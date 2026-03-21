mod actions;
mod config;
mod git;
mod models;
mod store;

use actions::{
    create_worktree, dispose_execution_session, get_execution_session, launch_worktree,
    mark_worktree_opened, preview_prune, prune_repo, remove_worktree, run_hook_event,
    start_remove_worktree_session,
};
use models::{
    BootstrapResponse, CreateWorktreeInput, DeleteCustomLauncherInput, ExecutionSessionSnapshot,
    LaunchWorktreeInput, RemoveWorktreeInput, RepoSnapshot, RunHookEventInput, SaveConfigInput,
    SaveCustomLauncherInput, SaveHooksInput, ShellInfo,
};
use std::sync::OnceLock;
use store::{push_recent, SharedState};
use tauri::{
    image::Image,
    menu::{AboutMetadataBuilder, MenuBuilder, MenuItemBuilder, SubmenuBuilder},
    tray::TrayIconBuilder,
    AppHandle, Emitter, Manager, State,
};

#[tauri::command]
fn bootstrap(state: State<'_, SharedState>) -> BootstrapResponse {
    let store = state.store.lock().unwrap();
    BootstrapResponse {
        recent_repos: store.recent_repos.clone(),
        tool_statuses: detect_tools(),
        last_active_repo: store.last_active_repo.clone(),
    }
}

#[tauri::command]
async fn open_repo(app: AppHandle, repo_root: String) -> Result<RepoSnapshot, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<SharedState>();
        load_repo_snapshot(&app, &state, repo_root)
    })
    .await
    .map_err(|e| e.to_string())?
}

pub fn load_repo_snapshot(
    app: &AppHandle,
    state: &SharedState,
    repo_root: String,
) -> Result<RepoSnapshot, String> {
    let repo_root = git::resolve_repo_root(&repo_root)?;
    let mut store = state.store.lock().unwrap();
    let repo_root_str = repo_root.to_string_lossy().to_string();
    let stored_config = store.repo_configs.get(&repo_root_str).cloned();
    push_recent(&mut store, &repo_root_str);
    store.last_active_repo = Some(repo_root_str.clone());
    store::persist(app, &store)?;
    let loaded = config::load(&repo_root, stored_config.as_ref(), &store.custom_launchers);
    let worktrees = git::scan_worktrees(&repo_root, &store)?;

    // Update PR cache with freshly fetched data
    for wt in &worktrees {
        if let (Some(branch), Some(pr_number), Some(pr_url)) =
            (&wt.branch, wt.pr_number, &wt.pr_url)
        {
            store.pr_cache.insert(
                branch.clone(),
                store::PrCacheEntry {
                    pr_number,
                    pr_url: pr_url.clone(),
                    fetched_at: chrono::Utc::now().to_rfc3339(),
                },
            );
        }
    }
    let _ = store::persist(app, &store);

    let main_worktree_path = worktrees
        .iter()
        .find(|worktree| worktree.is_main)
        .map(|worktree| worktree.path.clone())
        .unwrap_or_else(|| repo_root.to_string_lossy().to_string());
    Ok(RepoSnapshot {
        repo_root: repo_root.to_string_lossy().to_string(),
        main_worktree_path,
        config_text: loaded.text,
        config_errors: loaded.errors,
        merged_config: loaded.merged,
        worktrees,
        recent_repos: store.recent_repos.clone(),
        tool_statuses: detect_tools(),
    })
}

#[tauri::command]
async fn save_repo_config(
    app: AppHandle,
    input: SaveConfigInput,
) -> Result<RepoSnapshot, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<SharedState>();
        let repo_root = git::resolve_repo_root(&input.repo_root)?;
        let parsed = config::parse_config_text(&input.config_text)?;
        let repo_root_str = repo_root.to_string_lossy().to_string();
        {
            let mut store = state.store.lock().unwrap();
            if let Some(config) = parsed {
                store.repo_configs.insert(repo_root_str.clone(), config);
            } else {
                store.repo_configs.remove(&repo_root_str);
            }
            store::persist(&app, &store)?;
        }
        load_repo_snapshot(&app, &state, repo_root_str)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn save_repo_hooks(
    app: AppHandle,
    input: SaveHooksInput,
) -> Result<RepoSnapshot, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<SharedState>();
        let repo_root = git::resolve_repo_root(&input.repo_root)?;
        let mut parsed = config::parse_config_text(&input.config_text)?.unwrap_or_default();
        parsed.hooks = input.hooks;
        let repo_root_str = repo_root.to_string_lossy().to_string();
        {
            let mut store = state.store.lock().unwrap();
            if config::is_effectively_empty(&parsed) {
                store.repo_configs.remove(&repo_root_str);
            } else {
                store.repo_configs.insert(repo_root_str.clone(), parsed);
            }
            store::persist(&app, &store)?;
        }
        load_repo_snapshot(&app, &state, repo_root_str)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn create_repo_worktree(
    app: AppHandle,
    input: CreateWorktreeInput,
) -> Result<models::ActionResponse, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<SharedState>();
        let dt = read_default_terminal(&state);
        let ds = read_default_shell(&state);
        create_worktree(&app, &state, input, dt.as_deref(), &ds)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn remove_repo_worktree(
    app: AppHandle,
    input: RemoveWorktreeInput,
) -> Result<models::ActionResponse, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<SharedState>();
        let dt = read_default_terminal(&state);
        let ds = read_default_shell(&state);
        remove_worktree(&app, &state, input, dt.as_deref(), &ds)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn start_remove_repo_worktree_session(
    app: AppHandle,
    input: RemoveWorktreeInput,
) -> Result<ExecutionSessionSnapshot, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<SharedState>();
        let dt = read_default_terminal(&state);
        let ds = read_default_shell(&state);
        start_remove_worktree_session(&app, &state, input, dt.as_deref(), &ds)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn get_execution_session_snapshot(
    session_id: String,
) -> Result<ExecutionSessionSnapshot, String> {
    tauri::async_runtime::spawn_blocking(move || get_execution_session(&session_id))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn dispose_execution_session_snapshot(session_id: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || dispose_execution_session(&session_id))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn launch_repo_worktree(
    app: AppHandle,
    input: LaunchWorktreeInput,
) -> Result<models::ActionResponse, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<SharedState>();
        let dt = read_default_terminal(&state);
        let ds = read_default_shell(&state);
        if let Ok(repo_root) = git::resolve_repo_root(&input.repo_root) {
            let response = launch_worktree(
                &app,
                &state,
                LaunchWorktreeInput {
                    repo_root: repo_root.to_string_lossy().to_string(),
                    ..input.clone()
                },
                dt.as_deref(),
                &ds,
            )?;
            let _ = mark_worktree_opened(&app, &state, &input.worktree_path);
            return Ok(response);
        }
        launch_worktree(&app, &state, input, dt.as_deref(), &ds)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn run_repo_hook_event(
    app: AppHandle,
    input: RunHookEventInput,
) -> Result<models::ActionResponse, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<SharedState>();
        let dt = read_default_terminal(&state);
        let ds = read_default_shell(&state);
        run_hook_event(&app, &state, input, dt.as_deref(), &ds)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn preview_repo_prune(repo_root: String) -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(move || preview_prune(&repo_root))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn prune_repo_metadata(
    app: AppHandle,
    repo_root: String,
) -> Result<models::ActionResponse, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<SharedState>();
        prune_repo(&app, &state, repo_root)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn detect_install_command(repo_root: String) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        Ok(actions::detect_install_command(std::path::Path::new(&repo_root)))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn list_installed_apps() -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let output = std::process::Command::new("mdfind")
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
                let path = std::path::Path::new(line.trim());
                path.file_stem()
                    .and_then(|s| s.to_str())
                    .map(|s| s.to_string())
            })
            .collect();
        names.sort_unstable_by(|a, b| a.to_lowercase().cmp(&b.to_lowercase()));
        names.dedup();
        Ok(names)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn save_custom_launcher(
    app: AppHandle,
    input: SaveCustomLauncherInput,
) -> Result<RepoSnapshot, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<SharedState>();
        let mut store = state.store.lock().unwrap();
        let launcher = input.launcher;
        match &input.repo_root {
            Some(repo_root) => {
                let config = store.repo_configs.entry(repo_root.clone()).or_default();
                config.launchers.retain(|l| l.id != launcher.id);
                config.launchers.push(launcher);
            }
            None => {
                store.custom_launchers.retain(|l| l.id != launcher.id);
                store.custom_launchers.push(launcher);
            }
        }
        store::persist(&app, &store)?;
        let repo_root_str = input.repo_root.unwrap_or_else(|| {
            store.last_active_repo.clone().unwrap_or_default()
        });
        drop(store);
        load_repo_snapshot(&app, &state, repo_root_str)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn delete_custom_launcher(
    app: AppHandle,
    input: DeleteCustomLauncherInput,
) -> Result<RepoSnapshot, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<SharedState>();
        let mut store = state.store.lock().unwrap();
        // Remove from global custom launchers
        store.custom_launchers.retain(|l| l.id != input.launcher_id);
        // Also remove from repo-level config if a repo is specified
        if let Some(repo_root) = &input.repo_root {
            if let Some(config) = store.repo_configs.get_mut(repo_root) {
                config.launchers.retain(|l| l.id != input.launcher_id);
            }
        }
        store::persist(&app, &store)?;
        let repo_root_str = input.repo_root.unwrap_or_else(|| {
            store.last_active_repo.clone().unwrap_or_default()
        });
        drop(store);
        load_repo_snapshot(&app, &state, repo_root_str)
    })
    .await
    .map_err(|e| e.to_string())?
}

pub fn run() {
    // Fix PATH for packaged macOS apps. Apps launched from Finder/Dock inherit a
    // minimal launchd PATH (/usr/bin:/bin:/usr/sbin:/sbin) that excludes
    // user-installed tools (Homebrew, nvm, pnpm, cargo, etc.). Resolve the full
    // PATH from the user's login shell and apply it process-wide so ALL child
    // processes (hooks, install commands, git) inherit it automatically.
    #[cfg(not(target_os = "windows"))]
    unsafe {
        std::env::set_var("PATH", get_user_shell_path());
    }

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let state = SharedState::load(app.handle())?;
            let tray_enabled = state
                .store
                .lock()
                .unwrap()
                .show_tray_icon
                .unwrap_or(true);
            app.manage(state);
            if tray_enabled {
                setup_tray(app.handle());
            }
            setup_menu(app.handle())?;
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let app = window.app_handle();
                let state = app.state::<SharedState>();
                let tray_enabled = state
                    .store
                    .lock()
                    .unwrap()
                    .show_tray_icon
                    .unwrap_or(true);
                if tray_enabled {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            bootstrap,
            open_repo,
            save_repo_config,
            save_repo_hooks,
            create_repo_worktree,
            remove_repo_worktree,
            start_remove_repo_worktree_session,
            get_execution_session_snapshot,
            dispose_execution_session_snapshot,
            launch_repo_worktree,
            run_repo_hook_event,
            preview_repo_prune,
            prune_repo_metadata,
            list_branches,
            list_remote_branches,
            fetch_remote,
            get_default_terminal,
            set_default_terminal,
            list_available_shells,
            get_default_shell,
            set_default_shell,
            set_repo_worktree_root,
            get_file_diff,
            detect_install_command,
            list_installed_apps,
            save_custom_launcher,
            delete_custom_launcher,
            get_show_tray_icon,
            set_show_tray_icon,
            get_theme_mode,
            set_theme_mode
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[tauri::command]
async fn list_branches(repo_root: String) -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let repo_root = git::resolve_repo_root(&repo_root)?;
        git::list_local_branches(&repo_root)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn list_remote_branches(repo_root: String) -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let repo_root = git::resolve_repo_root(&repo_root)?;
        git::list_remote_branches(&repo_root)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn fetch_remote(repo_root: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let repo_root = git::resolve_repo_root(&repo_root)?;
        git::fetch_remote(&repo_root)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
fn get_default_terminal(state: State<'_, SharedState>) -> String {
    let store = state.store.lock().unwrap();
    if let Some(ref id) = store.default_terminal {
        return id.clone();
    }
    // Auto-detect: prefer ghostty > iterm2 > terminal
    drop(store);
    let tools = detect_tools();
    for id in &["ghostty", "warp", "iterm2", "terminal"] {
        if tools.iter().any(|t| t.id == *id && t.available) {
            return id.to_string();
        }
    }
    "terminal".into()
}

#[tauri::command]
fn set_default_terminal(
    app: AppHandle,
    state: State<'_, SharedState>,
    terminal_id: String,
) -> Result<(), String> {
    let mut store = state.store.lock().unwrap();
    store.default_terminal = Some(terminal_id);
    store::persist(&app, &store)
}

#[tauri::command]
async fn set_repo_worktree_root(
    app: AppHandle,
    repo_root: String,
    worktree_root: String,
) -> Result<RepoSnapshot, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<SharedState>();
        let repo_root = git::resolve_repo_root(&repo_root)?;
        let repo_root_str = repo_root.to_string_lossy().to_string();
        {
            let mut store = state.store.lock().unwrap();
            let worktree_root = worktree_root.trim().to_string();
            let config = store.repo_configs.entry(repo_root_str.clone()).or_default();
            if worktree_root.is_empty() {
                config.settings.worktree_root = None;
            } else {
                config.settings.worktree_root = Some(worktree_root);
            }
            store::persist(&app, &store)?;
        }
        load_repo_snapshot(&app, &state, repo_root_str)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn get_file_diff(
    worktree_path: String,
    file_path: String,
    status: String,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        git::file_diff(std::path::Path::new(&worktree_path), &file_path, &status)
    })
    .await
    .map_err(|e| e.to_string())?
}

fn read_default_terminal(state: &SharedState) -> Option<String> {
    state.store.lock().unwrap().default_terminal.clone()
}

fn read_default_shell(state: &SharedState) -> String {
    state
        .store
        .lock()
        .unwrap()
        .default_shell
        .clone()
        .unwrap_or_else(|| "/bin/bash".to_string())
}

#[tauri::command]
fn list_available_shells() -> Vec<ShellInfo> {
    let content = match std::fs::read_to_string("/etc/shells") {
        Ok(c) => c,
        Err(_) => return vec![ShellInfo { path: "/bin/bash".into(), label: "bash".into() }],
    };
    let mut shells = Vec::new();
    for line in content.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let path = std::path::Path::new(line);
        if !path.exists() {
            continue;
        }
        let label = path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or(line)
            .to_string();
        shells.push(ShellInfo {
            path: line.to_string(),
            label,
        });
    }
    if shells.is_empty() {
        shells.push(ShellInfo { path: "/bin/bash".into(), label: "bash".into() });
    }
    shells
}

#[tauri::command]
fn get_default_shell(state: State<'_, SharedState>) -> String {
    read_default_shell(&state)
}

#[tauri::command]
fn set_default_shell(
    app: AppHandle,
    state: State<'_, SharedState>,
    shell: String,
) -> Result<(), String> {
    let mut store = state.store.lock().unwrap();
    store.default_shell = Some(shell);
    store::persist(&app, &store)
}

#[tauri::command]
fn get_show_tray_icon(state: State<'_, SharedState>) -> bool {
    state
        .store
        .lock()
        .unwrap()
        .show_tray_icon
        .unwrap_or(true)
}

#[tauri::command]
fn set_show_tray_icon(
    app: AppHandle,
    state: State<'_, SharedState>,
    enabled: bool,
) -> Result<(), String> {
    {
        let mut store = state.store.lock().unwrap();
        store.show_tray_icon = Some(enabled);
        store::persist(&app, &store)?;
    }
    if enabled {
        setup_tray(&app);
    } else {
        // Remove existing tray icon
        if let Some(tray) = app.tray_by_id("grove-tray") {
            let _ = tray.set_visible(false);
        }
    }
    Ok(())
}

#[tauri::command]
fn get_theme_mode(state: State<'_, SharedState>) -> String {
    state
        .store
        .lock()
        .unwrap()
        .theme_mode
        .clone()
        .unwrap_or_else(|| "system".to_string())
}

#[tauri::command]
fn set_theme_mode(
    app: AppHandle,
    state: State<'_, SharedState>,
    mode: String,
) -> Result<(), String> {
    let mut store = state.store.lock().unwrap();
    store.theme_mode = Some(mode);
    store::persist(&app, &store)
}

fn setup_menu(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let about = AboutMetadataBuilder::new()
        .name(Some("Grove"))
        .version(Some(env!("CARGO_PKG_VERSION")))
        .build();

    let settings_item = MenuItemBuilder::with_id("settings", "Settings…")
        .accelerator("CmdOrCtrl+,")
        .build(app)?;

    let app_submenu = SubmenuBuilder::new(app, "Grove")
        .about(Some(about))
        .separator()
        .item(&settings_item)
        .separator()
        .services()
        .separator()
        .hide()
        .hide_others()
        .show_all()
        .separator()
        .quit()
        .build()?;

    let edit_submenu = SubmenuBuilder::new(app, "Edit")
        .undo()
        .redo()
        .separator()
        .cut()
        .copy()
        .paste()
        .select_all()
        .build()?;

    let view_submenu = SubmenuBuilder::new(app, "View")
        .fullscreen()
        .build()?;

    let window_submenu = SubmenuBuilder::new(app, "Window")
        .minimize()
        .separator()
        .close_window()
        .build()?;

    let menu = MenuBuilder::new(app)
        .item(&app_submenu)
        .item(&edit_submenu)
        .item(&view_submenu)
        .item(&window_submenu)
        .build()?;

    app.set_menu(menu)?;

    let handle = app.clone();
    app.on_menu_event(move |_app, event| {
        if event.id().as_ref() == "settings" {
            let _ = handle.emit("menu-settings", ());
        }
    });

    Ok(())
}

fn setup_tray(app: &AppHandle) {
    // If tray already exists, just make it visible
    if let Some(existing) = app.tray_by_id("grove-tray") {
        let _ = existing.set_visible(true);
        return;
    }

    let icon = Image::from_bytes(include_bytes!("../icons/tray-icon.png"))
        .expect("failed to load tray icon");

    let show_item = MenuItemBuilder::with_id("show", "Show Grove").build(app).unwrap();
    let quit_item = MenuItemBuilder::with_id("quit", "Quit").build(app).unwrap();
    let menu = MenuBuilder::new(app)
        .item(&show_item)
        .separator()
        .item(&quit_item)
        .build()
        .unwrap();

    TrayIconBuilder::with_id("grove-tray")
        .icon(icon)
        .icon_as_template(true)
        .menu(&menu)
        .tooltip("Grove")
        .on_menu_event(|app, event| match event.id().as_ref() {
            "show" => {
                if let Some(win) = app.get_webview_window("main") {
                    let _ = win.show();
                    let _ = win.unminimize();
                    let _ = win.set_focus();
                }
            }
            "quit" => {
                app.exit(0);
            }
            _ => {}
        })
        .show_menu_on_left_click(false)
        .on_tray_icon_event(|tray, event| {
            if let tauri::tray::TrayIconEvent::Click {
                button: tauri::tray::MouseButton::Left,
                ..
            } = event
            {
                let app = tray.app_handle();
                if let Some(win) = app.get_webview_window("main") {
                    let _ = win.show();
                    let _ = win.unminimize();
                    let _ = win.set_focus();
                }
            }
        })
        .build(app)
        .expect("failed to build tray icon");
}

fn detect_tools() -> Vec<models::ToolStatus> {
    vec![
        app_status("vscode", "VS Code", "Visual Studio Code"),
        app_status("cursor", "Cursor", "Cursor"),
        tool_status("terminal", "Terminal", true, None, "app"),
        app_status("ghostty", "Ghostty", "Ghostty"),
        app_status("iterm2", "iTerm2", "iTerm"),
        app_status("warp", "Warp", "Warp"),
        cli_status("claude", "Claude CLI"),
        cli_status("codex", "Codex CLI"),
        cli_status("gemini", "Gemini CLI"),
    ]
}

fn tool_status(
    id: &str,
    label: &str,
    available: bool,
    location: Option<String>,
    kind: &str,
) -> models::ToolStatus {
    models::ToolStatus {
        id: id.into(),
        label: label.into(),
        available,
        location,
        kind: kind.into(),
    }
}

/// Returns the full PATH as seen by the user's login shell.
///
/// macOS apps launched from Finder/Dock inherit a minimal PATH from launchd
/// (`/usr/bin:/bin:/usr/sbin:/sbin`), which doesn't include paths added by
/// the user's shell profile (e.g. homebrew, nvm, cargo, etc.).
/// We resolve this once by spawning a login shell and printing $PATH.
fn get_user_shell_path() -> &'static str {
    static CACHED: OnceLock<String> = OnceLock::new();
    CACHED.get_or_init(|| {
        // Determine user's login shell (defaults to zsh on modern macOS)
        let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".into());

        // -ilc: interactive login shell, then run a command
        // This sources ~/.zshrc / ~/.bashrc / ~/.profile etc.
        let output = std::process::Command::new(&shell)
            .args(["-ilc", "echo __GROVE_PATH__${PATH}__GROVE_PATH__"])
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::null())
            .output();

        if let Ok(out) = output {
            let stdout = String::from_utf8_lossy(&out.stdout);
            // Extract PATH between markers to avoid shell greeting noise
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

        // Fallback: current process PATH
        std::env::var("PATH").unwrap_or_default()
    })
}

fn cli_status(id: &str, label: &str) -> models::ToolStatus {
    let output = std::process::Command::new("which")
        .arg(id)
        .output();
    match output {
        Ok(output) if output.status.success() => tool_status(
            id,
            label,
            true,
            Some(String::from_utf8_lossy(&output.stdout).trim().into()),
            "cli",
        ),
        _ => tool_status(id, label, false, None, "cli"),
    }
}

fn app_status(id: &str, label: &str, app_name: &str) -> models::ToolStatus {
    let output = std::process::Command::new("open")
        .arg("-Ra")
        .arg(app_name)
        .output();
    match output {
        Ok(output) if output.status.success() => {
            tool_status(id, label, true, Some(app_name.into()), "app")
        }
        _ => tool_status(id, label, false, None, "app"),
    }
}
