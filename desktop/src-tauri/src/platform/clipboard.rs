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
    let files = paths.iter().map(|p| p.to_string_lossy().into_owned()).collect();
    with_clipboard(|c| c.set_files(files))
}
