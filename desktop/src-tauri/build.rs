fn main() {
    // Tauri reuses compressed assets by content hash without validating the
    // cached bytes. A truncated entry otherwise survives normal rebuilds and
    // appears as "asset not found" at runtime. Recreate only this crate's cache.
    println!("cargo:rerun-if-changed=../dist");
    let asset_cache = std::path::PathBuf::from(std::env::var_os("OUT_DIR").unwrap())
        .join("tauri-codegen-assets");
    match std::fs::remove_dir_all(&asset_cache) {
        Ok(()) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => panic!("Could not clear {}: {error}", asset_cache.display()),
    }
    println!("cargo:rerun-if-env-changed=TAURI_UPDATER_PUBLIC_KEY");
    if std::env::var("PROFILE").as_deref() == Ok("release") {
        assert!(
            std::env::var("TAURI_UPDATER_PUBLIC_KEY").is_ok_and(|key| !key.trim().is_empty()),
            "Release builds need TAURI_UPDATER_PUBLIC_KEY. See docs/UPDATES.md and run pnpm release:build."
        );
    }
    tauri_build::build()
}
