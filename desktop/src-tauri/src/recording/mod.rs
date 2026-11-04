//! Video recording owns its workers and files independently of screenshot sessions.
//! The webview receives status only; video surfaces never cross Tauri IPC.

use anyhow::{Context, Result, bail};
use parking_lot::{Condvar, Mutex};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::{
    Arc,
    atomic::{AtomicBool, Ordering},
};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager};
use tauri_plugin_opener::OpenerExt;

#[cfg(target_os = "windows")]
mod shortcut;
#[cfg(target_os = "windows")]
pub mod verify;
#[cfg(target_os = "windows")]
mod windows;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordingSource {
    pub id: String,
    pub name: String,
    pub kind: &'static str,
    pub width: u32,
    pub height: u32,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Sources {
    supported: bool,
    reason: Option<String>,
    sources: Vec<RecordingSource>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RecordingOptions {
    pub source_id: String,
    pub fps: u32,
    pub cursor: bool,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Phase {
    #[default]
    Idle,
    Starting,
    Recording,
    Stopping,
    Completed,
    Failed,
}

impl Phase {
    pub fn active(self) -> bool {
        matches!(self, Self::Starting | Self::Recording | Self::Stopping)
    }
}

#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    pub phase: Phase,
    pub elapsed_ms: u64,
    pub frames: u64,
    pub dropped_frames: u64,
    pub bytes: u64,
    pub fps: u32,
    pub width: u32,
    pub height: u32,
    pub encoder: Option<String>,
    pub path: Option<String>,
    pub error: Option<String>,
}

struct Session {
    stop: Arc<AtomicBool>,
    #[cfg(target_os = "windows")]
    progress: Arc<windows::Progress>,
    status: Mutex<Status>,
    finished: Condvar,
}

impl Session {
    fn phase(&self) -> Phase {
        self.status.lock().phase
    }

    fn new(path: PathBuf, fps: u32) -> Self {
        Self {
            stop: Arc::new(AtomicBool::new(false)),
            #[cfg(target_os = "windows")]
            progress: Arc::new(windows::Progress::default()),
            status: Mutex::new(Status {
                phase: Phase::Starting,
                path: Some(path.to_string_lossy().into_owned()),
                fps,
                ..Status::default()
            }),
            finished: Condvar::new(),
        }
    }

    fn snapshot(&self) -> Status {
        let mut status = self.status.lock().clone();
        #[cfg(target_os = "windows")]
        if status.phase.active() {
            status.frames = self.progress.frames.load(Ordering::Relaxed);
            status.dropped_frames = self.progress.dropped_frames.load(Ordering::Relaxed);
            status.elapsed_ms = self.progress.duration_ms.load(Ordering::Relaxed);
        }
        if let Some(path) = &status.path {
            status.bytes = std::fs::metadata(path)
                .map(|m| m.len())
                .unwrap_or(status.bytes);
        }
        status
    }

    fn request_stop(&self) {
        let mut status = self.status.lock();
        if status.phase.active() {
            status.phase = Phase::Stopping;
            self.stop.store(true, Ordering::Release);
        }
    }

    fn wait(&self, timeout: Duration) -> Result<Status> {
        let deadline = Instant::now() + timeout;
        let mut status = self.status.lock();
        while status.phase.active() {
            let Some(remaining) = deadline.checked_duration_since(Instant::now()) else {
                bail!("The recording is still being saved. Keep AlgorithShot open and try again.");
            };
            self.finished.wait_for(&mut status, remaining);
        }
        drop(status);
        Ok(self.snapshot())
    }

    fn finish(&self, result: Result<()>) {
        // Stop the separately owned shortcut thread even when the source closes.
        self.stop.store(true, Ordering::Release);
        let mut status = self.snapshot();
        match result {
            Ok(()) => status.phase = Phase::Completed,
            Err(error) => {
                status.phase = Phase::Failed;
                status.error = Some(format!("{error:#}"));
            }
        }
        *self.status.lock() = status;
        self.finished.notify_all();
    }
}

#[derive(Default)]
struct Store {
    session: Option<Arc<Session>>,
    update_locked: bool,
    shutting_down: bool,
}

#[derive(Default)]
pub struct RecordingState(Mutex<Store>);

impl RecordingState {
    fn reserve(&self, session: Arc<Session>) -> Result<()> {
        let mut store = self.0.lock();
        if store.shutting_down {
            bail!("AlgorithShot is closing.");
        }
        if store.update_locked {
            bail!("Wait for the app update to finish before recording.");
        }
        if store.session.as_ref().is_some_and(|s| s.phase().active()) {
            bail!("A recording is already running or being saved.");
        }
        store.session = Some(session);
        Ok(())
    }

    fn session(&self) -> Option<Arc<Session>> {
        self.0.lock().session.clone()
    }

    fn update_lock(&self, locked: bool) -> Result<()> {
        let mut store = self.0.lock();
        if locked && store.session.as_ref().is_some_and(|s| s.phase().active()) {
            bail!("Stop and save the recording before installing an update.");
        }
        store.update_locked = locked;
        Ok(())
    }
}

pub fn is_active(app: &AppHandle) -> bool {
    app.try_state::<RecordingState>()
        .and_then(|s| s.session())
        .is_some_and(|s| s.phase().active())
}

/// Keep optional thumbnail/optimization/OCR work out of the recording budget.
pub fn wait_until_idle(app: &AppHandle) {
    while is_active(app) {
        std::thread::sleep(Duration::from_millis(200));
    }
}

fn sources() -> Result<Sources> {
    #[cfg(target_os = "windows")]
    {
        // Tauri's blocking pool is not guaranteed to have initialized WinRT.
        let initialized = unsafe {
            ::windows::Win32::System::WinRT::RoInitialize(
                ::windows::Win32::System::WinRT::RO_INIT_MULTITHREADED,
            )
        }
        .is_ok();
        let supported = windows::capture_supported().unwrap_or(false);
        if initialized {
            unsafe { ::windows::Win32::System::WinRT::RoUninitialize() };
        }
        if !supported {
            return Ok(Sources {
                supported: false,
                reason: Some("Windows Graphics Capture is unavailable on this desktop.".into()),
                sources: vec![],
            });
        }
        let mut sources: Vec<_> = crate::win::monitors()
            .into_iter()
            .map(|m| RecordingSource {
                id: format!("monitor:{}", m.name),
                name: m.name,
                kind: "monitor",
                width: m.rect.w.max(0) as u32,
                height: m.rect.h.max(0) as u32,
            })
            .collect();
        sources.extend(
            crate::win::visible_windows()
                .into_iter()
                .filter(|w| !w.title.trim().is_empty())
                .map(|w| RecordingSource {
                    id: format!("window:{}", w.hwnd),
                    name: if w.app.is_empty() {
                        w.title
                    } else {
                        format!("{} — {}", w.app, w.title)
                    },
                    kind: "window",
                    width: w.rect.w.max(0) as u32,
                    height: w.rect.h.max(0) as u32,
                }),
        );
        Ok(Sources {
            supported: true,
            reason: None,
            sources,
        })
    }
    #[cfg(not(target_os = "windows"))]
    {
        Ok(Sources { supported: false, reason: Some("Video recording is currently available on Windows. Screenshots continue to work on this platform.".into()), sources: vec![] })
    }
}

fn validate_options(options: &RecordingOptions) -> Result<()> {
    if !matches!(options.fps, 30 | 60) {
        bail!("Choose 30 or 60 frames per second.");
    }
    if options.source_id.is_empty() || options.source_id.len() > 1024 {
        bail!("Choose a recording source.");
    }
    Ok(())
}

#[cfg(target_os = "windows")]
fn start(app: AppHandle, options: RecordingOptions) -> Result<Status> {
    validate_options(&options)?;
    let available = sources()?;
    if !available.supported {
        bail!("{}", available.reason.unwrap_or_default());
    }
    if !available.sources.iter().any(|s| s.id == options.source_id) {
        bail!("The selected screen or window is no longer available. Refresh the sources.");
    }
    let source = if let Some(name) = options.source_id.strip_prefix("monitor:") {
        windows::Source::Monitor(name.to_owned())
    } else if let Some(handle) = options.source_id.strip_prefix("window:") {
        windows::Source::Window(handle.parse().context("Invalid window")?)
    } else {
        bail!("Invalid recording source.");
    };
    let st = crate::state::state(&app);
    let dir = st.save_dir().join("Recordings");
    st.paths.validate_save_dir(&dir)?;
    crate::settings::ensure_capture_dir_writable(&dir)?;
    // A UUID prevents concurrent/previous runs from overwriting user recordings.
    let path = dir.join(format!(
        "Recording {} {}.mp4",
        chrono::Local::now().format("%Y-%m-%d %H-%M-%S"),
        uuid::Uuid::new_v4()
    ));
    let session = Arc::new(Session::new(path.clone(), options.fps));
    app.state::<RecordingState>().reserve(session.clone())?;
    let worker = session.clone();
    let spawned = std::thread::Builder::new().name("screen-recorder".into()).spawn(move || {
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| -> Result<()> {
            let _shortcut = shortcut::StopShortcut::start(worker.stop.clone())?;
            let (ready_tx, ready_rx) = std::sync::mpsc::sync_channel::<std::result::Result<windows::Started, String>>(1);
            let observer = worker.clone();
            let ready = std::thread::Builder::new().name("recording-ready".into()).spawn(move || {
                if let Ok(Ok(info)) = ready_rx.recv() {
                    let mut status = observer.status.lock();
                    if status.phase == Phase::Starting { status.phase = Phase::Recording; }
                    status.width = info.width;
                    status.height = info.height;
                    status.encoder = Some(info.encoder);
                }
            })?;
            let native = windows::Options { source, path, fps: options.fps, cursor: options.cursor };
            let result = windows::run(native, worker.stop.clone(), Arc::new(AtomicBool::new(false)), ready_tx, worker.progress.clone());
            let _ = ready.join();
            let finished = result?;
            worker.progress.frames.store(finished.frames, Ordering::Relaxed);
            worker.progress.duration_ms.store(finished.duration_ms, Ordering::Relaxed);
            Ok(())
        })).unwrap_or_else(|_| Err(anyhow::anyhow!("The recorder stopped unexpectedly. Any completed video fragments remain in the recording folder.")));
        worker.finish(result);
    });
    if let Err(error) = spawned {
        session.finish(Err(error.into()));
    }
    Ok(session.snapshot())
}

#[tauri::command]
pub async fn recording_sources() -> Result<Sources, String> {
    tauri::async_runtime::spawn_blocking(sources)
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| format!("{e:#}"))
}

#[tauri::command]
pub async fn recording_status(app: AppHandle) -> Status {
    let session = app.state::<RecordingState>().session();
    tauri::async_runtime::spawn_blocking(move || session.map(|s| s.snapshot()).unwrap_or_default())
        .await
        .unwrap_or_default()
}

#[tauri::command]
pub async fn recording_start(app: AppHandle, options: RecordingOptions) -> Result<Status, String> {
    #[cfg(target_os = "windows")]
    {
        tauri::async_runtime::spawn_blocking(move || start(app, options))
            .await
            .map_err(|e| e.to_string())?
            .map_err(|e| format!("{e:#}"))
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = app;
        validate_options(&options).map_err(|e| e.to_string())?;
        Err("Video recording is currently available on Windows.".into())
    }
}

#[tauri::command]
pub async fn recording_stop(app: AppHandle) -> Result<Status, String> {
    let session = app.state::<RecordingState>().session();
    tauri::async_runtime::spawn_blocking(move || {
        let Some(session) = session else {
            return Ok(Status::default());
        };
        session.request_stop();
        session
            .wait(Duration::from_secs(30))
            .map_err(|e| format!("{e:#}"))
    })
    .await
    .map_err(|e| e.to_string())?
}

fn finished_path(app: &AppHandle, allow_partial: bool) -> Result<PathBuf> {
    let status = app
        .state::<RecordingState>()
        .session()
        .map(|s| s.snapshot())
        .context("No recording has been saved yet.")?;
    if status.phase != Phase::Completed
        && !(allow_partial && status.phase == Phase::Failed && status.bytes > 0)
    {
        bail!("There is no saved recording to open yet.");
    }
    let path = PathBuf::from(status.path.context("Recording has no file")?);
    if !path.is_file() {
        bail!("The recording file has been moved or removed.");
    }
    Ok(path)
}

#[tauri::command]
pub async fn recording_open(app: AppHandle) -> Result<(), String> {
    let path = finished_path(&app, false).map_err(|e| e.to_string())?;
    app.opener()
        .open_path(path.to_string_lossy(), None::<&str>)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn recording_reveal(app: AppHandle) -> Result<(), String> {
    let path = finished_path(&app, true).map_err(|e| e.to_string())?;
    app.opener()
        .reveal_item_in_dir(path)
        .map_err(|e| e.to_string())
}

/// Serializes recording starts against the Windows installer, which may exit
/// the process without delivering a normal Tauri shutdown event.
#[tauri::command]
pub fn recording_update_lock(app: AppHandle, locked: bool) -> Result<(), String> {
    app.state::<RecordingState>()
        .update_lock(locked)
        .map_err(|e| e.to_string())
}

/// A normal window close still leaves the tray app running. Explicit Quit or
/// relaunch must wait for video finalization before allowing the process out.
pub fn shutdown(app: &AppHandle, code: i32) {
    let recording = app.state::<RecordingState>();
    let mut store = recording.0.lock();
    if store.shutting_down {
        return;
    }
    store.shutting_down = true;
    let session = store.session.clone();
    drop(store);
    let worker_app = app.clone();
    let spawned = std::thread::Builder::new()
        .name("recording-shutdown".into())
        .spawn(move || {
            if let Some(session) = session {
                session.request_stop();
                if let Err(error) = session.wait(Duration::from_secs(30)) {
                    log::error!("Cannot quit while saving recording: {error:#}");
                    worker_app.state::<RecordingState>().0.lock().shutting_down = false;
                    return;
                }
            }
            worker_app.exit(code);
        });
    if let Err(error) = spawned {
        app.state::<RecordingState>().0.lock().shutting_down = false;
        log::error!("Cannot start recording shutdown worker: {error}");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn session() -> Arc<Session> {
        Arc::new(Session::new(PathBuf::from("test-recording.mp4"), 30))
    }

    #[test]
    fn invalid_frame_rates_are_rejected() {
        for fps in [0, 1, 29, 120, u32::MAX] {
            assert!(
                validate_options(&RecordingOptions {
                    source_id: "monitor:test".into(),
                    fps,
                    cursor: true
                })
                .is_err()
            );
        }
    }

    #[test]
    fn simultaneous_starts_cannot_replace_a_live_session() {
        let state = Arc::new(RecordingState::default());
        let barrier = Arc::new(std::sync::Barrier::new(9));
        let workers: Vec<_> = (0..8)
            .map(|_| {
                let state = state.clone();
                let barrier = barrier.clone();
                std::thread::spawn(move || {
                    barrier.wait();
                    state.reserve(session()).is_ok()
                })
            })
            .collect();
        barrier.wait();
        assert_eq!(
            workers
                .into_iter()
                .filter_map(|w| w.join().ok())
                .filter(|ok| *ok)
                .count(),
            1
        );
    }

    #[test]
    fn updates_and_recordings_are_mutually_exclusive() {
        let state = RecordingState::default();
        state.update_lock(true).unwrap();
        assert!(state.reserve(session()).is_err());
        state.update_lock(false).unwrap();
        let live = session();
        state.reserve(live.clone()).unwrap();
        assert!(state.update_lock(true).is_err());
        live.request_stop();
        assert!(state.update_lock(true).is_err());
        live.finish(Ok(()));
        state.update_lock(true).unwrap();
    }

    #[test]
    fn stop_is_idempotent_and_the_slot_stays_busy_until_finalize() {
        let state = RecordingState::default();
        let live = session();
        state.reserve(live.clone()).unwrap();
        live.request_stop();
        live.request_stop();
        assert!(live.stop.load(Ordering::Acquire));
        assert_eq!(live.snapshot().phase, Phase::Stopping);
        assert!(state.reserve(session()).is_err());
        assert!(live.wait(Duration::ZERO).is_err());
        live.finish(Ok(()));
        assert_eq!(live.wait(Duration::ZERO).unwrap().phase, Phase::Completed);
        state.reserve(session()).unwrap();
    }

    #[test]
    fn failure_wakes_waiters_and_allows_retry() {
        let live = session();
        let waiting = live.clone();
        let worker = std::thread::spawn(move || waiting.wait(Duration::from_secs(2)));
        live.finish(Err(anyhow::anyhow!("encoder unavailable")));
        let status = worker.join().unwrap().unwrap();
        assert_eq!(status.phase, Phase::Failed);
        assert!(status.error.unwrap().contains("encoder unavailable"));
    }
}
