fn main() {
    println!("cargo:rerun-if-env-changed=TAURI_UPDATER_PUBLIC_KEY");
    if std::env::var("PROFILE").as_deref() == Ok("release") {
        assert!(
            std::env::var("TAURI_UPDATER_PUBLIC_KEY").is_ok_and(|key| !key.trim().is_empty()),
            "Release builds need TAURI_UPDATER_PUBLIC_KEY. See docs/UPDATES.md and run pnpm release:build."
        );
    }
    tauri_build::build()
}
