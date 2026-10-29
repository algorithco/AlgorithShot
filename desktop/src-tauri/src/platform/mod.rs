#[cfg(target_os = "macos")]
pub mod capture_macos;
#[cfg(target_os = "linux")]
pub mod portal;
