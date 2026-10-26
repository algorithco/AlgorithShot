//! Cache native application icons using macOS bundles and freedesktop entries.

use anyhow::{Context, Result, bail};
use parking_lot::Mutex;
use std::path::{Path, PathBuf};
use crate::{imaging, win};

pub struct AppIcons { dir: PathBuf, extracting: Mutex<()> }

impl AppIcons {
    pub fn new(dir: PathBuf) -> Self { Self { dir, extracting: Mutex::new(()) } }
    pub fn load(&self, name: &str) -> Result<Vec<u8>> { self.remember(name, 0) }
    pub fn remember(&self, name: &str, hwnd: isize) -> Result<Vec<u8>> {
        if name.trim().is_empty() { bail!("no source application"); }
        let hash = name.bytes().fold(0xcbf29ce484222325u64, |h, b| (h ^ u64::from(b)).wrapping_mul(0x100000001b3));
        let path = self.dir.join(format!("{hash:016x}.png"));
        if let Ok(data) = std::fs::read(&path) { return Ok(data); }
        let _lock = self.extracting.lock();
        if let Ok(data) = std::fs::read(&path) { return Ok(data); }
        let executable = win::window_pid(hwnd).and_then(win::process_path);
        let icon = native_icon(name, executable.as_deref()).with_context(|| format!("no native icon for {name}"))?;
        let image = image::load_from_memory(&icon)?.into_rgba8();
        let image = imaging::thumbnail(&image, 128)?;
        let png = imaging::encode(&image, imaging::Format::Png, 100)?;
        std::fs::create_dir_all(&self.dir)?;
        std::fs::write(&path, &png)?;
        Ok(png)
    }
}

fn normalized(name: &str) -> String {
    let value: String = name.chars().filter(|c| c.is_alphanumeric()).flat_map(char::to_lowercase).collect();
    match value.as_str() { "vscode" | "code" => "visualstudiocode".into(), "chrome" => "googlechrome".into(), _ => value }
}

pub fn name_from_url(encoded: &str) -> Option<String> {
    if encoded.is_empty() || encoded.len() > 4096 || encoded.len() % 2 != 0 { return None; }
    let bytes: Option<Vec<u8>> = encoded.as_bytes().chunks_exact(2)
        .map(|pair| u8::from_str_radix(std::str::from_utf8(pair).ok()?, 16).ok()).collect();
    String::from_utf8(bytes?).ok()
}

#[cfg(target_os = "linux")]
fn native_icon(name: &str, executable: Option<&Path>) -> Option<Vec<u8>> {
    let mut data_dirs = std::env::var("XDG_DATA_DIRS").unwrap_or_else(|_| "/usr/local/share:/usr/share".into())
        .split(':').map(PathBuf::from).collect::<Vec<_>>();
    if let Some(home) = std::env::var_os("HOME") {
        let local = std::env::var_os("XDG_DATA_HOME").map(PathBuf::from).unwrap_or_else(|| PathBuf::from(home).join(".local/share"));
        data_dirs.insert(0, local);
    }
    let expected = normalized(name);
    let mut icon_names = vec![name.to_lowercase()];
    for base in &data_dirs {
        for file in std::fs::read_dir(base.join("applications")).ok().into_iter().flatten().flatten() {
            if file.path().extension().is_none_or(|e| e != "desktop") { continue; }
            let Ok(content) = std::fs::read_to_string(file.path()) else { continue; };
            let mut section = false;
            let (mut display, mut exec, mut icon) = ("", "", "");
            for line in content.lines() {
                if line.starts_with('[') { section = line == "[Desktop Entry]"; continue; }
                if !section { continue; }
                if let Some(value) = line.strip_prefix("Name=") { display = value; }
                if let Some(value) = line.strip_prefix("Exec=") { exec = value; }
                if let Some(value) = line.strip_prefix("Icon=") { icon = value; }
            }
            let binary = exec.split_whitespace().next().unwrap_or("").trim_matches('"');
            let exec_name = Path::new(binary).file_stem().and_then(|s| s.to_str()).unwrap_or(binary);
            let matches = normalized(display) == expected || normalized(exec_name) == expected
                || executable.is_some_and(|p| p == Path::new(binary));
            if matches && !icon.is_empty() { icon_names.insert(0, icon.into()); }
        }
    }
    for icon in icon_names {
        let direct = Path::new(&icon);
        if direct.is_absolute() { if let Ok(data) = std::fs::read(direct) { return Some(data); } }
        for base in &data_dirs {
            for theme in ["hicolor", "Adwaita", "breeze"] {
                for size in ["128x128", "64x64", "256x256", "48x48", "32x32"] {
                    let path = base.join("icons").join(theme).join(size).join("apps").join(format!("{icon}.png"));
                    if let Ok(data) = std::fs::read(path) { return Some(data); }
                }
            }
            for ext in ["png", "xpm"] {
                if let Ok(data) = std::fs::read(base.join("pixmaps").join(format!("{icon}.{ext}"))) { return Some(data); }
            }
        }
    }
    None
}

#[cfg(target_os = "macos")]
fn native_icon(name: &str, executable: Option<&Path>) -> Option<Vec<u8>> {
    let mut bundles = Vec::new();
    if let Some(path) = executable.and_then(|p| p.ancestors().find(|p| p.extension().is_some_and(|e| e == "app"))) { bundles.push(path.to_path_buf()); }
    let mut roots = vec![PathBuf::from("/Applications"), PathBuf::from("/System/Applications")];
    if let Some(home) = std::env::var_os("HOME") { roots.push(PathBuf::from(home).join("Applications")); }
    for root in roots {
        for entry in std::fs::read_dir(root).ok().into_iter().flatten().flatten() {
            let path = entry.path();
            let stem = path.file_stem().and_then(|s| s.to_str()).unwrap_or("");
            if path.extension().is_some_and(|s| s == "app") && normalized(stem) == normalized(name) { bundles.push(path); }
        }
    }
    for bundle in bundles {
        let plist = plist::Value::from_file(bundle.join("Contents/Info.plist")).ok();
        let icon = plist.as_ref().and_then(|p| p.as_dictionary()).and_then(|d| d.get("CFBundleIconFile")).and_then(|v| v.as_string());
        let resources = bundle.join("Contents/Resources");
        let mut candidates = Vec::new();
        if let Some(icon) = icon { candidates.push(resources.join(if icon.ends_with(".icns") { icon.into() } else { format!("{icon}.icns") })); }
        candidates.extend(std::fs::read_dir(&resources).ok().into_iter().flatten().flatten().map(|e| e.path())
            .filter(|p| p.extension().is_some_and(|e| e == "icns")));
        for path in candidates {
            let Some(family) = std::fs::File::open(path).ok().and_then(|mut f| icns::IconFamily::read(&mut f).ok()) else { continue; };
            for kind in family.available_icons() {
                let Ok(image) = family.get_icon_with_type(kind) else { continue; };
                let mut png = Vec::new();
                if image.write_png(&mut png).is_ok() { return Some(png); }
            }
        }
    }
    None
}
