//! Algorithco Shot: a screenshot app that captures exactly what you need,
//! finds it again, and helps you share it safely.

mod capture;
mod card;
mod clipboard;
mod commands;
mod editor;
mod hotkeys;
mod i18n;
mod imaging;
mod jobs;
mod library;
mod pins;
mod protocol;
mod settings;
mod shots;
mod smart;
mod state;
mod tray;
mod watcher;
mod win;
mod wm;

use tauri::{AppHandle, Manager, RunEvent};

use crate::jobs::Jobs;
use crate::library::Library;
use crate::settings::Settings;
use crate::state::{AppState, Paths};

/// Command-line actions, also forwarded when the app is already running:
/// `--capture [mode]`, `--text`, `--qr`, `--library`, `--settings`, `--hidden`.
fn handle_args(app: &AppHandle, args: &[String], first_launch: bool) {
    let has = |flag: &str| args.iter().any(|a| a == flag);
    if has("--capture") {
        let mode = args
            .iter()
            .skip_while(|a| *a != "--capture")
            .nth(1)
            .filter(|m| !m.starts_with("--"))
            .cloned()
            .unwrap_or_else(|| "region".into());
        capture::start(app, &mode);
    } else if has("--text") {
        capture::start(app, "text");
    } else if has("--qr") {
        capture::start(app, "qr");
    } else if has("--settings") {
        show_main_later(app, "settings");
    } else if has("--library") || !first_launch {
        // Starting the app again by hand means "show me the window".
        show_main_later(app, "library");
    } else if !has("--hidden") {
        show_main_later(app, "library");
    }
}

fn show_main_later(app: &AppHandle, page: &str) {
    let app = app.clone();
    let page = page.to_string();
    std::thread::spawn(move || {
        if let Err(e) = wm::show_main(&app, Some(&page)) {
            log::warn!("open window: {e:#}");
        }
    });
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| handle_args(app, &args, false)))
        .plugin(
            tauri_plugin_log::Builder::new()
                .level(if cfg!(debug_assertions) { log::LevelFilter::Debug } else { log::LevelFilter::Info })
                .level_for("tao", log::LevelFilter::Warn)
                .level_for("notify", log::LevelFilter::Warn)
                .build(),
        )
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_autostart::Builder::new().args(["--hidden"]).build())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_drag::init())
        .register_asynchronous_uri_scheme_protocol("shot", protocol::handle)
        .setup(|app| {
            let handle = app.handle().clone();
            let paths = Paths::resolve(&handle)?;
            let settings = Settings::load(&paths.settings);
            let library = Library::open(&paths.database)?;
            app.manage(AppState::new(paths, settings, library, Jobs::new()));

            let st = state::state(&handle);
            st.jobs.start(handle.clone());
            tray::build(&handle)?;
            hotkeys::register_all(&handle);
            wm::precreate(&handle);
            watcher::restart(&handle);

            let bg = handle.clone();
            std::thread::spawn(move || {
                if let Err(e) = shots::reconcile(&bg) {
                    log::warn!("library check: {e:#}");
                }
                smart::resume_indexing(&bg);
                // Automatic clean-up, if it's turned on: now and every 6 hours.
                loop {
                    match shots::auto_clean(&bg) {
                        Ok(0) => {}
                        Ok(n) => log::info!("auto clean-up moved {n} screenshot(s) to the Recycle Bin"),
                        Err(e) => log::warn!("auto clean-up: {e:#}"),
                    }
                    std::thread::sleep(std::time::Duration::from_secs(6 * 3600));
                }
            });

            let args: Vec<String> = std::env::args().collect();
            let first_run = !st.settings().welcome_done;
            if first_run && !args.iter().any(|a| a == "--hidden") {
                show_main_later(&handle, "welcome");
            } else {
                handle_args(&handle, &args, true);
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_settings,
            commands::save_settings,
            commands::hotkey_status,
            commands::hotkeys_suspend,
            commands::app_info,
            commands::open_keyboard_settings,
            commands::pick_folder,
            commands::capture_start,
            commands::overlay_ready,
            commands::overlay_hide,
            commands::capture_cancel,
            commands::capture_commit,
            commands::copy_color,
            commands::element_at,
            commands::copy_text,
            commands::card_ready,
            commands::card_hide,
            commands::temp_save,
            commands::temp_copy,
            commands::temp_pin,
            commands::library_list,
            commands::library_overview,
            commands::library_get,
            commands::library_delete,
            commands::library_undo_delete,
            commands::library_rename,
            commands::library_favorite,
            commands::library_reveal,
            commands::library_open_folder,
            commands::reveal_path,
            commands::drag_icon,
            commands::temp_file,
            commands::library_copy,
            commands::library_pin,
            commands::pin_closed,
            commands::open_editor,
            commands::show_library,
            commands::cleanup_scan,
            commands::share_telegram,
            commands::save_as_image,
            editor::editor_info,
            editor::editor_fill,
            editor::editor_resize,
            editor::editor_estimate,
            editor::editor_save,
            editor::editor_save_as,
            editor::editor_copy,
            editor::editor_revert,
            editor::privacy_scan,
            editor::read_text,
            editor::open_image_file,
            editor::open_image_bytes,
        ])
        .build(tauri::generate_context!())
        .expect("error while building the app");

    app.run(|_app, event| {
        // Closing the last window keeps the app in the tray.
        if let RunEvent::ExitRequested { api, code: None, .. } = event {
            api.prevent_exit();
        }
    });
}
