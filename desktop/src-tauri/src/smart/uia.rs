//! UI Automation (the Windows accessibility API): the buttons, panels and
//! messages under a point, for "perfect screenshot" snapping in the overlay,
//! and the page address of a browser window, for the library.
//!
//! All calls go through one thread that owns the automation object; callers
//! wait with a timeout, so a slow app can never freeze the overlay.

use anyhow::Result;
use parking_lot::Mutex;
use serde::Serialize;
use std::mem::ManuallyDrop;
use std::sync::mpsc::{channel, Sender};
use std::sync::LazyLock;
use std::time::{Duration, Instant};
use windows::Win32::Foundation::HWND;
use windows::Win32::System::Com::{CoCreateInstance, CoInitializeEx, CLSCTX_INPROC_SERVER, COINIT_MULTITHREADED};
use windows::Win32::System::Variant::{VARIANT, VARIANT_0, VARIANT_0_0, VARIANT_0_0_0, VT_I4};
use windows::Win32::UI::Accessibility::{
    CUIAutomation, IUIAutomation, IUIAutomationCacheRequest, IUIAutomationCondition, IUIAutomationElement,
    IUIAutomationValuePattern, TreeScope_Children, TreeScope_Descendants, UIA_BoundingRectanglePropertyId,
    UIA_ControlTypePropertyId, UIA_EditControlTypeId, UIA_NamePropertyId, UIA_ValuePatternId,
};

use crate::win::Rect;

#[derive(Debug, Clone, Serialize)]
pub struct Element {
    pub rect: Rect,
    pub name: String,
}

enum Request {
    Elements { hwnd: isize, x: i32, y: i32, reply: Sender<Vec<Element>> },
    Url { hwnd: isize, reply: Sender<Option<String>> },
}

static WORKER: LazyLock<Mutex<Option<Sender<Request>>>> = LazyLock::new(|| Mutex::new(None));

fn worker() -> Option<Sender<Request>> {
    let mut guard = WORKER.lock();
    if guard.is_none() {
        let (tx, rx) = channel::<Request>();
        let spawned = std::thread::Builder::new().name("uia".into()).spawn(move || {
            let Ok(ctx) = Ctx::new() else {
                log::warn!("UI Automation is not available");
                return;
            };
            for req in rx {
                match req {
                    Request::Elements { hwnd, x, y, reply } => {
                        let _ = reply.send(ctx.elements_at(hwnd, x, y).unwrap_or_default());
                    }
                    Request::Url { hwnd, reply } => {
                        let _ = reply.send(ctx.url(hwnd).ok().flatten());
                    }
                }
            }
        });
        if spawned.is_ok() {
            *guard = Some(tx);
        }
    }
    guard.clone()
}

/// Elements under a screen point inside `hwnd`, smallest first.
pub fn elements_at(hwnd: isize, x: i32, y: i32, timeout: Duration) -> Vec<Element> {
    let Some(tx) = worker() else { return Vec::new() };
    let (reply, rx) = channel();
    if tx.send(Request::Elements { hwnd, x, y, reply }).is_err() {
        return Vec::new();
    }
    rx.recv_timeout(timeout).unwrap_or_default()
}

/// The address shown in a browser window, if it has one.
pub fn browser_url(hwnd: isize, timeout: Duration) -> Option<String> {
    let tx = worker()?;
    let (reply, rx) = channel();
    tx.send(Request::Url { hwnd, reply }).ok()?;
    rx.recv_timeout(timeout).ok().flatten()
}

pub fn is_browser(exe: &str) -> bool {
    matches!(exe.to_ascii_lowercase().as_str(), "chrome" | "msedge" | "firefox" | "opera" | "opera_gx" | "brave" | "browser" | "vivaldi" | "yandex")
}

fn variant_i32(value: i32) -> VARIANT {
    VARIANT {
        Anonymous: VARIANT_0 {
            Anonymous: ManuallyDrop::new(VARIANT_0_0 {
                vt: VT_I4,
                wReserved1: 0,
                wReserved2: 0,
                wReserved3: 0,
                Anonymous: VARIANT_0_0_0 { lVal: value },
            }),
        },
    }
}

struct Ctx {
    uia: IUIAutomation,
    cache: IUIAutomationCacheRequest,
    control_view: IUIAutomationCondition,
    is_edit: IUIAutomationCondition,
}

impl Ctx {
    fn new() -> Result<Ctx> {
        unsafe {
            let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
            let uia: IUIAutomation = CoCreateInstance(&CUIAutomation, None, CLSCTX_INPROC_SERVER)?;
            let cache = uia.CreateCacheRequest()?;
            cache.AddProperty(UIA_BoundingRectanglePropertyId)?;
            cache.AddProperty(UIA_NamePropertyId)?;
            let control_view = uia.ControlViewCondition()?;
            let is_edit = uia.CreatePropertyCondition(UIA_ControlTypePropertyId, &variant_i32(UIA_EditControlTypeId.0))?;
            Ok(Ctx { uia, cache, control_view, is_edit })
        }
    }

    fn elements_at(&self, hwnd: isize, x: i32, y: i32) -> Result<Vec<Element>> {
        let deadline = Instant::now() + Duration::from_millis(220);
        let mut chain: Vec<Element> = Vec::new();
        unsafe {
            let mut current: IUIAutomationElement = self.uia.ElementFromHandleBuildCache(HWND(hwnd as _), &self.cache)?;
            chain.push(element(&current)?);
            // Walk down: at each level take the smallest child under the point.
            for _ in 0..40 {
                if Instant::now() > deadline {
                    break;
                }
                let kids = current.FindAllBuildCache(TreeScope_Children, &self.control_view, &self.cache)?;
                let mut best: Option<(IUIAutomationElement, Rect)> = None;
                for i in 0..kids.Length()?.min(500) {
                    let kid = kids.GetElement(i)?;
                    let rect = Rect::from_win(kid.CachedBoundingRectangle()?);
                    if rect.w <= 0 || rect.h <= 0 || !rect.contains(x, y) {
                        continue;
                    }
                    if best.as_ref().is_none_or(|(_, b)| rect.area() < b.area()) {
                        best = Some((kid, rect));
                    }
                }
                let Some((kid, _)) = best else { break };
                chain.push(element(&kid)?);
                current = kid;
            }
        }
        chain.reverse();
        // Nested elements often share a box; keep the innermost one's name.
        chain.dedup_by(|later, earlier| later.rect == earlier.rect);
        Ok(chain)
    }

    fn url(&self, hwnd: isize) -> Result<Option<String>> {
        unsafe {
            let root = self.uia.ElementFromHandle(HWND(hwnd as _))?;
            let edit = root.FindFirst(TreeScope_Descendants, &self.is_edit)?;
            let value: IUIAutomationValuePattern = edit.GetCurrentPatternAs(UIA_ValuePatternId)?;
            Ok(normalize_url(&value.CurrentValue()?.to_string()))
        }
    }
}

fn element(e: &IUIAutomationElement) -> Result<Element> {
    unsafe {
        let name: String = e.CachedName().map(|b| b.to_string()).unwrap_or_default();
        Ok(Element { rect: Rect::from_win(e.CachedBoundingRectangle()?), name: name.chars().take(80).collect() })
    }
}

/// Address-bar text to a URL; None if it isn't one (e.g. a search phrase).
pub fn normalize_url(raw: &str) -> Option<String> {
    let v = raw.trim();
    if v.is_empty() || v.contains(char::is_whitespace) {
        return None;
    }
    if v.starts_with("http://") || v.starts_with("https://") {
        return Some(v.to_string());
    }
    let host = v.split('/').next().unwrap_or("");
    (host.contains('.') && !host.starts_with('.') && !host.ends_with('.')).then(|| format!("https://{v}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn address_bar_text_becomes_a_url() {
        assert_eq!(normalize_url("github.com/algorithco"), Some("https://github.com/algorithco".into()));
        assert_eq!(normalize_url("https://uzum.uz/ru"), Some("https://uzum.uz/ru".into()));
        assert_eq!(normalize_url("how to screenshot"), None);
        assert_eq!(normalize_url(""), None);
        assert!(is_browser("msedge") && !is_browser("Telegram"));
    }
}
