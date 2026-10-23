//! Background work after a capture or a change: thumbnails, lossless PNG
//! shrinking, and indexing (text, privacy check, fingerprint for duplicates).
//! Indexing runs on its own thread because Windows OCR needs COM.

use anyhow::{anyhow, Result};
use parking_lot::Mutex;
use std::path::PathBuf;
use std::sync::mpsc::{channel, Receiver, Sender};
use tauri::{AppHandle, Emitter};

use crate::imaging;
use crate::shots;
use crate::state::state;

#[derive(Debug, Clone)]
pub enum Job {
    Thumb(String),
    Optimize(String),
    Index(String),
}

pub struct Jobs {
    tx: Sender<Job>,
    rx: Mutex<Option<Receiver<Job>>>,
    index_tx: Sender<String>,
    index_rx: Mutex<Option<Receiver<String>>>,
}

impl Jobs {
    pub fn new() -> Jobs {
        let (tx, rx) = channel();
        let (index_tx, index_rx) = channel();
        Jobs { tx, rx: Mutex::new(Some(rx)), index_tx, index_rx: Mutex::new(Some(index_rx)) }
    }

    pub fn push(&self, job: Job) {
        let _ = self.tx.send(job);
    }

    /// Starts the worker threads. Call once, after the state is managed.
    pub fn start(&self, app: AppHandle) {
        let rx = self.rx.lock().take().expect("jobs started twice");
        let index_rx = self.index_rx.lock().take().expect("jobs started twice");
        let index_tx = self.index_tx.clone();

        let worker_app = app.clone();
        std::thread::Builder::new()
            .name("jobs".into())
            .spawn(move || {
                for job in rx {
                    let res = match &job {
                        Job::Thumb(id) => make_thumb(&worker_app, id).map(|_| {
                            let _ = worker_app.emit("library:thumb", id);
                        }),
                        Job::Optimize(id) => optimize(&worker_app, id),
                        Job::Index(id) => index_tx.send(id.clone()).map_err(|e| anyhow!("{e}")),
                    };
                    if let Err(e) = res {
                        log::warn!("job {job:?} failed: {e:#}");
                    }
                }
            })
            .expect("spawn jobs thread");

        std::thread::Builder::new()
            .name("index".into())
            .spawn(move || {
                crate::smart::init_thread();
                for id in index_rx {
                    if let Err(e) = crate::smart::index_shot(&app, &id) {
                        log::warn!("indexing {id} failed: {e:#}");
                    }
                }
            })
            .expect("spawn index thread");
    }
}

pub fn thumb_path(app: &AppHandle, id: &str) -> PathBuf {
    state(app).paths.thumbs.join(format!("{id}.webp"))
}

/// Writes `thumbs/{id}.webp`, about 480 px on the long side.
pub fn make_thumb(app: &AppHandle, id: &str) -> Result<PathBuf> {
    let st = state(app);
    let shot = st.library.get(id)?.ok_or_else(|| anyhow!("not found"))?;
    let img = shots::load_rgba(std::path::Path::new(&shot.path))?;
    let thumb = imaging::thumbnail(&img, 480)?;
    let data = webp::Encoder::from_rgba(thumb.as_raw(), thumb.width(), thumb.height()).encode(80.0);
    std::fs::create_dir_all(&st.paths.thumbs)?;
    let path = thumb_path(app, id);
    std::fs::write(&path, &*data)?;
    Ok(path)
}

/// Recompresses a PNG losslessly if that makes it smaller.
fn optimize(app: &AppHandle, id: &str) -> Result<()> {
    let st = state(app);
    let Some(shot) = st.library.get(id)? else { return Ok(()) };
    let path = PathBuf::from(&shot.path);
    if imaging::Format::from_path(&path) != imaging::Format::Png {
        return Ok(());
    }
    let data = std::fs::read(&path)?;
    let smaller = imaging::optimize_png(&data)?;
    // Skip if it got no smaller, or the file changed while we worked.
    if smaller.len() >= data.len() || std::fs::metadata(&path)?.len() != data.len() as u64 {
        return Ok(());
    }
    let tmp = path.with_extension("png.part");
    std::fs::write(&tmp, &smaller)?;
    st.note_write(path.clone());
    std::fs::rename(&tmp, &path)?;
    st.library.file_changed(id, smaller.len() as u64, shot.width, shot.height, None, false)?;
    let _ = app.emit("library:changed", id);
    Ok(())
}
