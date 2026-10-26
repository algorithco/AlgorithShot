//! Native monitor and window information for macOS and Linux.

use anyhow::{Context, Result, bail};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::OnceLock;
use tauri::AppHandle;

static APP: OnceLock<AppHandle> = OnceLock::new();

pub fn init(app: &AppHandle) { let _ = APP.set(app.clone()); }

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
pub struct Rect { pub x: i32, pub y: i32, pub w: i32, pub h: i32 }

impl Rect {
    pub fn new(x: i32, y: i32, w: i32, h: i32) -> Self { Self { x, y, w, h } }
    pub fn right(&self) -> i32 { self.x + self.w }
    pub fn bottom(&self) -> i32 { self.y + self.h }
    pub fn contains(&self, x: i32, y: i32) -> bool { x >= self.x && y >= self.y && x < self.right() && y < self.bottom() }
    pub fn intersect(&self, other: &Rect) -> Option<Rect> {
        let (x, y) = (self.x.max(other.x), self.y.max(other.y));
        let (right, bottom) = (self.right().min(other.right()), self.bottom().min(other.bottom()));
        (right > x && bottom > y).then(|| Self::new(x, y, right - x, bottom - y))
    }
    pub fn offset(&self, x: i32, y: i32) -> Rect { Self::new(self.x + x, self.y + y, self.w, self.h) }
    pub fn area(&self) -> i64 { self.w.max(0) as i64 * self.h.max(0) as i64 }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MonitorInfo { pub id: usize, pub name: String, pub rect: Rect, pub work: Rect, pub scale: f64, pub primary: bool }

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowInfo { pub hwnd: isize, pub rect: Rect, pub title: String, pub app: String, pub class: String }

fn native_bounds(m: &xcap::Monitor) -> Result<Rect> {
    let scale = if cfg!(target_os = "macos") { m.scale_factor()? as f64 } else { 1.0 };
    Ok(Rect::new((m.x()? as f64 * scale).round() as i32, (m.y()? as f64 * scale).round() as i32,
        (m.width()? as f64 * scale).round() as i32, (m.height()? as f64 * scale).round() as i32))
}

pub fn monitors() -> Vec<MonitorInfo> {
    let mut out: Vec<_> = xcap::Monitor::all().unwrap_or_default().into_iter().filter_map(|m| {
        let rect = native_bounds(&m).ok()?;
        Some(MonitorInfo { id: 0, name: format!("{} ({})", m.name().ok()?, m.id().ok()?), rect, work: rect,
            scale: m.scale_factor().unwrap_or(1.0) as f64, primary: m.is_primary().unwrap_or(false) })
    }).collect();
    out.sort_by_key(|m| (!m.primary, m.rect.x, m.rect.y));
    if let Some(native) = APP.get().and_then(|a| a.available_monitors().ok()) {
        for monitor in &mut out {
            if let Some(m) = native.iter().find(|m| m.position().x == monitor.rect.x && m.position().y == monitor.rect.y) {
                let work = m.work_area();
                monitor.work = Rect::new(work.position.x, work.position.y, work.size.width as i32, work.size.height as i32);
            }
        }
    }
    for (i, m) in out.iter_mut().enumerate() { m.id = i; }
    out
}

pub fn logical_rect_to_physical(r: Rect) -> Rect {
    if !cfg!(target_os = "macos") { return r; }
    let scale = xcap::Monitor::from_point(r.x + r.w / 2, r.y + r.h / 2).ok()
        .and_then(|m| m.scale_factor().ok()).unwrap_or(1.0) as f64;
    Rect::new((r.x as f64 * scale).round() as i32, (r.y as f64 * scale).round() as i32,
        (r.w as f64 * scale).round() as i32, (r.h as f64 * scale).round() as i32)
}

pub fn physical_point_to_logical(x: i32, y: i32) -> (i32, i32) {
    if !cfg!(target_os = "macos") { return (x, y); }
    let scale = monitors().into_iter().find(|m| m.rect.contains(x, y)).map(|m| m.scale).unwrap_or(1.0);
    ((x as f64 / scale).round() as i32, (y as f64 / scale).round() as i32)
}

pub fn visible_windows() -> Vec<WindowInfo> {
    xcap::Window::all().unwrap_or_default().into_iter().filter_map(|w| {
        if w.pid().ok()? == std::process::id() || w.is_minimized().unwrap_or(true) { return None; }
        let rect = logical_rect_to_physical(Rect::new(w.x().ok()?, w.y().ok()?, w.width().ok()? as i32, w.height().ok()? as i32));
        if rect.w < 4 || rect.h < 4 { return None; }
        let app = w.app_name().unwrap_or_default();
        Some(WindowInfo { hwnd: w.id().ok()? as isize, rect, title: w.title().unwrap_or_default(), class: app.clone(), app })
    }).collect()
}

pub fn window_pid(id: isize) -> Option<u32> {
    xcap::Window::all().ok()?.into_iter().find(|w| w.id().ok() == Some(id as u32))?.pid().ok()
}

pub fn grab(r: Rect) -> Result<Vec<u8>> {
    if r.w <= 0 || r.h <= 0 { bail!("empty area"); }
    let mut image = image::RgbaImage::new(r.w as u32, r.h as u32);
    let mut captured = false;
    for monitor in xcap::Monitor::all().context("Could not enumerate displays")? {
        let bounds = native_bounds(&monitor)?;
        let Some(part) = bounds.intersect(&r) else { continue; };
        let frame = monitor.capture_image().context("Screen capture failed. On macOS, allow Screen Recording in System Settings; on Linux, check your desktop's capture permissions.")?;
        let (x, y) = ((part.x - bounds.x) as u32, (part.y - bounds.y) as u32);
        let (w, h) = ((part.w as u32).min(frame.width().saturating_sub(x)), (part.h as u32).min(frame.height().saturating_sub(y)));
        if w == 0 || h == 0 { continue; }
        let crop = image::imageops::crop_imm(&frame, x, y, w, h).to_image();
        image::imageops::replace(&mut image, &crop, (part.x - r.x) as i64, (part.y - r.y) as i64);
        captured = true;
    }
    if !captured { bail!("The selected display is no longer available"); }
    for pixel in image.pixels_mut() { pixel.0[3] = 255; }
    Ok(image.into_raw())
}

pub fn cursor_pos() -> (i32, i32) {
    APP.get().and_then(|a| a.cursor_position().ok()).map(|p| (p.x.round() as i32, p.y.round() as i32)).unwrap_or_default()
}

pub fn friendly_app_name(exe: &str, title: &str) -> String {
    match exe.to_lowercase().as_str() {
        "google chrome" | "chrome" | "google-chrome" => "Chrome".into(),
        "microsoft edge" | "msedge" => "Edge".into(),
        "code" | "visual studio code" => "VS Code".into(),
        "telegram-desktop" | "telegram" => "Telegram".into(),
        "" => title.rsplit(" - ").next().unwrap_or(title).trim().into(),
        _ => exe.into(),
    }
}

pub fn process_path(pid: u32) -> Option<PathBuf> {
    #[cfg(target_os = "linux")]
    { std::fs::read_link(format!("/proc/{pid}/exe")).ok() }
    #[cfg(target_os = "macos")]
    {
        unsafe extern "C" { fn proc_pidpath(pid: i32, buffer: *mut std::ffi::c_void, size: u32) -> i32; }
        let mut buffer = vec![0u8; 4096];
        let count = unsafe { proc_pidpath(pid as i32, buffer.as_mut_ptr().cast(), buffer.len() as u32) };
        (count > 0).then(|| PathBuf::from(String::from_utf8_lossy(&buffer[..count as usize]).trim_end_matches('\0').to_string()))
    }
}

pub fn focus_app(name: &str) -> bool {
    let Some(window) = visible_windows().into_iter().find(|w| friendly_app_name(&w.app, &w.title).eq_ignore_ascii_case(name)) else { return false; };
    #[cfg(target_os = "macos")]
    { std::process::Command::new("open").args(["-a", &window.app]).status().is_ok_and(|s| s.success()) }
    #[cfg(target_os = "linux")]
    {
        use x11rb::{connection::Connection, protocol::xproto::{ConnectionExt, ClientMessageEvent, ClientMessageData, EventMask}};
        let Ok((connection, screen)) = x11rb::connect(None) else { return false; };
        let Ok(cookie) = connection.intern_atom(false, b"_NET_ACTIVE_WINDOW") else { return false; };
        let Ok(atom) = cookie.reply() else { return false; };
        let event = ClientMessageEvent::new(32, window.hwnd as u32, atom.atom, ClientMessageData::from([1, 0, 0, 0, 0]));
        connection.send_event(false, connection.setup().roots[screen].root, EventMask::SUBSTRUCTURE_REDIRECT | EventMask::SUBSTRUCTURE_NOTIFY, event).is_ok()
            && connection.flush().is_ok()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rectangles_preserve_negative_display_origins() {
        let left = Rect::new(-1920, 0, 1920, 1080);
        assert!(left.contains(-1, 500));
        assert!(!left.contains(0, 500));
        assert_eq!(left.intersect(&Rect::new(-100, 100, 200, 200)), Some(Rect::new(-100, 100, 100, 200)));
    }
}
