use std::{
    path::{Path, PathBuf},
    process::Command,
    sync::OnceLock,
};

/// Detect the best available terminal emulator on Linux.
fn detect_terminal() -> &'static str {
    // Respect $TERMINAL env var if set
    if let Ok(term) = std::env::var("TERMINAL") {
        if !term.is_empty() {
            // Leak the string so we can return a 'static ref
            // (only called once via OnceLock pattern in callers)
            static TERM_ENV: OnceLock<String> = OnceLock::new();
            return TERM_ENV.get_or_init(|| term);
        }
    }
    // Fallback: probe common terminals
    for candidate in &["kitty", "alacritty", "gnome-terminal", "konsole", "xterm"] {
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

pub fn open_terminal_at(terminal_id: &str, cwd: &Path, script: &str) -> Result<(), String> {
    let cwd_str = cwd.to_string_lossy();
    let terminal = if terminal_id == "terminal" || terminal_id.is_empty() {
        detect_terminal()
    } else {
        terminal_id
    };

    match terminal {
        "kitty" => {
            Command::new("kitty")
                .args(["--working-directory", &cwd_str, "-e", "bash", "-c", script])
                .spawn()
                .map_err(|e| format!("failed to open kitty: {e}"))?;
        }
        "alacritty" => {
            Command::new("alacritty")
                .args(["--working-directory", &cwd_str, "-e", "bash", "-c", script])
                .spawn()
                .map_err(|e| format!("failed to open alacritty: {e}"))?;
        }
        "gnome-terminal" => {
            Command::new("gnome-terminal")
                .args(["--working-directory", &cwd_str, "--", "bash", "-c", script])
                .spawn()
                .map_err(|e| format!("failed to open gnome-terminal: {e}"))?;
        }
        "konsole" => {
            Command::new("konsole")
                .args(["--workdir", &cwd_str, "-e", "bash", "-c", script])
                .spawn()
                .map_err(|e| format!("failed to open konsole: {e}"))?;
        }
        _ => {
            // xterm or unknown — use xterm-style invocation
            Command::new(terminal)
                .args(["-e", &format!("cd '{}' && {}", cwd_str, script)])
                .spawn()
                .map_err(|e| format!("failed to open {terminal}: {e}"))?;
        }
    }
    Ok(())
}

pub fn open_terminal_app(app_name: &str, cwd: &str) -> Result<(), String> {
    let terminal = if app_name.is_empty() {
        detect_terminal()
    } else {
        app_name
    };

    match terminal {
        "kitty" => {
            Command::new("kitty")
                .args(["--working-directory", cwd])
                .spawn()
                .map_err(|e| format!("failed to open kitty: {e}"))?;
        }
        "alacritty" => {
            Command::new("alacritty")
                .args(["--working-directory", cwd])
                .spawn()
                .map_err(|e| format!("failed to open alacritty: {e}"))?;
        }
        "gnome-terminal" => {
            Command::new("gnome-terminal")
                .args(["--working-directory", cwd])
                .spawn()
                .map_err(|e| format!("failed to open gnome-terminal: {e}"))?;
        }
        "konsole" => {
            Command::new("konsole")
                .args(["--workdir", cwd])
                .spawn()
                .map_err(|e| format!("failed to open konsole: {e}"))?;
        }
        _ => {
            Command::new(terminal)
                .current_dir(cwd)
                .spawn()
                .map_err(|e| format!("failed to open {terminal}: {e}"))?;
        }
    }
    Ok(())
}

pub fn list_installed_apps() -> Result<Vec<String>, String> {
    // Linux app discovery via .desktop files can be done later.
    Ok(Vec::new())
}

pub fn detect_app(app_name: &str) -> bool {
    Command::new("which")
        .arg(app_name)
        .output()
        .is_ok_and(|output| output.status.success())
}

pub fn detect_cli(id: &str) -> Option<String> {
    let output = Command::new("which").arg(id).output().ok()?;
    if output.status.success() {
        Some(String::from_utf8_lossy(&output.stdout).trim().to_string())
    } else {
        None
    }
}

pub fn open_app(app: &str, args: &[String], cwd: &Path) -> Result<(), String> {
    // For URLs, use xdg-open; otherwise run the command directly
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

pub fn available_shells() -> Vec<(String, String)> {
    let content = match std::fs::read_to_string("/etc/shells") {
        Ok(c) => c,
        Err(_) => return vec![("/bin/bash".into(), "bash".into())],
    };
    let mut shells = Vec::new();
    for line in content.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let path = Path::new(line);
        if !path.exists() {
            continue;
        }
        let label = path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or(line)
            .to_string();
        shells.push((line.to_string(), label));
    }
    if shells.is_empty() {
        shells.push(("/bin/bash".into(), "bash".into()));
    }
    shells
}

pub fn default_shell() -> String {
    std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".into())
}

pub fn get_user_shell_path() -> &'static str {
    static CACHED: OnceLock<String> = OnceLock::new();
    CACHED.get_or_init(|| {
        let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".into());
        let output = Command::new(&shell)
            .args(["-ilc", "echo __GROVE_PATH__${PATH}__GROVE_PATH__"])
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::null())
            .output();

        if let Ok(out) = output {
            let stdout = String::from_utf8_lossy(&out.stdout);
            if let Some(start) = stdout.find("__GROVE_PATH__") {
                let rest = &stdout[start + 14..];
                if let Some(end) = rest.find("__GROVE_PATH__") {
                    let path = rest[..end].trim();
                    if !path.is_empty() {
                        return path.to_string();
                    }
                }
            }
        }

        std::env::var("PATH").unwrap_or_default()
    })
}

pub fn home_dir() -> Result<PathBuf, String> {
    std::env::var("HOME")
        .map(PathBuf::from)
        .map_err(|_| "HOME not set".to_string())
}
