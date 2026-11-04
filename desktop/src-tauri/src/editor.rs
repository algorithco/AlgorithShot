//! Commands behind the editor. The page sends raw RGBA pixels in the request
//! body with a small JSON header (`x-args`), so big images skip JSON; pixel
//! results come back as raw bytes too.

use anyhow::{anyhow, Context, Result};
use image::RgbaImage;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::ipc::{InvokeBody, Request, Response};
use tauri::AppHandle;

use crate::imaging::{self, EncodedImage, Format};
use crate::library::Shot;
use crate::shots::{self, Source};
use crate::state::state;
use crate::win::Rect;

type CmdResult<T> = Result<T, String>;

fn fail(e: anyhow::Error) -> String {
    format!("{e:#}")
}

/// An async command alone does not move CPU-heavy work off the runtime. Large
/// images must not block window events, other commands, or clipboard requests.
async fn blocking<T: Send + 'static>(work: impl FnOnce() -> Result<T> + Send + 'static) -> CmdResult<T> {
    tauri::async_runtime::spawn_blocking(work).await.map_err(|e| e.to_string())?.map_err(fail)
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
                // Older builds could leave the indexed format stale after a
                // conversion. The saved file's extension controls export.
                format: Format::from_path(std::path::Path::new(&shot.path)).ext().into(),
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
    blocking(move || {
        let rect: Rect = arg(&args, "rect")?;
        Ok(Response::new(imaging::smart_fill(&img, rect)?.into_raw()))
    }).await
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
    blocking(move || {
        let out = match opt::<String>(&args, "mode").as_deref() {
            Some("fit") => {
                let bg: [u8; 4] = opt(&args, "background").unwrap_or([255, 255, 255, 255]);
                imaging::fit(&img, w, h, bg, true)?
            }
            _ => imaging::resize(&img, w, h)?,
        };
        Ok(Response::new(out.into_raw()))
    }).await
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Encoded {
    bytes: usize,
    quality: u8,
}

fn encode_with(img: &RgbaImage, args: &Value) -> Result<EncodedImage> {
    let format = Format::parse(&opt::<String>(args, "format").unwrap_or_else(|| "png".into()));
    let quality: u8 = opt(args, "quality").unwrap_or(100);
    let max = opt::<usize>(args, "maxBytes").unwrap_or(0);
    EncodedImage::new(img, format, quality, max)
}

/// How big the file would be with these settings.
#[tauri::command]
pub async fn editor_estimate(request: Request<'_>) -> CmdResult<Encoded> {
    let (img, args) = read(&request).map_err(fail)?;
    blocking(move || {
        let image = encode_with(&img, &args)?;
        Ok(Encoded { bytes: image.data.len(), quality: image.quality })
    }).await
}

/// Saves over the library screenshot (keeping the original), or adds an
/// unsaved image to the library.
#[tauri::command]
pub async fn editor_save(app: AppHandle, request: Request<'_>) -> CmdResult<Shot> {
    let (img, args) = read(&request).map_err(fail)?;
    blocking(move || {
        let target: String = arg(&args, "target")?;
        let image = encode_with(&img, &args)?;
        save_export(&app, &target, &image)
    }).await
}

fn save_export(app: &AppHandle, target: &str, image: &EncodedImage) -> Result<Shot> {
    match target.split_once(':') {
        Some(("shot", id)) => shots::save_edit(app, id, image),
        _ => shots::save_new_encoded(app, image, &Source::default()),
    }
}

/// Asks where to save, then writes the file. Returns the path, or None if
/// the user cancelled.
#[tauri::command]
pub async fn editor_save_as(app: AppHandle, request: Request<'_>) -> CmdResult<Option<String>> {
    use tauri_plugin_dialog::DialogExt;
    let (img, args) = read(&request).map_err(fail)?;
    blocking(move || {
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
        state(&app).paths.validate_save_dir(&path)?;
        let mut args = args;
        args["format"] = Value::String(Format::from_path(&path).ext().to_string());
        let image = encode_with(&img, &args)?;
        std::fs::write(&path, &image.data)?;
        Ok(Some(path.to_string_lossy().into_owned()))
    }).await
}

#[tauri::command]
pub async fn editor_copy(request: Request<'_>) -> CmdResult<()> {
    let (img, _) = read(&request).map_err(fail)?;
    blocking(move || crate::clipboard::set_image(&img)).await
}

/// Private data in the image (text patterns and faces), for the editor's
/// privacy panel.
#[tauri::command]
pub async fn privacy_scan(request: Request<'_>) -> CmdResult<Vec<crate::smart::privacy::Finding>> {
    let (img, _) = read(&request).map_err(fail)?;
    tauri::async_runtime::spawn_blocking(move || {
        crate::smart::init_thread();
        let text = crate::smart::ocr::read(&img)?;
        crate::smart::privacy::scan(&img, &text)
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(fail)
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

/// Used only by the isolated native overlay verifier, with its temporary
/// settings, database and screenshot folder. Never touches the user's library.
pub fn verify_export_quality(app: &AppHandle) -> Result<()> {
    use anyhow::ensure;
    use serde_json::json;

    let st = state(app);
    let settings = st.settings();
    // Reproduce the original defect: global lossy settings must not override
    // the PNG/WebP export the editor selected for a new image.
    st.settings.write().format = "jpeg".into();
    st.settings.write().jpeg_quality = 10;
    let result = (|| -> Result<()> {
        let img = RgbaImage::from_fn(1537, 863, |x, y| {
            image::Rgba([(x * 7 % 256) as u8, (y * 5 % 256) as u8, ((x + y) % 256) as u8, 255])
        });
        let cap = imaging::encode(&img, Format::Jpeg, 100)?.len() / 2;
        for (format, max) in [(Format::Png, 0), (Format::Webp, 0), (Format::Jpeg, cap)] {
            let output = encode_with(&img, &json!({"format": format, "quality": 100, "maxBytes": max}))?;
            let shot = save_export(app, "temp:quality-check", &output)?;
            ensure!(shot.format == format.ext(), "The selected export format was overridden");
            let data = std::fs::read(&shot.path)?;
            ensure!(data == output.data, "The export was encoded again during saving");
            ensure!(max == 0 || data.len() <= max, "The saved export exceeded its size limit");
            let decoded = image::load_from_memory(&data)?.to_rgba8();
            ensure!(decoded.dimensions() == img.dimensions(), "The saved image lost resolution");
            if format != Format::Jpeg {
                ensure!(decoded == img, "Lossless export changed captured pixels");
            }

            let target = format!("shot:{}", shot.id);
            let edited = EncodedImage::new(&img, Format::Webp, 100, 0)?;
            let path = std::path::Path::new(&shot.path);
            let occupied = path.with_extension("webp");
            let other = if occupied != path {
                if !occupied.exists() {
                    std::fs::write(&occupied, &edited.data)?;
                }
                Some(std::fs::read(&occupied)?)
            } else {
                None
            };
            let edited_shot = save_export(app, &target, &edited)?;
            ensure!(edited_shot.format == "webp", "The edited file format was not updated");
            if let Some(other) = other {
                ensure!(std::path::Path::new(&edited_shot.path) != occupied, "The export reused another screenshot's path");
                ensure!(std::fs::read(occupied)? == other, "The export overwrote a different screenshot");
            }
            ensure!(std::fs::read(&edited_shot.path)? == edited.data, "The edit was encoded again");
            let original = shots::original_path(app, &shot.id).context("The original was not preserved")?;
            ensure!(std::fs::read(original)? == output.data, "The original file was changed");
            let reverted = shots::revert(app, &shot.id)?;
            ensure!(reverted.format == format.ext(), "The reverted format was not restored");
            ensure!(std::fs::read(reverted.path)? == output.data, "Revert changed the original bytes");
        }
        println!("Verified lossless PNG/WebP pixels, native dimensions, selected formats, size limits and original recovery.");
        Ok(())
    })();
    *st.settings.write() = settings;
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn exports_default_to_lossless_without_a_size_limit() {
        let img = RgbaImage::from_fn(127, 83, |x, y| image::Rgba([x as u8, y as u8, 239, 255]));
        for args in [json!({}), json!({"format": "png", "quality": 10}), json!({"format": "webp"})] {
            let output = encode_with(&img, &args).unwrap();
            assert_eq!(output.quality, 100);
            assert_eq!(image::load_from_memory(&output.data).unwrap().to_rgba8(), img);
        }
    }

    #[test]
    fn selected_export_format_and_limit_are_encoded_together() {
        let img = RgbaImage::from_fn(319, 147, |x, y| image::Rgba([(x * 7 % 256) as u8, (y * 5 % 256) as u8, 239, 255]));
        let limit = imaging::encode(&img, Format::Jpeg, 100).unwrap().len() / 2;
        let output = encode_with(&img, &json!({"format": "jpeg", "quality": 100, "maxBytes": limit})).unwrap();
        assert_eq!(output.format, Format::Jpeg);
        assert!(output.data.len() <= limit);
        assert!(output.quality < 100);
        assert_eq!((output.width, output.height), img.dimensions());
    }
}
