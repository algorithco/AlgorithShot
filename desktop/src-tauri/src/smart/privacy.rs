//! The privacy shield: finds private data in a screenshot so it can be hidden
//! before sharing. Text comes from OCR; each pattern match is mapped back to
//! the boxes of the words it covers. Faces come from Windows' face detector.
//!
//! Formats include Uzbek ones: +998 phones, Uzcard (8600…) and Humo (9860…)
//! cards, passports like AA1234567 and the 14-digit PINFL.

use anyhow::Result;
use image::RgbaImage;
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::cell::RefCell;
use std::sync::LazyLock;
use windows::Graphics::Imaging::{BitmapPixelFormat, SoftwareBitmap};
use windows::Media::FaceAnalysis::FaceDetector;

use super::ocr::{Line, OcrText};
use crate::imaging;
use crate::win::Rect;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Finding {
    /// email, phone, card, passport, pinfl, iban, ip, key, password or face.
    pub kind: String,
    /// The value with most characters masked, safe to show in a list.
    pub preview: String,
    pub rect: Rect,
}

struct Pattern {
    kind: &'static str,
    re: Regex,
    /// Capture group to hide (0 = the whole match).
    group: usize,
    check: fn(&str) -> bool,
}

fn any(_: &str) -> bool {
    true
}

fn digits(s: &str) -> String {
    s.chars().filter(char::is_ascii_digit).collect()
}

fn phone_ok(s: &str) -> bool {
    let n = digits(s).len();
    (9..=15).contains(&n)
}

/// Luhn checksum, or a known Uzbek card prefix (those don't always pass it).
fn card_ok(s: &str) -> bool {
    let d = digits(s);
    if d.len() < 13 || d.len() > 19 {
        return false;
    }
    if ["8600", "9860", "5614", "6262"].iter().any(|p| d.starts_with(p)) && d.len() == 16 {
        return true;
    }
    let sum: u32 = d
        .chars()
        .rev()
        .enumerate()
        .map(|(i, c)| {
            let mut v = c.to_digit(10).unwrap_or(0);
            if i % 2 == 1 {
                v *= 2;
                if v > 9 {
                    v -= 9;
                }
            }
            v
        })
        .sum();
    sum % 10 == 0
}

static PATTERNS: LazyLock<Vec<Pattern>> = LazyLock::new(|| {
    let p = |kind, re: &str, group, check| Pattern { kind, re: Regex::new(re).expect("valid regex"), group, check };
    vec![
        p("email", r"(?i)\b[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}\b", 0, any),
        p("key", r"\b(?:sk-(?:ant-)?[A-Za-z0-9_\-]{20,}|gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_\-]{30,}|xox[baprs]-[A-Za-z0-9\-]{10,}|eyJ[A-Za-z0-9_\-]{8,}\.[A-Za-z0-9_\-]{8,}\.[A-Za-z0-9_\-]{8,}|\d{8,10}:[A-Za-z0-9_\-]{30,})", 0, any),
        p("password", r"(?i)\b(?:password|passwd|pwd|parol|пароль)\s*[:=]\s*(\S+)", 1, any),
        // Masked card numbers still show the bank and last digits.
        p("card", r"\b\d{4}[ \-]?(?:[*xX•]{4}[ \-]?){2}\d{4}\b", 0, any),
        p("card", r"\b(?:\d[ \-]?){12,18}\d\b", 0, card_ok),
        p("iban", r"\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){3,7}(?: ?[A-Z0-9]{1,3})?\b", 0, any),
        p("pinfl", r"\b[3-6]\d{13}\b", 0, any),
        p("passport", r"\b[A-Z]{2} ?\d{7}\b", 0, any),
        p("phone", r"\+?998[\s\-]?\(?\d{2}\)?[\s\-]?\d{3}[\s\-]?\d{2}[\s\-]?\d{2}\b", 0, phone_ok),
        p("phone", r"\+\d{1,3}[\s\-]?\(?\d{1,4}\)?(?:[\s\-]?\d{2,4}){2,4}\b", 0, phone_ok),
        p("phone", r"\b\(?\d{2}\)?[\s\-]\d{3}[\s\-]\d{2}[\s\-]\d{2}\b", 0, phone_ok),
        p("ip", r"\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b", 0, any),
    ]
});

/// Shows the first and last couple of characters and masks the rest.
pub fn mask(kind: &str, value: &str) -> String {
    if kind == "email" {
        if let Some((local, domain)) = value.split_once('@') {
            let first: String = local.chars().take(1).collect();
            return format!("{first}•••@{domain}");
        }
    }
    let total = value.chars().filter(|c| c.is_alphanumeric()).count();
    let (keep_start, keep_end) = match kind {
        "card" => (4, 4),
        "phone" => (3, 2),
        _ if total <= 4 => (0, 0),
        _ => (2, 2),
    };
    let mut i = 0;
    value
        .chars()
        .map(|c| {
            if !c.is_alphanumeric() {
                return c;
            }
            let keep = i < keep_start || i + keep_end >= total;
            i += 1;
            if keep { c } else { '•' }
        })
        .collect()
}

fn union(a: Rect, b: Rect) -> Rect {
    let x = a.x.min(b.x);
    let y = a.y.min(b.y);
    Rect::new(x, y, a.right().max(b.right()) - x, a.bottom().max(b.bottom()) - y)
}

/// Pattern matches in one OCR line, each with the union of its words' boxes.
fn scan_line(line: &Line) -> Vec<Finding> {
    // The line as text, remembering which bytes belong to which word.
    let mut text = String::new();
    let mut spans = Vec::new();
    for (i, w) in line.words.iter().enumerate() {
        if i > 0 {
            text.push(' ');
        }
        let start = text.len();
        text.push_str(&w.text);
        spans.push((start, text.len()));
    }
    let mut taken: Vec<(usize, usize)> = Vec::new();
    let mut out = Vec::new();
    for p in PATTERNS.iter() {
        for caps in p.re.captures_iter(&text) {
            let Some(m) = caps.get(p.group) else { continue };
            let whole = caps.get(0).unwrap();
            if !(p.check)(whole.as_str()) {
                continue;
            }
            // Earlier, more specific patterns win over later ones.
            if taken.iter().any(|&(s, e)| m.start() < e && m.end() > s) {
                continue;
            }
            let rect = spans
                .iter()
                .zip(&line.words)
                .filter(|((s, e), _)| *s < m.end() && *e > m.start())
                .map(|(_, w)| w.rect)
                .reduce(union);
            if let Some(rect) = rect {
                taken.push((m.start(), m.end()));
                out.push(Finding { kind: p.kind.to_string(), preview: mask(p.kind, m.as_str()), rect });
            }
        }
    }
    out
}

pub fn find_in_text(results: &[OcrText]) -> Vec<Finding> {
    let mut out: Vec<Finding> = Vec::new();
    for r in results {
        for line in &r.lines {
            for f in scan_line(line) {
                // The same item read by two engines counts once.
                let dup = out.iter().any(|o| o.kind == f.kind && o.rect.intersect(&f.rect).is_some_and(|i| i.area() * 2 >= f.rect.area().min(o.rect.area())));
                if !dup {
                    out.push(f);
                }
            }
        }
    }
    out
}

thread_local! {
    static DETECTOR: RefCell<Option<FaceDetector>> = const { RefCell::new(None) };
}

/// Faces, via the offline Windows face detector.
pub fn find_faces(img: &RgbaImage) -> Result<Vec<Finding>> {
    let (w, h) = img.dimensions();
    let scale = (1280.0 / w.max(h) as f64).min(1.0);
    let small = if scale < 1.0 { imaging::resize(img, ((w as f64 * scale) as u32).max(1), ((h as f64 * scale) as u32).max(1))? } else { img.clone() };
    let gray = SoftwareBitmap::Convert(&super::ocr::bitmap(&small)?, BitmapPixelFormat::Gray8)?;
    let detector = DETECTOR.with(|d| -> Result<FaceDetector> {
        if let Some(det) = d.borrow().as_ref() {
            return Ok(det.clone());
        }
        let det = FaceDetector::CreateAsync()?.join()?;
        *d.borrow_mut() = Some(det.clone());
        Ok(det)
    })?;
    let faces = detector.DetectFacesAsync(&gray)?.join()?;
    let mut out = Vec::new();
    for face in faces {
        let b = face.FaceBox()?;
        // A little margin: the detector's box is tight around the face.
        let pad = (b.Width as f64 * 0.15) as i32;
        let rect = Rect::new(
            (b.X as f64 / scale) as i32 - pad,
            (b.Y as f64 / scale) as i32 - pad,
            (b.Width as f64 / scale) as i32 + pad * 2,
            (b.Height as f64 / scale) as i32 + pad * 2,
        );
        if let Some(rect) = rect.intersect(&Rect::new(0, 0, w as i32, h as i32)) {
            out.push(Finding { kind: "face".into(), preview: String::new(), rect });
        }
    }
    Ok(out)
}

/// Everything private in an image: text matches plus faces.
pub fn scan(img: &RgbaImage, text: &[OcrText]) -> Vec<Finding> {
    let mut found = find_in_text(text);
    match find_faces(img) {
        Ok(faces) => found.extend(faces),
        Err(e) => log::debug!("face detection: {e:#}"),
    }
    found
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::smart::ocr::Word;

    /// A line whose words sit side by side, 10 px per character.
    fn line(text: &str) -> Line {
        let mut x = 0;
        let words = text
            .split(' ')
            .map(|w| {
                let r = Rect::new(x, 0, w.chars().count() as i32 * 10, 20);
                x += r.w + 10;
                Word { text: w.to_string(), rect: r }
            })
            .collect();
        Line { words }
    }

    fn kinds(text: &str) -> Vec<String> {
        scan_line(&line(text)).into_iter().map(|f| f.kind).collect()
    }

    #[test]
    fn finds_uzbek_and_common_formats() {
        // Made-up test values only.
        assert_eq!(kinds("Tel: +998 90 123 45 67"), vec!["phone"]);
        assert_eq!(kinds("Qoʻngʻiroq: 90 123 45 67"), vec!["phone"]);
        assert_eq!(kinds("Karta 8600 1234 5678 9012"), vec!["card"]);
        assert_eq!(kinds("Visa 4111 1111 1111 1111"), vec!["card"]);
        assert_eq!(kinds("Humo 9860 **** **** 4321"), vec!["card"]);
        assert_eq!(kinds("Pasport AB 1234567"), vec!["passport"]);
        assert_eq!(kinds("JShShIR 31234567890123"), vec!["pinfl"]);
        assert_eq!(kinds("mail me: test.user@example.uz"), vec!["email"]);
        assert_eq!(kinds("server 192.168.10.25 is down"), vec!["ip"]);
        assert_eq!(kinds("key sk-ant-api03-abcdefghijklmnopqrstuvwx"), vec!["key"]);
        assert_eq!(kinds("Parol: qwerty123"), vec!["password"]);
    }

    #[test]
    fn ignores_ordinary_numbers() {
        assert!(kinds("Summa 150 000 soʻm, 23.10.2026").is_empty());
        assert!(kinds("Order 1234 5678 9012 3456").is_empty()); // fails Luhn, no Uzbek prefix
        assert!(kinds("version 2.12.5").is_empty());
    }

    #[test]
    fn boxes_cover_only_the_matched_words() {
        let found = scan_line(&line("Tel +998 90 123 45 67 call"));
        assert_eq!(found.len(), 1);
        // "Tel " is 3 chars + gap; the box starts at the second word.
        assert_eq!(found[0].rect.x, 40);
        assert!(found[0].rect.right() < 40 + 250);
        // The password pattern hides only the value, not the label.
        let pw = scan_line(&line("Parol: qwerty123"));
        assert_eq!(pw[0].rect.x, 70);
    }

    #[test]
    fn previews_are_masked() {
        assert_eq!(mask("email", "test.user@example.uz"), "t•••@example.uz");
        assert_eq!(mask("card", "8600 1234 5678 9012"), "8600 •••• •••• 9012");
        assert_eq!(mask("phone", "+998 90 123 45 67"), "+998 •• ••• •• 67");
        assert_eq!(mask("passport", "AB1234567"), "AB•••••67");
    }
}
