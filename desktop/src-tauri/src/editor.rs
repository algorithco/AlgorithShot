//! Commands behind the editor. The page sends raw RGBA pixels in the request
//! body with a small JSON header (`x-args`), so big images skip JSON; pixel
//! results come back as raw bytes too.

use anyhow::{anyhow, Context, Result};
use image::RgbaImage;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::ipc::{InvokeBody, Request, Response};
use tauri::AppHandle;

use crate::imaging::{self, Format};
use crate::library::Shot;
use crate::shots::{self, Source};
use crate::state::state;
use crate::win::Rect;

type CmdResult<T> = Result<T, String>;

fn fail(e: anyhow::Error) -> String {
    format!("{e:#}")
}

/// Reads the image and the JSON arguments of a raw editor request.
fn read(request: &Request<'_>) -> Result<(RgbaImage, Value)> {
    let InvokeBody::Raw(data) = request.body() else {
        return Err(anyhow!("expected raw pixels"));
    };
    let args: Value = request
        .headers()
        .get("x-args")
        .and_then(|v| v.to_str().ok())
        .map(serde_json::from_str)
        .transpose()?
        .unwrap_or(Value::Null);
    let width = args["width"].as_u64().context("missing width")? as u32;
    let height = args["height"].as_u64().context("missing height")? as u32;
    Ok((imaging::from_raw(width, height, data.clone())?, args))
}

fn arg<T: for<'de> Deserialize<'de>>(args: &Value, key: &str) -> Result<T> {
    serde_json::from_value(args[key].clone()).with_context(|| format!("bad {key}"))
}

fn opt<T: for<'de> Deserialize<'de>>(args: &Value, key: &str) -> Option<T> {
    serde_json::from_value(args[key].clone()).ok()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EditorInfo {
    name: String,
    width: u32,
    height: u32,
    format: String,
    has_original: bool,
    shot: Option<Shot>,
}

/// What the editor is opening: a library screenshot or an unsaved image.
#[tauri::command]
pub async fn editor_info(app: AppHandle, target: String) -> CmdResult<EditorInfo> {
    let st = state(&app);
    match target.split_once(':') {
        Some(("shot", id)) => {
            let shot = st.library.get(id).map_err(fail)?.ok_or("this screenshot is gone")?;
            Ok(EditorInfo {
                name: shot.name.clone(),
                width: shot.width,
                height: shot.height,
                format: shot.format.clone(),
                has_original: shots::original_path(&app, id).is_some(),
                shot: Some(shot),
            })
        }
        Some(("temp", id)) => {
            let img = st.image(id).ok_or("this image is no longer available")?;
            Ok(EditorInfo {
                name: format!("Screenshot {}", chrono::Local::now().format("%Y-%m-%d %H-%M")),
                width: img.width(),
                height: img.height(),
                format: "png".into(),
                has_original: false,
                shot: None,
            })
        }
        _ => Err("unknown image".into()),
    }
}

/// Remove & fill: the body is a region around the hole; `rect` is the hole
/// inside it. Returns the filled hole as raw RGBA (rect.w × rect.h).
#[tauri::command]
pub async fn editor_fill(request: Request<'_>) -> CmdResult<Response> {
    let (img, args) = read(&request).map_err(fail)?;
    let rect: Rect = arg(&args, "rect").map_err(fail)?;
    let patch = imaging::smart_fill(&img, rect).map_err(fail)?;
    Ok(Response::new(patch.into_raw()))
}

/// Resize to exactly w×h ("resize"), or fit inside it on a background ("fit").
#[tauri::command]
pub async fn editor_resize(request: Request<'_>) -> CmdResult<Response> {
    let (img, args) = read(&request).map_err(fail)?;
    let w: u32 = arg(&args, "w").map_err(fail)?;
    let h: u32 = arg(&args, "h").map_err(fail)?;
    if w == 0 || h == 0 || w > 20000 || h > 20000 {
        return Err("size must be between 1 and 20000 px".into());
    }
    let out = match opt::<String>(&args, "mode").as_deref() {
        Some("fit") => {
            let bg: [u8; 4] = opt(&args, "background").unwrap_or([255, 255, 255, 255]);
            imaging::fit(&img, w, h, bg, true).map_err(fail)?
        }
        _ => imaging::resize(&img, w, h).map_err(fail)?,
    };
    Ok(Response::new(out.into_raw()))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Encoded {
    bytes: usize,
    quality: u8,
}

fn encode_with(img: &RgbaImage, args: &Value) -> Result<(Vec<u8>, Format, u8)> {
    let format = Format::parse(&opt::<String>(args, "format").unwrap_or_else(|| "png".into()));
    let quality: u8 = opt(args, "quality").unwrap_or(90);
    if let Some(max) = opt::<usize>(args, "maxBytes").filter(|m| *m > 0) {
        let (data, q) = imaging::encode_under(img, format, max)?;
        return Ok((data, format, q));
    }
    let mut data = imaging::encode(img, format, quality)?;
    if format == Format::Png {
        data = imaging::optimize_png(&data).unwrap_or(data);
    }
    Ok((data, format, quality))
}

/// How big the file would be with these settings.
#[tauri::command]
pub async fn editor_estimate(request: Request<'_>) -> CmdResult<Encoded> {
    let (img, args) = read(&request).map_err(fail)?;
    let (data, _, quality) = encode_with(&img, &args).map_err(fail)?;
    Ok(Encoded { bytes: data.len(), quality })
}

/// Saves over the library screenshot (keeping the original), or adds an
/// unsaved image to the library.
#[tauri::command]
pub async fn editor_save(app: AppHandle, request: Request<'_>) -> CmdResult<Shot> {
    let (img, args) = read(&request).map_err(fail)?;
    let target: String = arg(&args, "target").map_err(fail)?;
    let format = Format::parse(&opt::<String>(&args, "format").unwrap_or_else(|| "png".into()));
    let quality = if let Some(max) = opt::<usize>(&args, "maxBytes").filter(|m| *m > 0) {
        imaging::encode_under(&img, format, max).map_err(fail)?.1
    } else {
        opt(&args, "quality").unwrap_or(90)
    };
    match target.split_once(':') {
        Some(("shot", id)) => shots::save_edit(&app, id, &img, format, quality).map_err(fail),
        _ => shots::save_new(&app, &img, &Source::default()).map_err(fail),
    }
}

/// Asks where to save, then writes the file. Returns the path, or None if
/// the user cancelled.
#[tauri::command]
pub async fn editor_save_as(app: AppHandle, request: Request<'_>) -> CmdResult<Option<String>> {
    use tauri_plugin_dialog::DialogExt;
    let (img, args) = read(&request).map_err(fail)?;
    let name: String = opt(&args, "name").unwrap_or_else(|| "Screenshot.png".into());
    let picked = app
        .dialog()
        .file()
        .set_file_name(&name)
        .add_filter("PNG", &["png"])
        .add_filter("JPEG", &["jpg", "jpeg"])
        .add_filter("WebP", &["webp"])
        .blocking_save_file();
    let Some(path) = picked.and_then(|p| p.into_path().ok()) else { return Ok(None) };
    let mut args = args;
    args["format"] = Value::String(Format::from_path(&path).ext().to_string());
    let (data, _, _) = encode_with(&img, &args).map_err(fail)?;
    std::fs::write(&path, data).map_err(|e| e.to_string())?;
    Ok(Some(path.to_string_lossy().into_owned()))
}

#[tauri::command]
pub async fn editor_copy(request: Request<'_>) -> CmdResult<()> {
    let (img, _) = read(&request).map_err(fail)?;
    crate::clipboard::set_image(&img).map_err(fail)
}

/// Private data in the image (text patterns and faces), for the editor's
/// privacy panel.
#[tauri::command]
pub async fn privacy_scan(request: Request<'_>) -> CmdResult<Vec<crate::smart::privacy::Finding>> {
    let (img, _) = read(&request).map_err(fail)?;
    tauri::async_runtime::spawn_blocking(move || {
        crate::smart::init_thread();
        let text = crate::smart::ocr::read(&img).unwrap_or_default();
        crate::smart::privacy::scan(&img, &text)
    })
    .await
    .map_err(|e| e.to_string())
}

/// The text in an image, best reading.
#[tauri::command]
pub async fn read_text(request: Request<'_>) -> CmdResult<String> {
    let (img, _) = read(&request).map_err(fail)?;
    tauri::async_runtime::spawn_blocking(move || {
        crate::smart::init_thread();
        crate::smart::ocr::read(&img).map(|r| r.first().map(crate::smart::ocr::OcrText::text).unwrap_or_default())
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(fail)
}

#[tauri::command]
pub async fn editor_revert(app: AppHandle, id: String) -> CmdResult<Shot> {
    shots::revert(&app, &id).map_err(fail)
}

/// Opens a picture file (dropped or picked) in the editor without adding it
/// to the library until it's saved.
#[tauri::command]
pub async fn open_image_file(app: AppHandle, path: String) -> CmdResult<()> {
    let img = shots::load_rgba(std::path::Path::new(&path)).map_err(fail)?;
    let id = state(&app).put_temp(img);
    crate::wm::open_editor(&app, &format!("temp:{id}")).map_err(fail)
}

/// Opens pasted image data (PNG, JPEG…) in the editor.
#[tauri::command]
pub async fn open_image_bytes(app: AppHandle, request: Request<'_>) -> CmdResult<()> {
    let InvokeBody::Raw(data) = request.body() else {
        return Err("expected image bytes".into());
    };
    let img = image::load_from_memory(data).map_err(|e| e.to_string())?.to_rgba8();
    let id = state(&app).put_temp(img);
    crate::wm::open_editor(&app, &format!("temp:{id}")).map_err(fail)
}
