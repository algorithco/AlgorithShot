//! Thin wrappers over the Win32 calls the app needs: monitors, top-level
//! windows, the cursor and a few window-style tweaks.

use serde::{Deserialize, Serialize};
use windows::core::{BOOL, PWSTR};
use windows::Win32::Foundation::{CloseHandle, HWND, LPARAM, POINT, RECT};
use windows::Win32::Graphics::Dwm::{
    DwmGetWindowAttribute, DwmSetWindowAttribute, DWMWA_CLOAKED, DWMWA_EXTENDED_FRAME_BOUNDS,
    DWMWA_TRANSITIONS_FORCEDISABLED,
};
use windows::Win32::Graphics::Gdi::{
    EnumDisplayMonitors, GetMonitorInfoW, HDC, HMONITOR, MONITORINFO, MONITORINFOEXW,
};
use windows::Win32::System::Threading::{
    GetCurrentProcessId, OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32,
    PROCESS_QUERY_LIMITED_INFORMATION,
};
use windows::Win32::UI::HiDpi::{GetDpiForMonitor, MDT_EFFECTIVE_DPI};
use windows::Win32::UI::WindowsAndMessaging::{
    EnumWindows, GetClassNameW, GetCursorPos, GetForegroundWindow, GetWindowLongPtrW,
    GetWindowRect, GetWindowTextW, GetWindowThreadProcessId, IsIconic, IsWindowVisible,
    SetForegroundWindow, SetWindowPos, ShowWindow, GWL_EXSTYLE, HWND_TOPMOST, SWP_NOACTIVATE,
    SWP_NOMOVE, SWP_NOSIZE, SWP_SHOWWINDOW, SW_RESTORE, SW_SHOWNOACTIVATE, WS_EX_LAYERED,
    WS_EX_TRANSPARENT,
};

/// A rectangle in physical pixels.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
pub struct Rect {
    pub x: i32,
    pub y: i32,
    pub w: i32,
    pub h: i32,
}

impl Rect {
    pub fn new(x: i32, y: i32, w: i32, h: i32) -> Self {
        Self { x, y, w, h }
    }

    pub fn from_win(r: RECT) -> Self {
        Self::new(r.left, r.top, r.right - r.left, r.bottom - r.top)
    }

    pub fn right(&self) -> i32 {
        self.x + self.w
    }

    pub fn bottom(&self) -> i32 {
        self.y + self.h
    }

    pub fn contains(&self, px: i32, py: i32) -> bool {
        px >= self.x && py >= self.y && px < self.right() && py < self.bottom()
    }

    pub fn intersect(&self, o: &Rect) -> Option<Rect> {
        let x = self.x.max(o.x);
        let y = self.y.max(o.y);
        let r = self.right().min(o.right());
        let b = self.bottom().min(o.bottom());
        (r > x && b > y).then(|| Rect::new(x, y, r - x, b - y))
    }

    pub fn offset(&self, dx: i32, dy: i32) -> Rect {
        Rect::new(self.x + dx, self.y + dy, self.w, self.h)
    }

    pub fn area(&self) -> i64 {
        self.w.max(0) as i64 * self.h.max(0) as i64
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MonitorInfo {
    pub id: usize,
    pub name: String,
    pub rect: Rect,
    pub work: Rect,
    pub scale: f64,
    pub primary: bool,
}

/// All monitors, primary first, with physical bounds and scale factor.
pub fn monitors() -> Vec<MonitorInfo> {
    unsafe extern "system" fn collect(h: HMONITOR, _: HDC, _: *mut RECT, data: LPARAM) -> BOOL {
        let list = unsafe { &mut *(data.0 as *mut Vec<HMONITOR>) };
        list.push(h);
        true.into()
    }

    let mut handles: Vec<HMONITOR> = Vec::new();
    unsafe {
        let _ = EnumDisplayMonitors(None, None, Some(collect), LPARAM(&mut handles as *mut _ as isize));
    }

    let mut out: Vec<MonitorInfo> = handles
        .into_iter()
        .filter_map(|h| {
            let mut info = MONITORINFOEXW::default();
            info.monitorInfo.cbSize = std::mem::size_of::<MONITORINFOEXW>() as u32;
            let ok = unsafe { GetMonitorInfoW(h, &mut info as *mut _ as *mut MONITORINFO) };
            if !ok.as_bool() {
                return None;
            }
            let (mut dpi_x, mut dpi_y) = (96u32, 96u32);
            let _ = unsafe { GetDpiForMonitor(h, MDT_EFFECTIVE_DPI, &mut dpi_x, &mut dpi_y) };
            let name = String::from_utf16_lossy(&info.szDevice);
            Some(MonitorInfo {
                id: 0,
                name: name.trim_end_matches('\0').to_string(),
                rect: Rect::from_win(info.monitorInfo.rcMonitor),
                work: Rect::from_win(info.monitorInfo.rcWork),
                scale: dpi_x as f64 / 96.0,
                primary: info.monitorInfo.dwFlags & 1 != 0, // MONITORINFOF_PRIMARY
            })
        })
        .collect();

    out.sort_by_key(|m| (!m.primary, m.rect.x, m.rect.y));
    for (i, m) in out.iter_mut().enumerate() {
        m.id = i;
    }
    out
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowInfo {
    pub hwnd: isize,
    pub rect: Rect,
    pub title: String,
    pub app: String,
    pub class: String,
}

/// Visible top-level windows of other processes, front to back.
pub fn visible_windows() -> Vec<WindowInfo> {
    unsafe extern "system" fn collect(hwnd: HWND, data: LPARAM) -> BOOL {
        let list = unsafe { &mut *(data.0 as *mut Vec<HWND>) };
        list.push(hwnd);
        true.into()
    }

    let mut hwnds: Vec<HWND> = Vec::new();
    unsafe {
        let _ = EnumWindows(Some(collect), LPARAM(&mut hwnds as *mut _ as isize));
    }

    let me = unsafe { GetCurrentProcessId() };
    let mut out = Vec::new();
    for hwnd in hwnds {
        unsafe {
            if !IsWindowVisible(hwnd).as_bool() || IsIconic(hwnd).as_bool() || is_cloaked(hwnd) {
                continue;
            }
            let mut pid = 0u32;
            GetWindowThreadProcessId(hwnd, Some(&mut pid));
            if pid == me {
                continue;
            }
            let ex = GetWindowLongPtrW(hwnd, GWL_EXSTYLE) as u32;
            if ex & WS_EX_TRANSPARENT.0 != 0 && ex & WS_EX_LAYERED.0 != 0 {
                continue; // click-through overlays drawn by other apps
            }
            let Some(rect) = frame_rect(hwnd) else { continue };
            if rect.w < 4 || rect.h < 4 {
                continue;
            }
            out.push(WindowInfo {
                hwnd: hwnd.0 as isize,
                rect,
                title: window_text(hwnd),
                app: process_name(pid),
                class: class_name(hwnd),
            });
        }
    }
    out
}

/// The window bounds without the invisible resize border Windows 10/11 adds.
pub fn frame_rect(hwnd: HWND) -> Option<Rect> {
    let mut r = RECT::default();
    let ok = unsafe {
        DwmGetWindowAttribute(
            hwnd,
            DWMWA_EXTENDED_FRAME_BOUNDS,
            &mut r as *mut _ as *mut _,
            std::mem::size_of::<RECT>() as u32,
        )
    }
    .is_ok();
    if !ok {
        unsafe { GetWindowRect(hwnd, &mut r).ok()? };
    }
    Some(Rect::from_win(r))
}

fn is_cloaked(hwnd: HWND) -> bool {
    let mut cloaked: u32 = 0;
    let ok = unsafe {
        DwmGetWindowAttribute(hwnd, DWMWA_CLOAKED, &mut cloaked as *mut _ as *mut _, 4)
    }
    .is_ok();
    ok && cloaked != 0
}

fn window_text(hwnd: HWND) -> String {
    let mut buf = [0u16; 512];
    let n = unsafe { GetWindowTextW(hwnd, &mut buf) };
    String::from_utf16_lossy(&buf[..n.max(0) as usize])
}

fn class_name(hwnd: HWND) -> String {
    let mut buf = [0u16; 256];
    let n = unsafe { GetClassNameW(hwnd, &mut buf) };
    String::from_utf16_lossy(&buf[..n.max(0) as usize])
}

/// The executable name of a process without the `.exe`, e.g. `Telegram`.
pub fn process_name(pid: u32) -> String {
    unsafe {
        let Ok(handle) = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) else {
            return String::new();
        };
        let mut buf = [0u16; 1024];
        let mut len = buf.len() as u32;
        let res = QueryFullProcessImageNameW(handle, PROCESS_NAME_WIN32, PWSTR(buf.as_mut_ptr()), &mut len);
        let _ = CloseHandle(handle);
        if res.is_err() {
            return String::new();
        }
        let path = String::from_utf16_lossy(&buf[..len as usize]);
        std::path::Path::new(&path)
            .file_stem()
            .map(|s| s.to_string_lossy().into_owned())
            .unwrap_or_default()
    }
}

/// A friendly app name for file names and the library, e.g. `msedge` → `Edge`.
pub fn friendly_app_name(exe: &str, title: &str) -> String {
    let known = match exe.to_ascii_lowercase().as_str() {
        "chrome" => "Chrome",
        "msedge" => "Edge",
        "firefox" => "Firefox",
        "opera" | "opera_gx" => "Opera",
        "brave" => "Brave",
        "yandex" | "browser" => "Yandex",
        "telegram" => "Telegram",
        "whatsapp" | "whatsapp.root" => "WhatsApp",
        "code" => "VS Code",
        "explorer" => "Explorer",
        "winword" => "Word",
        "excel" => "Excel",
        "powerpnt" => "PowerPoint",
        "outlook" | "olk" => "Outlook",
        "ms-teams" | "teams" => "Teams",
        "notepad" => "Notepad",
        "slack" => "Slack",
        "discord" => "Discord",
        "zoom" => "Zoom",
        "figma" => "Figma",
        "photoshop" => "Photoshop",
        "windowsterminal" => "Terminal",
        "applicationframehost" => "",
        _ => "",
    };
    if !known.is_empty() {
        return known.to_string();
    }
    if exe.eq_ignore_ascii_case("applicationframehost") || exe.is_empty() {
        // Store apps run inside a frame host; the title is the best name we have.
        return title.rsplit(" - ").next().unwrap_or(title).trim().to_string();
    }
    let mut chars = exe.chars();
    match chars.next() {
        Some(c) => c.to_uppercase().collect::<String>() + chars.as_str(),
        None => String::new(),
    }
}

pub fn cursor_pos() -> (i32, i32) {
    let mut p = POINT::default();
    unsafe {
        let _ = GetCursorPos(&mut p);
    }
    (p.x, p.y)
}

pub fn foreground_window() -> isize {
    unsafe { GetForegroundWindow().0 as isize }
}

/// Stops Windows from fading the window in and out, so overlays appear at once.
pub fn disable_transitions(hwnd: isize) {
    let disabled: BOOL = true.into();
    unsafe {
        let _ = DwmSetWindowAttribute(
            HWND(hwnd as _),
            DWMWA_TRANSITIONS_FORCEDISABLED,
            &disabled as *const _ as *const _,
            std::mem::size_of::<BOOL>() as u32,
        );
    }
}

/// Shows a window on top without taking focus from the app the user is in.
pub fn show_topmost_no_activate(hwnd: isize) {
    unsafe {
        let hwnd = HWND(hwnd as _);
        let _ = ShowWindow(hwnd, SW_SHOWNOACTIVATE);
        let _ = SetWindowPos(
            hwnd,
            Some(HWND_TOPMOST),
            0,
            0,
            0,
            0,
            SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_SHOWWINDOW,
        );
    }
}

/// Brings the first visible window of `exe` to the front. Returns false if
/// the app isn't running.
pub fn focus_app(exe: &str) -> bool {
    let Some(target) = visible_windows()
        .into_iter()
        .find(|w| w.app.eq_ignore_ascii_case(exe) && !w.title.is_empty())
    else {
        return false;
    };
    unsafe {
        let hwnd = HWND(target.hwnd as _);
        if IsIconic(hwnd).as_bool() {
            let _ = ShowWindow(hwnd, SW_RESTORE);
        }
        SetForegroundWindow(hwnd).as_bool()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rect_intersection() {
        let a = Rect::new(0, 0, 100, 100);
        let b = Rect::new(50, 60, 100, 100);
        assert_eq!(a.intersect(&b), Some(Rect::new(50, 60, 50, 40)));
        assert_eq!(a.intersect(&Rect::new(100, 0, 10, 10)), None);
        assert!(a.contains(99, 99));
        assert!(!a.contains(100, 50));
    }

    #[test]
    fn app_names() {
        assert_eq!(friendly_app_name("msedge", "x"), "Edge");
        assert_eq!(friendly_app_name("Telegram", ""), "Telegram");
        assert_eq!(friendly_app_name("myapp", ""), "Myapp");
        assert_eq!(friendly_app_name("ApplicationFrameHost", "Calculator"), "Calculator");
    }
}
