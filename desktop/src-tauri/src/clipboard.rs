//! Windows clipboard: images (as a DIB with alpha, plus PNG for apps that
//! keep transparency), plain text, and files (so Explorer can paste them).

use anyhow::{anyhow, Result};
use image::RgbaImage;
use std::path::Path;
use windows::core::w;
use windows::Win32::Foundation::{HANDLE, HGLOBAL};
use windows::Win32::System::DataExchange::{CloseClipboard, EmptyClipboard, OpenClipboard, RegisterClipboardFormatW, SetClipboardData};
use windows::Win32::System::Memory::{GlobalAlloc, GlobalLock, GlobalUnlock, GMEM_MOVEABLE};

const CF_UNICODETEXT: u32 = 13;
const CF_HDROP: u32 = 15;
const CF_DIBV5: u32 = 17;

struct Clipboard;

impl Clipboard {
    /// Opens and empties the clipboard, retrying while another app holds it.
    fn open() -> Result<Clipboard> {
        for _ in 0..20 {
            if unsafe { OpenClipboard(None) }.is_ok() {
                unsafe { EmptyClipboard() }.map_err(|e| anyhow!("EmptyClipboard: {e}"))?;
                return Ok(Clipboard);
            }
            std::thread::sleep(std::time::Duration::from_millis(25));
        }
        Err(anyhow!("the clipboard is busy"))
    }

    fn put(&self, format: u32, bytes: &[u8]) -> Result<()> {
        unsafe {
            let mem: HGLOBAL = GlobalAlloc(GMEM_MOVEABLE, bytes.len())?;
            let ptr = GlobalLock(mem) as *mut u8;
            if ptr.is_null() {
                return Err(anyhow!("GlobalLock failed"));
            }
            std::ptr::copy_nonoverlapping(bytes.as_ptr(), ptr, bytes.len());
            let _ = GlobalUnlock(mem);
            // On success the clipboard owns the memory.
            SetClipboardData(format, Some(HANDLE(mem.0)))?;
        }
        Ok(())
    }
}

impl Drop for Clipboard {
    fn drop(&mut self) {
        unsafe {
            let _ = CloseClipboard();
        }
    }
}

pub fn set_image(img: &RgbaImage) -> Result<()> {
    let dib = dib_v5(img);
    let png = crate::imaging::encode(img, crate::imaging::Format::Png, 100)?;
    let png_format = unsafe { RegisterClipboardFormatW(w!("PNG")) };
    let cb = Clipboard::open()?;
    cb.put(CF_DIBV5, &dib)?;
    if png_format != 0 {
        cb.put(png_format, &png)?;
    }
    Ok(())
}

pub fn set_text(text: &str) -> Result<()> {
    let mut wide: Vec<u16> = text.encode_utf16().collect();
    wide.push(0);
    let bytes: Vec<u8> = wide.iter().flat_map(|c| c.to_le_bytes()).collect();
    Clipboard::open()?.put(CF_UNICODETEXT, &bytes)
}

/// Puts files on the clipboard as a copy, like Ctrl+C in Explorer.
pub fn set_files(paths: &[&Path]) -> Result<()> {
    // DROPFILES header: offset to the file list, a point, fNC, fWide.
    let mut data: Vec<u8> = Vec::new();
    data.extend_from_slice(&20u32.to_le_bytes());
    data.extend_from_slice(&[0u8; 8]);
    data.extend_from_slice(&0u32.to_le_bytes());
    data.extend_from_slice(&1u32.to_le_bytes());
    for p in paths {
        for c in p.as_os_str().to_string_lossy().encode_utf16().chain(std::iter::once(0)) {
            data.extend_from_slice(&c.to_le_bytes());
        }
    }
    data.extend_from_slice(&0u16.to_le_bytes());
    let effect = unsafe { RegisterClipboardFormatW(w!("Preferred DropEffect")) };
    let cb = Clipboard::open()?;
    cb.put(CF_HDROP, &data)?;
    if effect != 0 {
        cb.put(effect, &1u32.to_le_bytes())?; // DROPEFFECT_COPY
    }
    Ok(())
}

/// BITMAPV5HEADER + bottom-up BGRA rows, with an alpha mask.
fn dib_v5(img: &RgbaImage) -> Vec<u8> {
    let (w, h) = img.dimensions();
    let mut out = Vec::with_capacity(124 + (w * h * 4) as usize);
    let push32 = |out: &mut Vec<u8>, v: u32| out.extend_from_slice(&v.to_le_bytes());
    push32(&mut out, 124); // bV5Size
    push32(&mut out, w); // bV5Width
    push32(&mut out, h); // bV5Height (positive = bottom-up)
    out.extend_from_slice(&1u16.to_le_bytes()); // bV5Planes
    out.extend_from_slice(&32u16.to_le_bytes()); // bV5BitCount
    push32(&mut out, 3); // BI_BITFIELDS
    push32(&mut out, w * h * 4); // bV5SizeImage
    push32(&mut out, 2835); // 72 dpi
    push32(&mut out, 2835);
    push32(&mut out, 0); // bV5ClrUsed
    push32(&mut out, 0); // bV5ClrImportant
    push32(&mut out, 0x00FF_0000); // red mask
    push32(&mut out, 0x0000_FF00); // green mask
    push32(&mut out, 0x0000_00FF); // blue mask
    push32(&mut out, 0xFF00_0000); // alpha mask
    push32(&mut out, 0x7352_4742); // LCS_sRGB
    out.extend_from_slice(&[0u8; 36]); // bV5Endpoints
    push32(&mut out, 0); // gamma red
    push32(&mut out, 0); // gamma green
    push32(&mut out, 0); // gamma blue
    push32(&mut out, 4); // LCS_GM_IMAGES
    push32(&mut out, 0); // profile data
    push32(&mut out, 0); // profile size
    push32(&mut out, 0); // reserved
    debug_assert_eq!(out.len(), 124);
    for y in (0..h).rev() {
        for x in 0..w {
            let p = img.get_pixel(x, y);
            out.extend_from_slice(&[p[2], p[1], p[0], p[3]]);
        }
    }
    out
}

#[cfg(test)]
mod tests {
    #[test]
    fn dib_header_is_124_bytes_and_rows_are_bottom_up() {
        let mut img = image::RgbaImage::new(2, 2);
        img.put_pixel(0, 1, image::Rgba([1, 2, 3, 4]));
        let dib = super::dib_v5(&img);
        assert_eq!(dib.len(), 124 + 16);
        // Bottom row (y = 1) comes first, as BGRA.
        assert_eq!(&dib[124..128], &[3, 2, 1, 4]);
    }
}
