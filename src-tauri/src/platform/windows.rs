use std::{
    path::{Path, PathBuf},
    process::Command,
};

pub fn open_terminal_at(terminal_id: &str, cwd: &Path, script: &str) -> Result<(), String> {
    let cwd_str = cwd.to_string_lossy();
    match terminal_id {
        "powershell" => {
            Command::new("pwsh.exe")
                .args(["-NoExit", "-Command", &format!("cd '{}'; {}", cwd_str, script)])
                .spawn()
                .map_err(|e| format!("failed to open PowerShell: {e}"))?;
            Ok(())
        }
        "cmd" => {
            Command::new("cmd.exe")
                .args(["/K", &format!("cd /d \"{}\" && {}", cwd_str, script)])
                .spawn()
                .map_err(|e| format!("failed to open CMD: {e}"))?;
            Ok(())
        }
        // "windows-terminal" or any other id defaults to Windows Terminal
        _ => {
            Command::new("wt.exe")
                .args(["-d", &cwd_str, "cmd", "/K", script])
                .spawn()
                .map_err(|e| format!("failed to open Windows Terminal: {e}"))?;
            Ok(())
        }
    }
}

pub fn open_terminal_app(app_name: &str, cwd: &str) -> Result<(), String> {
    match app_name {
        "Windows Terminal" => {
            Command::new("wt.exe")
                .args(["-d", cwd])
                .spawn()
                .map_err(|e| format!("failed to open Windows Terminal: {e}"))?;
            Ok(())
        }
        "PowerShell" => {
            Command::new("pwsh.exe")
                .args(["-NoExit", "-Command", &format!("cd '{cwd}'")])
                .spawn()
                .map_err(|e| format!("failed to open PowerShell: {e}"))?;
            Ok(())
        }
        "CMD" => {
            Command::new("cmd.exe")
                .args(["/K", &format!("cd /d \"{cwd}\"")])
                .spawn()
                .map_err(|e| format!("failed to open CMD: {e}"))?;
            Ok(())
        }
        _ => Err(format!("unsupported terminal app on Windows: {app_name}")),
    }
}

pub fn list_installed_apps() -> Result<Vec<String>, String> {
    // Windows app discovery via registry is complex; return empty for MVP.
    Ok(Vec::new())
}

pub fn detect_app(app_name: &str) -> bool {
    Command::new("where.exe")
        .arg(app_name)
        .output()
        .is_ok_and(|output| output.status.success())
}

pub fn detect_cli(id: &str) -> Option<String> {
    let output = Command::new("where.exe").arg(id).output().ok()?;
    if output.status.success() {
        let stdout = String::from_utf8_lossy(&output.stdout);
        // where.exe may return multiple lines; take the first
        stdout.lines().next().map(|line| line.trim().to_string())
    } else {
        None
    }
}

pub fn open_app(app: &str, args: &[String], cwd: &Path) -> Result<(), String> {
    let mut command = Command::new("cmd");
    command
        .args(["/C", "start", "", app])
        .args(args)
        .current_dir(cwd);
    let output = command
        .output()
        .map_err(|error| format!("failed to launch {app}: {error}"))?;
    if !output.status.success() {
        return Err(format!("{app} failed with status {}", output.status));
    }
    Ok(())
}

pub fn available_shells() -> Vec<(String, String)> {
    let mut shells = Vec::new();
    // Check if PowerShell Core (pwsh.exe) is available
    if Command::new("where.exe")
        .arg("pwsh.exe")
        .output()
        .is_ok_and(|o| o.status.success())
    {
        shells.push(("pwsh.exe".into(), "PowerShell".into()));
    }
    // CMD is always available
    shells.push(("cmd.exe".into(), "CMD".into()));
    shells
}

pub fn default_shell() -> String {
    if Command::new("where.exe")
        .arg("pwsh.exe")
        .output()
        .is_ok_and(|o| o.status.success())
    {
        "pwsh.exe".into()
    } else {
        "cmd.exe".into()
    }
}

pub fn get_user_shell_path() -> &'static str {
    // Windows doesn't have the launchd PATH problem; return current PATH as-is.
    use std::sync::OnceLock;
    static CACHED: OnceLock<String> = OnceLock::new();
    CACHED.get_or_init(|| std::env::var("PATH").unwrap_or_default())
}

pub fn home_dir() -> Result<PathBuf, String> {
    // Try USERPROFILE first (standard Windows), then HOME
    std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .map(PathBuf::from)
        .map_err(|_| "USERPROFILE and HOME not set".to_string())
}
