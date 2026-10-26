//! Screenshots are user files: neither uninstalling nor clearing app data
//! may remove them. Only settings, the index and thumbnails belong in AppData.

use anyhow::{Context, Result, bail};
use std::collections::{HashMap, HashSet};
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::path::{Component, Path, PathBuf};

use crate::library::Library;
use crate::settings::Settings;
use crate::shots;
use crate::state::Paths;

#[derive(Debug)]
struct UnsafeSaveDir(&'static str);

impl std::fmt::Display for UnsafeSaveDir {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.0)
    }
}

impl std::error::Error for UnsafeSaveDir {}

/// Resolve existing ancestors as well as a not-yet-created suffix, so a
/// junction or `..` cannot disguise a folder inside app data.
fn resolved(path: &Path) -> Result<PathBuf> {
    let mut clean = PathBuf::new();
    for part in path.components() {
        match part {
            Component::CurDir => {}
            Component::ParentDir => {
                clean.pop();
            }
            _ => clean.push(part.as_os_str()),
        }
    }
    let mut ancestor = clean.as_path();
    let mut suffix = Vec::new();
    loop {
        match fs::canonicalize(ancestor) {
            Ok(mut base) => {
                if !suffix.is_empty() && !base.is_dir() {
                    bail!("The parent of {} is a file, not a folder", path.display());
                }
                for part in suffix.iter().rev() {
                    base.push(part);
                }
                return Ok(base);
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                suffix.push(ancestor.file_name().context("folder has no existing ancestor")?.to_os_string());
                ancestor = ancestor.parent().context("folder has no existing ancestor")?;
            }
            Err(e) => return Err(e).with_context(|| format!("checking {}", path.display())),
        }
    }
}

fn path_key(path: &Path) -> Result<String> {
    let value = resolved(path)?.to_string_lossy().into_owned();
    Ok(if cfg!(target_os = "windows") { value.to_lowercase() } else { value })
}

pub fn validate_save_dir<'a>(dir: &Path, private_dirs: impl IntoIterator<Item = &'a PathBuf>) -> Result<()> {
    if !dir.is_absolute() {
        bail!(UnsafeSaveDir(
            "Choose an absolute folder in Pictures or Documents so screenshots survive uninstalling the app."
        ));
    }
    let target = resolved(dir)?;
    for root in private_dirs {
        let root = resolved(root)?;
        // Windows paths are case insensitive; compare whole components.
        if root.components().count() <= target.components().count()
            && root
                .components()
                .zip(target.components())
                .all(|(a, b)| if cfg!(target_os = "windows") {
                    a.as_os_str().to_string_lossy().to_lowercase() == b.as_os_str().to_string_lossy().to_lowercase()
                } else { a == b })
        {
            bail!(UnsafeSaveDir(
                "This folder can be removed with the app or temporary files. Choose a folder in Pictures or Documents."
            ));
        }
    }
    Ok(())
}

fn needs_recovery(paths: &Paths, dir: &Path) -> bool {
    match paths.validate_save_dir(dir) {
        Ok(()) => false,
        Err(e) if e.is::<UnsafeSaveDir>() => true,
        Err(e) => {
            // An offline drive or a permissions error does not make a user's
            // chosen folder temporary. Keep the preference for when it returns.
            log::warn!("could not check save folder {}: {e:#}", dir.display());
            false
        }
    }
}

/// Copy without replacing an existing file. The caller keeps the source
/// until the durable copy and any new index entry have been committed.
fn copy_new(source: &Path, target: &Path) -> Result<()> {
    let mut input = File::open(source)?;
    let mut output = OpenOptions::new().write(true).create_new(true).open(target)?;
    let result = std::io::copy(&mut input, &mut output)
        .and_then(|_| output.flush())
        .and_then(|_| output.sync_all());
    drop(output);
    if let Err(e) = result {
        let _ = fs::remove_file(target);
        return Err(e).with_context(|| format!("preserving {}", source.display()));
    }
    Ok(())
}

fn same_contents(a: &Path, b: &Path) -> Result<bool> {
    let mut a = File::open(a)?;
    let mut b = File::open(b)?;
    if a.metadata()?.len() != b.metadata()?.len() {
        return Ok(false);
    }
    let mut left = [0; 8192];
    let mut right = [0; 8192];
    loop {
        let n = a.read(&mut left)?;
        b.read_exact(&mut right[..n])?;
        if left[..n] != right[..n] {
            return Ok(false);
        }
        if n == 0 {
            return Ok(true);
        }
    }
}

fn recover_image(source: &Path, dir: &Path) -> Result<PathBuf> {
    fs::create_dir_all(dir)?;
    let stem = source.file_stem().context("image has no file name")?.to_string_lossy();
    let ext = source.extension().and_then(|s| s.to_str()).unwrap_or("png");
    let target = shots::unique_path(dir, &stem, ext);
    copy_new(source, &target)?;
    Ok(target)
}

fn remove_recovered_source(source: &Path) {
    if let Err(e) = fs::remove_file(source) {
        // The durable copy is already complete. A read-only legacy file must
        // not stop the app starting, but keep the failure visible in the log.
        log::warn!("could not remove recovered screenshot {}: {e}", source.display());
    }
}

/// Runs before watchers and workers start. Preserve legacy originals and
/// recover any screenshots previously saved inside an app-owned folder.
pub fn prepare(paths: &Paths, settings: &mut Settings, library: &Library) -> Result<()> {
    paths.validate_save_dir(&paths.default_save_dir)?;
    validate_save_dir(&paths.originals, &paths.private_dirs)?;

    if paths.legacy_originals.is_dir() {
        fs::create_dir_all(&paths.originals)?;
        for entry in fs::read_dir(&paths.legacy_originals)? {
            let source = entry?.path();
            if !source.is_file() || !shots::is_image(&source) {
                continue;
            }
            let target = paths.originals.join(source.file_name().context("original has no file name")?);
            if target.exists() {
                if !same_contents(&source, &target)? {
                    bail!(
                        "An original already exists at {}; the previous copy is still at {}",
                        target.display(),
                        source.display()
                    );
                }
            } else {
                copy_new(&source, &target)?;
            }
            // A reverted or deleted original must not reappear next launch.
            // Remove the legacy copy only after the durable one is verified.
            fs::remove_file(&source).with_context(|| format!("finishing migration of {}", source.display()))?;
        }
    }

    let mut known = HashSet::new();
    let mut folders = HashMap::new();
    for (id, file) in library.all_paths()? {
        let source = PathBuf::from(file);
        let Some(dir) = source.parent() else { continue };
        let unsafe_folder = *folders.entry(dir.to_path_buf()).or_insert_with(|| needs_recovery(paths, dir));
        if !unsafe_folder || !source.is_file() {
            continue;
        }
        known.insert(path_key(&source)?);
        let target = recover_image(&source, &paths.default_save_dir)?;
        library.set_path(&id, &target.to_string_lossy())?;
        remove_recovered_source(&source);
        log::info!("preserved screenshot at {}", target.display());
    }

    if !settings.save_dir.trim().is_empty() {
        let old_dir = PathBuf::from(settings.save_dir.trim());
        if needs_recovery(paths, &old_dir) {
            // Also keep files whose index was lost or never written.
            if old_dir.is_dir() {
                for entry in fs::read_dir(&old_dir)? {
                    let source = entry?.path();
                    if source.is_file() && shots::is_image(&source) && !known.contains(&path_key(&source)?) {
                        recover_image(&source, &paths.default_save_dir)?;
                        remove_recovered_source(&source);
                    }
                }
            }
            settings.save_dir.clear();
            settings.save(&paths.settings)?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::library::NewShot;

    struct Fixture {
        root: PathBuf,
        paths: Paths,
    }

    impl Fixture {
        fn new() -> Self {
            let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join("target/storage-tests")
                .join(uuid::Uuid::new_v4().to_string());
            fs::create_dir_all(&root).unwrap();
            let root = fs::canonicalize(root).unwrap();
            let data = root.join("appdata");
            let pictures = root.join("Pictures/AlgorithShot");
            Self {
                paths: Paths {
                    settings: data.join("settings.json"),
                    database: data.join("library.db"),
                    thumbs: root.join("cache/thumbs"),
                    originals: pictures.join(".originals"),
                    legacy_originals: data.join("originals"),
                    default_save_dir: pictures,
                    private_dirs: vec![data, root.join("cache"), root.join("install"), root.join("temp")],
                },
                root,
            }
        }

        fn image(&self, path: &Path, color: u8) -> Vec<u8> {
            assert!(path.starts_with(&self.root));
            fs::create_dir_all(path.parent().unwrap()).unwrap();
            image::RgbaImage::from_pixel(2, 3, image::Rgba([color, 0, 0, 255])).save(path).unwrap();
            fs::read(path).unwrap()
        }

        fn remove(&self, path: &Path) {
            let path = fs::canonicalize(path).unwrap();
            assert!(path.starts_with(&self.root) && path != self.root);
            fs::remove_dir_all(path).unwrap();
        }
    }

    impl Drop for Fixture {
        fn drop(&mut self) {
            let base = fs::canonicalize(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("target/storage-tests")).unwrap();
            assert!(self.root.starts_with(&base) && self.root != base);
            fs::remove_dir_all(&self.root).unwrap();
        }
    }

    #[test]
    fn save_folders_exclude_app_data_install_cache_and_temp() {
        let f = Fixture::new();
        assert!(f.paths.validate_save_dir(&f.paths.default_save_dir).is_ok());
        assert!(f.paths.validate_save_dir(&f.root.join("Documents/photos")).is_ok());
        assert!(f.paths.validate_save_dir(&f.root.join("appdata-photos")).is_ok());
        assert!(f.paths.validate_save_dir(Path::new("relative/photos")).is_err());
        assert!(f.paths.validate_save_dir(&f.paths.originals).is_err());
        for root in &f.paths.private_dirs {
            assert!(f.paths.validate_save_dir(root).is_err());
            assert!(f.paths.validate_save_dir(&root.join("new/screenshots")).is_err());
            #[cfg(target_os = "windows")]
            assert!(f.paths.validate_save_dir(&PathBuf::from(root.to_string_lossy().to_uppercase())).is_err());
        }
        assert!(f.paths.validate_save_dir(&f.root.join("Pictures/../appdata/shots")).is_err());
    }

    #[test]
    #[cfg(target_os = "windows")]
    fn junction_cannot_disguise_app_data_as_a_user_folder() {
        let f = Fixture::new();
        let data = &f.paths.private_dirs[0];
        fs::create_dir_all(data).unwrap();
        let alias = f.root.join("photos-alias");
        let output = std::process::Command::new("cmd.exe")
            .args(["/c", "mklink", "/J"])
            .arg(&alias)
            .arg(data)
            .output()
            .unwrap();
        assert!(output.status.success(), "{}", String::from_utf8_lossy(&output.stderr));
        assert!(f.paths.validate_save_dir(&alias.join("new/photos")).is_err());
    }

    #[test]
    fn screenshots_and_originals_survive_removing_all_app_data_and_reinstalling() {
        let f = Fixture::new();
        let paths = &f.paths;
        let unsafe_dir = paths.private_dirs[0].join("captures");
        let old = unsafe_dir.join("shot.png");
        let saved = f.image(&old, 10);
        let unindexed = f.image(&unsafe_dir.join("unindexed.png"), 20);
        let existing = paths.default_save_dir.join("shot.png");
        let existing_bytes = f.image(&existing, 30);
        let library = Library::open(&paths.database).unwrap();
        let shot = library
            .insert(&NewShot {
                path: old.to_string_lossy().into_owned(),
                ..Default::default()
            })
            .unwrap();
        library.set_favorite(&shot.id, true).unwrap();
        library.set_text(&shot.id, "kept metadata", 1).unwrap();
        let legacy_original = paths.legacy_originals.join(format!("{}.png", shot.id));
        let original = f.image(&legacy_original, 40);
        let mut settings = Settings {
            save_dir: unsafe_dir.to_string_lossy().into_owned(),
            ..Default::default()
        };

        prepare(paths, &mut settings, &library).unwrap();

        let recovered = library.get(&shot.id).unwrap().unwrap();
        let recovered_path = PathBuf::from(&recovered.path);
        assert_eq!(recovered_path, paths.default_save_dir.join("shot (2).png"));
        assert!(recovered.favorite);
        assert_eq!(library.text(&shot.id).unwrap(), "kept metadata");
        assert!(settings.save_dir.is_empty());
        assert!(Settings::load(&paths.settings).save_dir.is_empty());
        assert!(!old.exists());
        assert!(!unsafe_dir.join("unindexed.png").exists());
        assert!(!legacy_original.exists());
        let durable_original = paths.originals.join(format!("{}.png", shot.id));
        assert_eq!(fs::read(&durable_original).unwrap(), original);
        prepare(paths, &mut settings, &library).unwrap();
        assert!(!paths.default_save_dir.join("shot (3).png").exists());
        drop(library);

        // Even removing every private folder must leave user images intact.
        for private in &paths.private_dirs {
            fs::create_dir_all(private).unwrap();
            f.remove(private);
        }
        assert_eq!(fs::read(&recovered_path).unwrap(), saved);
        assert_eq!(fs::read(&existing).unwrap(), existing_bytes);
        assert_eq!(fs::read(paths.default_save_dir.join("unindexed.png")).unwrap(), unindexed);
        assert_eq!(fs::read(&durable_original).unwrap(), original);

        let fresh_library = Library::open(&paths.database).unwrap();
        prepare(paths, &mut Settings::default(), &fresh_library).unwrap();
        assert_eq!(image::open(recovered_path).unwrap().width(), 2);
        assert_eq!(image::open(durable_original).unwrap().height(), 3);
    }

    #[test]
    fn conflicting_originals_are_preserved_without_overwriting_either_copy() {
        let f = Fixture::new();
        let legacy = f.paths.legacy_originals.join("same-id.png");
        let durable = f.paths.originals.join("same-id.png");
        let old_bytes = f.image(&legacy, 10);
        let new_bytes = f.image(&durable, 20);
        let library = Library::in_memory();
        assert!(prepare(&f.paths, &mut Settings::default(), &library).is_err());
        assert_eq!(fs::read(legacy).unwrap(), old_bytes);
        assert_eq!(fs::read(durable).unwrap(), new_bytes);
    }

    #[test]
    fn interrupted_original_migration_reuses_the_verified_copy() {
        let f = Fixture::new();
        let legacy = f.paths.legacy_originals.join("same-id.png");
        let durable = f.paths.originals.join("same-id.png");
        let original = f.image(&legacy, 10);
        f.image(&durable, 10);
        prepare(&f.paths, &mut Settings::default(), &Library::in_memory()).unwrap();
        assert_eq!(fs::read(durable).unwrap(), original);
        assert!(!legacy.exists());
    }

    #[test]
    fn reverted_original_is_not_resurrected_by_the_next_launch() {
        let f = Fixture::new();
        let legacy = f.paths.legacy_originals.join("shot.png");
        f.image(&legacy, 10);
        let library = Library::in_memory();
        prepare(&f.paths, &mut Settings::default(), &library).unwrap();
        let durable = f.paths.originals.join("shot.png");
        fs::remove_file(&durable).unwrap();
        prepare(&f.paths, &mut Settings::default(), &library).unwrap();
        assert!(!durable.exists());
        assert!(!legacy.exists());
    }

    #[test]
    fn safe_custom_folder_keeps_existing_files_and_preferences() {
        let f = Fixture::new();
        let dir = f.root.join("Documents/My screenshots");
        let source = dir.join("shot.png");
        f.image(&source, 10);
        let library = Library::in_memory();
        let shot = library
            .insert(&NewShot {
                path: source.to_string_lossy().into_owned(),
                ..Default::default()
            })
            .unwrap();
        let mut settings = Settings {
            save_dir: dir.to_string_lossy().into_owned(),
            ..Default::default()
        };
        let previous = settings.clone();
        prepare(&f.paths, &mut settings, &library).unwrap();
        assert_eq!(settings, previous);
        assert_eq!(library.get(&shot.id).unwrap().unwrap().path, source.to_string_lossy());
        assert!(!f.paths.default_save_dir.exists());
    }

    #[test]
    fn unavailable_custom_folder_does_not_reset_the_preference() {
        let f = Fixture::new();
        let file = f.root.join("not-a-directory");
        fs::write(&file, b"a file cannot contain a folder").unwrap();
        let mut settings = Settings {
            save_dir: file.join("photos").to_string_lossy().into_owned(),
            ..Default::default()
        };
        let previous = settings.clone();
        assert!(f.paths.validate_save_dir(Path::new(&settings.save_dir)).is_err());
        prepare(&f.paths, &mut settings, &Library::in_memory()).unwrap();
        assert_eq!(settings, previous);
    }
}
