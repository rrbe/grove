#[cfg(target_os = "macos")]
mod macos;
#[cfg(target_os = "windows")]
mod windows;
#[cfg(target_os = "linux")]
mod linux;
#[cfg(not(target_os = "windows"))]
mod posix;

// Each platform module exports the same public API; the compiler selects
// the right one at build time — no runtime dispatch needed.
#[cfg(target_os = "macos")]
pub use macos::*;
#[cfg(target_os = "windows")]
pub use windows::*;
#[cfg(target_os = "linux")]
pub use linux::*;

pub fn supports_applescript() -> bool {
    cfg!(target_os = "macos")
}
