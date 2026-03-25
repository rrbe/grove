use std::{
    path::Path,
    process::Command,
    sync::OnceLock,
};

/// Detect the best available terminal emulator on Linux.
fn detect_terminal() -> &'static str {
    if let Ok(term) = std::env::var("TERMINAL") {
        if !term.is_empty() {
            // Cache so we can return &'static str
            static TERM_ENV: OnceLock<String> = OnceLock::new();
            return TERM_ENV.get_or_init(|| term);
        }
    }
    for candidate in &["wezterm", "kitty", "alacritty", "gnome-terminal", "konsole", "xterm"] {
        if Command::new("which")
            .arg(candidate)
            .output()
            .is_ok_and(|o| o.status.success())
        {
            return candidate;
        }
    }
    "xterm"
}

fn resolve_terminal(id: &str) -> &str {
    match id {
        "terminal" | "" | "Terminal" => detect_terminal(),
        "Alacritty" => "alacritty",
        "WezTerm" => "wezterm",
        _ => id,
    }
}

/// Build the working-directory argument for a given terminal.
/// Returns (flag, value) for terminals with a dedicated flag, or None for xterm-style.
fn cwd_args(terminal: &str) -> Option<(&'static str, bool)> {
    match terminal {
        "kitty" | "alacritty" => Some(("--working-directory", true)),
        "gnome-terminal" => Some(("--working-directory", true)),
        "konsole" => Some(("--workdir", true)),
        _ => None,
    }
}

/// Separator between cwd args and exec args per terminal.
fn exec_separator(terminal: &str) -> &'static str {
    match terminal {
        "gnome-terminal" => "--",
        _ => "-e",
    }
}

pub fn open_terminal_at(terminal_id: &str, cwd: &Path, script: &str) -> Result<(), String> {
    let cwd_str = cwd.to_string_lossy();
    let terminal = resolve_terminal(terminal_id);

    // WezTerm has a unique CLI syntax: `wezterm start --cwd <dir> -- <cmd>`
    if terminal == "wezterm" {
        Command::new("wezterm")
            .args(["start", "--cwd", &cwd_str, "--", "bash", "-c", script])
            .spawn()
            .map_err(|e| format!("failed to open WezTerm: {e}"))?;
        return Ok(());
    }

    if let Some((flag, _)) = cwd_args(terminal) {
        let sep = exec_separator(terminal);
        Command::new(terminal)
            .args([flag, &cwd_str, sep, "bash", "-c", script])
            .spawn()
            .map_err(|e| format!("failed to open {terminal}: {e}"))?;
    } else {
        Command::new(terminal)
            .args(["-e", &format!("cd '{}' && {}", cwd_str, script)])
            .spawn()
            .map_err(|e| format!("failed to open {terminal}: {e}"))?;
    }
    Ok(())
}

pub fn open_terminal_app(app_name: &str, cwd: &str) -> Result<(), String> {
    let terminal = resolve_terminal(app_name);

    // WezTerm has a unique CLI syntax: `wezterm start --cwd <dir>`
    if terminal == "wezterm" {
        Command::new("wezterm")
            .args(["start", "--cwd", cwd])
            .spawn()
            .map_err(|e| format!("failed to open WezTerm: {e}"))?;
        return Ok(());
    }

    if let Some((flag, _)) = cwd_args(terminal) {
        Command::new(terminal)
            .args([flag, cwd])
            .spawn()
            .map_err(|e| format!("failed to open {terminal}: {e}"))?;
    } else {
        Command::new(terminal)
            .current_dir(cwd)
            .spawn()
            .map_err(|e| format!("failed to open {terminal}: {e}"))?;
    }
    Ok(())
}

pub fn list_installed_apps() -> Result<Vec<String>, String> {
    Ok(Vec::new())
}

pub fn detect_app(app_name: &str) -> bool {
    Command::new("which")
        .arg(app_name)
        .output()
        .is_ok_and(|output| output.status.success())
}

pub use super::posix::{available_shells, detect_cli, home_dir};

pub fn open_app(app: &str, args: &[String], cwd: &Path) -> Result<(), String> {
    if app.starts_with("http://") || app.starts_with("https://") {
        Command::new("xdg-open")
            .arg(app)
            .current_dir(cwd)
            .spawn()
            .map_err(|error| format!("failed to open {app}: {error}"))?;
    } else {
        Command::new(app)
            .args(args)
            .current_dir(cwd)
            .spawn()
            .map_err(|error| format!("failed to launch {app}: {error}"))?;
    }
    Ok(())
}

pub fn default_shell() -> String {
    std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".into())
}

pub fn get_user_shell_path() -> &'static str {
    super::posix::get_user_shell_path("/bin/bash")
}
