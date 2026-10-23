//! Shared app state, reachable from commands through `app.state::<AppState>()`.

use image::RgbaImage;
use parking_lot::{Mutex, RwLock};
use serde::Serialize;
use std::collections::{HashMap, VecDeque};
use std::path::PathBuf;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager};

use crate::capture::CaptureState;
use crate::jobs::Jobs;
use crate::library::Library;
use crate::settings::Settings;

pub struct Paths {
    pub settings: PathBuf,
    pub database: PathBuf,
    pub thumbs: PathBuf,
    /// Untouched copies of screenshots that were edited, named `{id}.{ext}`.
    pub originals: PathBuf,
    pub default_save_dir: PathBuf,
}

impl Paths {
    pub fn resolve(app: &AppHandle) -> tauri::Result<Paths> {
        let p = app.path();
        let data = p.app_data_dir()?;
        let cache = p.app_cache_dir()?;
        let home = p.home_dir()?;
        let pictures = p.picture_dir().unwrap_or_else(|_| home.join("Pictures"));
        // When Pictures lives in OneDrive, screenshots there would be copied
        // to the cloud. The default stays on this PC instead.
        let pictures = if is_cloud_synced(&pictures) { home.join("Pictures") } else { pictures };
        Ok(Paths {
            settings: p.app_config_dir()?.join("settings.json"),
            database: data.join("library.db"),
            thumbs: cache.join("thumbs"),
            originals: data.join("originals"),
            // Screenshots made before the rename stay where they are.
            default_save_dir: if pictures.join("Algorithco Shot").is_dir() { pictures.join("Algorithco Shot") } else { pictures.join("AlgorithShot") },
        })
    }
}

/// True for folders inside OneDrive (personal or business), which sync to the cloud.
pub fn is_cloud_synced(path: &std::path::Path) -> bool {
    path.components().any(|c| c.as_os_str().to_string_lossy().to_ascii_lowercase().starts_with("onedrive"))
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HotkeyStatus {
    pub action: String,
    pub key: String,
    pub ok: bool,
    pub error: Option<String>,
}

/// What the last delete moved to the Recycle Bin, so it can be undone.
#[derive(Debug, Clone)]
pub struct Deleted {
    pub ids: Vec<String>,
    pub paths: Vec<PathBuf>,
    pub at: chrono::DateTime<chrono::Local>,
}

pub struct AppState {
    pub paths: Paths,
    pub settings: RwLock<Settings>,
    pub library: Library,
    pub capture: CaptureState,
    pub jobs: Jobs,
    /// Images shown in pin windows and unsaved captures, by id.
    pub images: Mutex<HashMap<String, Arc<RgbaImage>>>,
    temps: Mutex<VecDeque<String>>,
    pub hotkeys: Mutex<Vec<HotkeyStatus>>,
    pub last_deleted: Mutex<Option<Deleted>>,
    /// Files this app just wrote, so the folder watcher ignores them.
    recent_writes: Mutex<HashMap<PathBuf, Instant>>,
}

impl AppState {
    pub fn new(paths: Paths, settings: Settings, library: Library, jobs: Jobs) -> AppState {
        AppState {
            paths,
            settings: RwLock::new(settings),
            library,
            capture: CaptureState::default(),
            jobs,
            images: Mutex::new(HashMap::new()),
            temps: Mutex::new(VecDeque::new()),
            hotkeys: Mutex::new(Vec::new()),
            last_deleted: Mutex::new(None),
            recent_writes: Mutex::new(HashMap::new()),
        }
    }

    pub fn save_dir(&self) -> PathBuf {
        let s = self.settings.read();
        if s.save_dir.trim().is_empty() {
            self.paths.default_save_dir.clone()
        } else {
            PathBuf::from(s.save_dir.trim())
        }
    }

    pub fn settings(&self) -> Settings {
        self.settings.read().clone()
    }

    pub fn note_write(&self, path: PathBuf) {
        let mut map = self.recent_writes.lock();
        map.retain(|_, t| t.elapsed() < Duration::from_secs(10));
        map.insert(path, Instant::now());
    }

    pub fn wrote_recently(&self, path: &std::path::Path) -> bool {
        self.recent_writes
            .lock()
            .get(path)
            .is_some_and(|t| t.elapsed() < Duration::from_secs(4))
    }

    pub fn put_image(&self, img: RgbaImage) -> String {
        let id = uuid::Uuid::new_v4().simple().to_string();
        self.images.lock().insert(id.clone(), Arc::new(img));
        id
    }

    /// Keeps an unsaved capture around for the card and editor. Only the
    /// last few are kept.
    pub fn put_temp(&self, img: RgbaImage) -> String {
        let id = self.put_image(img);
        let mut temps = self.temps.lock();
        temps.push_back(id.clone());
        while temps.len() > 4 {
            if let Some(old) = temps.pop_front() {
                self.images.lock().remove(&old);
            }
        }
        id
    }

    pub fn image(&self, id: &str) -> Option<Arc<RgbaImage>> {
        self.images.lock().get(id).cloned()
    }
}

pub fn state(app: &AppHandle) -> tauri::State<'_, AppState> {
    app.state::<AppState>()
}
