//! Screen capture: grabbing monitors, the capture session the overlay works
//! on, and what happens when the user confirms a selection.

use anyhow::{anyhow, bail, Context, Result};
use image::RgbaImage;
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, Emitter};
use windows::Win32::Graphics::Gdi::{
    BitBlt, CreateCompatibleBitmap, CreateCompatibleDC, DeleteDC, DeleteObject, GetDC, GetDIBits, ReleaseDC,
    SelectObject, BITMAPINFO, BITMAPINFOHEADER, BI_RGB, CAPTUREBLT, DIB_RGB_COLORS, SRCCOPY,
};

use crate::card::{self, Card};
use crate::shots::{self, Source};
use crate::smart::ocr;
use crate::state::state;
use crate::win::{self, MonitorInfo, Rect, WindowInfo};
use crate::{clipboard, imaging, pins, wm};

/// Copies a rectangle of the screen (physical pixels) as RGBA.
pub fn grab(r: Rect) -> Result<Vec<u8>> {
    if r.w <= 0 || r.h <= 0 {
        bail!("empty area");
    }
    unsafe {
        let screen = GetDC(None);
        if screen.is_invalid() {
            bail!("GetDC failed");
        }
        let mem = CreateCompatibleDC(Some(screen));
        let bitmap = CreateCompatibleBitmap(screen, r.w, r.h);
        let old = SelectObject(mem, bitmap.into());
        // CAPTUREBLT includes layered windows such as menus and tooltips.
        let blit = BitBlt(mem, 0, 0, r.w, r.h, Some(screen), r.x, r.y, SRCCOPY | CAPTUREBLT);
        SelectObject(mem, old);

        let mut info = BITMAPINFO {
            bmiHeader: BITMAPINFOHEADER {
                biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                biWidth: r.w,
                biHeight: -r.h, // top-down rows
                biPlanes: 1,
                biBitCount: 32,
                biCompression: BI_RGB.0,
                ..Default::default()
            },
            ..Default::default()
        };
        let mut buf = vec![0u8; r.w as usize * r.h as usize * 4];
        let lines = GetDIBits(mem, bitmap, 0, r.h as u32, Some(buf.as_mut_ptr() as *mut _), &mut info, DIB_RGB_COLORS);

        let _ = DeleteObject(bitmap.into());
        let _ = DeleteDC(mem);
        ReleaseDC(None, screen);

        blit.context("BitBlt failed")?;
        if lines == 0 {
            bail!("GetDIBits failed");
        }
        for px in buf.chunks_exact_mut(4) {
            px.swap(0, 2); // BGRA → RGBA
            px[3] = 255;
        }
        Ok(buf)
    }
}

pub struct Frame {
    pub monitor: MonitorInfo,
    pub rgba: Arc<Vec<u8>>,
}

pub struct Session {
    pub id: u64,
    pub frames: Vec<Frame>,
    pub windows: Vec<WindowInfo>,
}

#[derive(Clone)]
struct LastArea {
    monitor_name: String,
    rect: Rect,
}

#[derive(Default)]
pub struct CaptureState {
    session: Mutex<Option<Arc<Session>>>,
    last: Mutex<Option<LastArea>>,
    counter: AtomicU64,
    starting: AtomicBool,
}

impl CaptureState {
    pub fn current(&self) -> Option<Arc<Session>> {
        self.session.lock().clone()
    }

    pub fn frame(&self, session_id: u64, monitor_id: usize) -> Option<(MonitorInfo, Arc<Vec<u8>>)> {
        let s = self.session.lock().clone()?;
        if s.id != session_id {
            return None;
        }
        s.frames.iter().find(|f| f.monitor.id == monitor_id).map(|f| (f.monitor.clone(), f.rgba.clone()))
    }

    fn take(&self, session_id: u64) -> Option<Arc<Session>> {
        let mut guard = self.session.lock();
        if guard.as_ref().is_some_and(|s| s.id == session_id) { guard.take() } else { None }
    }
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct OverlayStart {
    session_id: u64,
    mode: String,
    monitor: MonitorInfo,
    /// Windows on this monitor, front to back, relative to the monitor.
    windows: Vec<WindowInfo>,
    cursor: Option<(i32, i32)>,
    last: Option<Rect>,
    snap: bool,
    elements: bool,
}

/// Freezes the screen and opens the overlay. `mode` is the tool the overlay
/// starts with: region, window, screen, fixed, text, qr, color or ruler.
pub fn start(app: &AppHandle, mode: &str) {
    let st = state(app);
    if st.capture.current().is_some() {
        let _ = app.emit("overlay:mode", mode);
        return;
    }
    if st.capture.starting.swap(true, Ordering::SeqCst) {
        return;
    }
    let app = app.clone();
    let mode = mode.to_string();
    std::thread::spawn(move || {
        let res = begin(&app, &mode);
        state(&app).capture.starting.store(false, Ordering::SeqCst);
        if let Err(e) = res {
            log::error!("capture failed: {e:#}");
            card::show(&app, Card::error(format!("{e:#}")));
        }
    });
}

/// Waits, showing a countdown, then starts a capture.
pub fn start_delayed(app: &AppHandle, mode: &str, seconds: u32) {
    let app = app.clone();
    let mode = mode.to_string();
    std::thread::spawn(move || {
        card::show(&app, Card::Countdown { seconds });
        std::thread::sleep(Duration::from_secs(seconds as u64));
        start(&app, &mode);
    });
}

fn begin(app: &AppHandle, mode: &str) -> Result<()> {
    let started = std::time::Instant::now();
    if wm::hide_card(app) {
        std::thread::sleep(Duration::from_millis(60)); // let the card leave the screen
    }
    let monitors = win::monitors();
    if monitors.is_empty() {
        bail!("no monitors found");
    }
    let frames = monitors
        .iter()
        .map(|m| Ok(Frame { monitor: m.clone(), rgba: Arc::new(grab(m.rect)?) }))
        .collect::<Result<Vec<_>>>()?;
    let windows = win::visible_windows();
    let (cx, cy) = win::cursor_pos();
    let grabbed = started.elapsed();

    let st = state(app);
    let id = st.capture.counter.fetch_add(1, Ordering::SeqCst) + 1;
    let session = Arc::new(Session { id, frames, windows });
    *st.capture.session.lock() = Some(session.clone());

    let settings = st.settings();
    let last = st.capture.last.lock().clone();
    for frame in &session.frames {
        let m = &frame.monitor;
        let overlay = wm::overlay(app, m)?;
        let windows = session
            .windows
            .iter()
            .filter_map(|w| {
                w.rect.intersect(&m.rect)?;
                Some(WindowInfo { rect: w.rect.offset(-m.rect.x, -m.rect.y), ..w.clone() })
            })
            .collect();
        let payload = OverlayStart {
            session_id: id,
            mode: mode.to_string(),
            monitor: m.clone(),
            windows,
            cursor: m.rect.contains(cx, cy).then(|| (cx - m.rect.x, cy - m.rect.y)),
            last: last.as_ref().filter(|l| l.monitor_name == m.name).map(|l| l.rect),
            snap: settings.snap,
            elements: settings.elements,
        };
        overlay.emit("overlay:start", payload)?;
    }
    log::info!("capture {id}: grabbed {} monitor(s) in {:?}", session.frames.len(), grabbed);

    // If an overlay never answers (page crashed), don't leave a capture hanging.
    let app = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_secs(5));
        let st = state(&app);
        if let Some(s) = st.capture.current() {
            if s.id == id && !wm::any_overlay_visible(&app) {
                log::warn!("capture {id}: overlay never showed, cancelling");
                cancel(&app, id);
            }
        }
    });
    Ok(())
}

/// The overlay drew the frozen screen; show it now.
pub fn overlay_ready(app: &AppHandle, window: &tauri::WebviewWindow, session_id: u64, monitor_id: usize) -> Result<()> {
    let st = state(app);
    let Some(session) = st.capture.current().filter(|s| s.id == session_id) else {
        window.hide()?;
        return Ok(());
    };
    window.show()?;
    let (cx, cy) = win::cursor_pos();
    let on_this = session.frames.iter().any(|f| f.monitor.id == monitor_id && f.monitor.rect.contains(cx, cy));
    let only_one = session.frames.len() == 1;
    if on_this || only_one {
        window.set_focus()?;
    }
    Ok(())
}

pub fn cancel(app: &AppHandle, session_id: u64) {
    if state(app).capture.take(session_id).is_some() {
        end_overlays(app, session_id);
    }
}

/// The words in an area of the frozen screen, relative to the monitor. The
/// capture stays open, so the overlay can let the user pick them in place.
pub fn read_text(app: &AppHandle, session_id: u64, monitor_id: usize, rect: Rect) -> Result<Vec<ocr::Line>> {
    let session = state(app).capture.current().filter(|s| s.id == session_id).ok_or_else(|| anyhow!("this capture has already ended"))?;
    let frame = session.frames.iter().find(|f| f.monitor.id == monitor_id).ok_or_else(|| anyhow!("monitor {monitor_id} is gone"))?;
    let m = &frame.monitor;
    let rect = rect.intersect(&Rect::new(0, 0, m.rect.w, m.rect.h)).ok_or_else(|| anyhow!("the selection is empty"))?;
    let img = imaging::crop(&frame.rgba, m.rect.w as u32, m.rect.h as u32, rect).ok_or_else(|| anyhow!("the selection is empty"))?;
    crate::smart::init_thread();
    let best = ocr::read(&img)?.into_iter().next().unwrap_or_default();
    Ok(best
        .lines
        .into_iter()
        .map(|line| ocr::Line {
            words: line.words.into_iter().map(|w| ocr::Word { rect: w.rect.offset(rect.x, rect.y), ..w }).collect(),
        })
        .collect())
}

/// Tells the overlays to clear and hide. They hide themselves once the
/// cleared frame is on screen, so the next capture never flashes an old one.
fn end_overlays(app: &AppHandle, session_id: u64) {
    let _ = app.emit("overlay:end", session_id);
    let app = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(400));
        // Only if no new capture started meanwhile.
        if state(&app).capture.current().is_none() {
            wm::hide_overlays(&app);
        }
    });
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitRequest {
    pub session_id: u64,
    pub monitor_id: usize,
    /// Relative to the monitor, physical pixels.
    pub rect: Rect,
    /// done, copy, save_as, edit, pin, text or qr.
    pub action: String,
    #[serde(default)]
    pub all_screens: bool,
}

pub fn commit(app: &AppHandle, req: CommitRequest) -> Result<()> {
    let st = state(app);
    let session = st.capture.take(req.session_id).ok_or_else(|| anyhow!("this capture has already ended"))?;
    end_overlays(app, session.id);

    let (img, on_screen) = if req.all_screens {
        stitch(&session)?
    } else {
        let frame = session
            .frames
            .iter()
            .find(|f| f.monitor.id == req.monitor_id)
            .ok_or_else(|| anyhow!("monitor {} is gone", req.monitor_id))?;
        let m = &frame.monitor;
        let img = imaging::crop(&frame.rgba, m.rect.w as u32, m.rect.h as u32, req.rect)
            .ok_or_else(|| anyhow!("the selection is empty"))?;
        *st.capture.last.lock() = Some(LastArea { monitor_name: m.name.clone(), rect: req.rect });
        (img, req.rect.offset(m.rect.x, m.rect.y))
    };
    let source = source_of(&session.windows, on_screen);
    let app = app.clone();
    std::thread::spawn(move || {
        if let Err(e) = finish(&app, img, source, on_screen, &req.action) {
            log::error!("after capture: {e:#}");
            card::show(&app, Card::error(format!("{e:#}")));
        }
    });
    Ok(())
}

/// Captures the last area again, without the overlay.
pub fn repeat_last(app: &AppHandle) -> Result<()> {
    let st = state(app);
    let last = st.capture.last.lock().clone();
    let Some(last) = last else {
        start(app, "region");
        return Ok(());
    };
    let monitors = win::monitors();
    let m = monitors.iter().find(|m| m.name == last.monitor_name).unwrap_or(&monitors[0]);
    let rect = last.rect.intersect(&Rect::new(0, 0, m.rect.w, m.rect.h)).ok_or_else(|| anyhow!("last area is off screen"))?;
    let on_screen = rect.offset(m.rect.x, m.rect.y);
    wm::hide_card(app);
    let img = imaging::from_raw(rect.w as u32, rect.h as u32, grab(on_screen)?)?;
    let source = source_of(&win::visible_windows(), on_screen);
    finish(app, img, source, on_screen, "done")
}

/// All monitors in one image, laid out as Windows arranges them.
fn stitch(session: &Session) -> Result<(RgbaImage, Rect)> {
    let left = session.frames.iter().map(|f| f.monitor.rect.x).min().unwrap_or(0);
    let top = session.frames.iter().map(|f| f.monitor.rect.y).min().unwrap_or(0);
    let right = session.frames.iter().map(|f| f.monitor.rect.right()).max().unwrap_or(0);
    let bottom = session.frames.iter().map(|f| f.monitor.rect.bottom()).max().unwrap_or(0);
    let mut out = RgbaImage::new((right - left) as u32, (bottom - top) as u32);
    for f in &session.frames {
        let r = f.monitor.rect;
        let img = imaging::from_raw(r.w as u32, r.h as u32, f.rgba.as_ref().clone())?;
        imaging::paste(&mut out, &img, r.x - left, r.y - top);
    }
    Ok((out, Rect::new(left, top, right - left, bottom - top)))
}

/// The app and window under the middle of the capture.
fn source_of(windows: &[WindowInfo], area: Rect) -> Source {
    let (cx, cy) = (area.x + area.w / 2, area.y + area.h / 2);
    let Some(w) = windows.iter().find(|w| w.rect.contains(cx, cy)) else { return Source::default() };
    let app = match w.class.as_str() {
        "Progman" | "WorkerW" => "Desktop".to_string(),
        "Shell_TrayWnd" | "Shell_SecondaryTrayWnd" => "Taskbar".to_string(),
        _ => win::friendly_app_name(&w.app, &w.title),
    };
    let title = if app == "Desktop" { String::new() } else { w.title.clone() };
    Source { app, title, url: String::new(), hwnd: w.hwnd, exe: w.app.clone() }
}

fn finish(app: &AppHandle, img: RgbaImage, mut src: Source, at: Rect, action: &str) -> Result<()> {
    let st = state(app);
    let settings = st.settings();
    // Browsers: remember the page address, so the library can search it.
    if crate::smart::uia::is_browser(&src.exe) {
        src.url = crate::smart::uia::browser_url(src.hwnd, Duration::from_millis(400)).unwrap_or_default();
    }
    match action {
        "pin" => pins::open(app, img, at),
        "text" | "qr" => crate::smart::screen_tool(app, action, &img),
        "save_as" => save_as(app, &img),
        "edit" => {
            let target = if settings.save_all { format!("shot:{}", shots::save_new(app, &img, &src)?.id) } else { format!("temp:{}", st.put_image(img)) };
            wm::open_editor(app, &target)
        }
        "copy" => {
            clipboard::set_image(&img)?;
            show_result(app, img, &src, true)
        }
        _ => {
            let copied = settings.copy_after_capture && clipboard::set_image(&img).is_ok();
            if settings.open_editor {
                let target = if settings.save_all { format!("shot:{}", shots::save_new(app, &img, &src)?.id) } else { format!("temp:{}", st.put_image(img)) };
                return wm::open_editor(app, &target);
            }
            show_result(app, img, &src, copied)
        }
    }
}

/// Saves (if the library keeps everything) and shows the quick card.
fn show_result(app: &AppHandle, img: RgbaImage, src: &Source, copied: bool) -> Result<()> {
    let st = state(app);
    let settings = st.settings();
    let (w, h) = img.dimensions();
    let (shot, temp_id) = if settings.save_all {
        (Some(shots::save_new(app, &img, src)?), None)
    } else {
        (None, Some(st.put_temp(img)))
    };
    if settings.show_card {
        card::show(app, Card::Shot { shot, temp_id, width: w, height: h, copied });
    }
    Ok(())
}

pub fn save_as(app: &AppHandle, img: &RgbaImage) -> Result<()> {
    use tauri_plugin_dialog::DialogExt;
    let name = format!("Screenshot {}.png", chrono::Local::now().format("%Y-%m-%d %H-%M-%S"));
    let picked = app
        .dialog()
        .file()
        .set_file_name(&name)
        .add_filter("PNG", &["png"])
        .add_filter("JPEG", &["jpg", "jpeg"])
        .add_filter("WebP", &["webp"])
        .blocking_save_file();
    let Some(path) = picked.and_then(|p| p.into_path().ok()) else { return Ok(()) };
    state(app).paths.validate_save_dir(&path)?;
    let format = imaging::Format::from_path(&path);
    let quality = match format {
        imaging::Format::Jpeg => state(app).settings().jpeg_quality,
        imaging::Format::Webp => state(app).settings().webp_quality,
        imaging::Format::Png => 100,
    };
    let mut data = imaging::encode(img, format, quality)?;
    if format == imaging::Format::Png {
        data = imaging::optimize_png(&data).unwrap_or(data);
    }
    std::fs::write(&path, data)?;
    card::show(app, Card::Saved { path: path.to_string_lossy().into_owned() });
    Ok(())
}

pub fn monitor_at(app: &AppHandle, x: i32, y: i32) -> Option<tauri::Monitor> {
    app.available_monitors()
        .ok()?
        .into_iter()
        .find(|m| {
            let (p, s) = (m.position(), m.size());
            x >= p.x && y >= p.y && x < p.x + s.width as i32 && y < p.y + s.height as i32
        })
}

#[cfg(test)]
mod tests {
    /// Reads the real screen into memory (nothing is saved or shown).
    #[test]
    fn grabs_the_main_monitor_at_full_resolution() {
        let monitors = crate::win::monitors();
        let m = &monitors[0];
        let started = std::time::Instant::now();
        let rgba = super::grab(m.rect).unwrap();
        let took = started.elapsed();
        assert_eq!(rgba.len(), (m.rect.w * m.rect.h * 4) as usize);
        assert!(rgba.chunks_exact(4).all(|p| p[3] == 255));
        let first = &rgba[0..4];
        assert!(rgba.chunks_exact(4).any(|p| p != first), "frame is blank");
        let windows = crate::win::visible_windows();
        assert!(!windows.is_empty());
        println!("grabbed {}x{} at {:.0}% in {:?}; {} windows", m.rect.w, m.rect.h, m.scale * 100.0, took, windows.len());
    }
}
