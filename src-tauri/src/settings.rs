//! User settings, stored as JSON in the app's config folder. Unknown or
//! missing fields fall back to defaults, so old files keep working.

use anyhow::Result;
use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Hotkeys {
    /// Freezes the screen and shows the capture toolbar.
    pub capture: String,
    /// Second key for the same thing, for when Print Screen is taken.
    pub capture_alt: String,
    pub text: String,
    pub qr: String,
    pub full_screen: String,
    pub repeat: String,
    pub library: String,
}

impl Default for Hotkeys {
    fn default() -> Self {
        Self {
            capture: "PrintScreen".into(),
            capture_alt: "Ctrl+Shift+PrintScreen".into(),
            text: String::new(),
            qr: String::new(),
            full_screen: String::new(),
            repeat: String::new(),
            library: String::new(),
        }
    }
}

impl Hotkeys {
    /// (action, shortcut) pairs that are set.
    pub fn bindings(&self) -> Vec<(&'static str, &str)> {
        [
            ("capture", self.capture.as_str()),
            ("capture", self.capture_alt.as_str()),
            ("text", self.text.as_str()),
            ("qr", self.qr.as_str()),
            ("screen", self.full_screen.as_str()),
            ("repeat", self.repeat.as_str()),
            ("library", self.library.as_str()),
        ]
        .into_iter()
        .filter(|(_, k)| !k.trim().is_empty())
        .collect()
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    /// "system", "en", "uz" or "ru".
    pub language: String,
    /// "system", "light" or "dark".
    pub theme: String,
    /// Empty means `Pictures\Algorithco Shot`.
    pub save_dir: String,
    /// Save every capture to the library (needed for search and history).
    pub save_all: bool,
    /// Tokens: {app} {title} {date} {time}.
    pub file_pattern: String,
    /// "png", "jpeg" or "webp".
    pub format: String,
    pub jpeg_quality: u8,
    pub webp_quality: u8,
    pub copy_after_capture: bool,
    pub show_card: bool,
    pub open_editor: bool,
    pub card_seconds: u32,
    pub snap: bool,
    /// Snap to buttons, panels and messages inside windows (UI Automation).
    pub elements: bool,
    pub hotkeys: Hotkeys,
    pub launch_at_login: bool,
    /// Read the text in every screenshot so the library can search it.
    pub index_text: bool,
    pub privacy_check: bool,
    /// Move screenshots older than this many days to the Recycle Bin, unless
    /// starred. 0 turns it off.
    pub auto_clean_days: u32,
    pub sound: bool,
    pub welcome_done: bool,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            language: "system".into(),
            theme: "system".into(),
            save_dir: String::new(),
            save_all: true,
            file_pattern: "{app} {date} {time}".into(),
            format: "png".into(),
            jpeg_quality: 90,
            webp_quality: 90,
            copy_after_capture: true,
            show_card: true,
            open_editor: false,
            card_seconds: 6,
            snap: true,
            elements: true,
            hotkeys: Hotkeys::default(),
            launch_at_login: false,
            index_text: true,
            privacy_check: true,
            auto_clean_days: 0,
            sound: false,
            welcome_done: false,
        }
    }
}

impl Settings {
    pub fn load(path: &Path) -> Settings {
        let parsed = std::fs::read(path).ok().and_then(|data| serde_json::from_slice::<Settings>(&data).ok());
        let mut s = parsed.unwrap_or_default();
        s.sanitize();
        s
    }

    pub fn save(&self, path: &Path) -> Result<()> {
        if let Some(dir) = path.parent() {
            std::fs::create_dir_all(dir)?;
        }
        let tmp = path.with_extension("json.tmp");
        std::fs::write(&tmp, serde_json::to_vec_pretty(self)?)?;
        std::fs::rename(tmp, path)?;
        Ok(())
    }

    /// Keeps values in range so a hand-edited file can't break the app.
    pub fn sanitize(&mut self) {
        if !["system", "en", "uz", "ru"].contains(&self.language.as_str()) {
            self.language = "system".into();
        }
        if !["system", "light", "dark"].contains(&self.theme.as_str()) {
            self.theme = "system".into();
        }
        if !["png", "jpeg", "webp"].contains(&self.format.as_str()) {
            self.format = "png".into();
        }
        self.jpeg_quality = self.jpeg_quality.clamp(10, 100);
        self.webp_quality = self.webp_quality.clamp(10, 100);
        self.card_seconds = self.card_seconds.clamp(2, 60);
        if self.file_pattern.trim().is_empty() {
            self.file_pattern = Settings::default().file_pattern;
        }
    }

    /// The language for texts made in Rust (tray menu, file names).
    pub fn resolved_language(&self) -> String {
        if self.language != "system" {
            return self.language.clone();
        }
        let tag = sys_locale().to_ascii_lowercase();
        if tag.starts_with("uz") {
            "uz".into()
        } else if tag.starts_with("ru") {
            "ru".into()
        } else {
            "en".into()
        }
    }
}

fn sys_locale() -> String {
    use windows::Win32::Globalization::GetUserDefaultLocaleName;
    let mut buf = [0u16; 85];
    let n = unsafe { GetUserDefaultLocaleName(&mut buf) };
    if n <= 1 {
        return "en".into();
    }
    String::from_utf16_lossy(&buf[..(n - 1) as usize])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn old_files_fill_in_defaults() {
        let s: Settings = serde_json::from_str(r#"{"format":"webp","hotkeys":{"capture":"F1"}}"#).unwrap();
        assert_eq!(s.format, "webp");
        assert_eq!(s.hotkeys.capture, "F1");
        assert_eq!(s.hotkeys.capture_alt, Hotkeys::default().capture_alt);
        assert!(s.save_all);
    }

    #[test]
    fn sanitize_fixes_bad_values() {
        let mut s = Settings { format: "bmp".into(), jpeg_quality: 0, language: "xx".into(), ..Default::default() };
        s.sanitize();
        assert_eq!((s.format.as_str(), s.jpeg_quality, s.language.as_str()), ("png", 10, "system"));
    }

    #[test]
    fn bindings_skip_empty() {
        let h = Hotkeys { capture_alt: String::new(), text: "Ctrl+Alt+T".into(), ..Default::default() };
        assert_eq!(h.bindings(), vec![("capture", "PrintScreen"), ("text", "Ctrl+Alt+T")]);
    }
}
