//! Commands the pages call with `invoke`. Errors become strings for the UI.
//! Anything that may create a window is `async` (see wm.rs).

use serde::Serialize;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Emitter, WebviewWindow};
use tauri_plugin_opener::OpenerExt;

use crate::capture::{self, CommitRequest};
use crate::card::{self, Card};
use crate::library::{AppCount, ListQuery, ListResult, Shot, Stats};
use crate::settings::Settings;
use crate::shots::{self, DeleteResult, Source};
use crate::state::{state, HotkeyStatus};
use crate::{clipboard, hotkeys, pins, tray, wm};

type CmdResult<T> = Result<T, String>;

fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}

fn anyhow_err(e: anyhow::Error) -> String {
    format!("{e:#}")
}

// ---- settings and app ----

#[tauri::command]
pub fn get_settings(app: AppHandle) -> Settings {
    state(&app).settings()
}

#[tauri::command]
pub async fn save_settings(app: AppHandle, mut settings: Settings) -> CmdResult<Settings> {
    settings.sanitize();
    let st = state(&app);
    let old = st.settings();
    settings.save(&st.paths.settings).map_err(anyhow_err)?;
    *st.settings.write() = settings.clone();

    if old.hotkeys != settings.hotkeys {
        hotkeys::register_all(&app);
    }
    if old.launch_at_login != settings.launch_at_login {
        use tauri_plugin_autostart::ManagerExt;
        let autostart = app.autolaunch();
        let res = if settings.launch_at_login { autostart.enable() } else { autostart.disable() };
        if let Err(e) = res {
            log::warn!("start with Windows: {e}");
        }
    }
    if old.save_dir != settings.save_dir {
        crate::watcher::restart(&app);
        let app = app.clone();
        std::thread::spawn(move || {
            let _ = shots::reconcile(&app);
        });
    }
    tray::refresh(&app);
    let _ = app.emit("settings:changed", settings.clone());
    Ok(settings)
}

#[tauri::command]
pub fn hotkey_status(app: AppHandle) -> Vec<HotkeyStatus> {
    state(&app).hotkeys.lock().clone()
}

/// Turns the global hotkeys off while Settings records a new one, so
/// pressing the current key doesn't start a capture.
#[tauri::command]
pub fn hotkeys_suspend(app: AppHandle, suspend: bool) -> Vec<HotkeyStatus> {
    hotkeys::set_recording(&app, suspend)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    version: String,
    save_dir: String,
    default_save_dir: String,
    /// The save folder is in OneDrive, so files also go to the cloud.
    save_dir_synced: bool,
    print_screen_taken: bool,
    language: String,
}

#[tauri::command]
pub fn app_info(app: AppHandle) -> AppInfo {
    let st = state(&app);
    let save_dir = st.save_dir();
    AppInfo {
        version: app.package_info().version.to_string(),
        save_dir_synced: crate::state::is_cloud_synced(&save_dir),
        save_dir: save_dir.to_string_lossy().into_owned(),
        default_save_dir: st.paths.default_save_dir.to_string_lossy().into_owned(),
        print_screen_taken: hotkeys::print_screen_blocked(&app),
        language: st.settings().resolved_language(),
    }
}

/// Opens the Windows Settings page where Print Screen can be given back.
#[tauri::command]
pub fn open_keyboard_settings(app: AppHandle) -> CmdResult<()> {
    app.opener().open_url("ms-settings:easeofaccess-keyboard", None::<&str>).map_err(err)
}

#[tauri::command]
pub async fn pick_folder(app: AppHandle) -> Option<String> {
    use tauri_plugin_dialog::DialogExt;
    tauri::async_runtime::spawn_blocking(move || {
        app.dialog().file().blocking_pick_folder().and_then(|p| p.into_path().ok()).map(|p| p.to_string_lossy().into_owned())
    })
    .await
    .ok()
    .flatten()
}

// ---- capture ----

#[tauri::command]
pub fn capture_start(app: AppHandle, mode: String, delay: Option<u32>) {
    match delay {
        Some(s) if s > 0 => capture::start_delayed(&app, &mode, s),
        _ => capture::start(&app, &mode),
    }
}

#[tauri::command]
pub fn overlay_ready(app: AppHandle, window: WebviewWindow, session_id: u64, monitor_id: usize) -> CmdResult<()> {
    capture::overlay_ready(&app, &window, session_id, monitor_id).map_err(anyhow_err)
}

#[tauri::command]
pub fn overlay_hide(window: WebviewWindow) -> CmdResult<()> {
    window.hide().map_err(err)
}

#[tauri::command]
pub fn capture_cancel(app: AppHandle, session_id: u64) {
    capture::cancel(&app, session_id);
}

#[tauri::command]
pub async fn capture_commit(app: AppHandle, req: CommitRequest) -> CmdResult<()> {
    capture::commit(&app, req).map_err(anyhow_err)
}

#[derive(Serialize)]
pub struct ElementOut {
    rect: crate::win::Rect,
    name: String,
}

/// UI elements under a point of a monitor in the current capture, smallest
/// first, relative to that monitor. Empty if element snapping is off.
#[tauri::command]
pub async fn element_at(app: AppHandle, session_id: u64, monitor_id: usize, x: i32, y: i32) -> Vec<ElementOut> {
    let st = state(&app);
    if !st.settings().elements {
        return Vec::new();
    }
    let Some(session) = st.capture.current().filter(|s| s.id == session_id) else { return Vec::new() };
    let Some(m) = session.frames.iter().map(|f| &f.monitor).find(|m| m.id == monitor_id) else { return Vec::new() };
    let (sx, sy) = (m.rect.x + x, m.rect.y + y);
    let Some(win) = session.windows.iter().find(|w| w.rect.contains(sx, sy)) else { return Vec::new() };
    let (hwnd, origin) = (win.hwnd, (m.rect.x, m.rect.y));
    tauri::async_runtime::spawn_blocking(move || crate::smart::uia::elements_at(hwnd, sx, sy, std::time::Duration::from_millis(260)))
        .await
        .unwrap_or_default()
        .into_iter()
        .map(|e| ElementOut { rect: e.rect.offset(-origin.0, -origin.1), name: e.name })
        .collect()
}

/// The words in part of the frozen screen, so the overlay can let the user
/// pick them right there. The capture stays open.
#[tauri::command]
pub async fn capture_read_text(app: AppHandle, session_id: u64, monitor_id: usize, rect: crate::win::Rect) -> CmdResult<Vec<crate::smart::ocr::Line>> {
    tauri::async_runtime::spawn_blocking(move || capture::read_text(&app, session_id, monitor_id, rect))
        .await
        .map_err(|e| e.to_string())?
        .map_err(anyhow_err)
}

#[tauri::command]
pub fn copy_color(app: AppHandle, hex: String) -> CmdResult<()> {
    clipboard::set_text(&hex).map_err(anyhow_err)?;
    card::show(&app, Card::Color { hex });
    Ok(())
}

#[tauri::command]
pub fn copy_text(text: String) -> CmdResult<()> {
    clipboard::set_text(&text).map_err(anyhow_err)
}

// ---- quick card ----

#[tauri::command]
pub fn card_ready(app: AppHandle, width: f64, height: f64) -> CmdResult<()> {
    card::ready(&app, width, height).map_err(anyhow_err)
}

#[tauri::command]
pub fn card_hide(app: AppHandle) {
    card::hide(&app);
}

#[tauri::command]
pub async fn temp_save(app: AppHandle, temp_id: String) -> CmdResult<Shot> {
    let img = state(&app).image(&temp_id).ok_or("this capture is no longer available")?;
    shots::save_new(&app, &img, &Source::default()).map_err(anyhow_err)
}

#[tauri::command]
pub fn temp_copy(app: AppHandle, temp_id: String) -> CmdResult<()> {
    let img = state(&app).image(&temp_id).ok_or("this capture is no longer available")?;
    clipboard::set_image(&img).map_err(anyhow_err)
}

// ---- library ----

#[tauri::command]
pub async fn library_list(app: AppHandle, query: ListQuery) -> CmdResult<ListResult> {
    state(&app).library.list(&query).map_err(anyhow_err)
}

#[derive(Serialize)]
pub struct Overview {
    stats: Stats,
    apps: Vec<AppCount>,
}

#[tauri::command]
pub async fn library_overview(app: AppHandle) -> CmdResult<Overview> {
    let lib = &state(&app).library;
    Ok(Overview { stats: lib.stats().map_err(anyhow_err)?, apps: lib.apps().map_err(anyhow_err)? })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShotDetail {
    shot: Shot,
    text: String,
    has_original: bool,
    privacy_json: String,
}

#[tauri::command]
pub async fn library_get(app: AppHandle, id: String) -> CmdResult<ShotDetail> {
    let st = state(&app);
    let shot = st.library.get(&id).map_err(anyhow_err)?.ok_or("not found")?;
    Ok(ShotDetail {
        text: st.library.text(&id).map_err(anyhow_err)?,
        privacy_json: st.library.privacy_json(&id).map_err(anyhow_err)?,
        has_original: shots::original_path(&app, &id).is_some(),
        shot,
    })
}

#[tauri::command]
pub async fn library_delete(app: AppHandle, ids: Vec<String>, permanent: bool) -> CmdResult<DeleteResult> {
    shots::delete(&app, &ids, permanent).map_err(anyhow_err)
}

#[tauri::command]
pub async fn library_undo_delete(app: AppHandle) -> CmdResult<usize> {
    shots::undo_delete(&app).map_err(anyhow_err)
}

#[tauri::command]
pub async fn library_rename(app: AppHandle, id: String, name: String) -> CmdResult<Shot> {
    shots::rename(&app, &id, &name).map_err(anyhow_err)
}

#[tauri::command]
pub async fn library_favorite(app: AppHandle, id: String, value: bool) -> CmdResult<()> {
    state(&app).library.set_favorite(&id, value).map_err(anyhow_err)?;
    let _ = app.emit("library:changed", &id);
    Ok(())
}

fn shot_path(app: &AppHandle, id: &str) -> CmdResult<PathBuf> {
    let shot = state(app).library.get(id).map_err(anyhow_err)?.ok_or("not found")?;
    Ok(PathBuf::from(shot.path))
}

#[tauri::command]
pub fn library_reveal(app: AppHandle, id: String) -> CmdResult<()> {
    let path = shot_path(&app, &id)?;
    app.opener().reveal_item_in_dir(path).map_err(err)
}

#[tauri::command]
pub fn reveal_path(app: AppHandle, path: String) -> CmdResult<()> {
    app.opener().reveal_item_in_dir(path).map_err(err)
}

/// A small PNG preview to show under the cursor while dragging a file out.
#[tauri::command]
pub async fn drag_icon(app: AppHandle, id: Option<String>, temp_id: Option<String>) -> CmdResult<String> {
    let st = state(&app);
    let key = id.clone().or(temp_id.clone()).ok_or("nothing to drag")?;
    let out = st.paths.thumbs.join(format!("{key}.drag.png"));
    if !out.exists() {
        let img = match (id, temp_id) {
            (Some(id), _) => shots::load_rgba(&shot_path(&app, &id)?).map_err(anyhow_err)?,
            (None, Some(t)) => (*st.image(&t).ok_or("this capture is no longer available")?).clone(),
            _ => unreachable!(),
        };
        let small = crate::imaging::thumbnail(&img, 160).map_err(anyhow_err)?;
        std::fs::create_dir_all(&st.paths.thumbs).map_err(err)?;
        small.save(&out).map_err(err)?;
    }
    Ok(out.to_string_lossy().into_owned())
}

/// Writes an unsaved capture to a temporary file, so it can be dragged out.
#[tauri::command]
pub async fn temp_file(app: AppHandle, temp_id: String) -> CmdResult<String> {
    let st = state(&app);
    let img = st.image(&temp_id).ok_or("this capture is no longer available")?;
    let dir = std::env::temp_dir().join("AlgorithShot");
    std::fs::create_dir_all(&dir).map_err(err)?;
    let path = dir.join(format!("Screenshot {}.png", chrono::Local::now().format("%Y-%m-%d %H-%M-%S")));
    let data = crate::imaging::encode(&img, crate::imaging::Format::Png, 100).map_err(anyhow_err)?;
    std::fs::write(&path, data).map_err(err)?;
    Ok(path.to_string_lossy().into_owned())
}

#[tauri::command]
pub fn library_open_folder(app: AppHandle) -> CmdResult<()> {
    let dir = state(&app).save_dir();
    std::fs::create_dir_all(&dir).map_err(err)?;
    app.opener().open_path(dir.to_string_lossy(), None::<&str>).map_err(err)
}

#[tauri::command]
pub async fn library_copy(app: AppHandle, ids: Vec<String>, as_file: bool) -> CmdResult<()> {
    let paths = ids.iter().map(|id| shot_path(&app, id)).collect::<CmdResult<Vec<_>>>()?;
    if as_file || paths.len() > 1 {
        let refs: Vec<&Path> = paths.iter().map(PathBuf::as_path).collect();
        clipboard::set_files(&refs).map_err(anyhow_err)
    } else {
        let img = shots::load_rgba(&paths[0]).map_err(anyhow_err)?;
        clipboard::set_image(&img).map_err(anyhow_err)
    }
}

#[tauri::command]
pub async fn library_pin(app: AppHandle, id: String) -> CmdResult<()> {
    let path = shot_path(&app, &id)?;
    pins::open_shot(&app, &path).map_err(anyhow_err)
}

#[tauri::command]
pub async fn temp_pin(app: AppHandle, temp_id: String) -> CmdResult<()> {
    let img = state(&app).image(&temp_id).ok_or("this capture is no longer available")?;
    let monitors = crate::win::monitors();
    let work = monitors.first().map(|m| m.work).unwrap_or_default();
    let (w, h) = (img.width() as i32, img.height() as i32);
    let at = crate::win::Rect::new(work.x + (work.w - w).max(0) / 2, work.y + (work.h - h).max(0) / 2, w, h);
    pins::open(&app, (*img).clone(), at).map_err(anyhow_err)
}

#[tauri::command]
pub fn pin_closed(app: AppHandle, id: String) {
    pins::closed(&app, &id);
}

#[tauri::command]
pub async fn open_editor(app: AppHandle, target: String, panel: Option<String>) -> CmdResult<()> {
    wm::open_editor_with(&app, &target, panel.as_deref()).map_err(anyhow_err)
}

#[tauri::command]
pub async fn show_library(app: AppHandle, page: Option<String>) -> CmdResult<()> {
    wm::show_main(&app, page.as_deref()).map_err(anyhow_err)
}

#[derive(Serialize)]
pub struct Cleanup {
    duplicates: Vec<Vec<Shot>>,
    old: Vec<Shot>,
    large: Vec<Shot>,
}

/// Duplicates, screenshots older than 90 days and files over 3 MB.
#[tauri::command]
pub async fn cleanup_scan(app: AppHandle) -> CmdResult<Cleanup> {
    let lib = &state(&app).library;
    let groups = crate::smart::duplicate_groups(&lib.phashes().map_err(anyhow_err)?, 6);
    let duplicates = groups.into_iter().map(|g| lib.get_many(&g)).collect::<anyhow::Result<Vec<_>>>().map_err(anyhow_err)?;
    let cutoff = chrono::Local::now().timestamp_millis() - 90 * 86_400_000;
    Ok(Cleanup {
        duplicates: duplicates.into_iter().filter(|g| g.len() > 1).collect(),
        old: lib.older_than(cutoff).map_err(anyhow_err)?,
        large: lib.larger_than(3 * 1024 * 1024).map_err(anyhow_err)?,
    })
}

/// "Save as…" from the quick card: asks where, then writes the file.
#[tauri::command]
pub async fn save_as_image(app: AppHandle, id: Option<String>, temp_id: Option<String>) -> CmdResult<()> {
    let img = match (id, temp_id) {
        (Some(id), _) => shots::load_rgba(&shot_path(&app, &id)?).map_err(anyhow_err)?,
        (None, Some(t)) => (*state(&app).image(&t).ok_or("this capture is no longer available")?).clone(),
        _ => return Err("nothing to save".into()),
    };
    tauri::async_runtime::spawn_blocking(move || capture::save_as(&app, &img))
        .await
        .map_err(err)?
        .map_err(anyhow_err)
}

/// Copies the image and brings Telegram forward so the user can paste it.
/// Returns false if Telegram isn't running (then it's opened).
#[tauri::command]
pub async fn share_telegram(app: AppHandle, id: Option<String>, temp_id: Option<String>) -> CmdResult<bool> {
    let img = match (id, temp_id) {
        (Some(id), _) => shots::load_rgba(&shot_path(&app, &id)?).map_err(anyhow_err)?,
        (None, Some(t)) => (*state(&app).image(&t).ok_or("this capture is no longer available")?).clone(),
        _ => return Err("nothing to share".into()),
    };
    clipboard::set_image(&img).map_err(anyhow_err)?;
    if crate::win::focus_app("Telegram") {
        return Ok(true);
    }
    app.opener().open_url("tg://", None::<&str>).map_err(err)?;
    Ok(false)
}
