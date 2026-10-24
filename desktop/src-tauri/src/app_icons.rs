//! Native application icons, kept locally so they survive the source app closing.

use anyhow::{Context, Result, bail};
use image::RgbaImage;
use parking_lot::Mutex;
use std::path::PathBuf;
use windows::Win32::Foundation::{HWND, SIZE};
use windows::Win32::Graphics::Gdi::{
    BI_RGB, BITMAP, BITMAPINFO, BITMAPINFOHEADER, DIB_RGB_COLORS, DeleteObject, GetDC, GetDIBits,
    GetObjectW, HBITMAP, ReleaseDC,
};
use windows::Win32::System::Com::{
    COINIT_APARTMENTTHREADED, CoInitializeEx, CoTaskMemFree, CoUninitialize,
};
use windows::Win32::UI::Shell::{
    BHID_EnumItems, FOLDERID_AppsFolder, IEnumShellItems, IShellItem, IShellItemImageFactory,
    KF_FLAG_DEFAULT, SHCreateItemFromParsingName, SHGetKnownFolderItem, SIGDN,
    SIGDN_DESKTOPABSOLUTEPARSING, SIGDN_NORMALDISPLAY, SIIGBF_ICONONLY,
};
use windows::Win32::UI::WindowsAndMessaging::GetWindowThreadProcessId;
use windows::core::PCWSTR;

use crate::imaging::{self, Format};
use crate::win;

struct InstalledApp {
    name: String,
    target: String,
}

pub struct AppIcons {
    dir: PathBuf,
    installed: Mutex<Option<Vec<InstalledApp>>>,
    // Shell extraction runs on background threads, once at a time on cache misses.
    extracting: Mutex<()>,
}

impl AppIcons {
    pub fn new(dir: PathBuf) -> Self {
        Self {
            dir,
            installed: Mutex::new(None),
            extracting: Mutex::new(()),
        }
    }

    pub fn load(&self, name: &str) -> Result<Vec<u8>> {
        self.remember(name, 0)
    }

    pub fn remember(&self, name: &str, hwnd: isize) -> Result<Vec<u8>> {
        if name.trim().is_empty() {
            bail!("no source application");
        }
        let path = self.dir.join(format!("{}.png", cache_key(name)));
        if let Ok(png) = std::fs::read(&path) {
            return Ok(png);
        }
        let _lock = self.extracting.lock();
        if let Ok(png) = std::fs::read(&path) {
            return Ok(png);
        }
        let _com = ComApartment::new()?;
        let image = match name {
            "Desktop" => shell_image("shell:Desktop"),
            "Taskbar" => shell_image("shell:AppsFolder"),
            "Explorer" => std::env::var_os("WINDIR").and_then(|dir| {
                shell_image(&PathBuf::from(dir).join("explorer.exe").to_string_lossy())
            }),
            _ => window_image(hwnd)
                .or_else(|| {
                    win::visible_windows()
                        .iter()
                        .filter(|w| {
                            win::friendly_app_name(&w.app, &w.title).eq_ignore_ascii_case(name)
                        })
                        .find_map(|w| window_image(w.hwnd))
                })
                .or_else(|| self.installed_image(name)),
        }
        .with_context(|| format!("no native icon for {name}"))?;
        let png = imaging::encode(&image, Format::Png, 100)?;
        std::fs::create_dir_all(&self.dir)?;
        std::fs::write(path, &png)?;
        Ok(png)
    }

    fn installed_image(&self, name: &str) -> Option<RgbaImage> {
        let mut installed = self.installed.lock();
        if installed.is_none() {
            *installed = Some(installed_apps().ok()?);
        }
        let name = normalized(name);
        let apps = installed.as_ref()?;
        let mut matches: Vec<_> = apps
            .iter()
            .filter_map(|app| {
                let display = normalized(&app.name);
                let target = normalized(app.target.rsplit('\\').next().unwrap_or(&app.target));
                let score = if display == name || target == name {
                    3
                } else if name.len() >= 3 && (display.ends_with(&name) || target.ends_with(&name)) {
                    2
                } else if name.len() >= 3 && display.starts_with(&name) {
                    1
                } else {
                    0
                };
                (score > 0).then_some((score, app))
            })
            .collect();
        matches.sort_by_key(|(score, app)| (std::cmp::Reverse(*score), app.name.len()));
        matches
            .into_iter()
            .find_map(|(_, app)| shell_image(&app.target))
    }
}

// File names never contain an app name or a path supplied by the webview.
fn cache_key(name: &str) -> String {
    let hash = name.bytes().fold(0xcbf29ce484222325u64, |hash, byte| {
        (hash ^ u64::from(byte)).wrapping_mul(0x100000001b3)
    });
    format!("{hash:016x}")
}

fn normalized(name: &str) -> String {
    let name: String = name
        .chars()
        .filter(|c| c.is_alphanumeric())
        .flat_map(char::to_lowercase)
        .collect();
    // The library uses this abbreviation; Windows registers the full product name.
    if name == "vscode" {
        "visualstudiocode".into()
    } else {
        name
    }
}

/// URLs use UTF-8 hex so slashes, spaces and non-Latin app names stay one segment.
pub fn name_from_url(encoded: &str) -> Option<String> {
    if encoded.is_empty() || encoded.len() > 4096 || encoded.len() % 2 != 0 {
        return None;
    }
    let bytes: Option<Vec<u8>> = encoded
        .as_bytes()
        .chunks_exact(2)
        .map(|pair| {
            let text = std::str::from_utf8(pair).ok()?;
            u8::from_str_radix(text, 16).ok()
        })
        .collect();
    String::from_utf8(bytes?).ok()
}

struct ComApartment;

impl ComApartment {
    fn new() -> Result<Self> {
        unsafe { CoInitializeEx(None, COINIT_APARTMENTTHREADED).ok()? };
        Ok(Self)
    }
}

impl Drop for ComApartment {
    fn drop(&mut self) {
        unsafe { CoUninitialize() };
    }
}

fn window_image(hwnd: isize) -> Option<RgbaImage> {
    if hwnd == 0 {
        return None;
    }
    let mut pid = 0;
    unsafe { GetWindowThreadProcessId(HWND(hwnd as *mut _), Some(&mut pid)) };
    let path = win::process_path(pid)?;
    // A frame host's executable has a generic icon; use the Store app's Shell entry.
    if path
        .file_stem()?
        .to_string_lossy()
        .eq_ignore_ascii_case("ApplicationFrameHost")
    {
        return None;
    }
    shell_image(&path.to_string_lossy())
}

fn shell_image(target: &str) -> Option<RgbaImage> {
    let wide: Vec<u16> = target.encode_utf16().chain(Some(0)).collect();
    let factory: IShellItemImageFactory =
        unsafe { SHCreateItemFromParsingName(PCWSTR(wide.as_ptr()), None).ok()? };
    let bitmap = unsafe {
        factory
            .GetImage(SIZE { cx: 48, cy: 48 }, SIIGBF_ICONONLY)
            .ok()?
    };
    let image = bitmap_image(bitmap);
    unsafe {
        let _ = DeleteObject(bitmap.into());
    }
    image
}

fn installed_apps() -> Result<Vec<InstalledApp>> {
    let folder: IShellItem =
        unsafe { SHGetKnownFolderItem(&FOLDERID_AppsFolder, KF_FLAG_DEFAULT, None)? };
    let items: IEnumShellItems = unsafe { folder.BindToHandler(None, &BHID_EnumItems)? };
    let mut apps = Vec::new();
    loop {
        let mut item = [None];
        let mut fetched = 0;
        unsafe { items.Next(&mut item, Some(&mut fetched))? };
        if fetched == 0 {
            break;
        }
        if let Some(item) = item[0].take() {
            if let (Some(name), Some(target)) = (
                display_name(&item, SIGDN_NORMALDISPLAY),
                display_name(&item, SIGDN_DESKTOPABSOLUTEPARSING),
            ) {
                // AppsFolder supplies application IDs (e.g. "Chrome"), which
                // need their namespace when reopened on another worker thread.
                let target =
                    if target.starts_with("::{") || std::path::Path::new(&target).is_absolute() {
                        target
                    } else {
                        format!("shell:AppsFolder\\{target}")
                    };
                apps.push(InstalledApp { name, target });
            }
        }
    }
    Ok(apps)
}

fn display_name(item: &IShellItem, kind: SIGDN) -> Option<String> {
    let text = unsafe { item.GetDisplayName(kind).ok()? };
    let result = unsafe { text.to_string().ok() };
    unsafe { CoTaskMemFree(Some(text.0.cast())) };
    result
}

fn bitmap_image(bitmap: HBITMAP) -> Option<RgbaImage> {
    let mut details = BITMAP::default();
    let read = unsafe {
        GetObjectW(
            bitmap.into(),
            size_of::<BITMAP>() as i32,
            Some((&mut details as *mut BITMAP).cast()),
        )
    };
    if read == 0
        || details.bmWidth <= 0
        || details.bmWidth > 512
        || details.bmHeight <= 0
        || details.bmHeight > 512
    {
        return None;
    }
    let (width, height) = (details.bmWidth as u32, details.bmHeight as u32);
    let mut info = BITMAPINFO {
        bmiHeader: BITMAPINFOHEADER {
            biSize: size_of::<BITMAPINFOHEADER>() as u32,
            biWidth: width as i32,
            biHeight: -(height as i32),
            biPlanes: 1,
            biBitCount: 32,
            biCompression: BI_RGB.0,
            ..Default::default()
        },
        ..Default::default()
    };
    let mut pixels = vec![0u8; (width * height * 4) as usize];
    let dc = unsafe { GetDC(None) };
    if dc.is_invalid() {
        return None;
    }
    let lines = unsafe {
        GetDIBits(
            dc,
            bitmap,
            0,
            height,
            Some(pixels.as_mut_ptr().cast()),
            &mut info,
            DIB_RGB_COLORS,
        )
    };
    unsafe { ReleaseDC(None, dc) };
    if lines != height as i32 {
        return None;
    }
    unpremultiply_bgra(&mut pixels);
    RgbaImage::from_raw(width, height, pixels)
}

fn unpremultiply_bgra(pixels: &mut [u8]) {
    let has_alpha = pixels.chunks_exact(4).any(|p| p[3] != 0);
    for pixel in pixels.chunks_exact_mut(4) {
        pixel.swap(0, 2);
        if !has_alpha {
            pixel[3] = 255;
        }
        let alpha = u32::from(pixel[3]);
        if alpha > 0 && alpha < 255 {
            for channel in &mut pixel[..3] {
                *channel = ((u32::from(*channel) * 255 + alpha / 2) / alpha).min(255) as u8;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn icon_urls_accept_unicode_and_reject_invalid_input() {
        assert_eq!(name_from_url("565320436f6465").as_deref(), Some("VS Code"));
        assert_eq!(name_from_url("d0a2d0b5d181d182").as_deref(), Some("Тест"));
        for invalid in ["", "0", "zz", "ff", "/../"] {
            assert!(name_from_url(invalid).is_none());
        }
    }

    #[test]
    fn native_pixels_keep_transparency_and_correct_colours() {
        let mut pixels = [25, 50, 100, 128, 0, 0, 0, 0];
        unpremultiply_bgra(&mut pixels);
        assert_eq!(pixels, [199, 100, 50, 128, 0, 0, 0, 0]);
        let mut opaque = [10, 20, 30, 0];
        unpremultiply_bgra(&mut opaque);
        assert_eq!(opaque, [30, 20, 10, 255]);
    }

    #[test]
    fn installed_apps_supply_icons_without_running_windows() {
        let _com = ComApartment::new().unwrap();
        let apps = installed_apps().unwrap();
        assert!(!apps.is_empty());
        let cache = AppIcons::new(PathBuf::new());
        let mut checked = 0;
        for name in ["Telegram", "Chrome", "Claude", "VS Code"] {
            if apps.iter().any(|app| {
                let display = normalized(&app.name);
                display.ends_with(&normalized(name)) || display.starts_with(&normalized(name))
            }) {
                let image = cache
                    .installed_image(name)
                    .unwrap_or_else(|| panic!("missing installed icon for {name}"));
                assert!(image.pixels().any(|p| p[3] > 0), "blank icon for {name}");
                checked += 1;
                println!(
                    "{name}: {}x{} native installed icon",
                    image.width(),
                    image.height()
                );
            }
        }
        // CI may have none of these apps installed; the first Shell entry still
        // exercises the installed-app image factory without any open windows.
        if checked == 0 {
            assert!(apps.iter().any(|app| shell_image(&app.target).is_some()));
        }
    }

    #[test]
    fn extracts_and_reuses_native_icons_without_an_open_app() {
        let dir = std::env::temp_dir().join(format!("shot-icons-{}", uuid::Uuid::new_v4()));
        let cache = AppIcons::new(dir.clone());
        for name in ["Desktop", "Explorer"] {
            let png = cache.load(name).unwrap();
            let image = image::load_from_memory(&png).unwrap().into_rgba8();
            assert!(image.width() > 0 && image.height() > 0);
            assert!(image.pixels().any(|p| p[3] > 0));
            assert_eq!(png, AppIcons::new(dir.clone()).load(name).unwrap());
        }
        assert!(
            cache
                .load("AlgorithShot nonexistent test app 293847")
                .is_err()
        );
        for name in ["Desktop", "Explorer"] {
            std::fs::remove_file(dir.join(format!("{}.png", cache_key(name)))).unwrap();
        }
        std::fs::remove_dir(dir).unwrap();
    }
}
