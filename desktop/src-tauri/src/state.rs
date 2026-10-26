//! Shared app state, reachable from commands through `app.state::<AppState>()`.

use image::RgbaImage;
use parking_lot::{Mutex, RwLock};
use serde::Serialize;
use std::collections::{HashMap, VecDeque};
use std::path::PathBuf;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager};

use crate::app_icons::AppIcons;
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
    pub legacy_originals: PathBuf,
    pub default_save_dir: PathBuf,
    /// Folders removed by uninstallers or temporary-file clean-up.
    pub private_dirs: Vec<PathBuf>,
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
        // Screenshots made before the rename stay where they are.
        let default_save_dir = if pictures.join("Algorithco Shot").is_dir() { pictures.join("Algorithco Shot") } else { pictures.join("AlgorithShot") };
        let config = p.app_config_dir()?;
        let mut private_dirs = vec![data.clone(), cache.clone(), config.clone(), p.app_local_data_dir()?, std::env::temp_dir()];
        if let Some(install_dir) = installation_dir(&std::env::current_exe()?) {
            private_dirs.push(install_dir);
        }
        Ok(Paths {
            settings: config.join("settings.json"),
            database: data.join("library.db"),
            thumbs: cache.join("thumbs"),
            originals: default_save_dir.join(".originals"),
            legacy_originals: data.join("originals"),
            default_save_dir,
            private_dirs,
        })
    }

    pub fn validate_save_dir(&self, dir: &std::path::Path) -> anyhow::Result<()> {
        crate::storage::validate_save_dir(dir, self.private_dirs.iter().chain(std::iter::once(&self.originals)))
    }
}

/// Updates replace the whole macOS bundle, including Resources and sibling
/// folders of Contents/MacOS, so protect more than the binary's parent.
fn installation_dir(executable: &std::path::Path) -> Option<PathBuf> {
    executable.ancestors().find(|path| path.extension().is_some_and(|ext| ext == "app"))
        .or_else(|| executable.parent()).map(std::path::Path::to_path_buf)
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

#[cfg(test)]
mod installation_tests {
    use super::*;

    #[test]
    fn the_whole_app_bundle_is_treated_as_replaceable_application_data() {
        let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("target/app-bundle-test");
        let bundle = root.join("AlgorithShot.app");
        let executable = bundle.join("Contents/MacOS/algorithco-shot");
        let install = installation_dir(&executable).unwrap();
        assert_eq!(install, bundle);
        assert!(crate::storage::validate_save_dir(&bundle.join("Contents/Resources/screenshots"), [&install]).is_err());
        assert!(crate::storage::validate_save_dir(&root.join("Pictures/AlgorithShot"), [&install]).is_ok());
    }

    #[test]
    fn other_installations_protect_the_executable_directory() {
        let directory = std::path::Path::new("Programs").join("AlgorithShot");
        assert_eq!(installation_dir(&directory.join("algorithco-shot.exe")), Some(directory));
    }
}

/// What the last delete moved to the Recycle Bin, so it can be undone.
#[derive(Debug, Clone)]
pub struct Deleted {
    pub ids: Vec<String>,
    pub paths: Vec<PathBuf>,
    pub at: chrono::DateTime<chrono::Local>,
    #[cfg(target_os = "macos")]
    pub trash_paths: Vec<PathBuf>,
}

pub struct AppState {
    pub paths: Paths,
    pub app_icons: AppIcons,
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
            app_icons: AppIcons::new(paths.database.with_file_name("app-icons")),
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
