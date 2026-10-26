//! Native global shortcuts on macOS and Linux; conflicts are shown in Settings.

use tauri::AppHandle;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};
use crate::{capture, wm, state::{state, HotkeyStatus}};

pub fn register_all(app: &AppHandle) -> Vec<HotkeyStatus> {
    let shortcuts = app.global_shortcut();
    let _ = shortcuts.unregister_all();
    let bindings = state(app).settings().hotkeys;
    let statuses: Vec<_> = bindings.bindings().into_iter().map(|(action, key)| {
        let result = shortcuts.on_shortcut(key, move |app, _, event| {
            if event.state == ShortcutState::Pressed { run(app, action); }
        });
        HotkeyStatus { action: action.into(), key: key.into(), ok: result.is_ok(), error: result.err().map(|e| e.to_string()) }
    }).collect();
    *state(app).hotkeys.lock() = statuses.clone();
    statuses
}

pub fn set_recording(app: &AppHandle, on: bool) -> Vec<HotkeyStatus> {
    if on { let _ = app.global_shortcut().unregister_all(); Vec::new() } else { register_all(app) }
}

pub fn print_screen_blocked(_: &AppHandle) -> bool { false }

pub fn run(app: &AppHandle, action: &str) {
    match action {
        "capture" => capture::start(app, "region"),
        "text" => capture::start(app, "text"),
        "qr" => capture::start(app, "qr"),
        "screen" => capture::start(app, "screen"),
        "repeat" => {
            let app = app.clone();
            std::thread::spawn(move || { if let Err(e) = capture::repeat_last(&app) { log::warn!("repeat: {e:#}"); } });
        }
        "library" => {
            let app = app.clone();
            std::thread::spawn(move || { if let Err(e) = wm::show_main(&app, Some("library")) { log::warn!("library: {e:#}"); } });
        }
        _ => {}
    }
}
