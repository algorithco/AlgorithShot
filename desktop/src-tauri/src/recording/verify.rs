//! Opt-in, isolated smoke check for the real Windows recording pipeline.
//! Only this process's synthetic HWND is captured. No desktop, user window,
//! screenshot library, global shortcut or installed application is involved.

use std::path::Path;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::{Arc, mpsc};
use std::time::{Duration, Instant};

use ::windows::Win32::Foundation::{COLORREF, HINSTANCE, HWND, LPARAM, LRESULT, RECT, WPARAM};
use ::windows::Win32::Graphics::Gdi::{
    BeginPaint, CreateSolidBrush, DeleteObject, EndPaint, FillRect, InvalidateRect, PAINTSTRUCT,
    SetBkMode, SetTextColor, TRANSPARENT, TextOutW,
};
use ::windows::Win32::Media::MediaFoundation::*;
use ::windows::Win32::System::Com::{COINIT_MULTITHREADED, CoInitializeEx, CoUninitialize};
use ::windows::Win32::System::LibraryLoader::GetModuleHandleW;
use ::windows::Win32::UI::WindowsAndMessaging::{
    CreateWindowExW, DefWindowProcW, DestroyWindow, DispatchMessageW, GetClientRect, HWND_BOTTOM,
    IsWindow, KillTimer, MSG, PM_REMOVE, PeekMessageW, RegisterClassW, SWP_NOACTIVATE, SWP_NOMOVE,
    SWP_NOSIZE, SetTimer, SetWindowPos, TranslateMessage, UnregisterClassW, WM_PAINT, WM_QUIT,
    WM_TIMER, WNDCLASSW, WS_EX_NOACTIVATE, WS_EX_TOOLWINDOW, WS_POPUP, WS_VISIBLE,
};
use ::windows::core::{PCWSTR, w};
use anyhow::{Context, Result, anyhow, bail};

use super::windows as backend;

const CLASS_NAME: PCWSTR = w!("AlgorithShotSyntheticRecordingCheck");
static PAINT_TICK: AtomicU32 = AtomicU32::new(0);

unsafe extern "system" fn paint_window(
    hwnd: HWND,
    message: u32,
    wp: WPARAM,
    lp: LPARAM,
) -> LRESULT {
    match message {
        WM_TIMER => {
            PAINT_TICK.fetch_add(1, Ordering::Relaxed);
            let _ = unsafe { InvalidateRect(Some(hwnd), None, false) };
            LRESULT(0)
        }
        WM_PAINT => {
            let mut paint = PAINTSTRUCT::default();
            let dc = unsafe { BeginPaint(hwnd, &mut paint) };
            let mut bounds = RECT::default();
            let _ = unsafe { GetClientRect(hwnd, &mut bounds) };
            let background = unsafe { CreateSolidBrush(COLORREF(0x0024_2018)) };
            unsafe { FillRect(dc, &bounds, background) };
            let _ = unsafe { DeleteObject(background.into()) };

            let tick = PAINT_TICK.load(Ordering::Relaxed);
            let x = 24 + ((tick * 9) % 480) as i32;
            let bar = RECT {
                left: x * bounds.right / 640,
                top: bounds.bottom / 3,
                right: (x + 96) * bounds.right / 640,
                bottom: bounds.bottom * 5 / 6,
            };
            let foreground = unsafe { CreateSolidBrush(COLORREF(0x0000_d3ff)) };
            unsafe { FillRect(dc, &bar, foreground) };
            let _ = unsafe { DeleteObject(foreground.into()) };
            unsafe {
                SetBkMode(dc, TRANSPARENT);
                SetTextColor(dc, COLORREF(0x00ff_ffff));
            }
            let heading: Vec<u16> = "AlgorithShot - synthetic recording check"
                .encode_utf16()
                .collect();
            let label: Vec<u16> = format!("Own test window only | animation frame {tick:05}")
                .encode_utf16()
                .collect();
            let _ = unsafe { TextOutW(dc, 24, 26, &heading) };
            let _ = unsafe { TextOutW(dc, 24, 58, &label) };
            let _ = unsafe { EndPaint(hwnd, &paint) };
            LRESULT(0)
        }
        _ => unsafe { DefWindowProcW(hwnd, message, wp, lp) },
    }
}

struct SyntheticWindow {
    hwnd: HWND,
    instance: HINSTANCE,
}

impl SyntheticWindow {
    fn new(width: u32, height: u32) -> Result<Self> {
        let instance = HINSTANCE(unsafe { GetModuleHandleW(None) }?.0);
        let class = WNDCLASSW {
            lpfnWndProc: Some(paint_window),
            hInstance: instance,
            lpszClassName: CLASS_NAME,
            ..Default::default()
        };
        if unsafe { RegisterClassW(&class) } == 0 {
            bail!("Could not register the synthetic recording window class");
        }
        PAINT_TICK.store(0, Ordering::Relaxed);
        let result = unsafe {
            CreateWindowExW(
                WS_EX_NOACTIVATE | WS_EX_TOOLWINDOW,
                CLASS_NAME,
                w!("AlgorithShot synthetic recording verification"),
                WS_POPUP | WS_VISIBLE,
                48,
                48,
                width as i32,
                height as i32,
                None,
                None,
                Some(instance),
                None,
            )
        };
        let hwnd = match result {
            Ok(hwnd) => hwnd,
            Err(error) => {
                let _ = unsafe { UnregisterClassW(CLASS_NAME, Some(instance)) };
                return Err(error.into());
            }
        };
        let window = Self { hwnd, instance };
        // Keep the test pattern behind other windows and leave focus alone.
        unsafe {
            SetWindowPos(
                hwnd,
                Some(HWND_BOTTOM),
                0,
                0,
                0,
                0,
                SWP_NOACTIVATE | SWP_NOMOVE | SWP_NOSIZE,
            )
        }?;
        if unsafe { SetTimer(Some(hwnd), 1, 30, None) } == 0 {
            bail!("Could not start the synthetic animation timer");
        }
        Ok(window)
    }

    fn pump(&self) -> Result<()> {
        let mut message = MSG::default();
        while unsafe { PeekMessageW(&mut message, None, 0, 0, PM_REMOVE) }.as_bool() {
            if message.message == WM_QUIT {
                bail!("The synthetic recording window was closed before verification completed");
            }
            unsafe {
                let _ = TranslateMessage(&message);
                DispatchMessageW(&message);
            }
        }
        if !unsafe { IsWindow(Some(self.hwnd)) }.as_bool() {
            bail!("The synthetic recording window no longer exists");
        }
        Ok(())
    }

    fn freeze(&self) -> Result<()> {
        unsafe { KillTimer(Some(self.hwnd), 1) }?;
        Ok(())
    }

    fn close(&self) -> Result<()> {
        unsafe { DestroyWindow(self.hwnd) }?;
        Ok(())
    }
}

impl Drop for SyntheticWindow {
    fn drop(&mut self) {
        unsafe {
            let _ = KillTimer(Some(self.hwnd), 1);
            if IsWindow(Some(self.hwnd)).as_bool() {
                let _ = DestroyWindow(self.hwnd);
            }
            let _ = UnregisterClassW(CLASS_NAME, Some(self.instance));
        }
    }
}

struct StopOnDrop(Arc<AtomicBool>);
impl Drop for StopOnDrop {
    fn drop(&mut self) {
        self.0.store(true, Ordering::Release);
    }
}

/// Call before ordinary Tauri startup and single-instance forwarding.
/// Keeps the resulting videos in `output_dir` for manual inspection.
pub fn run(output_dir: &Path) -> Result<()> {
    std::fs::create_dir_all(output_dir)
        .context("creating the recording verification output directory")?;
    run_case(output_dir, 640, 360, 30, false)?;
    run_case(output_dir, 1920, 1080, 60, true)?;
    Ok(())
}

fn run_case(
    output_dir: &Path,
    width: u32,
    height: u32,
    fps: u32,
    close_source: bool,
) -> Result<()> {
    let path = output_dir.join(format!(
        "synthetic-recording-{fps}fps-{}.mp4",
        uuid::Uuid::new_v4()
    ));
    let window = SyntheticWindow::new(width, height)?;
    window.pump()?;
    let stop = Arc::new(AtomicBool::new(false));
    let _stop_guard = StopOnDrop(stop.clone());
    let paused = Arc::new(AtomicBool::new(false));
    let progress = Arc::new(backend::Progress::default());
    let (ready_tx, ready_rx) = mpsc::sync_channel(1);
    let (done_tx, done_rx) = mpsc::sync_channel(1);
    let options = backend::Options {
        source: backend::Source::Window(window.hwnd.0 as isize),
        path: path.clone(),
        fps,
        cursor: false,
    };
    let worker_stop = stop.clone();
    let worker_progress = progress.clone();
    let worker = std::thread::Builder::new()
        .name("recording-synthetic-check".into())
        .spawn(move || {
            let result = backend::run(options, worker_stop, paused, ready_tx, worker_progress);
            let _ = done_tx.send(result);
        })?;
    let launched = Instant::now();
    let mut ready_at = None;
    let mut started_info = None;
    let mut stop_at = None;
    let mut frozen = false;
    let mut source_closed = false;
    let result = loop {
        if !source_closed {
            if let Err(error) = window.pump() {
                break Err(error);
            }
        }
        if ready_at.is_none() {
            match ready_rx.try_recv() {
                Ok(Ok(started)) => {
                    println!(
                        "Recording synthetic HWND at {fps} fps: {} x {}, {}",
                        started.width, started.height, started.encoder
                    );
                    ready_at = Some(Instant::now());
                    started_info = Some(started);
                }
                Ok(Err(error)) => break Err(anyhow!(error)),
                Err(mpsc::TryRecvError::Empty | mpsc::TryRecvError::Disconnected) => {}
            }
        }
        if let Ok(finished) = done_rx.try_recv() {
            break finished;
        }
        if ready_at.is_none() && launched.elapsed() > Duration::from_secs(15) {
            break Err(anyhow!(
                "The native recorder did not initialize within 15 seconds"
            ));
        }
        // The last second deliberately has no source updates. This exercises
        // held-frame cadence and prevents a static desktop from ending early.
        if ready_at.is_some_and(|at: Instant| at.elapsed() >= Duration::from_secs(2)) && !frozen {
            if let Err(error) = window.freeze() {
                break Err(error);
            }
            frozen = true;
        }
        if ready_at.is_some_and(|at: Instant| at.elapsed() >= Duration::from_secs(3))
            && stop_at.is_none()
        {
            if close_source {
                if let Err(error) = window.close() {
                    break Err(error);
                }
                source_closed = true;
            } else {
                stop.store(true, Ordering::Release);
            }
            stop_at = Some(Instant::now());
        }
        if stop_at.is_some_and(|at: Instant| at.elapsed() > Duration::from_secs(15)) {
            break Err(anyhow!(
                "The native recorder did not finish within 15 seconds after stopping"
            ));
        }
        std::thread::sleep(Duration::from_millis(5));
    };
    stop.store(true, Ordering::Release);
    // A failed native pipeline must never hang verification indefinitely.
    // The caller exits this isolated process after the result is reported.
    if result.is_err() {
        let deadline = Instant::now() + Duration::from_secs(3);
        while !worker.is_finished() && Instant::now() < deadline {
            if !source_closed {
                let _ = window.pump();
            }
            std::thread::sleep(Duration::from_millis(5));
        }
        if worker.is_finished() {
            let _ = worker.join();
        }
        return result.map(|_| ());
    }
    worker
        .join()
        .map_err(|_| anyhow!("The synthetic recording worker panicked"))?;
    let finished = result?;
    let started = started_info.context("The recorder stopped before reporting readiness")?;
    if started.width != width || started.height != height {
        bail!(
            "Synthetic capture dimensions were {} x {}, expected {width} x {height}",
            started.width,
            started.height
        );
    }
    if finished.frames < 15 || finished.duration_ms < 2000 {
        bail!(
            "Synthetic recording was too short: {} frames over {} ms",
            finished.frames,
            finished.duration_ms
        );
    }
    if close_source && !source_closed {
        bail!("The source-close test did not close its own source");
    }
    let decoded = verify_video(&path, started.width, started.height, fps)?;
    println!(
        "Verified {fps} fps synthetic WGC recording, hardware encoding, static tail, {} and decoding: {decoded} samples, {} ms, {} dropped frames. File: {}",
        if close_source {
            "source-close finalization"
        } else {
            "explicit-stop finalization"
        },
        finished.duration_ms,
        progress.dropped_frames.load(Ordering::Acquire),
        path.display()
    );
    Ok(())
}

struct MediaRuntime;
impl MediaRuntime {
    fn new() -> Result<Self> {
        unsafe {
            CoInitializeEx(None, COINIT_MULTITHREADED).ok()?;
        }
        if let Err(error) = unsafe { MFStartup(MF_VERSION, MFSTARTUP_FULL) } {
            unsafe {
                CoUninitialize();
            }
            return Err(error.into());
        }
        Ok(Self)
    }
}
impl Drop for MediaRuntime {
    fn drop(&mut self) {
        unsafe {
            let _ = MFShutdown();
            CoUninitialize();
        }
    }
}

fn verify_video(path: &Path, width: u32, height: u32, fps: u32) -> Result<u64> {
    let _runtime = MediaRuntime::new()?;
    let wide: Vec<u16> = path.as_os_str().encode_wide().chain(Some(0)).collect();
    let reader =
        unsafe { MFCreateSourceReaderFromURL(PCWSTR(wide.as_ptr()), None::<&IMFAttributes>) }?;
    let stream = MF_SOURCE_READER_FIRST_VIDEO_STREAM.0 as u32;
    unsafe {
        reader.SetStreamSelection(MF_SOURCE_READER_ALL_STREAMS.0 as u32, false)?;
        reader.SetStreamSelection(stream, true)?;
    }
    let native = unsafe { reader.GetCurrentMediaType(stream) }?;
    if unsafe { native.GetGUID(&MF_MT_SUBTYPE) }? != MFVideoFormat_H264 {
        bail!("The synthetic recording does not contain H.264 video");
    }
    let dimensions = unsafe { native.GetUINT64(&MF_MT_FRAME_SIZE) }?;
    if dimensions >> 32 != width as u64 || dimensions as u32 != height {
        bail!("Encoded frame dimensions differ from the capture dimensions");
    }
    // The fragmented MP4 reader may derive a rate from presentation times.
    // Verify actual playback cadence below instead of exact metadata equality.
    let decoded_type = unsafe { MFCreateMediaType() }?;
    unsafe {
        decoded_type.SetGUID(&MF_MT_MAJOR_TYPE, &MFMediaType_Video)?;
        decoded_type.SetGUID(&MF_MT_SUBTYPE, &MFVideoFormat_NV12)?;
        reader.SetCurrentMediaType(stream, None, &decoded_type)?;
    }
    let mut samples = 0;
    let mut first_time = None;
    let mut last_time = None;
    let mut first_luma: Option<Vec<u8>> = None;
    let mut changed = false;
    let mut duration = 0;
    let mut decoded_luma = Vec::new();
    // A short recording cannot legitimately produce this many frames. The cap
    // also makes a malformed file unable to turn this check into an endless loop.
    for _ in 0..1200 {
        let (mut flags, mut timestamp, mut sample) = (0, 0, None);
        unsafe {
            reader.ReadSample(
                stream,
                0,
                None,
                Some(&mut flags),
                Some(&mut timestamp),
                Some(&mut sample),
            )
        }?;
        if flags & MF_SOURCE_READERF_ERROR.0 as u32 != 0 {
            bail!("The decoder reported an error");
        }
        if let Some(sample) = sample {
            if last_time.is_some_and(|last| timestamp <= last) {
                bail!("Decoded timestamps are not strictly increasing");
            }
            first_time.get_or_insert(timestamp);
            last_time = Some(timestamp);
            duration = timestamp + unsafe { sample.GetSampleDuration() }.unwrap_or(0);
            let buffer = unsafe { sample.ConvertToContiguousBuffer() }?;
            let (mut data, mut length) = (std::ptr::null_mut(), 0);
            unsafe { buffer.Lock(&mut data, None, Some(&mut length)) }?;
            let luma_len = (width * height) as usize;
            let luma = if !data.is_null() && length as usize >= luma_len {
                // The luma plane contains only this owned synthetic window.
                unsafe { std::slice::from_raw_parts(data, luma_len) }
                    .iter()
                    .step_by(97)
                    .copied()
                    .collect::<Vec<_>>()
            } else {
                Vec::new()
            };
            unsafe { buffer.Unlock() }?;
            if luma.is_empty() {
                bail!("The decoder produced an empty frame");
            }
            if let Some(first) = &first_luma {
                changed |= !visually_equal(first, &luma);
            } else {
                first_luma = Some(luma.clone());
            }
            decoded_luma.push((timestamp, luma));
            samples += 1;
        }
        if flags & MF_SOURCE_READERF_ENDOFSTREAM.0 as u32 != 0 {
            if samples < 15 {
                bail!("Only {samples} video frames could be decoded");
            }
            let duration_ms = (duration - first_time.unwrap_or(0)) / 10_000;
            if !(2000..=8000).contains(&duration_ms) {
                bail!("Decoded duration is unexpected: {duration_ms} ms");
            }
            let minimum_samples = duration_ms as u64 * u64::from(fps) * 9 / 10_000;
            if samples < minimum_samples {
                bail!(
                    "The {fps} fps recording decoded only {samples} frames over {duration_ms} ms (expected at least {minimum_samples})"
                );
            }
            if !changed {
                bail!("The decoded recording contains no animation changes");
            }
            // Hardware H.264 can vary quantization even for identical input.
            // Compare decoded luma within the final half-second with a small
            // tolerance instead of requiring bit-identical pixels.
            let tail_start = last_time.unwrap_or(0) - 5_000_000;
            let tail: Vec<_> = decoded_luma
                .iter()
                .filter(|(timestamp, _)| *timestamp >= tail_start)
                .map(|(_, luma)| luma)
                .collect();
            if tail.len() < 3 || !tail.windows(2).all(|pair| visually_equal(pair[0], pair[1])) {
                bail!("The static source tail did not produce repeated decoded frames");
            }
            return Ok(samples);
        }
    }
    bail!("The synthetic recording did not reach the end within 1200 decoded samples")
}

fn visually_equal(left: &[u8], right: &[u8]) -> bool {
    let delta: usize = left
        .iter()
        .zip(right)
        .map(|(a, b)| a.abs_diff(*b) as usize)
        .sum();
    delta <= left.len() * 2
}

use std::os::windows::ffi::OsStrExt;
