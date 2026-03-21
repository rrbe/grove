use sha2::{Digest, Sha256};
use std::{
    fs,
    path::{Path, PathBuf},
    process::Command,
    sync::OnceLock,
};

/// Escape a string for use inside an AppleScript double-quoted string.
fn apple_quote(value: &str) -> String {
    format!("\"{}\"", value.replace('\\', "\\\\").replace('"', "\\\""))
}

/// POSIX shell-quote a value.
fn shell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\"'\"'"))
}

pub fn open_terminal_at(terminal_id: &str, _cwd: &Path, script: &str) -> Result<(), String> {
    match terminal_id {
        "iterm2" => run_script_in_iterm2(script),
        "ghostty" => run_script_in_ghostty(script),
        "warp" => run_script_in_warp(script),
        _ => run_script_in_terminal_app(script),
    }
}

fn run_script_in_terminal_app(script: &str) -> Result<(), String> {
    let output = Command::new("osascript")
        .args([
            "-e",
            &format!(
                "tell application \"Terminal\" to do script {}",
                apple_quote(script)
            ),
            "-e",
            "tell application \"Terminal\" to activate",
        ])
        .output()
        .map_err(|error| format!("failed to open Terminal.app: {error}"))?;
    if !output.status.success() {
        return Err(format!(
            "failed to open Terminal.app, osascript exited with {}",
            output.status
        ));
    }
    Ok(())
}

fn run_script_in_iterm2(script: &str) -> Result<(), String> {
    let applescript = format!(
        "tell application \"iTerm2\"\nactivate\nset newWindow to (create window with default profile)\ntell current session of newWindow\nwrite text {}\nend tell\nend tell",
        apple_quote(script)
    );
    let output = Command::new("osascript")
        .arg("-e")
        .arg(&applescript)
        .output()
        .map_err(|e| format!("failed to open iTerm2: {e}"))?;
    if !output.status.success() {
        return Err(format!(
            "iTerm2 osascript failed with status {}",
            output.status
        ));
    }
    Ok(())
}

fn run_script_in_ghostty(script: &str) -> Result<(), String> {
    use std::io::Write;
    let hash = {
        let mut hasher = Sha256::new();
        hasher.update(script.as_bytes());
        format!("{:x}", hasher.finalize())
    };
    let tmp_path = format!("/tmp/grove-{}.sh", &hash[..12]);
    {
        let mut file = fs::File::create(&tmp_path)
            .map_err(|e| format!("failed to create temp script: {e}"))?;
        file.write_all(script.as_bytes())
            .map_err(|e| format!("failed to write temp script: {e}"))?;
    }

    let invoke_cmd = format!(
        "bash {} ; rm -f {}",
        shell_quote(&tmp_path),
        shell_quote(&tmp_path)
    );
    let applescript = format!(
        "tell application \"Ghostty\"\nactivate\ndelay 0.5\ntell application \"System Events\" to tell process \"Ghostty\" to keystroke \"t\" using command down\ndelay 0.3\ntell application \"System Events\" to tell process \"Ghostty\" to keystroke {}\nend tell",
        apple_quote(&format!("{invoke_cmd}\n"))
    );
    let output = Command::new("osascript")
        .arg("-e")
        .arg(&applescript)
        .output();
    match output {
        Ok(out) if out.status.success() => Ok(()),
        Ok(out) => Err(format!(
            "Ghostty osascript failed with status {}",
            out.status
        )),
        Err(e) => Err(format!("failed to open Ghostty: {e}")),
    }
}

fn run_script_in_warp(script: &str) -> Result<(), String> {
    use std::io::Write;
    let hash = {
        let mut hasher = Sha256::new();
        hasher.update(script.as_bytes());
        format!("{:x}", hasher.finalize())
    };
    let tmp_path = format!("/tmp/grove-{}.sh", &hash[..12]);
    {
        let mut file = fs::File::create(&tmp_path)
            .map_err(|e| format!("failed to create temp script: {e}"))?;
        file.write_all(script.as_bytes())
            .map_err(|e| format!("failed to write temp script: {e}"))?;
    }

    let invoke_cmd = format!(
        "bash {} ; rm -f {}",
        shell_quote(&tmp_path),
        shell_quote(&tmp_path)
    );
    let applescript = format!(
        "tell application \"Warp\"\nactivate\ndelay 0.5\ntell application \"System Events\" to tell process \"Warp\" to keystroke \"t\" using command down\ndelay 0.3\ntell application \"System Events\" to tell process \"Warp\" to keystroke {}\nend tell",
        apple_quote(&format!("{invoke_cmd}\n"))
    );
    let output = Command::new("osascript")
        .arg("-e")
        .arg(&applescript)
        .output();
    match output {
        Ok(out) if out.status.success() => Ok(()),
        Ok(out) => Err(format!(
            "Warp osascript failed with status {}",
            out.status
        )),
        Err(e) => Err(format!("failed to open Warp: {e}")),
    }
}

pub fn open_terminal_app(app_name: &str, cwd: &str) -> Result<(), String> {
    let script = match app_name {
        "Terminal" => {
            format!(
                "tell application \"Terminal\" to do script {}\ntell application \"Terminal\" to activate",
                apple_quote(&format!("cd {}", shell_quote(cwd)))
            )
        }
        "Ghostty" => {
            let applescript = format!(
                "tell application \"Ghostty\"\nactivate\ndelay 0.5\ntell application \"System Events\" to tell process \"Ghostty\" to keystroke \"t\" using command down\ndelay 0.3\ntell application \"System Events\" to tell process \"Ghostty\" to keystroke \"cd {} && clear\\n\"\nend tell",
                shell_quote(cwd).replace('\'', "")
            );
            let output = Command::new("osascript")
                .arg("-e")
                .arg(&applescript)
                .output();
            match output {
                Ok(out) if out.status.success() => return Ok(()),
                _ => {
                    let output = Command::new("open")
                        .arg("-a")
                        .arg("Ghostty")
                        .arg(cwd)
                        .output()
                        .map_err(|e| format!("failed to open Ghostty: {e}"))?;
                    if !output.status.success() {
                        return Err(format!("Ghostty failed with status {}", output.status));
                    }
                    return Ok(());
                }
            }
        }
        "iTerm2" => {
            format!(
                "tell application \"iTerm2\"\nactivate\nset newWindow to (create window with default profile)\ntell current session of newWindow\nwrite text {}\nend tell\nend tell",
                apple_quote(&format!("cd {}", shell_quote(cwd)))
            )
        }
        "Warp" => {
            let output = Command::new("open")
                .arg("-a")
                .arg("Warp")
                .arg(cwd)
                .output()
                .map_err(|e| format!("failed to open Warp: {e}"))?;
            if !output.status.success() {
                return Err(format!("Warp failed with status {}", output.status));
            }
            return Ok(());
        }
        _ => return Err(format!("unsupported terminal app: {app_name}")),
    };
    let output = Command::new("osascript")
        .arg("-e")
        .arg(&script)
        .output()
        .map_err(|e| format!("failed to open {app_name}: {e}"))?;
    if !output.status.success() {
        return Err(format!(
            "{app_name} osascript failed with status {}",
            output.status
        ));
    }
    Ok(())
}

pub fn list_installed_apps() -> Result<Vec<String>, String> {
    let output = Command::new("mdfind")
        .args([
            "kMDItemContentType=com.apple.application-bundle",
            "-onlyin",
            "/Applications",
            "-onlyin",
            &format!(
                "{}/Applications",
                std::env::var("HOME").unwrap_or_default()
            ),
        ])
        .output()
        .map_err(|e| format!("failed to run mdfind: {e}"))?;
    if !output.status.success() {
        return Ok(Vec::new());
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut names: Vec<String> = stdout
        .lines()
        .filter_map(|line| {
            let path = Path::new(line.trim());
            path.file_stem()
                .and_then(|s| s.to_str())
                .map(|s| s.to_string())
        })
        .collect();
    names.sort_unstable_by_key(|a| a.to_lowercase());
    names.dedup();
    Ok(names)
}

pub fn detect_app(app_name: &str) -> bool {
    Command::new("open")
        .arg("-Ra")
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
    let mut command = Command::new("open");
    command.arg("-a").arg(app).args(args).current_dir(cwd);
    let output = command
        .output()
        .map_err(|error| format!("failed to launch {app}: {error}"))?;
    if !output.status.success() {
        return Err(format!("{app} failed with status {}", output.status));
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
    "/bin/zsh".into()
}

pub fn get_user_shell_path() -> &'static str {
    static CACHED: OnceLock<String> = OnceLock::new();
    CACHED.get_or_init(|| {
        let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".into());
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
