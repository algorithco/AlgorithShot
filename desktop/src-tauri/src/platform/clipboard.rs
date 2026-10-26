//! Persistent native clipboard ownership for images, text and file lists.

use anyhow::{Result, anyhow};
use clipboard_rs::{Clipboard, ClipboardContext, RustImageData, common::RustImage};
use image::RgbaImage;
use parking_lot::Mutex;
use std::{path::Path, sync::LazyLock};

static CLIPBOARD: LazyLock<Mutex<Option<ClipboardContext>>> = LazyLock::new(|| Mutex::new(None));

fn with_clipboard(action: impl FnOnce(&ClipboardContext) -> clipboard_rs::Result<()>) -> Result<()> {
    let mut context = CLIPBOARD.lock();
    if context.is_none() { *context = Some(ClipboardContext::new().map_err(|e| anyhow!("Clipboard: {e}"))?); }
    action(context.as_ref().unwrap()).map_err(|e| anyhow!("Clipboard: {e}"))
}

pub fn set_image(image: &RgbaImage) -> Result<()> {
    let data = RustImageData::from_dynamic_image(image::DynamicImage::ImageRgba8(image.clone()));
    with_clipboard(|c| c.set_image(data))
}

pub fn set_text(text: &str) -> Result<()> { with_clipboard(|c| c.set_text(text.into())) }

pub fn set_files(paths: &[&Path]) -> Result<()> {
    #[cfg(target_os = "macos")]
    let files = paths.iter().map(|p| p.to_string_lossy().into_owned()).collect();
    #[cfg(target_os = "linux")]
    let files = paths.iter().map(|p| tauri::Url::from_file_path(p).map(|url| url.to_string())
        .map_err(|_| anyhow!("Clipboard file path must be absolute"))).collect::<Result<Vec<_>>>()?;
    with_clipboard(|c| c.set_files(files))
}

pub fn verify() -> Result<()> {
    let text = "AlgorithShot clipboard verification";
    set_text(text)?;
    with_clipboard(|c| {
        if c.get_text()? != text { return Err("Native clipboard text did not round-trip".into()); }
        Ok(())
    })?;
    let image = RgbaImage::from_pixel(8, 8, image::Rgba([13, 117, 231, 255]));
    set_image(&image)?;
    with_clipboard(|c| {
        let copied = c.get_image()?.to_rgba8()?;
        if copied != image { return Err("Native clipboard pixels did not round-trip".into()); }
        Ok(())
    })?;
    let path = std::env::temp_dir().join(format!("AlgorithShot clipboard ёʻ {}.png", uuid::Uuid::new_v4()));
    image.save(&path)?;
    let result = (|| -> Result<()> {
        set_files(&[path.as_path()])?;
        with_clipboard(|c| {
            let files = c.get_files()?;
            let first = files.first().ok_or("Native clipboard file list is empty")?;
            let restored = if first.starts_with("file://") {
                tauri::Url::parse(first)?.to_file_path().map_err(|_| "Invalid clipboard file URL")?
            } else { std::path::PathBuf::from(first) };
            if restored.canonicalize()? != path.canonicalize()? { return Err("Native clipboard file path did not round-trip".into()); }
            Ok(())
        })
    })();
    let _ = std::fs::remove_file(&path);
    result
}
