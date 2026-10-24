//! QR codes and barcodes on screen (rxing, a Rust port of ZXing).

use image::RgbaImage;

fn luma(img: &RgbaImage) -> Vec<u8> {
    img.pixels()
        .map(|p| ((p[0] as u32 * 299 + p[1] as u32 * 587 + p[2] as u32 * 114) / 1000) as u8)
        .collect()
}

/// The text of every code found, without repeats.
pub fn scan(img: &RgbaImage) -> Vec<String> {
    let mut out = decode(img);
    // Small codes read better when enlarged.
    if out.is_empty() && img.width().max(img.height()) < 900 {
        let big = image::imageops::resize(img, img.width() * 2, img.height() * 2, image::imageops::FilterType::Nearest);
        out = decode(&big);
    }
    out
}

fn decode(img: &RgbaImage) -> Vec<String> {
    let results = rxing::helpers::detect_multiple_in_luma(luma(img), img.width(), img.height()).unwrap_or_default();
    let mut out: Vec<String> = Vec::new();
    for r in results {
        let text = r.getText().trim().to_string();
        if !text.is_empty() && !out.contains(&text) {
            out.push(text);
        }
    }
    out
}
