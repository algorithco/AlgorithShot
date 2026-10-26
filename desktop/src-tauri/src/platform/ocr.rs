//! Offline Tesseract WASM service hosted in a hidden, local-only webview.

use anyhow::{Context, Result, anyhow, bail};
use image::RgbaImage;
use parking_lot::{Condvar, Mutex};
use serde::{Deserialize, Serialize};
use std::{collections::HashMap, sync::{OnceLock, mpsc::{Sender, channel}}, time::Duration};
use tauri::{AppHandle, Emitter, Listener, WebviewUrl, WebviewWindowBuilder};

#[path = "../smart/ocr_types.rs"]
mod types;
pub use types::{Line, OcrText, Word, union_text};

struct Service {
    app: AppHandle,
    ready: Mutex<bool>,
    signal: Condvar,
    pending: Mutex<HashMap<String, Sender<std::result::Result<OcrText, String>>>>,
}
static SERVICE: OnceLock<Service> = OnceLock::new();

#[derive(Clone, Serialize)]
struct Request { id: String, png: Vec<u8> }

#[derive(Deserialize)]
struct Response { id: String, result: Option<OcrText>, error: Option<String> }

pub fn init(app: &AppHandle) -> Result<()> {
    if SERVICE.set(Service { app: app.clone(), ready: Mutex::new(false), signal: Condvar::new(), pending: Mutex::new(HashMap::new()) }).is_err() { return Ok(()); }
    app.listen("ocr:ready", |_| {
        if let Some(service) = SERVICE.get() { *service.ready.lock() = true; service.signal.notify_all(); }
    });
    app.listen("ocr:result", |event| {
        let Ok(response) = serde_json::from_str::<Response>(event.payload()) else { return; };
        let Some(service) = SERVICE.get() else { return; };
        if let Some(reply) = service.pending.lock().remove(&response.id) {
            let result = response.result.ok_or_else(|| response.error.unwrap_or_else(|| "Text recognition failed".into()));
            let _ = reply.send(result);
        }
    });
    WebviewWindowBuilder::new(app, "ocr", WebviewUrl::App("ocr.html".into()))
        .title("AlgorithShot OCR").visible(false).focused(false).skip_taskbar(true).build()?;
    Ok(())
}

pub fn languages() -> Vec<String> { vec!["en".into(), "ru".into(), "uz".into(), "uz-Cyrl".into()] }

pub fn verify() -> Result<()> {
    let image = image::load_from_memory(include_bytes!("../../../test/fixtures/ocr-languages.png"))?.into_rgba8();
    let text = union_text(&read(&image)?);
    for expected in ["hello", "привет", "salom"] {
        if !text.to_lowercase().contains(expected) { bail!("The native OCR engine did not recognize the {expected} test word"); }
    }
    Ok(())
}

pub fn read(image: &RgbaImage) -> Result<Vec<OcrText>> {
    if image.width() == 0 || image.height() == 0 { bail!("The image is empty"); }
    let service = SERVICE.get().context("The offline OCR service is not initialized")?;
    let mut ready = service.ready.lock();
    if !*ready { service.signal.wait_for(&mut ready, Duration::from_secs(20)); }
    if !*ready { bail!("The offline OCR service did not start. Restart AlgorithShot and retry."); }
    drop(ready);

    let scale = (4096.0 / image.width().max(image.height()) as f64).min(2.0);
    let prepared = if (scale - 1.0).abs() > 0.01 {
        crate::imaging::resize(image, (image.width() as f64 * scale).round().max(1.0) as u32,
            (image.height() as f64 * scale).round().max(1.0) as u32)?
    } else { image.clone() };
    let png = crate::imaging::encode(&prepared, crate::imaging::Format::Png, 100)?;
    let id = uuid::Uuid::new_v4().to_string();
    let (reply, receiver) = channel();
    service.pending.lock().insert(id.clone(), reply);
    if let Err(error) = service.app.emit_to("ocr", "ocr:read", Request { id: id.clone(), png }) {
        service.pending.lock().remove(&id);
        return Err(error.into());
    }
    let response = receiver.recv_timeout(Duration::from_secs(120));
    service.pending.lock().remove(&id);
    let mut text = response.context("Offline text recognition timed out")?.map_err(|e| anyhow!(e))?;
    for line in &mut text.lines {
        for word in &mut line.words {
            word.rect.x = (word.rect.x as f64 / scale).floor() as i32;
            word.rect.y = (word.rect.y as f64 / scale).floor() as i32;
            word.rect.w = (word.rect.w as f64 / scale).ceil() as i32;
            word.rect.h = (word.rect.h as f64 / scale).ceil() as i32;
        }
    }
    Ok(vec![text])
}
