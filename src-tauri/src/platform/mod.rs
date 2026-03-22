#[cfg(target_os = "macos")]
mod macos;
#[cfg(target_os = "windows")]
mod windows;
#[cfg(target_os = "linux")]
mod linux;

use std::path::{Path, PathBuf};

/// Open a terminal emulator at `cwd` and run `script` inside it.
/// `terminal_id` selects which terminal to use (e.g. "iterm2", "ghostty", "windows-terminal").
pub fn open_terminal_at(terminal_id: &str, cwd: &Path, script: &str) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    return macos::open_terminal_at(terminal_id, cwd, script);
    #[cfg(target_os = "windows")]
    return windows::open_terminal_at(terminal_id, cwd, script);
    #[cfg(target_os = "linux")]
    return linux::open_terminal_at(terminal_id, cwd, script);
}

/// Open a terminal app with its working directory set to `cwd`.
/// Used by the App launcher kind for terminal applications.
pub fn open_terminal_app(app_name: &str, cwd: &str) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    return macos::open_terminal_app(app_name, cwd);
    #[cfg(target_os = "windows")]
    return windows::open_terminal_app(app_name, cwd);
    #[cfg(target_os = "linux")]
    return linux::open_terminal_app(app_name, cwd);
}

/// List GUI applications installed on the system.
pub fn list_installed_apps() -> Result<Vec<String>, String> {
    #[cfg(target_os = "macos")]
    return macos::list_installed_apps();
    #[cfg(target_os = "windows")]
    return windows::list_installed_apps();
    #[cfg(target_os = "linux")]
    return linux::list_installed_apps();
}

/// Check whether a GUI application is installed.
pub fn detect_app(app_name: &str) -> bool {
    #[cfg(target_os = "macos")]
    return macos::detect_app(app_name);
    #[cfg(target_os = "windows")]
    return windows::detect_app(app_name);
    #[cfg(target_os = "linux")]
    return linux::detect_app(app_name);
}

/// Check whether a CLI tool is available and return its path.
pub fn detect_cli(id: &str) -> Option<String> {
    #[cfg(target_os = "macos")]
    return macos::detect_cli(id);
    #[cfg(target_os = "windows")]
    return windows::detect_cli(id);
    #[cfg(target_os = "linux")]
    return linux::detect_cli(id);
}

/// Open a GUI application with arguments at the given working directory.
pub fn open_app(app: &str, args: &[String], cwd: &Path) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    return macos::open_app(app, args, cwd);
    #[cfg(target_os = "windows")]
    return windows::open_app(app, args, cwd);
    #[cfg(target_os = "linux")]
    return linux::open_app(app, args, cwd);
}

/// Return the list of available shells as (path, label) pairs.
pub fn available_shells() -> Vec<(String, String)> {
    #[cfg(target_os = "macos")]
    return macos::available_shells();
    #[cfg(target_os = "windows")]
    return windows::available_shells();
    #[cfg(target_os = "linux")]
    return linux::available_shells();
}

/// Return the default shell for this platform.
pub fn default_shell() -> String {
    #[cfg(target_os = "macos")]
    return macos::default_shell();
    #[cfg(target_os = "windows")]
    return windows::default_shell();
    #[cfg(target_os = "linux")]
    return linux::default_shell();
}

/// Return the full PATH as seen by the user's login shell.
/// On macOS/Linux, apps launched from desktop inherit a minimal PATH; this
/// resolves the real one by spawning a login shell.
pub fn get_user_shell_path() -> &'static str {
    #[cfg(target_os = "macos")]
    return macos::get_user_shell_path();
    #[cfg(target_os = "windows")]
    return windows::get_user_shell_path();
    #[cfg(target_os = "linux")]
    return linux::get_user_shell_path();
}

/// Return the user's home directory.
pub fn home_dir() -> Result<PathBuf, String> {
    #[cfg(target_os = "macos")]
    return macos::home_dir();
    #[cfg(target_os = "windows")]
    return windows::home_dir();
    #[cfg(target_os = "linux")]
    return linux::home_dir();
}

/// Check whether an AppleScript launcher is supported on this platform.
pub fn supports_applescript() -> bool {
    cfg!(target_os = "macos")
}
