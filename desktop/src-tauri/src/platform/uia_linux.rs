//! AT-SPI's C API runs on a bounded worker, with GObject references released.

use std::{collections::VecDeque, ffi::{c_char, c_void, CStr}, ptr, time::{Duration, Instant}};
use super::{Element, normalize_url};
use crate::win::{self, Rect};
type Object = *mut c_void;
#[repr(C)] struct Bounds { x: i32, y: i32, width: i32, height: i32 }

#[link(name = "atspi")]
unsafe extern "C" {
    fn atspi_init() -> i32;
    fn atspi_set_timeout(timeout: i32, startup: i32);
    fn atspi_get_desktop(index: i32) -> Object;
    fn atspi_accessible_get_child_count(object: Object, error: *mut Object) -> i32;
    fn atspi_accessible_get_child_at_index(object: Object, index: i32, error: *mut Object) -> Object;
    fn atspi_accessible_get_process_id(object: Object, error: *mut Object) -> u32;
    fn atspi_accessible_get_name(object: Object, error: *mut Object) -> *mut c_char;
    fn atspi_accessible_get_role_name(object: Object, error: *mut Object) -> *mut c_char;
    fn atspi_accessible_get_component_iface(object: Object) -> Object;
    fn atspi_accessible_get_text_iface(object: Object) -> Object;
    fn atspi_component_get_extents(object: Object, coord: u32, error: *mut Object) -> *mut Bounds;
    fn atspi_text_get_character_count(object: Object, error: *mut Object) -> i32;
    fn atspi_text_get_text(object: Object, start: i32, end: i32, error: *mut Object) -> *mut c_char;
}
#[link(name = "gobject-2.0")]
unsafe extern "C" { fn g_object_unref(object: Object); }
#[link(name = "glib-2.0")]
unsafe extern "C" { fn g_free(object: Object); }

struct Owned(Object);
impl Drop for Owned { fn drop(&mut self) { unsafe { g_object_unref(self.0); } } }
impl Owned {
    fn new(object: Object) -> Option<Self> { (!object.is_null()).then_some(Self(object)) }
    fn children(&self) -> Vec<Self> {
        let count = unsafe { atspi_accessible_get_child_count(self.0, ptr::null_mut()) }.clamp(0, 300);
        (0..count).filter_map(|i| Self::new(unsafe { atspi_accessible_get_child_at_index(self.0, i, ptr::null_mut()) })).collect()
    }
    fn rect(&self) -> Option<Rect> {
        let component = Self::new(unsafe { atspi_accessible_get_component_iface(self.0) })?;
        let bounds = unsafe { atspi_component_get_extents(component.0, 0, ptr::null_mut()) };
        if bounds.is_null() { return None; }
        let result = unsafe { Rect::new((*bounds).x, (*bounds).y, (*bounds).width, (*bounds).height) };
        unsafe { g_free(bounds.cast()); }
        (result.w > 0 && result.h > 0).then_some(result)
    }
}

fn take_string(text: *mut c_char) -> Option<String> {
    if text.is_null() { return None; }
    let value = unsafe { CStr::from_ptr(text).to_string_lossy().into_owned() };
    unsafe { g_free(text.cast()); }
    Some(value)
}

pub fn init() { unsafe { atspi_init(); atspi_set_timeout(80, 200); } }

fn application(window: isize) -> Option<Owned> {
    let pid = win::window_pid(window)?;
    let desktop = Owned::new(unsafe { atspi_get_desktop(0) })?;
    desktop.children().into_iter().find(|app| unsafe { atspi_accessible_get_process_id(app.0, ptr::null_mut()) } == pid)
}

pub fn elements_at(window: isize, x: i32, y: i32) -> Vec<Element> {
    let Some(app) = application(window) else { return Vec::new(); };
    let mut queue = VecDeque::from([app]);
    let deadline = Instant::now() + Duration::from_millis(220);
    let mut out = Vec::new();
    let mut count = 0;
    while let Some(element) = queue.pop_front() {
        if count >= 500 || Instant::now() >= deadline { break; }
        count += 1;
        if let Some(rect) = element.rect() {
            if !rect.contains(x, y) { continue; }
            if !out.iter().any(|e: &Element| e.rect == rect) {
                let name = take_string(unsafe { atspi_accessible_get_name(element.0, ptr::null_mut()) }).unwrap_or_default();
                out.push(Element { rect, name });
            }
        }
        queue.extend(element.children());
    }
    out.sort_by_key(|e| e.rect.area());
    out.truncate(24);
    out
}

pub fn browser_url(window: isize) -> Option<String> {
    let app = application(window)?;
    let title = win::visible_windows().into_iter().find(|w| w.hwnd == window).map(|w| w.title).unwrap_or_default();
    let mut queue = VecDeque::from([app]);
    let deadline = Instant::now() + Duration::from_millis(350);
    let mut count = 0;
    while let Some(element) = queue.pop_front() {
        if count >= 600 || Instant::now() >= deadline { break; }
        count += 1;
        let role = take_string(unsafe { atspi_accessible_get_role_name(element.0, ptr::null_mut()) }).unwrap_or_default();
        if role == "frame" && !title.is_empty() {
            let name = take_string(unsafe { atspi_accessible_get_name(element.0, ptr::null_mut()) }).unwrap_or_default();
            if !name.is_empty() && name != title { continue; }
        }
        if role == "entry" || role == "text" || role == "combo box" {
            if let Some(text) = Owned::new(unsafe { atspi_accessible_get_text_iface(element.0) }) {
                let size = unsafe { atspi_text_get_character_count(text.0, ptr::null_mut()) };
                if (1..=4096).contains(&size) {
                    if let Some(url) = take_string(unsafe { atspi_text_get_text(text.0, 0, size, ptr::null_mut()) }).and_then(|v| normalize_url(&v)) { return Some(url); }
                }
            }
        }
        queue.extend(element.children());
    }
    None
}
