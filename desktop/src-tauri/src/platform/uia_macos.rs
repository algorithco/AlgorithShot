//! AX objects stay on the accessibility worker; Core Foundation ownership is explicit.

use std::{collections::VecDeque, ffi::{c_void, c_char, CStr}, ptr, time::{Duration, Instant}};
use super::{Element, normalize_url};
use crate::win::{self, Rect};

type Object = *const c_void;
#[repr(C)] #[derive(Default)] struct Point { x: f64, y: f64 }
#[repr(C)] #[derive(Default)] struct Size { w: f64, h: f64 }

#[link(name = "ApplicationServices", kind = "framework")]
unsafe extern "C" {
    fn AXUIElementCreateSystemWide() -> Object;
    fn AXUIElementCreateApplication(pid: i32) -> Object;
    fn AXUIElementCopyElementAtPosition(element: Object, x: f32, y: f32, result: *mut Object) -> i32;
    fn AXUIElementCopyAttributeValue(element: Object, attribute: Object, result: *mut Object) -> i32;
    fn AXUIElementSetMessagingTimeout(element: Object, timeout: f32) -> i32;
    fn AXUIElementGetPid(element: Object, pid: *mut i32) -> i32;
    fn AXValueGetValue(value: Object, kind: u32, result: *mut c_void) -> bool;
}
#[link(name = "CoreFoundation", kind = "framework")]
unsafe extern "C" {
    fn CFRelease(object: Object);
    fn CFRetain(object: Object) -> Object;
    fn CFGetTypeID(object: Object) -> usize;
    fn CFStringGetTypeID() -> usize;
    fn CFArrayGetTypeID() -> usize;
    fn CFURLGetTypeID() -> usize;
    fn CFURLGetString(object: Object) -> Object;
    fn CFStringCreateWithCString(allocator: Object, bytes: *const c_char, encoding: u32) -> Object;
    fn CFStringGetLength(string: Object) -> isize;
    fn CFStringGetMaximumSizeForEncoding(length: isize, encoding: u32) -> isize;
    fn CFStringGetCString(string: Object, bytes: *mut c_char, length: isize, encoding: u32) -> bool;
    fn CFArrayGetCount(array: Object) -> isize;
    fn CFArrayGetValueAtIndex(array: Object, index: isize) -> Object;
}

struct Owned(Object);
impl Owned {
    fn new(value: Object) -> Option<Self> { (!value.is_null()).then_some(Self(value)) }
    fn attr(&self, name: &CStr) -> Option<Self> {
        let name = Self::new(unsafe { CFStringCreateWithCString(ptr::null(), name.as_ptr(), 0x08000100) })?;
        let mut result = ptr::null();
        if unsafe { AXUIElementCopyAttributeValue(self.0, name.0, &mut result) } == 0 { Self::new(result) } else { None }
    }
    fn text(&self) -> Option<String> {
        let mut object = self.0;
        unsafe {
            if CFGetTypeID(object) == CFURLGetTypeID() { object = CFURLGetString(object); }
            if object.is_null() || CFGetTypeID(object) != CFStringGetTypeID() { return None; }
            let length = CFStringGetMaximumSizeForEncoding(CFStringGetLength(object), 0x08000100) + 1;
            if !(1..=32768).contains(&length) { return None; }
            let mut data = vec![0u8; length as usize];
            if !CFStringGetCString(object, data.as_mut_ptr().cast(), length, 0x08000100) { return None; }
            Some(CStr::from_ptr(data.as_ptr().cast()).to_string_lossy().into_owned())
        }
    }
    fn children(&self) -> Vec<Self> {
        let Some(array) = self.attr(c"AXChildren") else { return Vec::new(); };
        unsafe {
            if CFGetTypeID(array.0) != CFArrayGetTypeID() { return Vec::new(); }
            (0..CFArrayGetCount(array.0).min(300)).filter_map(|i| Self::new(CFRetain(CFArrayGetValueAtIndex(array.0, i)))).collect()
        }
    }
    fn rect(&self) -> Option<Rect> {
        let position = self.attr(c"AXPosition")?;
        let dimensions = self.attr(c"AXSize")?;
        let (mut point, mut size) = (Point::default(), Size::default());
        if !unsafe { AXValueGetValue(position.0, 1, (&mut point as *mut Point).cast()) }
            || !unsafe { AXValueGetValue(dimensions.0, 2, (&mut size as *mut Size).cast()) } { return None; }
        Some(win::logical_rect_to_physical(Rect::new(point.x.round() as i32, point.y.round() as i32, size.w.round() as i32, size.h.round() as i32)))
    }
}
impl Drop for Owned { fn drop(&mut self) { unsafe { CFRelease(self.0); } } }

pub fn init() {}

pub fn elements_at(window: isize, x: i32, y: i32) -> Vec<Element> {
    let Some(system) = Owned::new(unsafe { AXUIElementCreateSystemWide() }) else { return Vec::new(); };
    unsafe { AXUIElementSetMessagingTimeout(system.0, 0.15); }
    let (lx, ly) = win::physical_point_to_logical(x, y);
    let mut value = ptr::null();
    if unsafe { AXUIElementCopyElementAtPosition(system.0, lx as f32, ly as f32, &mut value) } != 0 { return Vec::new(); }
    let mut current = Owned::new(value);
    let expected = win::window_pid(window);
    let deadline = Instant::now() + Duration::from_millis(220);
    let mut out = Vec::new();
    while let Some(element) = current {
        if out.len() >= 24 || Instant::now() >= deadline { break; }
        let mut pid = 0;
        unsafe { AXUIElementGetPid(element.0, &mut pid); AXUIElementSetMessagingTimeout(element.0, 0.1); }
        if expected.is_some_and(|expected| expected != pid as u32) { break; }
        if let Some(rect) = element.rect().filter(|r| r.w > 2 && r.h > 2 && r.contains(x, y)) {
            if !out.iter().any(|e: &Element| e.rect == rect) {
                let name = element.attr(c"AXTitle").and_then(|v| v.text()).or_else(|| element.attr(c"AXDescription").and_then(|v| v.text())).unwrap_or_default();
                out.push(Element { rect, name });
            }
        }
        current = element.attr(c"AXParent");
    }
    out.sort_by_key(|e| e.rect.area());
    out
}

pub fn browser_url(window: isize) -> Option<String> {
    let pid = win::window_pid(window)?;
    let application = Owned::new(unsafe { AXUIElementCreateApplication(pid as i32) })?;
    unsafe { AXUIElementSetMessagingTimeout(application.0, 0.1); }
    let target_title = win::visible_windows().into_iter().find(|w| w.hwnd == window).map(|w| w.title).unwrap_or_default();
    let focused = application.attr(c"AXFocusedWindow");
    let mut queue: VecDeque<_> = focused.into_iter().chain(application.children()).collect();
    let deadline = Instant::now() + Duration::from_millis(350);
    let mut count = 0;
    while let Some(element) = queue.pop_front() {
        if count >= 500 || Instant::now() >= deadline { break; }
        count += 1;
        if let Some(role) = element.attr(c"AXRole").and_then(|v| v.text()) {
            if role == "AXWindow" && !target_title.is_empty() {
                if let Some(title) = element.attr(c"AXTitle").and_then(|v| v.text()) { if title != target_title { continue; } }
            }
            if let Some(url) = element.attr(c"AXURL").and_then(|v| v.text()).and_then(|s| normalize_url(&s)) { return Some(url); }
            if role == "AXTextField" || role == "AXComboBox" {
                if let Some(url) = element.attr(c"AXValue").and_then(|v| v.text()).and_then(|s| normalize_url(&s)) { return Some(url); }
            }
        }
        queue.extend(element.children());
    }
    None
}
