//! Global hotkeys, registered from the settings. A key another app already
//! owns fails to register; the status is kept so Settings can say so.

use tauri::AppHandle;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

use crate::state::{state, HotkeyStatus};
use crate::{capture, wm};

pub fn register_all(app: &AppHandle) -> Vec<HotkeyStatus> {
    let gs = app.global_shortcut();
    let _ = gs.unregister_all();
    let hotkeys = state(app).settings().hotkeys;
    let mut status = Vec::new();
    for (action, key) in hotkeys.bindings() {
        let res = gs.on_shortcut(key, move |app, _shortcut, event| {
            if event.state == ShortcutState::Pressed {
                run(app, action);
            }
        });
        if let Err(e) = &res {
            log::warn!("hotkey {key} for {action}: {e}");
        }
        status.push(HotkeyStatus {
            action: action.to_string(),
            key: key.to_string(),
            ok: res.is_ok(),
            error: res.err().map(|e| e.to_string()),
        });
    }
    *state(app).hotkeys.lock() = status.clone();
    status
}

pub fn run(app: &AppHandle, action: &str) {
    match action {
        "capture" => capture::start(app, "region"),
        "text" => capture::start(app, "text"),
        "qr" => capture::start(app, "qr"),
        "screen" => capture::start(app, "screen"),
        "repeat" => {
            let app = app.clone();
            std::thread::spawn(move || {
                if let Err(e) = capture::repeat_last(&app) {
                    log::warn!("repeat: {e:#}");
                }
            });
        }
        "library" => {
            let app = app.clone();
            std::thread::spawn(move || {
                let _ = wm::show_main(&app, Some("library"));
            });
        }
        _ => {}
    }
}

/// True when Windows gives Print Screen to the Snipping Tool.
pub fn print_screen_taken_by_windows() -> bool {
    use windows::core::w;
    use windows::Win32::System::Registry::{RegGetValueW, HKEY_CURRENT_USER, RRF_RT_REG_DWORD};
    let mut value: u32 = 0;
    let mut size = std::mem::size_of::<u32>() as u32;
    let res = unsafe {
        RegGetValueW(
            HKEY_CURRENT_USER,
            w!("Control Panel\\Keyboard"),
            w!("PrintScreenKeyForSnippingEnabled"),
            RRF_RT_REG_DWORD,
            None,
            Some(&mut value as *mut _ as *mut _),
            Some(&mut size),
        )
    };
    // On current Windows 11 the setting is on unless the user turned it off.
    if res.is_err() { true } else { value != 0 }
}
