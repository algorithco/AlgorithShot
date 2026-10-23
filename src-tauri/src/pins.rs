//! Pinned screenshots: small always-on-top windows that show an image right
//! where it was captured, for comparing or copying from.

use anyhow::Result;
use image::RgbaImage;
use tauri::{AppHandle, PhysicalPosition, WebviewUrl, WebviewWindowBuilder};

use crate::capture::monitor_at;
use crate::state::state;
use crate::win::Rect;

/// Room around the image for the border and shadow, in logical pixels.
const PAD: f64 = 10.0;

pub fn open(app: &AppHandle, img: RgbaImage, at: Rect) -> Result<()> {
    let scale = monitor_at(app, at.x, at.y).map(|m| m.scale_factor()).unwrap_or(1.0);
    let (w, h) = (img.width() as f64 / scale, img.height() as f64 / scale);
    let (pw, ph) = (img.width(), img.height());
    let id = state(app).put_image(img);
    let url = format!("pin.html?id={id}&w={pw}&h={ph}");
    let window = WebviewWindowBuilder::new(app, format!("pin-{id}"), WebviewUrl::App(url.into()))
        .title("AlgorithShot — Pin")
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .resizable(false)
        .visible(false)
        .inner_size(w + PAD * 2.0, h + PAD * 2.0)
        .build()?;
    let pad = (PAD * scale).round() as i32;
    window.set_position(PhysicalPosition::new(at.x - pad, at.y - pad))?;
    Ok(())
}

/// Pins a library screenshot at the middle of the main monitor.
pub fn open_shot(app: &AppHandle, path: &std::path::Path) -> Result<()> {
    let img = crate::shots::load_rgba(path)?;
    let monitors = crate::win::monitors();
    let work = monitors.first().map(|m| m.work).unwrap_or_default();
    let (w, h) = (img.width() as i32, img.height() as i32);
    let at = Rect::new(work.x + (work.w - w).max(0) / 2, work.y + (work.h - h).max(0) / 2, w, h);
    open(app, img, at)
}

pub fn closed(app: &AppHandle, id: &str) {
    state(app).images.lock().remove(id);
}
