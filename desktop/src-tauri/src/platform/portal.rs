//! Native Wayland capture and shortcuts, without an X11/XWayland connection.

use anyhow::{Context, Result, anyhow, bail};
use image::RgbaImage;
use parking_lot::Mutex;
use serde::Serialize;
use std::{collections::HashMap, sync::{LazyLock, atomic::{AtomicBool, AtomicU64, Ordering}, mpsc}, time::Duration};
use tauri::{AppHandle, Emitter};
use zbus::{blocking::{Connection, MessageIterator, Proxy, connection::Builder}, MatchRule,
    zvariant::{DynamicType, OwnedObjectPath, OwnedValue, Value}};
use crate::state::{HotkeyStatus, state};

const DESKTOP: &str = "org.freedesktop.portal.Desktop";
const DESKTOP_PATH: &str = "/org/freedesktop/portal/desktop";
const SHORTCUTS: &str = "org.freedesktop.portal.GlobalShortcuts";
type Values = HashMap<String, OwnedValue>;
type BoundShortcuts = Vec<(String, Values)>;

pub fn is_wayland() -> bool {
    std::env::var("XDG_SESSION_TYPE").is_ok_and(|s| s.eq_ignore_ascii_case("wayland"))
        || std::env::var_os("WAYLAND_DISPLAY").is_some_and(|s| !s.is_empty())
}

fn connection() -> Result<Connection> {
    Builder::session()?.method_timeout(Duration::from_secs(10)).build()
        .context("The desktop service is unavailable. Start a desktop session and retry.")
}

fn token() -> String { format!("algorithshot_{}", uuid::Uuid::new_v4().simple()) }

/// Subscribe before the method call so an immediate response cannot be lost.
/// Filter by the returned path, including portals that do not use handle_token.
fn request<B: Serialize + DynamicType>(connection: &Connection, proxy: &Proxy<'_>, method: &str, body: &B)
    -> Result<Option<Values>>
{
    request_with_timeout(connection, proxy, method, body, Duration::from_secs(120))
}

fn request_with_timeout<B: Serialize + DynamicType>(connection: &Connection, proxy: &Proxy<'_>, method: &str,
    body: &B, timeout: Duration) -> Result<Option<Values>>
{
    let rule = MatchRule::builder().msg_type(zbus::message::Type::Signal).sender(DESKTOP)?
        .interface("org.freedesktop.portal.Request")?.member("Response")?.build();
    let mut messages = MessageIterator::for_match_rule(rule, connection, Some(16))?;
    let path: OwnedObjectPath = proxy.call_method(method, body)?.body().deserialize()?;
    let expected = path.clone();
    let (sender, receiver) = mpsc::channel();
    std::thread::spawn(move || {
        let result = (|| -> Result<Option<Values>> {
            for message in &mut messages {
                let message = message?;
                if message.header().path().is_none_or(|p| p.as_str() != expected.as_str()) { continue; }
                let (code, values): (u32, Values) = message.body().deserialize()?;
                return match code {
                    0 => Ok(Some(values)),
                    1 => Ok(None), // User cancellation is not a capture failure.
                    _ => Err(anyhow!("The desktop could not complete the request. Please retry.")),
                };
            }
            bail!("The desktop service disconnected. Please retry.")
        })();
        let _ = sender.send(result);
    });
    match receiver.recv_timeout(timeout) {
        Ok(result) => result,
        Err(_) => {
            if let Ok(request) = Proxy::new(connection, DESKTOP, path.as_str(), "org.freedesktop.portal.Request") {
                let _ = request.call_method("Close", &());
            }
            // End the blocked signal reader too; every operation owns its bus connection.
            let _ = connection.clone().close();
            bail!("The desktop request timed out. Please retry and complete the permission dialog.")
        }
    }
}

pub struct Screenshot { pub image: RgbaImage, pub selected: bool }

/// Only v3's advertised target guarantees a native region/window picker.
/// Earlier versions expose an interactive hint; selection stays in our UI.
fn capture_options<'a>(mode: &str, version: u32, available: u32, handle: &'a str) -> (HashMap<&'static str, Value<'a>>, bool) {
    let requested = match mode { "window" => 2u32, "region" | "text" | "qr" => 4, _ => 1 };
    let target = if version >= 3 && available & requested != 0 { Some(requested) }
        else if version >= 3 && available & 1 != 0 { Some(1) } else { None };
    let selected = target.is_some_and(|t| t == 2 || t == 4);
    let mut options = HashMap::from([
        ("handle_token", Value::from(handle)),
        ("interactive", Value::from(selected)),
        ("modal", Value::from(false)),
    ]);
    if let Some(target) = target { options.insert("target", Value::from(target)); }
    (options, selected)
}

pub fn screenshot(mode: &str) -> Result<Option<Screenshot>> {
    let connection = connection()?;
    capture_on(&connection, mode)
}

fn capture_on(connection: &Connection, mode: &str) -> Result<Option<Screenshot>> {
    let proxy = Proxy::new(connection, DESKTOP, DESKTOP_PATH, "org.freedesktop.portal.Screenshot")
        .context("Screen capture is unavailable. Install the screenshot portal for your desktop.")?;
    let handle = token();
    let version = proxy.get_property::<u32>("version").unwrap_or(1);
    let available = if version >= 3 { proxy.get_property::<u32>("AvailableTargets").unwrap_or(0) } else { 0 };
    let (options, selected) = capture_options(mode, version, available, &handle);
    let Some(mut result) = request(connection, &proxy, "Screenshot", &("", options))? else { return Ok(None); };
    let uri = String::try_from(result.remove("uri").context("The desktop returned no captured image")?)?;
    let path = tauri::Url::parse(&uri)?.to_file_path().map_err(|_| anyhow!("The desktop returned an invalid image location"))?;
    // The portal owns this file. Never remove a path returned by another process.
    Ok(Some(Screenshot { image: crate::shots::load_rgba(&path)?, selected }))
}

static SHORTCUT_CONNECTION: LazyLock<Mutex<Option<(u64, Connection)>>> = LazyLock::new(|| Mutex::new(None));
static SHORTCUT_GENERATION: AtomicU64 = AtomicU64::new(0);
static SUSPENDED: AtomicBool = AtomicBool::new(false);

pub fn set_recording(app: &AppHandle, on: bool) -> Vec<HotkeyStatus> {
    SUSPENDED.store(on, Ordering::SeqCst);
    state(app).hotkeys.lock().clone()
}

pub fn register_shortcuts(app: &AppHandle) -> Vec<HotkeyStatus> {
    let generation = SHORTCUT_GENERATION.fetch_add(1, Ordering::SeqCst) + 1;
    if let Some((_, previous)) = SHORTCUT_CONNECTION.lock().take() { let _ = previous.close(); }
    let bindings: Vec<_> = state(app).settings().hotkeys.bindings().into_iter()
        .map(|(action, key)| (action.to_owned(), key.to_owned())).collect();
    let pending: Vec<_> = bindings.iter().map(|(action, key)| HotkeyStatus {
        action: action.clone(), key: key.clone(), ok: false, trigger: None,
        error: Some("Choose the shortcut in your desktop's permission dialog.".into()),
    }).collect();
    *state(app).hotkeys.lock() = pending.clone();
    if bindings.is_empty() { return pending; }
    let app = app.clone();
    std::thread::spawn(move || {
        let result = shortcut_session(&app, &bindings, generation);
        if SHORTCUT_GENERATION.load(Ordering::SeqCst) == generation {
            let connection = {
                let mut current = SHORTCUT_CONNECTION.lock();
                if current.as_ref().is_some_and(|(owner, _)| *owner == generation) { current.take() } else { None }
            };
            if let Some((_, connection)) = connection { let _ = connection.close(); }
            if let Err(error) = result {
                log::warn!("desktop shortcuts: {error:#}");
                publish_shortcuts(&app, &bindings, &[], Some("Your desktop could not enable this shortcut. Use the screenshot button or configure algorithco-shot --capture in desktop Keyboard Settings."));
            }
        }
    });
    pending
}

fn publish_shortcuts(app: &AppHandle, requested: &[(String, String)], actual: &[(String, Values)], error: Option<&str>) {
    let statuses: Vec<_> = requested.iter().enumerate().map(|(i, (action, key))| {
        let binding = actual.iter().find(|(id, _)| id == &shortcut_id(requested, i));
        let trigger = binding.and_then(|(_, properties)| properties.get("trigger_description"))
            .and_then(|value| <&str>::try_from(value).ok()).unwrap_or(key);
        HotkeyStatus { action: action.clone(), key: key.clone(), trigger: binding.map(|_| trigger.into()), ok: binding.is_some(),
            error: binding.is_none().then(|| error.unwrap_or("This shortcut was not enabled by your desktop.").into()) }
    }).collect();
    *state(app).hotkeys.lock() = statuses.clone();
    let _ = app.emit("hotkeys:changed", statuses);
}

fn shortcut_session(app: &AppHandle, bindings: &[(String, String)], generation: u64) -> Result<()> {
    let connection = connection()?;
    {
        let mut current = SHORTCUT_CONNECTION.lock();
        if SHORTCUT_GENERATION.load(Ordering::SeqCst) != generation { return Ok(()); }
        *current = Some((generation, connection.clone()));
    }
    let proxy = Proxy::new(&connection, DESKTOP, DESKTOP_PATH, SHORTCUTS)?;
    proxy.get_property::<u32>("version").context("The desktop does not provide global shortcuts")?;
    let events = MatchRule::builder().msg_type(zbus::message::Type::Signal).sender(DESKTOP)?.build();
    let mut events = MessageIterator::for_match_rule(events, &connection, Some(64))?;
    let (handle, session_token) = (token(), token());
    let options = HashMap::from([("handle_token", Value::from(handle.as_str())),
        ("session_handle_token", Value::from(session_token.as_str()))]);
    let Some(mut session) = request(&connection, &proxy, "CreateSession", &(options,))? else {
        publish_shortcuts(app, bindings, &[], None); return Ok(());
    };
    // The protocol preserves this result's historical string (not object-path) type.
    let session = String::try_from(session.remove("session_handle").context("No shortcut session was created")?)?;
    let session = OwnedObjectPath::try_from(session)?;
    let language = state(app).settings().resolved_language();
    let shortcuts: Vec<_> = bindings.iter().enumerate().map(|(i, (action, key))| {
        let description = crate::i18n::t(&language, action);
        let mut properties = HashMap::from([("description", Value::from(description))]);
        if let Some(trigger) = preferred_trigger(key) { properties.insert("preferred_trigger", Value::from(trigger)); }
        (shortcut_id(bindings, i), properties)
    }).collect();
    let handle = token();
    let options = HashMap::from([("handle_token", Value::from(handle.as_str()))]);
    let Some(mut result) = request(&connection, &proxy, "BindShortcuts", &(&session, shortcuts, "", options))? else {
        publish_shortcuts(app, bindings, &[], None); return Ok(());
    };
    let actual = BoundShortcuts::try_from(result.remove("shortcuts").context("The desktop returned no shortcut bindings")?)?;
    if SHORTCUT_GENERATION.load(Ordering::SeqCst) != generation { return Ok(()); }
    publish_shortcuts(app, bindings, &actual, None);
    for message in &mut events {
        let message = message?;
        if SHORTCUT_GENERATION.load(Ordering::SeqCst) != generation { return Ok(()); }
        let header = message.header();
        match header.member().map(|member| member.as_str()) {
            Some("Activated") if header.interface().is_some_and(|i| i.as_str() == SHORTCUTS) => {
                let (path, id, _, _): (OwnedObjectPath, String, u64, Values) = message.body().deserialize()?;
                if path != session || SUSPENDED.load(Ordering::SeqCst) { continue; }
                if let Some((_, (action, _))) = bindings.iter().enumerate().find(|(i, _)| shortcut_id(bindings, *i) == id) {
                    crate::hotkeys::run(app, action);
                }
            }
            Some("ShortcutsChanged") if header.interface().is_some_and(|i| i.as_str() == SHORTCUTS) => {
                let (path, actual): (OwnedObjectPath, BoundShortcuts) = message.body().deserialize()?;
                if path == session { publish_shortcuts(app, bindings, &actual, None); }
            }
            Some("Closed") if header.path().is_some_and(|p| p.as_str() == session.as_str()) => {
                bail!("The desktop shortcut session was closed")
            }
            _ => {}
        }
    }
    bail!("The desktop shortcut service disconnected")
}

fn shortcut_id(bindings: &[(String, String)], index: usize) -> String {
    let action = &bindings[index].0;
    let ordinal = bindings[..index].iter().filter(|(other, _)| other == action).count();
    format!("{action}-{ordinal}")
}

/// XDG shortcuts use XKB keysyms, rather than browser KeyboardEvent codes.
fn preferred_trigger(shortcut: &str) -> Option<String> {
    let mut parts = shortcut.split('+').peekable();
    let mut result = Vec::new();
    while let Some(part) = parts.next() {
        let key = if parts.peek().is_some() {
            match part { "Ctrl" | "Control" => "CTRL", "Alt" => "ALT", "Shift" => "SHIFT", "Super" | "Meta" => "LOGO", _ => return None }.to_owned()
        } else {
            match part {
                "PrintScreen" => "Print", "ScrollLock" => "Scroll_Lock", "Enter" => "Return",
                "ArrowLeft" => "Left", "ArrowRight" => "Right", "ArrowUp" => "Up", "ArrowDown" => "Down",
                "PageUp" => "Page_Up", "PageDown" => "Page_Down", "Backspace" => "BackSpace", "Space" => "space",
                "CapsLock" => "Caps_Lock", "NumLock" => "Num_Lock",
                "NumpadAdd" => "KP_Add", "NumpadSubtract" => "KP_Subtract", "NumpadMultiply" => "KP_Multiply",
                "NumpadDivide" => "KP_Divide", "NumpadDecimal" => "KP_Decimal", "NumpadEnter" => "KP_Enter",
                "BracketLeft" => "bracketleft", "BracketRight" => "bracketright", "Backslash" => "backslash",
                "Semicolon" => "semicolon", "Quote" => "apostrophe", "Comma" => "comma", "Period" => "period",
                "Slash" => "slash", "Backquote" => "grave", "Minus" => "minus", "Equal" => "equal",
                other => other,
            }.to_owned()
        };
        let key = if let Some(letter) = key.strip_prefix("Key") { letter.to_ascii_lowercase() }
            else if let Some(digit) = key.strip_prefix("Digit") { digit.to_owned() }
            else if let Some(digit) = key.strip_prefix("Numpad").filter(|s| s.len() == 1 && s.bytes().all(|c| c.is_ascii_digit())) { format!("KP_{digit}") }
            else if key.len() == 1 { key.to_ascii_lowercase() } else { key };
        if key.is_empty() || !key.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'_') { return None; }
        result.push(key);
    }
    (!result.is_empty()).then(|| result.join("+"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{io::{BufRead, BufReader}, process::{Child, Command, Stdio}};

    #[test]
    fn selection_does_not_rely_on_an_interactive_hint_from_older_portals() {
        let (legacy, selected) = capture_options("region", 2, 0, "test");
        assert!(!selected);
        assert!(!bool::try_from(legacy.get("interactive").unwrap()).unwrap());
        assert!(!legacy.contains_key("target"));
        let (native, selected) = capture_options("region", 3, 7, "test");
        assert!(selected);
        assert_eq!(u32::try_from(native.get("target").unwrap()).unwrap(), 4);
        let (restricted, selected) = capture_options("window", 3, 1, "test");
        assert!(!selected);
        assert!(!bool::try_from(restricted.get("interactive").unwrap()).unwrap());
        assert_eq!(u32::try_from(restricted.get("target").unwrap()).unwrap(), 1);
        let (tool, selected) = capture_options("color", 3, 7, "test");
        assert!(!selected);
        assert_eq!(u32::try_from(tool.get("target").unwrap()).unwrap(), 1);
    }

    struct Bus(Child, String);
    impl Bus {
        fn new() -> Self {
            let mut child = Command::new("dbus-daemon").args(["--session", "--nofork", "--print-address=1"])
                .stdout(Stdio::piped()).spawn().expect("dbus-daemon is needed for portal tests");
            let mut address = String::new();
            BufReader::new(child.stdout.take().unwrap()).read_line(&mut address).unwrap();
            Self(child, address.trim().to_owned())
        }
        fn connection(&self) -> Connection { Builder::address(self.1.as_str()).unwrap().build().unwrap() }
    }
    impl Drop for Bus { fn drop(&mut self) { let _ = self.0.kill(); let _ = self.0.wait(); } }

    struct ScreenshotPortal { response: u32, respond: bool, version: u32, targets: u32, uri: String }
    #[zbus::interface(name = "org.freedesktop.portal.Screenshot")]
    impl ScreenshotPortal {
        #[zbus(property, name = "version")]
        fn version(&self) -> u32 { self.version }
        #[zbus(property)]
        fn available_targets(&self) -> u32 { self.targets }

        async fn screenshot(&self, _parent: &str, _options: Values, #[zbus(connection)] connection: &zbus::Connection)
            -> zbus::fdo::Result<OwnedObjectPath>
        {
            let path = OwnedObjectPath::try_from("/org/freedesktop/portal/desktop/request/test/returned_path").unwrap();
            if self.respond {
                let values = HashMap::from([("uri".to_owned(), OwnedValue::from(zbus::zvariant::Str::from(self.uri.clone())))]);
                // Deliberately respond before returning the request handle.
                connection.emit_signal(None::<&str>, path.as_str(), "org.freedesktop.portal.Request", "Response", &(self.response, values)).await?;
            }
            Ok(path)
        }
    }

    #[test]
    fn portal_handles_immediate_response_cancellation_and_timeout() {
        for (code, respond) in [(0, true), (1, true), (0, false)] {
            let bus = Bus::new();
            let _server = Builder::address(bus.1.as_str()).unwrap().name(DESKTOP).unwrap()
                .serve_at(DESKTOP_PATH, ScreenshotPortal { response: code, respond, version: 2, targets: 0, uri: "file:///tmp/portal-test.png".into() }).unwrap().build().unwrap();
            let connection = bus.connection();
            let proxy = Proxy::new(&connection, DESKTOP, DESKTOP_PATH, "org.freedesktop.portal.Screenshot").unwrap();
            let result = request_with_timeout(&connection, &proxy, "Screenshot", &("", Values::new()), Duration::from_millis(200));
            if !respond { assert!(result.unwrap_err().to_string().contains("timed out")); }
            else if code == 1 { assert!(result.unwrap().is_none()); }
            else { assert_eq!(String::try_from(result.unwrap().unwrap().remove("uri").unwrap()).unwrap(), "file:///tmp/portal-test.png"); }
        }
    }

    #[test]
    fn portal_decodes_local_image_uris_and_distinguishes_native_from_app_selection() {
        let path = std::env::temp_dir().join(format!("algorithshot portal ёʻ {}.png", uuid::Uuid::new_v4()));
        let expected = RgbaImage::from_pixel(8, 4, image::Rgba([17, 31, 109, 255]));
        expected.save(&path).unwrap();
        let result = (|| -> Result<()> {
            for (version, targets, selected) in [(2, 0, false), (3, 7, true), (3, 1, false)] {
                let bus = Bus::new();
                let _server = Builder::address(bus.1.as_str())?.name(DESKTOP)?
                    .serve_at(DESKTOP_PATH, ScreenshotPortal { response: 0, respond: true, version, targets,
                        uri: tauri::Url::from_file_path(&path).unwrap().to_string() })?.build()?;
                let screenshot = capture_on(&bus.connection(), "region")?.unwrap();
                assert_eq!(screenshot.image, expected);
                assert_eq!(screenshot.selected, selected);
            }
            Ok(())
        })();
        let _ = std::fs::remove_file(&path);
        result.unwrap();
    }

    #[test]
    fn shortcuts_use_xkb_names_and_stable_action_ids() {
        assert_eq!(preferred_trigger("Ctrl+Shift+KeyA").as_deref(), Some("CTRL+SHIFT+a"));
        assert_eq!(preferred_trigger("Ctrl+Alt+Enter").as_deref(), Some("CTRL+ALT+Return"));
        assert_eq!(preferred_trigger("Super+PrintScreen").as_deref(), Some("LOGO+Print"));
        assert_eq!(preferred_trigger("Ctrl+Numpad7").as_deref(), Some("CTRL+KP_7"));
        let first = vec![("capture".into(), "A".into()), ("qr".into(), "Q".into())];
        let second = vec![("capture".into(), "A".into()), ("text".into(), "T".into()), ("qr".into(), "Q".into())];
        assert_eq!(shortcut_id(&first, 1), shortcut_id(&second, 2));
    }
}
