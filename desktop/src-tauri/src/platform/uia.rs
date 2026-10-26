//! Bounded accessibility queries using macOS AX and Linux AT-SPI.

use serde::Serialize;
use std::{sync::{OnceLock, mpsc::{Sender, channel}}, time::Duration};
use crate::win::Rect;

#[cfg(target_os = "macos")]
#[path = "uia_macos.rs"]
mod native;
#[cfg(target_os = "linux")]
#[path = "uia_linux.rs"]
mod native;

#[derive(Debug, Clone, Serialize)]
pub struct Element { pub rect: Rect, pub name: String }

enum Request {
    Elements(isize, i32, i32, Sender<Vec<Element>>),
    Url(isize, Sender<Option<String>>),
}

fn worker() -> &'static Sender<Request> {
    static WORKER: OnceLock<Sender<Request>> = OnceLock::new();
    WORKER.get_or_init(|| {
        let (sender, receiver) = channel();
        std::thread::Builder::new().name("accessibility".into()).spawn(move || {
            native::init();
            for request in receiver {
                match request {
                    Request::Elements(window, x, y, reply) => { let _ = reply.send(native::elements_at(window, x, y)); }
                    Request::Url(window, reply) => { let _ = reply.send(native::browser_url(window)); }
                }
            }
        }).expect("start accessibility worker");
        sender
    })
}

pub fn elements_at(window: isize, x: i32, y: i32, timeout: Duration) -> Vec<Element> {
    let (sender, receiver) = channel();
    if worker().send(Request::Elements(window, x, y, sender)).is_err() { return Vec::new(); }
    receiver.recv_timeout(timeout).unwrap_or_default()
}

pub fn browser_url(window: isize, timeout: Duration) -> Option<String> {
    let (sender, receiver) = channel();
    worker().send(Request::Url(window, sender)).ok()?;
    receiver.recv_timeout(timeout).ok().flatten()
}

pub fn is_browser(name: &str) -> bool {
    matches!(name.to_ascii_lowercase().as_str(), "chrome" | "google chrome" | "google-chrome" | "chromium" | "chromium-browser"
        | "microsoft edge" | "msedge" | "firefox" | "safari" | "opera" | "opera_gx" | "brave" | "brave browser" | "browser" | "vivaldi" | "yandex")
}

fn normalize_url(text: &str) -> Option<String> {
    let value = text.trim();
    if value.is_empty() || value.len() > 4096 || value.chars().any(char::is_whitespace) { return None; }
    if value.starts_with("https://") || value.starts_with("http://") { Some(value.into()) }
    else if value.contains('.') && !value.contains(':') { Some(format!("https://{value}")) }
    else { None }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn addresses_are_separate_from_search_queries() {
        assert_eq!(normalize_url("example.com/path"), Some("https://example.com/path".into()));
        assert!(normalize_url("search for example.com").is_none());
        assert!(normalize_url("javascript:example.com").is_none());
    }
}
