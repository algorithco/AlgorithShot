//! Native displays and windows. Capture coordinates use a non-overlapping
//! raster space; native window placement keeps each display's logical origin.

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
pub struct MonitorInfo {
    pub id: usize, pub name: String, pub rect: Rect, pub work: Rect, pub scale: f64, pub primary: bool,
    #[serde(skip)] pub logical: Rect,
    #[serde(skip)] pub native_id: u32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowInfo { pub hwnd: isize, pub rect: Rect, pub title: String, pub app: String, pub class: String }

fn raster_rect(logical: Rect, scale: f64, desktop_scale: f64) -> Rect {
    Rect::new((logical.x as f64 * desktop_scale).round() as i32,
        (logical.y as f64 * desktop_scale).round() as i32,
        (logical.w as f64 * scale).round() as i32,
        (logical.h as f64 * scale).round() as i32)
}

pub fn monitors() -> Vec<MonitorInfo> {
    #[cfg(target_os = "linux")]
    {
        // GTK reports native pixel bounds on X11 and can also enumerate Wayland
        // outputs without DISPLAY. Avoid xcap's logical Xft.dpi coordinates.
        let mut monitors: Vec<_> = APP.get().and_then(|app| app.available_monitors().ok()).unwrap_or_default()
            .into_iter().enumerate().map(|(id, m)| {
                let rect = Rect::new(m.position().x, m.position().y, m.size().width as i32, m.size().height as i32);
                let work = m.work_area();
                MonitorInfo { id, native_id: id as u32, name: m.name().cloned().unwrap_or_else(|| "Display".into()),
                    logical: rect, rect, work: Rect::new(work.position.x, work.position.y, work.size.width as i32, work.size.height as i32),
                    scale: m.scale_factor(), primary: id == 0 }
            }).collect();
        if let Some(primary) = APP.get().and_then(|app| app.primary_monitor().ok().flatten()) {
            for monitor in &mut monitors { monitor.primary = monitor.rect.x == primary.position().x && monitor.rect.y == primary.position().y; }
        }
        monitors.sort_by_key(|m| (!m.primary, m.rect.x, m.rect.y));
        for (id, monitor) in monitors.iter_mut().enumerate() { monitor.id = id; }
        monitors
    }
    #[cfg(target_os = "macos")]
    {
    let native = match xcap::Monitor::all() {
        Ok(monitors) => monitors,
        Err(error) => { log::warn!("display enumeration: {error}"); return vec![]; }
    };
    let mut out: Vec<_> = native.into_iter().filter_map(|m| {
        let logical = Rect::new(m.x().ok()?, m.y().ok()?, m.width().ok()? as i32, m.height().ok()? as i32);
        let scale = m.scale_factor().unwrap_or(1.0) as f64;
        let scale = if scale.is_finite() && scale > 0.0 { scale } else { 1.0 };
        let native_id = m.id().ok()?;
        Some(MonitorInfo { id: 0, name: format!("{} ({native_id})", m.name().ok()?), rect: logical,
            work: logical, logical, native_id, scale, primary: m.is_primary().unwrap_or(false) })
    }).collect();
    // Scaling each origin by its own DPI makes adjacent Retina/1x displays
    // overlap. A common origin scale prevents overlap; sizes remain real pixels.
    let desktop_scale = out.iter().map(|m| m.scale).fold(1.0, f64::max);
    for monitor in &mut out {
        monitor.rect = raster_rect(monitor.logical, monitor.scale, desktop_scale);
        monitor.work = monitor.rect;
    }
    out.sort_by_key(|m| (!m.primary, m.rect.x, m.rect.y));
    if let Some(native) = APP.get().and_then(|app| app.available_monitors().ok()) {
        for monitor in &mut out {
            let native_origin = raster_rect(monitor.logical, monitor.scale, monitor.scale);
            if let Some(m) = native.iter().find(|m| m.position().x == native_origin.x && m.position().y == native_origin.y) {
                let work = m.work_area();
                monitor.work = Rect::new(monitor.rect.x + work.position.x - native_origin.x,
                    monitor.rect.y + work.position.y - native_origin.y, work.size.width as i32, work.size.height as i32);
                monitor.scale = m.scale_factor();
            }
        }
    }
    for (id, m) in out.iter_mut().enumerate() { m.id = id; }
    out
    }
}

pub fn overlay_position(monitor: &MonitorInfo) -> tauri::Position {
    #[cfg(target_os = "macos")]
    { tauri::LogicalPosition::new(monitor.logical.x, monitor.logical.y).into() }
    #[cfg(target_os = "linux")]
    { tauri::PhysicalPosition::new(monitor.rect.x, monitor.rect.y).into() }
}

pub fn desktop_position(x: i32, y: i32) -> tauri::Position {
    #[cfg(target_os = "macos")]
    { let (x, y) = physical_point_to_logical(x, y); tauri::LogicalPosition::new(x, y).into() }
    #[cfg(target_os = "linux")]
    { tauri::PhysicalPosition::new(x, y).into() }
}

fn transform_rect(rect: Rect, monitor: &MonitorInfo) -> Rect {
    Rect::new(monitor.rect.x + ((rect.x - monitor.logical.x) as f64 * monitor.scale).round() as i32,
        monitor.rect.y + ((rect.y - monitor.logical.y) as f64 * monitor.scale).round() as i32,
        (rect.w as f64 * monitor.scale).round() as i32, (rect.h as f64 * monitor.scale).round() as i32)
}

pub fn logical_rect_to_physical(rect: Rect) -> Rect {
    if !cfg!(target_os = "macos") { return rect; }
    monitors().iter().find(|m| m.logical.contains(rect.x + rect.w / 2, rect.y + rect.h / 2))
        .map(|m| transform_rect(rect, m)).unwrap_or(rect)
}

#[cfg(target_os = "macos")]
pub fn physical_point_to_logical(x: i32, y: i32) -> (i32, i32) {
    monitors().iter().find(|m| m.rect.contains(x, y)).map(|m| (
        m.logical.x + ((x - m.rect.x) as f64 / m.scale).round() as i32,
        m.logical.y + ((y - m.rect.y) as f64 / m.scale).round() as i32,
    )).unwrap_or((x, y))
}

pub fn visible_windows() -> Vec<WindowInfo> {
    #[cfg(target_os = "linux")]
    { if crate::platform::portal::is_wayland() { vec![] } else { crate::platform::x11::windows() } }
    #[cfg(target_os = "macos")]
    {
    let displays = monitors();
    let mut out = vec![];
    for window in xcap::Window::all().unwrap_or_default() {
        if window.pid().ok() == Some(std::process::id()) || window.is_minimized().unwrap_or(true) { continue; }
        let (Ok(id), Ok(x), Ok(y), Ok(width), Ok(height)) = (window.id(), window.x(), window.y(), window.width(), window.height()) else { continue; };
        let rect = Rect::new(x, y, width as i32, height as i32);
        if rect.w < 4 || rect.h < 4 { continue; }
        let app = window.app_name().unwrap_or_default();
        let title = window.title().unwrap_or_default();
        let pieces: Vec<_> = displays.iter().filter_map(|m| rect.intersect(&m.logical).map(|r| transform_rect(r, m))).collect();
        for rect in pieces {
            out.push(WindowInfo { hwnd: id as isize, rect, title: title.clone(), class: app.clone(), app: app.clone() });
        }
    }
    out
    }
}

pub fn window_pid(id: isize) -> Option<u32> {
    #[cfg(target_os = "linux")]
    { if crate::platform::portal::is_wayland() { None } else { crate::platform::x11::window_pid(id) } }
    #[cfg(target_os = "macos")]
    { xcap::Window::all().ok()?.into_iter().find(|w| w.id().ok() == Some(id as u32))?.pid().ok() }
}

pub fn capture_frames() -> Result<Vec<(MonitorInfo, Vec<u8>)>> { capture_displays(None) }

fn capture_displays(region: Option<Rect>) -> Result<Vec<(MonitorInfo, Vec<u8>)>> {
    #[cfg(target_os = "macos")]
    crate::platform::capture_macos::ensure_permission(APP.get().context("The app is not ready to capture")?)?;
    let displays = monitors();
    if displays.is_empty() { bail!("No display is available. Reconnect a display and retry."); }
    let mut frames = vec![];
    #[cfg(target_os = "linux")]
    {
        if crate::platform::portal::is_wayland() { bail!("Use the desktop screenshot picker in this session"); }
        for monitor in displays {
            if region.is_some_and(|r| monitor.rect.intersect(&r).is_none()) { continue; }
            let image = crate::platform::x11::capture(monitor.rect)?;
            frames.push((monitor, image.into_raw()));
        }
    }
    #[cfg(target_os = "macos")]
    for native in xcap::Monitor::all().context("Could not enumerate displays")? {
        let id = native.id()?;
        let Some(mut monitor) = displays.iter().find(|m| m.native_id == id).cloned() else { continue; };
        if region.is_some_and(|r| monitor.rect.intersect(&r).is_none()) { continue; }
        let image = match crate::platform::capture_macos::capture(id)? {
            Some(image) => image,
            None => native.capture_image().context("Could not capture the display")?,
        };
        monitor.rect.w = image.width() as i32;
        monitor.rect.h = image.height() as i32;
        if image.width() == 0 || image.height() == 0 { bail!("The display returned an empty image"); }
        frames.push((monitor, image.into_raw()));
    }
    if frames.is_empty() { bail!("The selected display is no longer available"); }
    Ok(frames)
}

pub fn grab(region: Rect) -> Result<Vec<u8>> {
    if region.w <= 0 || region.h <= 0 { bail!("empty area"); }
    let mut image = image::RgbaImage::new(region.w as u32, region.h as u32);
    for (monitor, pixels) in capture_displays(Some(region))? {
        let Some(part) = monitor.rect.intersect(&region) else { continue; };
        let frame = image::RgbaImage::from_raw(monitor.rect.w as u32, monitor.rect.h as u32, pixels).context("Invalid captured image")?;
        let crop = image::imageops::crop_imm(&frame, (part.x - monitor.rect.x) as u32, (part.y - monitor.rect.y) as u32, part.w as u32, part.h as u32).to_image();
        image::imageops::replace(&mut image, &crop, (part.x - region.x) as i64, (part.y - region.y) as i64);
    }
    for pixel in image.pixels_mut() { pixel.0[3] = 255; }
    Ok(image.into_raw())
}

#[cfg(target_os = "linux")]
pub fn portal_monitor(width: u32, height: u32) -> MonitorInfo {
    let rect = Rect::new(0, 0, width as i32, height as i32);
    MonitorInfo { id: 0, native_id: 0, name: "Captured image".into(), rect, work: rect, logical: rect, scale: 1.0, primary: true }
}

pub fn cursor_pos() -> (i32, i32) {
    #[cfg(target_os = "macos")]
    {
        let Some((x, y)) = crate::platform::capture_macos::cursor_position() else { return (0, 0); };
        let rect = logical_rect_to_physical(Rect::new(x.round() as i32, y.round() as i32, 1, 1));
        (rect.x, rect.y)
    }
    #[cfg(target_os = "linux")]
    { APP.get().and_then(|app| app.cursor_position().ok()).map(|p| (p.x.round() as i32, p.y.round() as i32)).unwrap_or_default() }
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
    fn mixed_dpi_displays_keep_non_overlapping_pixels_and_logical_origins() {
        let retina = Rect::new(0, 0, 1440, 900);
        let external = Rect::new(1440, 0, 1920, 1080);
        let retina_pixels = raster_rect(retina, 2.0, 2.0);
        let external_pixels = raster_rect(external, 1.0, 2.0);
        assert_eq!(retina_pixels, Rect::new(0, 0, 2880, 1800));
        assert_eq!(external_pixels, Rect::new(2880, 0, 1920, 1080));
        assert!(retina_pixels.intersect(&external_pixels).is_none());
        let monitor = MonitorInfo { id: 1, native_id: 1, name: "External".into(), rect: external_pixels,
            work: external_pixels, logical: external, scale: 1.0, primary: false };
        assert_eq!(transform_rect(Rect::new(1450, 20, 100, 60), &monitor), Rect::new(2890, 20, 100, 60));
        let left = raster_rect(Rect::new(-1920, -120, 1920, 1080), 1.0, 2.0);
        assert_eq!(left, Rect::new(-3840, -240, 1920, 1080));
        assert!(left.intersect(&retina_pixels).is_none());
    }

    #[test]
    fn x11_fractional_dpi_keeps_the_native_raster_dimensions() {
        assert_eq!(raster_rect(Rect::new(1280, 0, 1280, 720), 1.5, 1.5), Rect::new(1920, 0, 1920, 1080));
    }

    #[test]
    fn rectangles_preserve_negative_display_origins() {
        let left = Rect::new(-1920, 0, 1920, 1080);
        assert!(left.contains(-1, 500));
        assert!(!left.contains(0, 500));
        assert_eq!(left.intersect(&Rect::new(-100, 100, 200, 200)), Some(Rect::new(-100, 100, 100, 200)));
    }
}
