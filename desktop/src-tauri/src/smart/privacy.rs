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
#[cfg(target_os = "windows")]
use std::cell::RefCell;
use std::sync::LazyLock;
#[cfg(target_os = "windows")]
use windows::Graphics::Imaging::{BitmapPixelFormat, SoftwareBitmap};
#[cfg(target_os = "windows")]
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
    numeric_candidates: bool,
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
    if d.len() < 13 || d.len() > 19 || d.chars().all(|c| c == d.chars().next().unwrap()) {
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
    let p = |kind, re: &str, group, check| Pattern { kind, re: Regex::new(re).expect("valid regex"), group, check, numeric_candidates: false };
    vec![
        p("password", r#"(?i)\b(?:[a-z][a-z0-9]*[_-])*(?:password|passwd|pwd|parol|пароль|api[_ -]?key|(?:access|auth|refresh)[_ -]?token|(?:client[_ -]?)?secret|secret[_ -]?access[_ -]?key|authorization)\s*["']?\s*[:=]\s*("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|(?:Bearer\s+)?[^\s"']+)"#, 1, any),
        p("email", r"(?i)\b[a-z0-9._%+\-]+\s*@\s*[a-z0-9\-]+(?:\s*\.\s*[a-z0-9\-]+)*\s*\.\s*[a-z]{2,}\b", 0, any),
        p("key", r"\b(?:sk-(?:ant-)?[A-Za-z0-9_\-]{20,}|gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_\-]{30,}|xox[baprs]-[A-Za-z0-9\-]{10,}|eyJ[A-Za-z0-9_\-]{8,}\.[A-Za-z0-9_\-]{8,}\.[A-Za-z0-9_\-]{8,}|\d{8,10}:[A-Za-z0-9_\-]{30,})", 0, any),
        // Masked card numbers still show the bank and last digits.
        p("card", r"\b\d{4}[ \-]?(?:[*xX•]{4}[ \-]?){2}\d{4}\b", 0, any),
        Pattern { numeric_candidates: true, ..p("card", r"\b[0-9]+(?:[ \-][0-9]+)*\b", 0, card_ok) },
        p("iban", r"\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){3,7}(?: ?[A-Z0-9]{1,3})?\b", 0, any),
        p("pinfl", r"\b[3-6]\d{13}\b", 0, any),
        p("passport", r"(?i)\b[A-Z]{2}\s?\d{7}\b", 0, any),
        // OCR often reads 1 as I/l and 0 as O. Only accept these with an ID label.
        p("passport", r"(?i)\b(?:passport|pasport|паспорт)\s*[:=]?\s*([A-Z]{2}\s*[0-9OIl](?:\s*[0-9OIl]){6})\b", 1, any),
        p("phone", r"\+?\b998[\s\-]?\(?\d{2}\)?[\s\-]?\d{3}[\s\-]?\d{2}[\s\-]?\d{2}\b", 0, phone_ok),
        p("phone", r"\+\d{1,3}[\s\-]?\(?\d{1,4}\)?(?:[\s\-]?\d{2,4}){2,4}\b", 0, phone_ok),
        p("phone", r"\b\(?\d{2}\)?[\s\-]\d{3}[\s\-]\d{2}[\s\-]\d{2}\b", 0, phone_ok),
        p("ip", r"\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b", 0, any),
    ]
});

/// Shows the first and last couple of characters and masks the rest.
pub fn mask(kind: &str, value: &str) -> String {
    if matches!(kind, "password" | "key") {
        return "••••••••".into();
    }
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

/// Inspect bounded digit sequences independently: a neighboring amount or
/// another card must not turn a valid card into one rejected greedy match.
fn card_ranges(text: &str, runs: &Regex) -> Vec<std::ops::Range<usize>> {
    let mut candidates = Vec::new();
    for run in runs.find_iter(text) {
        let bytes = run.as_str().as_bytes();
        for start in 0..bytes.len() {
            if !bytes[start].is_ascii_digit() || (start > 0 && bytes[start - 1].is_ascii_digit()) {
                continue;
            }
            let mut count = 0;
            for end in start..bytes.len() {
                if !bytes[end].is_ascii_digit() { continue; }
                count += 1;
                if count > 19 { break; }
                if count < 13 || (end + 1 < bytes.len() && bytes[end + 1].is_ascii_digit()) { continue; }
                let range = run.start() + start..run.start() + end + 1;
                let value = &text[range.clone()];
                if card_ok(value) {
                    // Prefer complete common 16-digit cards over a checksum
                    // coincidence formed by including an adjacent number.
                    let grouped = count == 16 && value.split([' ', '-']).all(|g| g.len() == 4);
                    candidates.push((grouped, count == 16, range));
                }
            }
        }
    }
    candidates.sort_by(|a, b| b.0.cmp(&a.0).then(b.1.cmp(&a.1))
        .then(a.2.start.cmp(&b.2.start)).then(b.2.end.cmp(&a.2.end)));
    let mut out: Vec<std::ops::Range<usize>> = Vec::new();
    for (_, _, candidate) in candidates {
        if !out.iter().any(|r| r.start < candidate.end && r.end > candidate.start) {
            out.push(candidate);
        }
    }
    out.sort_by_key(|r| r.start);
    out
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
        // Normalize OCR whitespace and typography without changing word ownership.
        for c in w.text.chars() {
            match c {
                '\u{200b}' | '\u{feff}' | '\u{00ad}' => {},
                c if c.is_whitespace() => text.push(' '),
                '‐' | '‑' | '–' | '−' => text.push('-'),
                '＠' => text.push('@'),
                '．' => text.push('.'),
                c => text.push(c),
            }
        }
        spans.push((start, text.len()));
    }
    let mut taken: Vec<(usize, usize)> = Vec::new();
    let mut out = Vec::new();
    for p in PATTERNS.iter() {
        let matches: Vec<_> = if p.numeric_candidates {
            card_ranges(&text, &p.re)
        } else {
            p.re.captures_iter(&text).filter_map(|caps| {
                let m = caps.get(p.group)?;
                (p.check)(m.as_str()).then_some(m.start()..m.end())
            }).collect()
        };
        for m in matches {
            // Earlier, more specific patterns win over later ones.
            if taken.iter().any(|&(s, e)| m.start >= s && m.end <= e) {
                continue;
            }
            let rect = spans
                .iter()
                .zip(&line.words)
                .filter(|((s, e), _)| *s < m.end && *e > m.start)
                .map(|(_, w)| w.rect)
                .reduce(union);
            if let Some(rect) = rect {
                taken.push((m.start, m.end));
                out.push(Finding { kind: p.kind.to_string(), preview: mask(p.kind, &text[m.clone()]), rect });
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
                let dup = out.iter_mut().find(|o| o.kind == f.kind && o.rect.intersect(&f.rect).is_some_and(|i| i.area() * 2 >= f.rect.area().min(o.rect.area())));
                if let Some(existing) = dup {
                    existing.rect = union(existing.rect, f.rect);
                } else {
                    out.push(f);
                }
            }
        }
    }
    out
}

#[cfg(target_os = "windows")]
thread_local! {
    static DETECTOR: RefCell<Option<FaceDetector>> = const { RefCell::new(None) };
}

/// Faces, via the offline Windows face detector.
#[cfg(target_os = "windows")]
pub fn find_faces(img: &RgbaImage) -> Result<Vec<Finding>> {
    let (w, h) = img.dimensions();
    if w == 0 || h == 0 { return Ok(Vec::new()); }
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
        let pad = (b.Width as f64 / scale * 0.15) as i32;
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

#[cfg(not(target_os = "windows"))]
pub fn find_faces(img: &RgbaImage) -> Result<Vec<Finding>> {
    let (w, h) = img.dimensions();
    if w == 0 || h == 0 { return Ok(Vec::new()); }
    let scale = (1280.0 / w.max(h) as f64).min(1.0);
    let small = if scale < 1.0 { imaging::resize(img, ((w as f64 * scale) as u32).max(1), ((h as f64 * scale) as u32).max(1))? } else { img.clone() };
    let gray = image::DynamicImage::ImageRgba8(small).into_luma8();
    let model = rustface::read_model(std::io::Cursor::new(include_bytes!("../../models/seeta_fd_frontal_v1.0.bin")))?;
    let mut detector = rustface::create_detector_with_model(model);
    detector.set_min_face_size(20);
    detector.set_score_thresh(2.0);
    detector.set_pyramid_scale_factor(0.8);
    detector.set_slide_window_step(4, 4);
    let data = rustface::ImageData::new(gray.as_raw(), gray.width(), gray.height());
    Ok(detector.detect(&data).into_iter().filter_map(|face| {
        let b = face.bbox();
        let pad = (b.width() as f64 / scale * 0.15) as i32;
        let rect = Rect::new((b.x() as f64 / scale) as i32 - pad, (b.y() as f64 / scale) as i32 - pad,
            (b.width() as f64 / scale) as i32 + pad * 2, (b.height() as f64 / scale) as i32 + pad * 2);
        rect.intersect(&Rect::new(0, 0, w as i32, h as i32)).map(|rect| Finding { kind: "face".into(), preview: String::new(), rect })
    }).collect())
}

/// Everything private in an image: text matches plus faces.
pub fn scan(img: &RgbaImage, text: &[OcrText]) -> Result<Vec<Finding>> {
    let mut found = find_in_text(text);
    found.extend(find_faces(img)?);
    Ok(found)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(not(target_os = "windows"))]
    #[test]
    fn the_embedded_face_model_loads_and_ignores_an_empty_scene() {
        let image = RgbaImage::from_pixel(100, 100, image::Rgba([255, 255, 255, 255]));
        assert!(find_faces(&image).unwrap().is_empty());
    }
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
    fn handles_ocr_spacing_and_secret_labels() {
        assert!(kinds("Contact test.user @ example . uz").contains(&"email".into()));
        assert!(kinds("Tel: +998\u{a0}90‑123‑45‑67").contains(&"phone".into()));
        assert_eq!(kinds("passport ab1234567"), vec!["passport"]);
        assert_eq!(kinds("Passport: ABI 234567"), vec!["passport"]);
        assert!(kinds("ABI 234567").is_empty());
        assert_eq!(kinds("api_key: synthetic_secret"), vec!["password"]);
        let found = scan_line(&line("password: \"two words\""));
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].rect.right(), line("password: \"two words\"").words.last().unwrap().rect.right());
        assert_eq!(mask("password", "!@#$"), "••••••••");
        assert_eq!(mask("key", "sk-test-secret"), "••••••••");
        assert!(kinds("0000000000000000").is_empty());
    }

    #[test]
    fn duplicate_engine_boxes_keep_all_edges() {
        let first = line("test@example.uz");
        let mut second = first.clone();
        second.words[0].rect.x += 5;
        second.words[0].rect.w += 10;
        let expected = union(first.words[0].rect, second.words[0].rect);
        let found = find_in_text(&[
            OcrText { lang: "en".into(), lines: vec![first] },
            OcrText { lang: "ru".into(), lines: vec![second] },
        ]);
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].rect, expected);
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
    fn card_detection_does_not_consume_neighboring_numbers() {
        for text in [
            "Karta 8600 1234 5678 9012 42",
            "42 8600 1234 5678 9012",
            "4111 1111 1111 1111 42",
            "8600 1234 5678 9012 9860 1234 5678 9012",
        ] {
            let found = scan_line(&line(text));
            let cards: Vec<_> = found.iter().filter(|f| f.kind == "card").collect();
            let expected = if text.contains("9860") { 2 } else { 1 };
            assert_eq!(cards.len(), expected, "{text}: {found:?}");
            if text.ends_with(" 42") {
                assert!(cards[0].rect.right() < line(text).words.last().unwrap().rect.x);
            }
        }
    }

    #[test]
    fn escaped_quotes_do_not_leave_secret_suffixes_visible() {
        let input = r#"password: "synthetic\" secret tail" done"#;
        let words = line(input);
        let found = scan_line(&words);
        let password = found.iter().find(|f| f.kind == "password").unwrap();
        assert_eq!(password.rect.right(), words.words[3].rect.right());
        assert_eq!(password.preview, "••••••••");
    }

    #[test]
    fn secret_context_wins_over_previews_that_reveal_characters() {
        for text in [
            "password: synthetic@example.uz",
            "DB_PASSWORD=synthetic@example.uz",
            "CLIENT_SECRET=synthetic-secret",
            "AWS_SECRET_ACCESS_KEY=synthetic-secret",
        ] {
            let found = scan_line(&line(text));
            assert_eq!(found.len(), 1, "{text}: {found:?}");
            assert_eq!(found[0].kind, "password");
            assert_eq!(found[0].preview, "••••••••");
        }
    }

    #[test]
    fn rejects_partial_matches_inside_longer_identifiers() {
        assert!(kinds("reference 123998901234567").is_empty());
        assert!(kinds("serial 000000000000000000000").is_empty());
    }

    #[test]
    fn previews_are_masked() {
        assert_eq!(mask("email", "test.user@example.uz"), "t•••@example.uz");
        assert_eq!(mask("card", "8600 1234 5678 9012"), "8600 •••• •••• 9012");
        assert_eq!(mask("phone", "+998 90 123 45 67"), "+998 •• ••• •• 67");
        assert_eq!(mask("passport", "AB1234567"), "AB•••••67");
    }
}
