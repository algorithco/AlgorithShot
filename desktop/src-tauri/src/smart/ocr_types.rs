//! Text and physical word boxes shared by the native and WASM OCR engines.

use serde::{Deserialize, Serialize};
use crate::win::Rect;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Word { pub text: String, pub rect: Rect }

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Line { pub words: Vec<Word> }

impl Line {
    pub fn text(&self) -> String { self.words.iter().map(|w| w.text.as_str()).collect::<Vec<_>>().join(" ") }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct OcrText { pub lang: String, pub lines: Vec<Line> }

impl OcrText {
    pub fn text(&self) -> String { self.lines.iter().map(Line::text).collect::<Vec<_>>().join("\n") }
}

pub fn union_text(results: &[OcrText]) -> String {
    let mut seen = std::collections::HashSet::new();
    results.iter().flat_map(|r| &r.lines).map(Line::text)
        .filter(|t| seen.insert(t.to_lowercase())).collect::<Vec<_>>().join("\n")
}
