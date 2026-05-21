use std::{
    path::{Path, PathBuf},
    process::Command,
    sync::OnceLock,
};

pub fn detect_cli(id: &str) -> Option<String> {
    let output = Command::new("which").arg(id).output().ok()?;
    if output.status.success() {
        Some(String::from_utf8_lossy(&output.stdout).trim().to_string())
    } else {
        None
    }
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

/// Resolve the full PATH from the user's login shell.
/// Desktop apps launched from Finder/Dock/desktop inherit a minimal PATH
/// that excludes user-installed tools (Homebrew, nvm, cargo, etc.).
pub fn get_user_shell_path(default_shell: &str) -> &'static str {
    static CACHED: OnceLock<String> = OnceLock::new();
    CACHED.get_or_init(|| {
        let shell = std::env::var("SHELL").unwrap_or_else(|_| default_shell.into());
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

/// Spawn `editor` (potentially with flags, e.g. "code --wait") on `path`,
/// inheriting stdio so the user can interact directly. Routed through
/// `sh -c` so the editor string can carry its own arguments.
pub fn spawn_editor(editor: &str, path: &Path) -> Result<(), String> {
    let status = Command::new("sh")
        .arg("-c")
        .arg(format!(r#"{editor} "$1""#))
        .arg("--")
        .arg(path)
        .status()
        .map_err(|error| format!("failed to spawn editor '{editor}': {error}"))?;
    if !status.success() {
        return Err(format!("editor '{editor}' exited with status {status}"));
    }
    Ok(())
}
