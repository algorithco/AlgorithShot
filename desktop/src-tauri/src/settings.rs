//! User settings, stored as JSON in the app's config folder. Unknown or
//! missing fields fall back to defaults, so old files keep working.

use anyhow::Result;
use serde::{Deserialize, Serialize};
use std::path::Path;

pub const SETUP_VERSION: u32 = 1;

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
    /// Empty means `Pictures\AlgorithShot`.
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
    /// Highlight the window under the pointer in Region, Copy text and Scan
    /// QR, so a click captures it. Off: the user always draws the area.
    pub highlight: bool,
    /// With `highlight`, also the buttons, panels and messages inside
    /// windows (UI Automation).
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
    /// Version of the full setup completed by the user; 0 includes old welcome-only files.
    pub setup_version: u32,
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
            highlight: false,
            elements: true,
            hotkeys: Hotkeys::default(),
            launch_at_login: false,
            index_text: true,
            privacy_check: true,
            auto_clean_days: 0,
            sound: false,
            welcome_done: false,
            setup_version: 0,
        }
    }
}

impl Settings {
    pub fn needs_setup(&self) -> bool {
        self.setup_version < SETUP_VERSION
    }

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

/// A removed-on-success write probe catches inaccessible destinations before
/// the setup completion marker and choices are committed.
pub fn ensure_capture_dir_writable(path: &Path) -> Result<()> {
    use anyhow::Context;
    std::fs::create_dir_all(path).with_context(|| format!("opening screenshot folder {}", path.display()))?;
    let probe_path = path.join(format!(".algorithshot-write-check-{}", uuid::Uuid::new_v4()));
    let probe = std::fs::OpenOptions::new().write(true).create_new(true).open(&probe_path)
        .with_context(|| format!("Screenshot folder is not writable: {}", path.display()))?;
    drop(probe);
    std::fs::remove_file(&probe_path).context("removing screenshot folder write check")?;
    Ok(())
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

    #[test]
    fn old_welcome_does_not_skip_full_setup() {
        let settings: Settings = serde_json::from_str(r#"{"welcomeDone":true,"format":"webp"}"#).unwrap();
        assert!(settings.welcome_done);
        assert!(settings.needs_setup());
        assert_eq!(settings.format, "webp");
    }

    #[test]
    fn completed_setup_and_choices_survive_a_reload() {
        let root = std::env::temp_dir().join(format!("algorithshot-setup-{}", uuid::Uuid::new_v4()));
        let path = root.join("settings.json");
        let settings = Settings { setup_version: SETUP_VERSION, welcome_done: true, language: "uz".into(), format: "webp".into(), webp_quality: 73, ..Default::default() };
        settings.save(&path).unwrap();
        let loaded = Settings::load(&path);
        assert_eq!(loaded, settings);
        assert!(!loaded.needs_setup());
        std::fs::remove_file(&path).unwrap();
        std::fs::remove_dir(&root).unwrap();
    }

    #[test]
    fn destination_write_check_leaves_no_probe_files() {
        let root = std::env::temp_dir().join(format!("algorithshot-folder-check-{}", uuid::Uuid::new_v4()));
        ensure_capture_dir_writable(&root).unwrap();
        assert_eq!(std::fs::read_dir(&root).unwrap().count(), 0);
        let user_file = root.join("existing-image.png");
        std::fs::write(&user_file, b"existing bytes").unwrap();
        assert!(ensure_capture_dir_writable(&user_file).is_err());
        assert_eq!(std::fs::read(&user_file).unwrap(), b"existing bytes");
        std::fs::remove_file(&user_file).unwrap();
        std::fs::remove_dir(&root).unwrap();
    }
}
