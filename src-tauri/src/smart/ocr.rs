//! Text recognition with Windows' built-in, offline OCR (Windows.Media.Ocr).
//!
//! Each language installed for OCR (on most PCs English, often Russian) is a
//! separate engine. Screenshots can mix scripts, so the useful engines run
//! and the results are scored; search indexes all of them, while copying
//! text uses the best one. Small screen text reads much better at 2×, so
//! images are scaled up first when they're small enough.

use anyhow::{anyhow, Result};
use image::RgbaImage;
use serde::Serialize;
use std::cell::RefCell;
use std::collections::HashMap;
use windows::core::HSTRING;
use windows::Globalization::Language;
use windows::Graphics::Imaging::{BitmapPixelFormat, SoftwareBitmap};
use windows::Media::Ocr::OcrEngine;
use windows::Storage::Streams::DataWriter;

use crate::imaging;
use crate::win::Rect;

#[derive(Debug, Clone, Serialize)]
pub struct Word {
    pub text: String,
    pub rect: Rect,
}

#[derive(Debug, Clone, Default, Serialize)]
pub struct Line {
    pub words: Vec<Word>,
}

impl Line {
    pub fn text(&self) -> String {
        self.words.iter().map(|w| w.text.as_str()).collect::<Vec<_>>().join(" ")
    }
}

#[derive(Debug, Clone, Default)]
pub struct OcrText {
    pub lang: String,
    pub lines: Vec<Line>,
}

impl OcrText {
    pub fn text(&self) -> String {
        self.lines.iter().map(Line::text).collect::<Vec<_>>().join("\n")
    }

    /// Rough quality: letters in words that stay within one script. An
    /// English engine reading Cyrillic produces mixed junk and scores low.
    pub fn score(&self) -> usize {
        self.lines
            .iter()
            .flat_map(|l| &l.words)
            .map(|w| {
                let letters: Vec<char> = w.text.chars().filter(|c| c.is_alphanumeric()).collect();
                let latin = letters.iter().any(|c| c.is_ascii_alphabetic());
                let cyrillic = letters.iter().any(|c| matches!(c, '\u{0400}'..='\u{04FF}'));
                if latin && cyrillic { 0 } else { letters.len() }
            })
            .sum()
    }
}

thread_local! {
    static ENGINES: RefCell<HashMap<String, OcrEngine>> = RefCell::new(HashMap::new());
}

/// Language tags with an OCR engine on this PC, e.g. ["en-US", "ru"].
pub fn languages() -> Vec<String> {
    OcrEngine::AvailableRecognizerLanguages()
        .map(|list| list.into_iter().filter_map(|l| l.LanguageTag().ok()).map(|t| t.to_string()).collect())
        .unwrap_or_default()
}

/// The engines worth running: one English, one Russian (for Cyrillic, which
/// also covers most Uzbek Cyrillic), then anything else installed.
fn engine_langs() -> Vec<String> {
    let all = languages();
    let mut picked: Vec<String> = Vec::new();
    for prefix in ["en", "ru"] {
        if let Some(tag) = all.iter().find(|t| t.to_ascii_lowercase().starts_with(prefix)) {
            picked.push(tag.clone());
        }
    }
    if picked.is_empty() {
        picked.extend(all.into_iter().take(1));
    }
    picked
}

fn engine(lang: &str) -> Result<OcrEngine> {
    ENGINES.with(|cache| {
        if let Some(e) = cache.borrow().get(lang) {
            return Ok(e.clone());
        }
        let language = Language::CreateLanguage(&HSTRING::from(lang))?;
        let e = OcrEngine::TryCreateFromLanguage(&language)?;
        cache.borrow_mut().insert(lang.to_string(), e.clone());
        Ok(e)
    })
}

/// A Windows bitmap (BGRA8) from RGBA pixels.
pub fn bitmap(img: &RgbaImage) -> Result<SoftwareBitmap> {
    let mut bgra = img.as_raw().clone();
    for px in bgra.chunks_exact_mut(4) {
        px.swap(0, 2);
    }
    let writer = DataWriter::new()?;
    writer.WriteBytes(&bgra)?;
    let buffer = writer.DetachBuffer()?;
    Ok(SoftwareBitmap::CreateCopyFromBuffer(&buffer, BitmapPixelFormat::Bgra8, img.width() as i32, img.height() as i32)?)
}

/// How much to enlarge before reading: 2× unless that gets too big.
fn upscale_for(img: &RgbaImage) -> u32 {
    let max = OcrEngine::MaxImageDimension().unwrap_or(2600);
    let (w, h) = img.dimensions();
    if w * 2 <= max && h * 2 <= max && (w as u64 * h as u64) <= 2_600_000 { 2 } else { 1 }
}

/// Fits the image within the engine's size limit.
fn prepare(img: &RgbaImage) -> Result<(RgbaImage, f64)> {
    let max = OcrEngine::MaxImageDimension().unwrap_or(2600) as f64;
    let (w, h) = (img.width() as f64, img.height() as f64);
    let k = upscale_for(img) as f64;
    let scale = (k).min(max / w).min(max / h);
    if (scale - 1.0).abs() < 1e-6 {
        return Ok((img.clone(), 1.0));
    }
    let nw = (w * scale).round().max(1.0) as u32;
    let nh = (h * scale).round().max(1.0) as u32;
    Ok((imaging::resize(img, nw, nh)?, scale))
}

pub fn recognize(img: &RgbaImage, lang: &str) -> Result<OcrText> {
    let (prepared, scale) = prepare(img)?;
    let result = engine(lang)?.RecognizeAsync(&bitmap(&prepared)?)?.join()?;
    let mut lines = Vec::new();
    for line in result.Lines()? {
        let mut words = Vec::new();
        for word in line.Words()? {
            let r = word.BoundingRect()?;
            words.push(Word {
                text: word.Text()?.to_string(),
                rect: Rect::new(
                    (r.X as f64 / scale).floor() as i32,
                    (r.Y as f64 / scale).floor() as i32,
                    ((r.Width as f64) / scale).ceil() as i32,
                    ((r.Height as f64) / scale).ceil() as i32,
                ),
            });
        }
        if !words.is_empty() {
            lines.push(Line { words });
        }
    }
    Ok(OcrText { lang: lang.to_string(), lines })
}

/// Reads with every useful engine, best result first.
pub fn read(img: &RgbaImage) -> Result<Vec<OcrText>> {
    let langs = engine_langs();
    if langs.is_empty() {
        return Err(anyhow!("no OCR language is installed in Windows"));
    }
    let mut results = Vec::new();
    for lang in langs {
        match recognize(img, &lang) {
            Ok(r) => results.push(r),
            Err(e) => log::warn!("OCR {lang}: {e:#}"),
        }
    }
    if results.is_empty() {
        return Err(anyhow!("text recognition failed"));
    }
    results.sort_by_key(|r| std::cmp::Reverse(r.score()));
    log::debug!("OCR: best engine {} (score {})", results[0].lang, results[0].score());
    Ok(results)
}

/// All engines' text, without repeating identical lines, for search.
pub fn union_text(results: &[OcrText]) -> String {
    let mut seen = std::collections::HashSet::new();
    let mut out: Vec<String> = Vec::new();
    for r in results {
        for line in &r.lines {
            let t = line.text();
            if seen.insert(t.to_lowercase()) {
                out.push(t);
            }
        }
    }
    out.join("\n")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn line(words: &[&str]) -> Line {
        Line { words: words.iter().map(|w| Word { text: w.to_string(), rect: Rect::default() }).collect() }
    }

    #[test]
    fn score_prefers_clean_scripts() {
        let good = OcrText { lang: "ru".into(), lines: vec![line(&["Привет", "мир"])] };
        let junk = OcrText { lang: "en".into(), lines: vec![line(&["Пpивeт", "Mиp"])] };
        assert!(good.score() > junk.score());
        assert_eq!(good.text(), "Привет мир");
    }

    #[test]
    fn union_drops_repeated_lines() {
        let a = OcrText { lang: "en".into(), lines: vec![line(&["Hello"]), line(&["Total", "150"])] };
        let b = OcrText { lang: "ru".into(), lines: vec![line(&["hello"]), line(&["Итого"])] };
        assert_eq!(union_text(&[a, b]), "Hello\nTotal 150\nИтого");
    }
}
