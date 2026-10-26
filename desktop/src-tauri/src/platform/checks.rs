//! Native integration checks used in isolated CI sessions, before app storage opens.

use anyhow::{Result, bail};

pub fn verify() -> Result<()> {
    crate::smart::ocr::verify()?;
    crate::clipboard::verify()?;
    let blank = image::RgbaImage::from_pixel(100, 100, image::Rgba([255, 255, 255, 255]));
    if !crate::smart::privacy::find_faces(&blank)?.is_empty() { bail!("The face model reported a face in an empty fixture"); }
    #[cfg(target_os = "linux")]
    {
        let monitors = crate::win::monitors();
        let monitor = monitors.first().ok_or_else(|| anyhow::anyhow!("No X11 display is available for the capture test"))?;
        let pixels = crate::capture::grab(monitor.rect)?;
        if pixels.len() != monitor.rect.w as usize * monitor.rect.h as usize * 4 { bail!("Native X11 capture returned an invalid image size"); }
    }
    Ok(())
}
