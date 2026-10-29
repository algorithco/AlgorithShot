//! Global hotkeys, registered from the settings. A key another app already
//! owns fails to register; the status is kept so Settings can say so.
//!
//! Plain Print Screen is special: Windows hands it to the Snipping Tool
//! before any registered hotkey sees it. So when it's bound, a low-level
//! keyboard hook takes it first. The hook only looks at Print Screen; every
//! other key passes straight through untouched.

use parking_lot::Mutex;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{channel, Sender};
use std::sync::OnceLock;
use std::time::Duration;
use tauri::{AppHandle, Emitter};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};
use windows::Win32::Foundation::{HINSTANCE, LPARAM, LRESULT, WPARAM};
use windows::Win32::System::LibraryLoader::GetModuleHandleW;
use windows::Win32::UI::Input::KeyboardAndMouse::{GetAsyncKeyState, VK_CONTROL, VK_LWIN, VK_MENU, VK_RWIN, VK_SHIFT, VK_SNAPSHOT};
use windows::Win32::UI::WindowsAndMessaging::{
    CallNextHookEx, GetMessageW, SetWindowsHookExW, KBDLLHOOKSTRUCT, MSG, WH_KEYBOARD_LL, WM_KEYDOWN, WM_SYSKEYDOWN,
};

use crate::state::{state, HotkeyStatus};
use crate::{capture, wm};

enum HookEvent {
    /// Plain Print Screen was pressed and is bound to this action.
    Run(&'static str),
    /// Settings is recording a key; this is what was pressed.
    Record(String),
}

/// The action bound to plain Print Screen, if any.
static PRINT_SCREEN: Mutex<Option<&'static str>> = Mutex::new(None);
/// Settings is recording a new hotkey: Print Screen goes to it instead.
static RECORDING: AtomicBool = AtomicBool::new(false);
/// Whether the keyboard hook started (set once).
static HOOK_OK: OnceLock<bool> = OnceLock::new();
/// Where the hook sends what it saw.
static SENDER: OnceLock<Sender<HookEvent>> = OnceLock::new();

pub fn register_all(app: &AppHandle) -> Vec<HotkeyStatus> {
    let gs = app.global_shortcut();
    let _ = gs.unregister_all();
    let hotkeys = state(app).settings().hotkeys;
    let mut status = Vec::new();
    let mut print_screen = None;
    for (action, key) in hotkeys.bindings() {
        if key.eq_ignore_ascii_case("PrintScreen") && hook_running(app) {
            print_screen = Some(action);
            status.push(HotkeyStatus { action: action.to_string(), key: key.to_string(), ok: true, error: None, trigger: None });
            continue;
        }
        let res = gs.on_shortcut(key, move |app, _shortcut, event| {
            if event.state == ShortcutState::Pressed {
                run(app, action);
            }
        });
        if let Err(e) = &res {
            log::warn!("hotkey {key} for {action}: {e}");
        }
        status.push(HotkeyStatus {
            action: action.to_string(),
            key: key.to_string(),
            ok: res.is_ok(),
            error: res.err().map(|e| e.to_string()),
            trigger: None,
        });
    }
    *PRINT_SCREEN.lock() = print_screen;
    *state(app).hotkeys.lock() = status.clone();
    status
}

/// While Settings records a key: hotkeys off, and Print Screen is reported
/// to the page (which can't see it otherwise).
pub fn set_recording(app: &AppHandle, on: bool) -> Vec<HotkeyStatus> {
    RECORDING.store(on, Ordering::SeqCst);
    if on {
        hook_running(app);
        let _ = app.global_shortcut().unregister_all();
        *PRINT_SCREEN.lock() = None;
        Vec::new()
    } else {
        register_all(app)
    }
}

pub fn run(app: &AppHandle, action: &str) {
    match action {
        "capture" => capture::start(app, "region"),
        "text" => capture::start(app, "text"),
        "qr" => capture::start(app, "qr"),
        "screen" => capture::start(app, "screen"),
        "repeat" => {
            let app = app.clone();
            std::thread::spawn(move || {
                if let Err(e) = capture::repeat_last(&app) {
                    log::warn!("repeat: {e:#}");
                }
            });
        }
        "library" => {
            let app = app.clone();
            std::thread::spawn(move || {
                let _ = wm::show_main(&app, Some("library"));
            });
        }
        _ => {}
    }
}

/// Starts the keyboard hook once. Returns false if Windows refused it.
fn hook_running(app: &AppHandle) -> bool {
    *HOOK_OK.get_or_init(|| start_hook(app.clone()))
}

fn start_hook(app: AppHandle) -> bool {
    let (tx, rx) = channel::<HookEvent>();
    // Events are handled here, never inside the hook, which must return fast.
    let events = std::thread::Builder::new().name("hotkey-events".into()).spawn(move || {
        for event in rx {
            match event {
                HookEvent::Run(action) => run(&app, action),
                HookEvent::Record(key) => {
                    let _ = app.emit("hotkey:record", key);
                }
            }
        }
    });
    if events.is_err() || SENDER.set(tx).is_err() {
        return false;
    }
    install_hook()
}

/// Installs the hook on its own thread and waits until Windows answers.
fn install_hook() -> bool {
    let (ready_tx, ready_rx) = channel::<bool>();
    let spawned = std::thread::Builder::new().name("keyboard-hook".into()).spawn(move || unsafe {
        let module = GetModuleHandleW(None).ok().map(|m| HINSTANCE(m.0));
        let hook = SetWindowsHookExW(WH_KEYBOARD_LL, Some(keyboard_proc), module, 0);
        let _ = ready_tx.send(hook.is_ok());
        if hook.is_err() {
            return;
        }
        // The hook is called through this thread's message loop.
        let mut msg = MSG::default();
        while GetMessageW(&mut msg, None, 0, 0).as_bool() {}
    });
    if spawned.is_err() {
        return false;
    }

    let ok = ready_rx.recv_timeout(Duration::from_secs(2)).unwrap_or(false);
    if !ok {
        log::warn!("keyboard hook refused; Print Screen falls back to a normal hotkey");
    }
    ok
}

fn down(vk: u16) -> bool {
    unsafe { (GetAsyncKeyState(vk as i32) as u16) & 0x8000 != 0 }
}

/// "Ctrl+Shift+PrintScreen" etc. for the keys held right now.
fn combo() -> String {
    let mut parts: Vec<&str> = Vec::new();
    if down(VK_CONTROL.0) {
        parts.push("Ctrl");
    }
    if down(VK_MENU.0) {
        parts.push("Alt");
    }
    if down(VK_SHIFT.0) {
        parts.push("Shift");
    }
    if down(VK_LWIN.0) || down(VK_RWIN.0) {
        parts.push("Super");
    }
    parts.push("PrintScreen");
    parts.join("+")
}

unsafe extern "system" fn keyboard_proc(code: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    if code >= 0 {
        let info = unsafe { &*(lparam.0 as *const KBDLLHOOKSTRUCT) };
        if info.vkCode == VK_SNAPSHOT.0 as u32 {
            let pressed = wparam.0 as u32 == WM_KEYDOWN || wparam.0 as u32 == WM_SYSKEYDOWN;
            if RECORDING.load(Ordering::Relaxed) {
                if pressed {
                    if let Some(tx) = SENDER.get() {
                        let _ = tx.send(HookEvent::Record(combo()));
                    }
                }
                return LRESULT(1); // swallowed: the Snipping Tool doesn't open
            }
            let action = *PRINT_SCREEN.lock();
            if let Some(action) = action {
                if combo() == "PrintScreen" {
                    if pressed {
                        if let Some(tx) = SENDER.get() {
                            let _ = tx.send(HookEvent::Run(action));
                        }
                    }
                    return LRESULT(1);
                }
            }
        }
    }
    unsafe { CallNextHookEx(None, code, wparam, lparam) }
}

/// True when Windows gives Print Screen to the Snipping Tool.
pub fn print_screen_taken_by_windows() -> bool {
    use windows::core::w;
    use windows::Win32::System::Registry::{RegGetValueW, HKEY_CURRENT_USER, RRF_RT_REG_DWORD};
    let mut value: u32 = 0;
    let mut size = std::mem::size_of::<u32>() as u32;
    let res = unsafe {
        RegGetValueW(
            HKEY_CURRENT_USER,
            w!("Control Panel\\Keyboard"),
            w!("PrintScreenKeyForSnippingEnabled"),
            RRF_RT_REG_DWORD,
            None,
            Some(&mut value as *mut _ as *mut _),
            Some(&mut size),
        )
    };
    // On current Windows 11 the setting is on unless the user turned it off.
    if res.is_err() { true } else { value != 0 }
}

/// Print Screen is bound but still goes to the Snipping Tool: only when the
/// keyboard hook couldn't start.
pub fn print_screen_blocked(app: &AppHandle) -> bool {
    let bound = state(app).settings().hotkeys.bindings().iter().any(|(_, k)| k.eq_ignore_ascii_case("PrintScreen"));
    bound && HOOK_OK.get() != Some(&true) && print_screen_taken_by_windows()
}

#[cfg(test)]
mod tests {
    use super::*;
    use windows::Win32::UI::Input::KeyboardAndMouse::{keybd_event, KEYEVENTF_KEYUP};

    /// Presses Print Screen for real, so it's not run by default:
    /// `cargo test --lib print_screen -- --ignored`.
    #[test]
    #[ignore]
    fn print_screen_goes_to_the_hook_not_snipping_tool() {
        let (tx, rx) = channel();
        SENDER.set(tx).ok();
        *PRINT_SCREEN.lock() = Some("capture");
        assert!(install_hook(), "Windows refused the keyboard hook");
        unsafe {
            keybd_event(VK_SNAPSHOT.0 as u8, 0, Default::default(), 0);
            keybd_event(VK_SNAPSHOT.0 as u8, 0, KEYEVENTF_KEYUP, 0);
        }
        match rx.recv_timeout(Duration::from_secs(2)) {
            Ok(HookEvent::Run(action)) => assert_eq!(action, "capture"),
            _ => panic!("the hook did not see Print Screen"),
        }
    }
}
