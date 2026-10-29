fn main() {
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("macos") {
        println!("cargo:rerun-if-changed=src/platform/capture_macos.m");
        cc::Build::new()
            .file("src/platform/capture_macos.m")
            .flag("-fobjc-arc")
            .compile("algorithshot_capture_macos");
        println!("cargo:rustc-link-lib=framework=Foundation");
        println!("cargo:rustc-link-lib=framework=CoreGraphics");
        // ScreenCaptureKit is absent on 12.0–12.2. The bridge gates its use
        // with @available and leaves those releases on Core Graphics.
        println!("cargo:rustc-link-arg=-Wl,-weak_framework,ScreenCaptureKit");
    }
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
