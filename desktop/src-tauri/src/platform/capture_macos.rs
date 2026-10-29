//! Version-gated ScreenCaptureKit capture; all returned pixels are owned by Rust.

use anyhow::{Context, Result, bail};
use image::RgbaImage;
use std::{ffi::{c_char, c_void, CStr}, sync::mpsc, time::Duration};
use tauri::AppHandle;

unsafe extern "C" {
    fn algorithshot_capture_permission(request: bool) -> bool;
    fn algorithshot_has_screenshot_manager() -> bool;
    fn algorithshot_capture_display(display: u32, pixels: *mut *mut u8, width: *mut u32,
        height: *mut u32, error: *mut c_char, error_size: usize) -> bool;
    fn algorithshot_free_capture(pixels: *mut c_void);
    fn algorithshot_cursor_position(x: *mut f64, y: *mut f64) -> bool;
}

pub fn cursor_position() -> Option<(f64, f64)> {
    let (mut x, mut y) = (0.0, 0.0);
    unsafe { algorithshot_cursor_position(&mut x, &mut y) }.then_some((x, y))
}

pub fn ensure_permission(app: &AppHandle) -> Result<()> {
    if unsafe { algorithshot_capture_permission(false) } { return Ok(()); }
    let (sender, receiver) = mpsc::channel();
    app.run_on_main_thread(move || {
        let _ = sender.send(unsafe { algorithshot_capture_permission(true) });
    })?;
    if receiver.recv_timeout(Duration::from_secs(120)).unwrap_or(false) { return Ok(()); }
    bail!("Allow Screen Recording for AlgorithShot in System Settings > Privacy & Security, then retry. You may need to quit and reopen the app after granting access.")
}

pub fn capture(display: u32) -> Result<Option<RgbaImage>> {
    if !unsafe { algorithshot_has_screenshot_manager() } { return Ok(None); }
    let (mut pixels, mut width, mut height) = (std::ptr::null_mut(), 0, 0);
    let mut error = [0 as c_char; 1024];
    let ok = unsafe { algorithshot_capture_display(display, &mut pixels, &mut width, &mut height,
        error.as_mut_ptr(), error.len()) };
    if !ok {
        bail!("{}", unsafe { CStr::from_ptr(error.as_ptr()) }.to_string_lossy());
    }
    if pixels.is_null() { bail!("Screen capture returned no image"); }
    let len = (width as usize).checked_mul(height as usize).and_then(|n| n.checked_mul(4));
    let result = len.map(|len| unsafe { std::slice::from_raw_parts(pixels, len) }.to_vec())
        .and_then(|data| RgbaImage::from_raw(width, height, data));
    unsafe { algorithshot_free_capture(pixels.cast()); }
    Ok(Some(result.context("Screen capture returned an invalid image")?))
}
