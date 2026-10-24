//! Verify the same embedded bytes that Tauri serves to the webviews.

use tauri::{Assets, Runtime};

pub fn verify<R: Runtime>(assets: &dyn Assets<R>) -> Result<usize, String> {
    for page in ["index.html", "overlay.html", "card.html", "editor.html", "pin.html"] {
        if assets.get(&page.into()).is_none_or(|bytes| bytes.is_empty()) {
            return Err(format!("Embedded page is missing or corrupt: {page}"));
        }
    }

    let mut count = 0;
    for (path, _) in assets.iter() {
        // iter() exposes compressed bytes; get() also exercises decompression.
        if assets.get(&path.as_ref().into()).is_none() {
            return Err(format!("Embedded asset is missing or corrupt: {path}"));
        }
        count += 1;
    }
    Ok(count)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tauri::utils::assets::{EmbeddedAssets, phf};

    #[test]
    fn rejects_zero_filled_compressed_page() {
        let assets = EmbeddedAssets::new(
            phf::Map { key: 0, disps: &[(0, 0)], entries: &[("/index.html", &[0; 32])] },
            &[],
            phf::Map { key: 0, disps: &[], entries: &[] },
        );
        assert_eq!(
            verify::<tauri::Wry>(&assets).unwrap_err(),
            "Embedded page is missing or corrupt: index.html"
        );
    }

    #[test]
    fn rejects_build_without_embedded_pages() {
        let assets = EmbeddedAssets::new(
            phf::Map { key: 0, disps: &[], entries: &[] },
            &[],
            phf::Map { key: 0, disps: &[], entries: &[] },
        );
        assert!(verify::<tauri::Wry>(&assets).is_err());
    }

    // Enable tauri/custom-protocol to test production assets instead of devUrl.
    #[cfg(not(dev))]
    #[test]
    fn all_bundled_pages_and_assets_are_readable() {
        let context: tauri::Context<tauri::Wry> = tauri::generate_context!();
        assert!(verify(context.assets()).unwrap() >= 5);
    }
}
