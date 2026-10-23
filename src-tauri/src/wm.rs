//! Creates, places and shows the app's windows: one capture overlay per
//! monitor, the quick card, the library and the editors.
//!
//! Commands that create windows must be `async`: on Windows, building a
//! webview from the main thread inside a sync command can deadlock.

use anyhow::{anyhow, Result};
use tauri::{AppHandle, Emitter, LogicalSize, Manager, PhysicalPosition, PhysicalSize, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

use crate::win::{self, MonitorInfo};

const CARD_WIDTH: f64 = 392.0;
const CARD_MARGIN: f64 = 12.0;

fn overlay_label(id: usize) -> String {
    format!("overlay-{id}")
}

/// The overlay window for a monitor, created on first use and placed
/// exactly over it.
pub fn overlay(app: &AppHandle, m: &MonitorInfo) -> Result<WebviewWindow> {
    let label = overlay_label(m.id);
    let window = match app.get_webview_window(&label) {
        Some(w) => w,
        None => {
            let w = WebviewWindowBuilder::new(app, &label, WebviewUrl::App("overlay.html".into()))
                .title("AlgorithShot")
                .decorations(false)
                .transparent(true)
                .shadow(false)
                .resizable(false)
                .always_on_top(true)
                .skip_taskbar(true)
                .visible(false)
                .focused(false)
                .inner_size(m.rect.w as f64 / m.scale, m.rect.h as f64 / m.scale)
                .position(m.rect.x as f64 / m.scale, m.rect.y as f64 / m.scale)
                .build()?;
            win::disable_transitions(w.hwnd()?.0 as isize);
            w
        }
    };
    window.set_position(PhysicalPosition::new(m.rect.x, m.rect.y))?;
    window.set_size(PhysicalSize::new(m.rect.w as u32, m.rect.h as u32))?;
    Ok(window)
}

/// Makes the overlays and the card ahead of time so the first capture is fast.
pub fn precreate(app: &AppHandle) {
    for m in win::monitors() {
        if let Err(e) = overlay(app, &m) {
            log::warn!("overlay for {}: {e:#}", m.name);
        }
    }
    if let Err(e) = card(app) {
        log::warn!("card window: {e:#}");
    }
}

pub fn hide_overlays(app: &AppHandle) {
    for (label, w) in app.webview_windows() {
        if label.starts_with("overlay-") {
            let _ = w.hide();
        }
    }
}

pub fn any_overlay_visible(app: &AppHandle) -> bool {
    app.webview_windows()
        .iter()
        .any(|(label, w)| label.starts_with("overlay-") && w.is_visible().unwrap_or(false))
}

pub fn card(app: &AppHandle) -> Result<WebviewWindow> {
    if let Some(w) = app.get_webview_window("card") {
        return Ok(w);
    }
    let w = WebviewWindowBuilder::new(app, "card", WebviewUrl::App("card.html".into()))
        .title("AlgorithShot")
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .resizable(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .visible(false)
        .focused(false)
        .inner_size(CARD_WIDTH, 140.0)
        .build()?;
    win::disable_transitions(w.hwnd()?.0 as isize);
    Ok(w)
}

/// Sizes the card to its content and puts it in the bottom-right corner of
/// the main monitor's work area (above the taskbar).
pub fn place_card(_app: &AppHandle, w: &WebviewWindow, width: f64, height: f64) -> Result<()> {
    let monitors = win::monitors();
    let m = monitors.first().ok_or_else(|| anyhow!("no monitor"))?;
    let width = if width > 0.0 { width } else { CARD_WIDTH };
    w.set_size(LogicalSize::new(width, height))?;
    let px_w = (width * m.scale).round() as i32;
    let px_h = (height * m.scale).round() as i32;
    let margin = (CARD_MARGIN * m.scale).round() as i32;
    w.set_position(PhysicalPosition::new(m.work.right() - px_w - margin, m.work.bottom() - px_h - margin))?;
    Ok(())
}

/// Hides the card. Returns true if it was showing.
pub fn hide_card(app: &AppHandle) -> bool {
    match app.get_webview_window("card") {
        Some(w) if w.is_visible().unwrap_or(false) => {
            let _ = w.hide();
            true
        }
        _ => false,
    }
}

/// Opens the library window (or brings it forward) on `page`:
/// library, cleanup or settings.
pub fn show_main(app: &AppHandle, page: Option<&str>) -> Result<()> {
    if let Some(w) = app.get_webview_window("main") {
        if w.is_minimized().unwrap_or(false) {
            w.unminimize()?;
        }
        w.show()?;
        w.set_focus()?;
        if let Some(page) = page {
            w.emit("nav", page)?;
        }
        return Ok(());
    }
    let url = format!("index.html#{}", page.unwrap_or("library"));
    WebviewWindowBuilder::new(app, "main", WebviewUrl::App(url.into()))
        .title("AlgorithShot")
        .inner_size(1180.0, 760.0)
        .min_inner_size(880.0, 560.0)
        .center()
        .visible(true)
        .build()?;
    Ok(())
}

/// Opens an editor for `shot:{id}` or `temp:{id}`. One window per image.
pub fn open_editor(app: &AppHandle, target: &str) -> Result<()> {
    open_editor_with(app, target, None)
}

/// Same, starting on a side panel such as "privacy".
pub fn open_editor_with(app: &AppHandle, target: &str, panel: Option<&str>) -> Result<()> {
    let label = format!("editor-{}", target.replace(':', "_"));
    if let Some(w) = app.get_webview_window(&label) {
        w.show()?;
        w.set_focus()?;
        if let Some(panel) = panel {
            w.emit("editor:panel", panel)?;
        }
        return Ok(());
    }
    let (w, h) = editor_size(app, target);
    let mut url = format!("editor.html?target={target}");
    if let Some(panel) = panel {
        url.push_str(&format!("&panel={panel}"));
    }
    WebviewWindowBuilder::new(app, &label, WebviewUrl::App(url.into()))
        .title("AlgorithShot — Editor")
        .inner_size(w, h)
        .min_inner_size(820.0, 560.0)
        .center()
        .visible(true)
        .build()?;
    Ok(())
}

/// Big enough to show the image at 100% when it fits, within 90% of the
/// main monitor's work area.
fn editor_size(app: &AppHandle, target: &str) -> (f64, f64) {
    let monitors = win::monitors();
    let Some(m) = monitors.first() else { return (1200.0, 800.0) };
    let (max_w, max_h) = (m.work.w as f64 / m.scale * 0.9, m.work.h as f64 / m.scale * 0.9);
    let st = crate::state::state(app);
    let dims = match target.split_once(':') {
        Some(("shot", id)) => st.library.get(id).ok().flatten().map(|s| (s.width, s.height)),
        Some(("temp", id)) => st.image(id).map(|i| i.dimensions()),
        _ => None,
    };
    let (iw, ih) = dims.map(|(w, h)| (w as f64 / m.scale, h as f64 / m.scale)).unwrap_or((1100.0, 700.0));
    // Room for the toolbar, side panel and status bar.
    ((iw + 380.0).clamp(900.0, max_w), (ih + 170.0).clamp(620.0, max_h))
}
