//! The "smart" features: reading text (OCR), the privacy shield, QR codes,
//! UI element detection, and image fingerprints for finding duplicates.

pub mod ocr;
pub mod privacy;
pub mod qr;
pub mod uia;

#[cfg(test)]
mod live_tests;

use anyhow::{anyhow, Result};
use image::RgbaImage;
use image_hasher::{HashAlg, HasherConfig, ImageHash};
use tauri::{AppHandle, Emitter};

use crate::card::{self, Card};
use crate::shots;
use crate::state::state;

/// Prepares the calling thread for Windows Runtime calls (OCR, faces).
pub fn init_thread() {
    use windows::Win32::System::Com::{CoInitializeEx, COINIT_MULTITHREADED};
    unsafe {
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
    }
}

/// Reads, checks and fingerprints one screenshot, then stores the results.
pub fn index_shot(app: &AppHandle, id: &str) -> Result<()> {
    let st = state(app);
    let Some(shot) = st.library.get(id)? else { return Ok(()) };
    let img = shots::load_rgba(std::path::Path::new(&shot.path))?;
    let settings = st.settings();

    let text = if settings.index_text || settings.privacy_check { ocr::read(&img) } else { Err(anyhow!("off")) };
    match &text {
        Ok(results) if settings.index_text => st.library.set_text(id, &ocr::union_text(results), 1)?,
        Err(e) if settings.index_text => {
            log::warn!("reading text of {id}: {e:#}");
            st.library.set_text(id, "", 2)?;
        }
        _ => st.library.set_text(id, "", 2)?,
    }
    if settings.privacy_check {
        let found = privacy::scan(&img, text.as_deref().unwrap_or(&[]));
        st.library.set_privacy(id, found.len() as i32, &serde_json::to_string(&found)?)?;
    }
    st.library.set_phash(id, &fingerprint(&img))?;
    let _ = app.emit("library:indexed", id);
    Ok(())
}

/// Queues screenshots that were never indexed (e.g. the app closed early).
pub fn resume_indexing(app: &AppHandle) {
    let st = state(app);
    let mut ids = st.library.pending_text(500).unwrap_or_default();
    ids.extend(st.library.missing_phash(500).unwrap_or_default());
    ids.sort();
    ids.dedup();
    for id in ids {
        st.jobs.push(crate::jobs::Job::Index(id));
    }
}

/// The overlay's "copy text" and "scan QR" tools: the result goes to the
/// clipboard and the card shows it.
pub fn screen_tool(app: &AppHandle, tool: &str, img: &RgbaImage) -> Result<()> {
    init_thread();
    if tool == "qr" {
        let items = qr::scan(img);
        let copied = items.len() == 1 && crate::clipboard::set_text(&items[0]).is_ok();
        card::show(app, Card::Qr { items, copied });
        return Ok(());
    }
    let text = ocr::read(img)?.first().map(ocr::OcrText::text).unwrap_or_default();
    let copied = !text.is_empty() && crate::clipboard::set_text(&text).is_ok();
    card::show(app, Card::Text { text, copied });
    Ok(())
}

fn hasher() -> image_hasher::Hasher {
    HasherConfig::new().hash_alg(HashAlg::Gradient).hash_size(16, 16).to_hasher()
}

/// A 256-bit perceptual hash: near-identical screenshots differ by a few bits.
pub fn fingerprint(img: &RgbaImage) -> Vec<u8> {
    hasher().hash_image(&image::DynamicImage::ImageRgba8(img.clone())).as_bytes().to_vec()
}

/// How many bits two fingerprints differ by.
pub fn distance(a: &[u8], b: &[u8]) -> Result<u32> {
    let a = ImageHash::<Box<[u8]>>::from_bytes(a).map_err(|e| anyhow!("{e:?}"))?;
    let b = ImageHash::<Box<[u8]>>::from_bytes(b).map_err(|e| anyhow!("{e:?}"))?;
    Ok(a.dist(&b))
}

/// Groups of screenshots that look the same (within `max_bits`), oldest
/// first in each group.
pub fn duplicate_groups(hashes: &[(String, Vec<u8>)], max_bits: u32) -> Vec<Vec<String>> {
    let mut group_of: Vec<Option<usize>> = vec![None; hashes.len()];
    let mut groups: Vec<Vec<String>> = Vec::new();
    for i in 0..hashes.len() {
        for j in (i + 1)..hashes.len() {
            if group_of[j].is_some() {
                continue;
            }
            if distance(&hashes[i].1, &hashes[j].1).is_ok_and(|d| d <= max_bits) {
                let g = *group_of[i].get_or_insert_with(|| {
                    groups.push(vec![hashes[i].0.clone()]);
                    groups.len() - 1
                });
                groups[g].push(hashes[j].0.clone());
                group_of[j] = Some(g);
            }
        }
    }
    groups
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::Rgba;

    fn ui(seed: u32) -> RgbaImage {
        RgbaImage::from_fn(320, 200, |x, y| {
            let band = (y / 20 + seed) % 3;
            let v = if x > 40 && x < 280 && band == 0 { 40 } else { 230 };
            Rgba([v, v, (v as u32 + seed * 30).min(255) as u8, 255])
        })
    }

    #[test]
    fn duplicates_are_grouped() {
        let a = ui(0);
        let mut a2 = a.clone();
        a2.put_pixel(10, 10, Rgba([0, 0, 0, 255])); // one pixel changed
        let b = ui(1);
        let hashes = vec![("a".to_string(), fingerprint(&a)), ("b".into(), fingerprint(&b)), ("a2".into(), fingerprint(&a2))];
        assert!(distance(&hashes[0].1, &hashes[2].1).unwrap() <= 2);
        assert_eq!(duplicate_groups(&hashes, 6), vec![vec!["a".to_string(), "a2".to_string()]]);
    }
}
