//! File-level work on screenshots: saving new captures, naming, deleting to
//! the Recycle Bin (with undo), renaming, saving edits (keeping the
//! original) and keeping the index in step with the folder.

use anyhow::{anyhow, bail, Context, Result};
use chrono::Local;
use image::RgbaImage;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Emitter};

use crate::imaging::{self, Format};
use crate::jobs::Job;
use crate::library::{NewShot, Shot};
use crate::state::{state, Deleted};

/// Where a capture came from, for the file name and the library.
#[derive(Debug, Clone, Default)]
pub struct Source {
    pub app: String,
    pub title: String,
    pub url: String,
    /// The window and its program, used to look up a browser's address.
    pub hwnd: isize,
    pub exe: String,
}

const IMAGE_EXTS: [&str; 5] = ["png", "jpg", "jpeg", "webp", "bmp"];

pub fn is_image(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| IMAGE_EXTS.contains(&e.to_ascii_lowercase().as_str()))
}

/// Builds a file name from the pattern, e.g. `Telegram 2026-10-23 14-05-12`.
pub fn file_stem(pattern: &str, src: &Source, now: chrono::DateTime<Local>) -> String {
    let app = if src.app.trim().is_empty() { "Screenshot" } else { src.app.trim() };
    let title: String = src.title.chars().take(60).collect();
    let name = pattern
        .replace("{app}", app)
        .replace("{title}", title.trim())
        .replace("{date}", &now.format("%Y-%m-%d").to_string())
        .replace("{time}", &now.format("%H-%M-%S").to_string());
    let clean = sanitize(&name);
    if clean.is_empty() { format!("Screenshot {}", now.format("%Y-%m-%d %H-%M-%S")) } else { clean }
}

/// Removes characters Windows doesn't allow in file names.
pub fn sanitize(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|c| if "<>:\"/\\|?*".contains(c) || c.is_control() { ' ' } else { c })
        .collect();
    let collapsed = cleaned.split_whitespace().collect::<Vec<_>>().join(" ");
    let trimmed = collapsed.trim_end_matches(['.', ' ']).trim();
    let reserved = ["CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "LPT1", "LPT2", "LPT3"];
    if reserved.contains(&trimmed.to_ascii_uppercase().as_str()) {
        format!("{trimmed}_")
    } else {
        trimmed.chars().take(150).collect()
    }
}

/// `dir/stem.ext`, or `dir/stem (2).ext` and so on if that's taken.
pub fn unique_path(dir: &Path, stem: &str, ext: &str) -> PathBuf {
    let first = dir.join(format!("{stem}.{ext}"));
    if !first.exists() {
        return first;
    }
    (2..)
        .map(|n| dir.join(format!("{stem} ({n}).{ext}")))
        .find(|p| !p.exists())
        .expect("some name is free")
}

fn write_atomic(path: &Path, data: &[u8]) -> Result<()> {
    let tmp = path.with_extension(format!(
        "{}.part",
        path.extension().and_then(|e| e.to_str()).unwrap_or("tmp")
    ));
    std::fs::write(&tmp, data).with_context(|| format!("writing {}", tmp.display()))?;
    std::fs::rename(&tmp, path).with_context(|| format!("saving {}", path.display()))?;
    Ok(())
}

/// Saves a new capture to the library folder and indexes it.
pub fn save_new(app: &AppHandle, img: &RgbaImage, src: &Source) -> Result<Shot> {
    let st = state(app);
    let settings = st.settings();
    let dir = st.save_dir();
    st.paths.validate_save_dir(&dir)?;
    std::fs::create_dir_all(&dir).with_context(|| format!("creating {}", dir.display()))?;

    let format = Format::parse(&settings.format);
    let quality = match format {
        Format::Jpeg => settings.jpeg_quality,
        Format::Webp => settings.webp_quality,
        Format::Png => 100,
    };
    let now = Local::now();
    let path = unique_path(&dir, &file_stem(&settings.file_pattern, src, now), format.ext());
    let data = imaging::encode(img, format, quality)?;
    st.note_write(path.clone());
    write_atomic(&path, &data)?;

    let shot = st.library.insert(&NewShot {
        path: path.to_string_lossy().into_owned(),
        created: now.timestamp_millis(),
        width: img.width(),
        height: img.height(),
        bytes: data.len() as u64,
        format: format.ext().into(),
        app: src.app.clone(),
        title: src.title.clone(),
        url: src.url.clone(),
    })?;
    // Keep the source icon while its window/executable is still available.
    if !src.app.is_empty() {
        if let Err(error) = st.app_icons.remember(&src.app, src.hwnd) {
            log::debug!("source app icon: {error:#}");
        }
    }
    after_change(app, &shot.id, format == Format::Png);
    Ok(shot)
}

/// Queues the follow-up work for a new or changed file and tells the UI.
pub fn after_change(app: &AppHandle, id: &str, optimize: bool) {
    let st = state(app);
    st.jobs.push(Job::Thumb(id.to_string()));
    if optimize {
        st.jobs.push(Job::Optimize(id.to_string()));
    }
    st.jobs.push(Job::Index(id.to_string()));
    let _ = app.emit("library:changed", id);
}

/// Adds a file that appeared in the folder (copied in, or from another app).
pub fn import(app: &AppHandle, path: &Path) -> Result<Option<Shot>> {
    let st = state(app);
    let key = path.to_string_lossy().into_owned();
    if st.library.by_path(&key)?.is_some() || !is_image(path) {
        return Ok(None);
    }
    let meta = std::fs::metadata(path)?;
    let (width, height) = image::image_dimensions(path).unwrap_or((0, 0));
    let created = meta
        .created()
        .or_else(|_| meta.modified())
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as i64)
        .unwrap_or_else(|| Local::now().timestamp_millis());
    let shot = st.library.insert(&NewShot {
        path: key,
        created,
        width,
        height,
        bytes: meta.len(),
        format: Format::from_path(path).ext().into(),
        ..Default::default()
    })?;
    after_change(app, &shot.id, false);
    Ok(Some(shot))
}

/// Brings the index in line with the folder: adds new files, drops rows
/// whose files are gone. Returns how many rows changed.
pub fn reconcile(app: &AppHandle) -> Result<usize> {
    let st = state(app);
    let dir = st.save_dir();
    let mut changed = 0;
    for (id, path) in st.library.all_paths()? {
        if !Path::new(&path).exists() {
            st.library.remove(&id)?;
            changed += 1;
        }
    }
    if let Ok(entries) = std::fs::read_dir(&dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_file() && is_image(&path) && import(app, &path)?.is_some() {
                changed += 1;
            }
        }
    }
    // Rows moved to the Recycle Bin more than a day ago can go for good.
    let day_ago = Local::now().timestamp_millis() - 86_400_000;
    for id in st.library.trashed_before(day_ago)? {
        remove_row_and_extras(app, &id);
    }
    if changed > 0 {
        let _ = app.emit("library:changed", "");
    }
    Ok(changed)
}

fn remove_row_and_extras(app: &AppHandle, id: &str) {
    let st = state(app);
    let _ = std::fs::remove_file(st.paths.thumbs.join(format!("{id}.webp")));
    if let Some(orig) = original_path(app, id) {
        let _ = std::fs::remove_file(orig);
    }
    let _ = st.library.remove(id);
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteResult {
    pub deleted: usize,
    pub can_undo: bool,
}

/// Moves screenshots to the Recycle Bin, or deletes them for good.
pub fn delete(app: &AppHandle, ids: &[String], permanent: bool) -> Result<DeleteResult> {
    let st = state(app);
    let shots = st.library.get_many(ids)?;
    let paths: Vec<PathBuf> = shots.iter().map(|s| PathBuf::from(&s.path)).filter(|p| p.exists()).collect();
    for p in &paths {
        st.note_write(p.clone());
    }
    if permanent {
        for p in &paths {
            std::fs::remove_file(p).with_context(|| format!("deleting {}", p.display()))?;
        }
        for s in &shots {
            remove_row_and_extras(app, &s.id);
        }
    } else {
        let at = Local::now();
        trash::delete_all(&paths).map_err(|e| anyhow!("Recycle Bin: {e}"))?;
        let ids: Vec<String> = shots.iter().map(|s| s.id.clone()).collect();
        st.library.set_trashed(&ids, Some(at.timestamp_millis()))?;
        *st.last_deleted.lock() = Some(Deleted { ids, paths, at });
    }
    let _ = app.emit("library:changed", "");
    Ok(DeleteResult { deleted: shots.len(), can_undo: !permanent })
}

/// Restores what the last delete moved to the Recycle Bin.
pub fn undo_delete(app: &AppHandle) -> Result<usize> {
    let st = state(app);
    let Some(last) = st.last_deleted.lock().take() else { bail!("nothing to undo") };
    let since = last.at.timestamp() - 5;
    let items: Vec<trash::TrashItem> = trash::os_limited::list()
        .map_err(|e| anyhow!("Recycle Bin: {e}"))?
        .into_iter()
        .filter(|item| item.time_deleted >= since && last.paths.iter().any(|p| *p == item.original_path()))
        .collect();
    let restored = items.len();
    for p in &last.paths {
        st.note_write(p.clone());
    }
    if !items.is_empty() {
        trash::os_limited::restore_all(items).map_err(|e| anyhow!("Recycle Bin: {e}"))?;
    }
    st.library.set_trashed(&last.ids, None)?;
    let _ = app.emit("library:changed", "");
    Ok(restored)
}

pub fn rename(app: &AppHandle, id: &str, new_name: &str) -> Result<Shot> {
    let st = state(app);
    let shot = st.library.get(id)?.ok_or_else(|| anyhow!("not found"))?;
    let old = PathBuf::from(&shot.path);
    let stem = sanitize(Path::new(new_name).file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default().as_str());
    if stem.is_empty() {
        bail!("empty name");
    }
    let ext = old.extension().and_then(|e| e.to_str()).unwrap_or("png").to_string();
    let dir = old.parent().ok_or_else(|| anyhow!("no folder"))?;
    let target = dir.join(format!("{stem}.{ext}"));
    if target == old {
        return Ok(shot);
    }
    if target.exists() && !target.to_string_lossy().eq_ignore_ascii_case(&old.to_string_lossy()) {
        bail!("name_taken");
    }
    st.note_write(old.clone());
    st.note_write(target.clone());
    std::fs::rename(&old, &target)?;
    st.library.set_path(id, &target.to_string_lossy())?;
    let _ = app.emit("library:changed", id);
    st.library.get(id)?.ok_or_else(|| anyhow!("not found"))
}

pub fn original_path(app: &AppHandle, id: &str) -> Option<PathBuf> {
    let dir = &state(app).paths.originals;
    IMAGE_EXTS.iter().map(|e| dir.join(format!("{id}.{e}"))).find(|p| p.exists())
}

/// Saves an edited image over a library screenshot. The first edit keeps
/// the untouched file so "Revert to original" can bring it back.
pub fn save_edit(app: &AppHandle, id: &str, img: &RgbaImage, format: Format, quality: u8) -> Result<Shot> {
    let st = state(app);
    let shot = st.library.get(id)?.ok_or_else(|| anyhow!("not found"))?;
    let path = PathBuf::from(&shot.path);
    st.paths.validate_save_dir(&path)?;
    if original_path(app, id).is_none() && path.exists() {
        crate::storage::validate_save_dir(&st.paths.originals, &st.paths.private_dirs)?;
        std::fs::create_dir_all(&st.paths.originals)?;
        let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("png");
        std::fs::copy(&path, st.paths.originals.join(format!("{id}.{ext}")))?;
    }
    // Keep the file's own format unless the user picked another one.
    let target = if Format::from_path(&path) == format { path.clone() } else { path.with_extension(format.ext()) };
    let data = imaging::encode(img, format, quality)?;
    st.note_write(target.clone());
    write_atomic(&target, &data)?;
    if target != path {
        st.note_write(path.clone());
        let _ = std::fs::remove_file(&path);
        st.library.set_path(id, &target.to_string_lossy())?;
    }
    st.library.file_changed(id, data.len() as u64, img.width(), img.height(), Some(true), true)?;
    after_change(app, id, format == Format::Png);
    st.library.get(id)?.ok_or_else(|| anyhow!("not found"))
}

pub fn revert(app: &AppHandle, id: &str) -> Result<Shot> {
    let st = state(app);
    let shot = st.library.get(id)?.ok_or_else(|| anyhow!("not found"))?;
    let orig = original_path(app, id).ok_or_else(|| anyhow!("no original"))?;
    let current = PathBuf::from(&shot.path);
    let ext = orig.extension().and_then(|e| e.to_str()).unwrap_or("png");
    let target = current.with_extension(ext);
    st.paths.validate_save_dir(&target)?;
    st.note_write(current.clone());
    st.note_write(target.clone());
    std::fs::copy(&orig, &target)?;
    if target != current {
        let _ = std::fs::remove_file(&current);
        st.library.set_path(id, &target.to_string_lossy())?;
    }
    std::fs::remove_file(&orig)?;
    let (w, h) = image::image_dimensions(&target)?;
    let bytes = std::fs::metadata(&target)?.len();
    st.library.file_changed(id, bytes, w, h, Some(false), true)?;
    after_change(app, id, false);
    st.library.get(id)?.ok_or_else(|| anyhow!("not found"))
}

/// Moves screenshots older than the setting to the Recycle Bin (starred ones
/// stay). Returns how many went.
pub fn auto_clean(app: &AppHandle) -> Result<usize> {
    let st = state(app);
    let days = st.settings().auto_clean_days;
    if days == 0 {
        return Ok(0);
    }
    let cutoff = Local::now().timestamp_millis() - days as i64 * 86_400_000;
    let ids: Vec<String> = st.library.older_than(cutoff)?.into_iter().map(|s| s.id).collect();
    if ids.is_empty() {
        return Ok(0);
    }
    Ok(delete(app, &ids, false)?.deleted)
}

pub fn load_rgba(path: &Path) -> Result<RgbaImage> {
    Ok(image::open(path).with_context(|| format!("opening {}", path.display()))?.to_rgba8())
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    #[test]
    fn file_names() {
        let now = Local.with_ymd_and_hms(2026, 10, 23, 14, 5, 12).unwrap();
        let src = Source { app: "Telegram".into(), title: "Chat: \"Team\" <work>".into(), ..Default::default() };
        assert_eq!(file_stem("{app} {date} {time}", &src, now), "Telegram 2026-10-23 14-05-12");
        assert_eq!(file_stem("{title}", &src, now), "Chat Team work");
        assert_eq!(file_stem("{app}", &Source::default(), now), "Screenshot");
        assert_eq!(sanitize("con"), "con_");
        assert_eq!(sanitize("a/b\\c:d. "), "a b c d");
    }

    #[test]
    fn unique_names() {
        let dir = std::env::temp_dir().join(format!("as-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let first = unique_path(&dir, "shot", "png");
        std::fs::write(&first, b"x").unwrap();
        assert_eq!(unique_path(&dir, "shot", "png").file_name().unwrap(), "shot (2).png");
        std::fs::remove_dir_all(dir).unwrap();
    }
}
