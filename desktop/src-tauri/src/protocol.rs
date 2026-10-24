//! The `shot://` protocol (http://shot.localhost on Windows) the pages use
//! to load pixels without going through JSON:
//!
//! - `/frame/{session}/{monitor}` raw RGBA of a frozen monitor
//! - `/thumb/{id}` library thumbnail (WebP)
//! - `/image/{id}` the library file itself
//! - `/original/{id}` the untouched copy of an edited screenshot
//! - `/mem/{id}` an image held in memory (pins, unsaved captures) as PNG
//! - `/app-icon/{hex-name}` a native Windows application icon (PNG)

use std::borrow::Cow;
use tauri::http::{header, Request, Response, StatusCode};
use tauri::{AppHandle, UriSchemeContext, UriSchemeResponder, Wry};

use crate::imaging::{self, Format};
use crate::jobs;
use crate::state::state;

pub fn handle(ctx: UriSchemeContext<'_, Wry>, request: Request<Vec<u8>>, responder: UriSchemeResponder) {
    let app = ctx.app_handle().clone();
    let path = request.uri().path().to_string();
    std::thread::spawn(move || responder.respond(route(&app, &path)));
}

fn route(app: &AppHandle, path: &str) -> Response<Cow<'static, [u8]>> {
    let parts: Vec<&str> = path.trim_matches('/').split('/').collect();
    let st = state(app);
    match parts.as_slice() {
        ["app-icon", name] => match crate::app_icons::name_from_url(name)
            .and_then(|name| st.app_icons.load(&name).ok()) {
            Some(png) => ok("image/png", png, false),
            None => not_found(),
        },
        ["frame", session, monitor] => {
            let (Ok(session), Ok(monitor)) = (session.parse::<u64>(), monitor.parse::<usize>()) else {
                return not_found();
            };
            match st.capture.frame(session, monitor) {
                Some((_, rgba)) => ok("application/octet-stream", rgba.as_ref().clone(), false),
                None => not_found(),
            }
        }
        ["thumb", id] => {
            let path = jobs::thumb_path(app, id);
            let path = if path.exists() { Some(path) } else { jobs::make_thumb(app, id).ok() };
            match path.and_then(|p| std::fs::read(p).ok()) {
                Some(data) => ok("image/webp", data, true),
                None => not_found(),
            }
        }
        ["image", id] => match st.library.get(id).ok().flatten() {
            Some(shot) => file(&shot.path),
            None => not_found(),
        },
        ["original", id] => match crate::shots::original_path(app, id) {
            Some(p) => file(&p.to_string_lossy()),
            None => not_found(),
        },
        ["mem", id] => match st.image(id).and_then(|img| imaging::encode(&img, Format::Png, 100).ok()) {
            Some(png) => ok("image/png", png, false),
            None => not_found(),
        },
        _ => not_found(),
    }
}

fn file(path: &str) -> Response<Cow<'static, [u8]>> {
    match std::fs::read(path) {
        Ok(data) => ok(Format::from_path(std::path::Path::new(path)).mime(), data, false),
        Err(_) => not_found(),
    }
}

fn ok(mime: &str, body: Vec<u8>, cache: bool) -> Response<Cow<'static, [u8]>> {
    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, mime)
        .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
        // Thumbnail URLs carry ?v=rev, so they can be cached; the rest can't.
        .header(header::CACHE_CONTROL, if cache { "max-age=31536000, immutable" } else { "no-store" })
        .body(Cow::Owned(body))
        .expect("valid response")
}

fn not_found() -> Response<Cow<'static, [u8]>> {
    Response::builder()
        .status(StatusCode::NOT_FOUND)
        .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
        .body(Cow::Borrowed(&[][..]))
        .expect("valid response")
}
