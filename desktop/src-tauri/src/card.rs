//! The quick card in the screen corner that appears after each capture.
//! Rust sends the content; the page lays it out, reports its height, and
//! only then is the window shown, so it never flashes old content.

use serde::Serialize;
use tauri::{AppHandle, Emitter};

use crate::library::Shot;
use crate::wm;

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Card {
    #[serde(rename_all = "camelCase")]
    Shot {
        shot: Option<Shot>,
        /// Set when the capture wasn't saved to the library.
        temp_id: Option<String>,
        width: u32,
        height: u32,
        copied: bool,
    },
    #[serde(rename_all = "camelCase")]
    Text { text: String, copied: bool },
    #[serde(rename_all = "camelCase")]
    Qr { items: Vec<String>, copied: bool },
    #[serde(rename_all = "camelCase")]
    Color { hex: String },
    #[serde(rename_all = "camelCase")]
    Countdown { seconds: u32 },
    #[serde(rename_all = "camelCase")]
    Saved { path: String },
    #[serde(rename_all = "camelCase")]
    Message { text: String, error: bool },
}

impl Card {
    pub fn error(text: String) -> Card {
        Card::Message { text, error: true }
    }
}

pub fn show(app: &AppHandle, card: Card) {
    if let Err(e) = (|| -> anyhow::Result<()> {
        let window = wm::card(app)?;
        window.show()?;
        crate::state::state(app).capture.wait_for_window("card", std::time::Duration::from_secs(15))?;
        window.emit("card:show", card)?;
        Ok(())
    })() {
        log::warn!("card: {e:#}");
    }
}

/// The page laid out the card: size the window and show it without
/// stealing focus.
pub fn ready(app: &AppHandle, width: f64, height: f64) -> anyhow::Result<()> {
    let w = wm::card(app)?;
    wm::place_card(app, &w, width, height)?;
    // Keep Tao's visibility state in sync. Showing the HWND directly leaves
    // it marked hidden, so a later w.hide() does nothing and the empty,
    // transparent topmost window keeps intercepting clicks.
    w.show()?;
    Ok(())
}

pub fn hide(app: &AppHandle) {
    let _ = app.emit_to("card", "card:reset", ());
    wm::hide_card(app);
}

