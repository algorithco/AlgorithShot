//! The tray icon: left click opens the app, right click opens the menu.

use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Wry};

use crate::i18n::t;
use crate::state::state;
use crate::{capture, wm};

const TRAY_ID: &str = "main";

fn menu(app: &AppHandle) -> tauri::Result<Menu<Wry>> {
    let st = state(app);
    let lang = st.settings().resolved_language();
    let capture_key = st.settings().hotkeys.capture;
    let item = |id: &str, accel: Option<&str>| MenuItem::with_id(app, id, t(&lang, id), true, accel);
    Menu::with_items(
        app,
        &[
            &item("capture", (!capture_key.is_empty()).then_some(capture_key.as_str()))?,
            &item("text", None)?,
            &item("qr", None)?,
            &item("screen", None)?,
            &item("repeat", None)?,
            &item("timer", None)?,
            &PredefinedMenuItem::separator(app)?,
            &item("library", None)?,
            &item("settings", None)?,
            &PredefinedMenuItem::separator(app)?,
            &item("quit", None)?,
        ],
    )
}

pub fn build(app: &AppHandle) -> tauri::Result<()> {
    let icon = app.default_window_icon().cloned().expect("app icon");
    TrayIconBuilder::with_id(TRAY_ID)
        .icon(icon)
        .tooltip("AlgorithShot")
        .menu(&menu(app)?)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "capture" => capture::start(app, "region"),
            "text" => capture::start(app, "text"),
            "qr" => capture::start(app, "qr"),
            "screen" => capture::start(app, "screen"),
            "timer" => capture::start_delayed(app, "region", 3),
            "repeat" => {
                if let Err(e) = capture::repeat_last(app) {
                    log::warn!("repeat: {e:#}");
                }
            }
            "library" => open_main(app, "library"),
            "settings" => open_main(app, "settings"),
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                open_main(tray.app_handle(), "library");
            }
        })
        .build(app)?;
    Ok(())
}

fn open_main(app: &AppHandle, page: &str) {
    // Window creation must not run on the tray's call stack (main thread).
    let app = app.clone();
    let page = page.to_string();
    std::thread::spawn(move || {
        if let Err(e) = wm::show_main(&app, Some(&page)) {
            log::warn!("open library: {e:#}");
        }
    });
}

/// Rebuilds the menu after the language or hotkeys change.
pub fn refresh(app: &AppHandle) {
    if let (Some(tray), Ok(menu)) = (app.tray_by_id(TRAY_ID), menu(app)) {
        let _ = tray.set_menu(Some(menu));
    }
}
