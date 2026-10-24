//! Watches the save folder, so pictures added or deleted in Explorer show up
//! in (or leave) the library. The app's own writes are ignored.

use notify_debouncer_mini::notify::{RecommendedWatcher, RecursiveMode};
use notify_debouncer_mini::{new_debouncer, DebounceEventResult, DebouncedEvent, Debouncer};
use parking_lot::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Emitter};

use crate::shots;
use crate::state::state;

static WATCHER: Mutex<Option<Debouncer<RecommendedWatcher>>> = Mutex::new(None);

pub fn restart(app: &AppHandle) {
    *WATCHER.lock() = None;
    let dir = state(app).save_dir();
    if let Err(e) = std::fs::create_dir_all(&dir) {
        log::warn!("save folder {}: {e}", dir.display());
        return;
    }
    let handler_app = app.clone();
    let debouncer = new_debouncer(Duration::from_millis(700), move |res: DebounceEventResult| match res {
        Ok(events) => handle(&handler_app, events),
        Err(e) => log::warn!("folder watcher: {e}"),
    });
    let mut debouncer = match debouncer {
        Ok(d) => d,
        Err(e) => {
            log::warn!("folder watcher: {e}");
            return;
        }
    };
    if let Err(e) = debouncer.watcher().watch(&dir, RecursiveMode::NonRecursive) {
        log::warn!("watching {}: {e}", dir.display());
        return;
    }
    *WATCHER.lock() = Some(debouncer);
}

fn handle(app: &AppHandle, events: Vec<DebouncedEvent>) {
    let st = state(app);
    let mut changed = false;
    for event in events {
        let path = event.path;
        if st.wrote_recently(&path) || !shots::is_image(&path) {
            continue;
        }
        if path.exists() {
            match shots::import(app, &path) {
                Ok(Some(_)) => changed = true,
                Ok(None) => {}
                Err(e) => log::warn!("importing {}: {e:#}", path.display()),
            }
        } else if let Ok(Some(shot)) = st.library.by_path(&path.to_string_lossy()) {
            let _ = st.library.remove(&shot.id);
            changed = true;
        }
    }
    if changed {
        let _ = app.emit("library:changed", "");
    }
}
