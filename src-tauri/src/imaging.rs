//! Pure image operations: crop, encode, resize, fit, cut strip and smart fill.
//! Everything works on straight (not premultiplied) RGBA8 buffers.

use anyhow::{anyhow, bail, Result};
use image::codecs::jpeg::JpegEncoder;
use image::codecs::png::{CompressionType, FilterType as PngFilter, PngEncoder};
use image::{ExtendedColorType, ImageEncoder, RgbaImage};
use serde::{Deserialize, Serialize};

use crate::win::Rect;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Format {
    Png,
    Jpeg,
    Webp,
}

impl Format {
    pub fn parse(s: &str) -> Format {
        match s.to_ascii_lowercase().as_str() {
            "jpg" | "jpeg" => Format::Jpeg,
            "webp" => Format::Webp,
            _ => Format::Png,
        }
    }

    pub fn from_path(path: &std::path::Path) -> Format {
        Format::parse(path.extension().and_then(|e| e.to_str()).unwrap_or("png"))
    }

    pub fn ext(self) -> &'static str {
        match self {
            Format::Png => "png",
            Format::Jpeg => "jpg",
            Format::Webp => "webp",
        }
    }

    pub fn mime(self) -> &'static str {
        match self {
            Format::Png => "image/png",
            Format::Jpeg => "image/jpeg",
            Format::Webp => "image/webp",
        }
    }
}

pub fn from_raw(width: u32, height: u32, rgba: Vec<u8>) -> Result<RgbaImage> {
    RgbaImage::from_raw(width, height, rgba).ok_or_else(|| anyhow!("pixel buffer does not match {width}x{height}"))
}

/// Copies `r` out of a frame, clamped to the frame. `None` if nothing is left.
pub fn crop(rgba: &[u8], width: u32, height: u32, r: Rect) -> Option<RgbaImage> {
    let bounds = Rect::new(0, 0, width as i32, height as i32);
    let r = r.intersect(&bounds)?;
    let mut out = RgbaImage::new(r.w as u32, r.h as u32);
    let row_bytes = r.w as usize * 4;
    for row in 0..r.h as usize {
        let src = ((r.y as usize + row) * width as usize + r.x as usize) * 4;
        let dst = row * row_bytes;
        out.as_mut()[dst..dst + row_bytes].copy_from_slice(&rgba[src..src + row_bytes]);
    }
    Some(out)
}

/// Pastes `src` onto `dst` at (x, y), clipping at the edges. Pixels are
/// replaced, not blended.
pub fn paste(dst: &mut RgbaImage, src: &RgbaImage, x: i32, y: i32) {
    for sy in 0..src.height() as i32 {
        let dy = y + sy;
        if dy < 0 || dy >= dst.height() as i32 {
            continue;
        }
        for sx in 0..src.width() as i32 {
            let dx = x + sx;
            if dx < 0 || dx >= dst.width() as i32 {
                continue;
            }
            dst.put_pixel(dx as u32, dy as u32, *src.get_pixel(sx as u32, sy as u32));
        }
    }
}

/// Encodes for saving. PNG uses fast compression here; `optimize_png`
/// shrinks it later without changing a single pixel.
pub fn encode(img: &RgbaImage, format: Format, quality: u8) -> Result<Vec<u8>> {
    let (w, h) = img.dimensions();
    let mut out = Vec::with_capacity((w * h) as usize);
    match format {
        Format::Png => {
            PngEncoder::new_with_quality(&mut out, CompressionType::Fast, PngFilter::Adaptive)
                .write_image(img.as_raw(), w, h, ExtendedColorType::Rgba8)?;
        }
        Format::Jpeg => {
            let rgb = flatten_on_white(img);
            JpegEncoder::new_with_quality(&mut out, quality.clamp(1, 100))
                .write_image(&rgb, w, h, ExtendedColorType::Rgb8)?;
        }
        Format::Webp => {
            let enc = webp::Encoder::from_rgba(img.as_raw(), w, h);
            let mem = if quality >= 100 { enc.encode_lossless() } else { enc.encode(quality as f32) };
            out.extend_from_slice(&mem);
        }
    }
    Ok(out)
}

/// Lossless PNG recompression: same pixels, smaller file.
pub fn optimize_png(data: &[u8]) -> Result<Vec<u8>> {
    let mut opts = oxipng::Options::from_preset(2);
    opts.strip = oxipng::StripChunks::Safe;
    oxipng::optimize_from_memory(data, &opts).map_err(|e| anyhow!("oxipng: {e}"))
}

/// Finds the best quality that keeps a JPEG or WebP under `max_bytes`.
/// Returns the bytes and the quality used.
pub fn encode_under(img: &RgbaImage, format: Format, max_bytes: usize) -> Result<(Vec<u8>, u8)> {
    if format == Format::Png {
        let data = optimize_png(&encode(img, Format::Png, 100)?)?;
        if data.len() > max_bytes {
            bail!("too_big");
        }
        return Ok((data, 100));
    }
    let (mut lo, mut hi) = (5u8, 95u8);
    let mut best: Option<(Vec<u8>, u8)> = None;
    while lo <= hi {
        let q = lo + (hi - lo) / 2;
        let data = encode(img, format, q)?;
        if data.len() <= max_bytes {
            best = Some((data, q));
            lo = q + 1;
        } else {
            if q == 0 {
                break;
            }
            hi = q - 1;
        }
    }
    best.ok_or_else(|| anyhow!("too_big"))
}

fn flatten_on_white(img: &RgbaImage) -> Vec<u8> {
    let mut rgb = Vec::with_capacity(img.as_raw().len() / 4 * 3);
    for p in img.pixels() {
        let a = p[3] as u32;
        for c in 0..3 {
            rgb.push(((p[c] as u32 * a + 255 * (255 - a)) / 255) as u8);
        }
    }
    rgb
}

/// High-quality resize (Lanczos3). Alpha is handled correctly.
pub fn resize(img: &RgbaImage, width: u32, height: u32) -> Result<RgbaImage> {
    use fast_image_resize::{images::Image, FilterType, PixelType, ResizeAlg, ResizeOptions, Resizer};
    if width == 0 || height == 0 {
        bail!("size must be at least 1x1");
    }
    if (width, height) == img.dimensions() {
        return Ok(img.clone());
    }
    let src = Image::from_vec_u8(img.width(), img.height(), img.as_raw().clone(), PixelType::U8x4)?;
    let mut dst = Image::new(width, height, PixelType::U8x4);
    let opts = ResizeOptions::new().resize_alg(ResizeAlg::Convolution(FilterType::Lanczos3));
    Resizer::new().resize(&src, &mut dst, &opts)?;
    from_raw(width, height, dst.into_vec())
}

/// Scales the image to fit inside `width`×`height` and centres it on a
/// background colour, so the result has exactly that size without stretching.
pub fn fit(img: &RgbaImage, width: u32, height: u32, background: [u8; 4], upscale: bool) -> Result<RgbaImage> {
    let (iw, ih) = img.dimensions();
    let mut scale = (width as f64 / iw as f64).min(height as f64 / ih as f64);
    if !upscale {
        scale = scale.min(1.0);
    }
    let nw = ((iw as f64 * scale).round() as u32).clamp(1, width);
    let nh = ((ih as f64 * scale).round() as u32).clamp(1, height);
    let scaled = resize(img, nw, nh)?;
    let mut out = RgbaImage::from_pixel(width, height, image::Rgba(background));
    image::imageops::overlay(&mut out, &scaled, ((width - nw) / 2) as i64, ((height - nh) / 2) as i64);
    Ok(out)
}

/// A thumbnail that fits in `max`×`max`.
pub fn thumbnail(img: &RgbaImage, max: u32) -> Result<RgbaImage> {
    let (w, h) = img.dimensions();
    if w <= max && h <= max {
        return Ok(img.clone());
    }
    let scale = (max as f64 / w as f64).min(max as f64 / h as f64);
    resize(img, ((w as f64 * scale) as u32).max(1), ((h as f64 * scale) as u32).max(1))
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Axis {
    /// Removes a band of rows: the image gets shorter.
    Horizontal,
    /// Removes a band of columns: the image gets narrower.
    Vertical,
}

/// Removes the band `[from, to)` and joins the two remaining parts.
pub fn cut_strip(img: &RgbaImage, axis: Axis, from: u32, to: u32) -> Result<RgbaImage> {
    let (w, h) = img.dimensions();
    let limit = if axis == Axis::Horizontal { h } else { w };
    let (from, to) = (from.min(to).min(limit), from.max(to).min(limit));
    if to - from >= limit {
        bail!("the strip covers the whole image");
    }
    let cut = to - from;
    Ok(match axis {
        Axis::Horizontal => RgbaImage::from_fn(w, h - cut, |x, y| {
            *img.get_pixel(x, if y < from { y } else { y + cut })
        }),
        Axis::Vertical => RgbaImage::from_fn(w - cut, h, |x, y| {
            *img.get_pixel(if x < from { x } else { x + cut }, y)
        }),
    })
}

/// Fills `r` from the pixels around it and returns the patch (r.w × r.h).
///
/// Two fills are blended: top→bottom (continues columns) and left→right
/// (continues rows). The pair of opposite borders that look more alike wins,
/// so flat colours, gradients, list stripes and table lines carry on through
/// the hole, and a text line cut at the sides doesn't smear. Borders are
/// sampled a few pixels thick and median-filtered. Made for UI screenshots;
/// photos come out smooth.
pub fn smart_fill(img: &RgbaImage, r: Rect) -> Result<RgbaImage> {
    let bounds = Rect::new(0, 0, img.width() as i32, img.height() as i32);
    let r = r.intersect(&bounds).ok_or_else(|| anyhow!("area is outside the image"))?;
    let (w, h) = (r.w as usize, r.h as usize);

    const DEPTH: i32 = 3;
    let sample = |x: i32, y: i32| -> Option<[f32; 4]> {
        bounds.contains(x, y).then(|| {
            let p = img.get_pixel(x as u32, y as u32);
            [p[0] as f32, p[1] as f32, p[2] as f32, p[3] as f32]
        })
    };
    // Median over the border thickness, per channel.
    let border_px = |pts: Vec<Option<[f32; 4]>>| -> Option<[f32; 4]> {
        let pts: Vec<[f32; 4]> = pts.into_iter().flatten().collect();
        if pts.is_empty() {
            return None;
        }
        let mut out = [0f32; 4];
        for (c, slot) in out.iter_mut().enumerate() {
            let mut v: Vec<f32> = pts.iter().map(|p| p[c]).collect();
            v.sort_by(|a, b| a.partial_cmp(b).unwrap());
            *slot = v[v.len() / 2];
        }
        Some(out)
    };

    let top: Vec<Option<[f32; 4]>> = (0..r.w)
        .map(|i| border_px((1..=DEPTH).map(|d| sample(r.x + i, r.y - d)).collect()))
        .collect();
    let bottom: Vec<Option<[f32; 4]>> = (0..r.w)
        .map(|i| border_px((0..DEPTH).map(|d| sample(r.x + i, r.bottom() + d)).collect()))
        .collect();
    let left: Vec<Option<[f32; 4]>> = (0..r.h)
        .map(|j| border_px((1..=DEPTH).map(|d| sample(r.x - d, r.y + j)).collect()))
        .collect();
    let right: Vec<Option<[f32; 4]>> = (0..r.h)
        .map(|j| border_px((0..DEPTH).map(|d| sample(r.right() + d, r.y + j)).collect()))
        .collect();

    let have = |side: &[Option<[f32; 4]>]| side.iter().all(Option::is_some);
    let unwrap = |side: Vec<Option<[f32; 4]>>| -> Vec<[f32; 4]> { side.into_iter().map(|p| p.unwrap_or([0.0; 4])).collect() };
    let (ht, hb, hl, hr) = (have(&top), have(&bottom), have(&left), have(&right));
    if !(ht || hb || hl || hr) {
        bail!("nothing around the area to fill from");
    }

    // A missing side borrows its opposite; if both are missing that axis drops out.
    let mut t = unwrap(top);
    let mut b = unwrap(bottom);
    let mut l = unwrap(left);
    let mut rr = unwrap(right);
    if !ht && hb {
        t = b.clone();
    }
    if !hb && ht {
        b = t.clone();
    }
    if !hl && hr {
        l = rr.clone();
    }
    if !hr && hl {
        rr = l.clone();
    }
    let vertical_ok = ht || hb;
    let horizontal_ok = hl || hr;

    smooth(&mut t);
    smooth(&mut b);
    smooth(&mut l);
    smooth(&mut rr);

    let lerp = |a: [f32; 4], c: [f32; 4], s: f32| -> [f32; 4] {
        [a[0] + (c[0] - a[0]) * s, a[1] + (c[1] - a[1]) * s, a[2] + (c[2] - a[2]) * s, a[3] + (c[3] - a[3]) * s]
    };
    let mismatch = |a: &[[f32; 4]], c: &[[f32; 4]]| -> f32 {
        let sum: f32 = a.iter().zip(c).map(|(p, q)| (0..4).map(|k| (p[k] - q[k]).abs()).sum::<f32>()).sum();
        sum / a.len().max(1) as f32
    };

    // Weight of each fill grows with how badly the *other* pair matches.
    let (wv, wu) = match (vertical_ok, horizontal_ok) {
        (true, true) => {
            let dv = mismatch(&t, &b).powi(2);
            let du = mismatch(&l, &rr).powi(2);
            if dv + du < 1e-3 { (0.5, 0.5) } else { (du / (dv + du), dv / (dv + du)) }
        }
        (true, false) => (1.0, 0.0),
        _ => (0.0, 1.0),
    };

    let mut out = RgbaImage::new(r.w as u32, r.h as u32);
    for j in 0..h {
        let v = (j as f32 + 1.0) / (h as f32 + 1.0);
        for i in 0..w {
            let u = (i as f32 + 1.0) / (w as f32 + 1.0);
            let down = lerp(t[i], b[i], v);
            let across = lerp(l[j], rr[j], u);
            let px = [
                down[0] * wv + across[0] * wu,
                down[1] * wv + across[1] * wu,
                down[2] * wv + across[2] * wu,
                down[3] * wv + across[3] * wu,
            ];
            out.put_pixel(
                i as u32,
                j as u32,
                image::Rgba([
                    px[0].round().clamp(0.0, 255.0) as u8,
                    px[1].round().clamp(0.0, 255.0) as u8,
                    px[2].round().clamp(0.0, 255.0) as u8,
                    px[3].round().clamp(0.0, 255.0) as u8,
                ]),
            );
        }
    }
    Ok(out)
}

/// 5-tap median along a border, so one odd pixel doesn't make a streak.
fn smooth(side: &mut [[f32; 4]]) {
    if side.len() < 5 {
        return;
    }
    let src = side.to_vec();
    for i in 0..side.len() {
        let lo = i.saturating_sub(2);
        let hi = (i + 3).min(src.len());
        for c in 0..4 {
            let mut v: Vec<f32> = src[lo..hi].iter().map(|p| p[c]).collect();
            v.sort_by(|a, b| a.partial_cmp(b).unwrap());
            side[i][c] = v[v.len() / 2];
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::Rgba;

    fn checker(w: u32, h: u32) -> RgbaImage {
        RgbaImage::from_fn(w, h, |x, y| Rgba([(x * 7 % 256) as u8, (y * 5 % 256) as u8, ((x + y) % 256) as u8, 255]))
    }

    #[test]
    fn crop_is_exact_and_clamped() {
        let img = checker(200, 100);
        let c = crop(img.as_raw(), 200, 100, Rect::new(10, 20, 64, 32)).unwrap();
        assert_eq!(c.dimensions(), (64, 32));
        assert_eq!(c.get_pixel(0, 0), img.get_pixel(10, 20));
        assert_eq!(c.get_pixel(63, 31), img.get_pixel(73, 51));
        let clamped = crop(img.as_raw(), 200, 100, Rect::new(180, 90, 50, 50)).unwrap();
        assert_eq!(clamped.dimensions(), (20, 10));
        assert!(crop(img.as_raw(), 200, 100, Rect::new(300, 0, 5, 5)).is_none());
    }

    #[test]
    fn png_round_trip_is_pixel_exact() {
        let img = checker(123, 77);
        for data in [encode(&img, Format::Png, 100).unwrap(), optimize_png(&encode(&img, Format::Png, 100).unwrap()).unwrap()] {
            let back = image::load_from_memory(&data).unwrap().to_rgba8();
            assert_eq!(back, img);
        }
    }

    #[test]
    fn webp_lossless_round_trip() {
        let img = checker(40, 30);
        let data = encode(&img, Format::Webp, 100).unwrap();
        assert_eq!(image::load_from_memory(&data).unwrap().to_rgba8(), img);
    }

    #[test]
    fn jpeg_and_size_limit() {
        let img = checker(400, 300);
        let full = encode(&img, Format::Jpeg, 95).unwrap();
        let (small, q) = encode_under(&img, Format::Jpeg, full.len() / 3).unwrap();
        assert!(small.len() <= full.len() / 3);
        assert!(q < 95);
        assert!(encode_under(&img, Format::Jpeg, 10).is_err());
    }

    #[test]
    fn resize_and_fit_sizes() {
        let img = checker(300, 100);
        assert_eq!(resize(&img, 150, 50).unwrap().dimensions(), (150, 50));
        let fitted = fit(&img, 200, 200, [255, 255, 255, 255], false).unwrap();
        assert_eq!(fitted.dimensions(), (200, 200));
        // Image is scaled to 200x67 and centred; the top band stays background.
        assert_eq!(*fitted.get_pixel(100, 10), Rgba([255, 255, 255, 255]));
        assert_eq!(thumbnail(&img, 120).unwrap().dimensions(), (120, 40));
    }

    #[test]
    fn cut_strip_joins_parts() {
        let img = checker(50, 40);
        let cut = cut_strip(&img, Axis::Horizontal, 10, 25).unwrap();
        assert_eq!(cut.dimensions(), (50, 25));
        assert_eq!(cut.get_pixel(3, 9), img.get_pixel(3, 9));
        assert_eq!(cut.get_pixel(3, 10), img.get_pixel(3, 25));
        let cut = cut_strip(&img, Axis::Vertical, 30, 20).unwrap();
        assert_eq!(cut.dimensions(), (40, 40));
        assert_eq!(cut.get_pixel(20, 5), img.get_pixel(30, 5));
        assert!(cut_strip(&img, Axis::Vertical, 0, 50).is_err());
    }

    #[test]
    fn smart_fill_flat_background_is_seamless() {
        let mut img = RgbaImage::from_pixel(100, 60, Rgba([240, 242, 245, 255]));
        // "Text" to remove.
        for x in 30..70 {
            for y in 25..35 {
                img.put_pixel(x, y, Rgba([20, 20, 20, 255]));
            }
        }
        let patch = smart_fill(&img, Rect::new(28, 23, 44, 14)).unwrap();
        assert!(patch.pixels().all(|p| *p == Rgba([240, 242, 245, 255])));
    }

    #[test]
    fn smart_fill_continues_gradients_and_stripes() {
        // Horizontal gradient.
        let img = RgbaImage::from_fn(100, 50, |x, _| Rgba([(x * 2) as u8, 100, 50, 255]));
        let patch = smart_fill(&img, Rect::new(40, 10, 20, 30)).unwrap();
        for (i, j, p) in patch.enumerate_pixels() {
            let expected = ((40 + i) * 2) as i32;
            assert!((p[0] as i32 - expected).abs() <= 2, "x={i} y={j} got {}", p[0]);
        }
        // Alternating row colours, like a list.
        let img = RgbaImage::from_fn(80, 40, |_, y| if (y / 4) % 2 == 0 { Rgba([255, 255, 255, 255]) } else { Rgba([230, 230, 230, 255]) });
        let patch = smart_fill(&img, Rect::new(20, 8, 30, 16)).unwrap();
        for (_, j, p) in patch.enumerate_pixels() {
            let y = 8 + j;
            let expected = if (y / 4) % 2 == 0 { 255 } else { 230 };
            assert!((p[0] as i32 - expected).abs() <= 3, "row {y} got {}", p[0]);
        }
    }

    #[test]
    fn smart_fill_at_image_edge() {
        let img = RgbaImage::from_pixel(50, 50, Rgba([10, 20, 30, 255]));
        let patch = smart_fill(&img, Rect::new(0, 0, 20, 50)).unwrap();
        assert!(patch.pixels().all(|p| *p == Rgba([10, 20, 30, 255])));
    }
}
