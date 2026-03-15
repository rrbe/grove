mod actions;
mod config;
mod git;
mod models;
mod store;

use actions::{
    approve_execution_session, approve_fingerprints, create_worktree, dispose_execution_session,
    get_execution_session, launch_worktree, mark_worktree_opened, preview_prune, prune_repo,
    remove_worktree, run_hook_event, start_remove_worktree_session, start_worktree,
};
use config::save;
use models::{
    ApproveCommandsInput, ApproveExecutionSessionInput, BootstrapResponse, CreateWorktreeInput,
    ExecutionSessionSnapshot, LaunchWorktreeInput, RemoveWorktreeInput, RepoSnapshot,
    RunHookEventInput, SaveConfigsInput, StartWorktreeInput,
};
use store::{push_recent, SharedState};
use tauri::{AppHandle, Manager, State};

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
    let mut loaded = config::load(&repo_root)?;
    let mut store = state.store.lock().unwrap();
    let repo_root_str = repo_root.to_string_lossy().to_string();
    // Apply per-repo worktree root from app store (highest priority).
    if let Some(root) = store.repo_worktree_roots.get(&repo_root_str) {
        loaded.merged.settings.worktree_root = root.clone();
    }
    push_recent(&mut store, &repo_root_str);
    store.last_active_repo = Some(repo_root_str.clone());
    store::persist(app, &store)?;
    let worktrees = git::scan_worktrees(&repo_root, &loaded.merged.cold_start, &store)?;

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
        config_paths: loaded.paths,
        project_config_text: loaded.project_text,
        local_config_text: loaded.local_text,
        config_errors: loaded.errors,
        merged_config: loaded.merged,
        worktrees,
        recent_repos: store.recent_repos.clone(),
        tool_statuses: detect_tools(),
    })
}

#[tauri::command]
async fn save_repo_configs(
    app: AppHandle,
    input: SaveConfigsInput,
) -> Result<RepoSnapshot, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<SharedState>();
        let repo_root = git::resolve_repo_root(&input.repo_root)?;
        save(
            &repo_root,
            &input.project_config_text,
            &input.local_config_text,
        )?;
        load_repo_snapshot(&app, &state, repo_root.to_string_lossy().to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn approve_repo_commands(app: AppHandle, input: ApproveCommandsInput) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<SharedState>();
        let repo_root = git::resolve_repo_root(&input.repo_root)?;
        approve_fingerprints(
            &app,
            &state,
            &repo_root.to_string_lossy(),
            &input.fingerprints,
        )
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
        create_worktree(&app, &state, input, dt.as_deref())
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
        remove_worktree(&app, &state, input, dt.as_deref())
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
        start_remove_worktree_session(&app, &state, input, dt.as_deref())
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
async fn approve_execution_session_commands(
    app: AppHandle,
    input: ApproveExecutionSessionInput,
) -> Result<ExecutionSessionSnapshot, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<SharedState>();
        approve_execution_session(&app, &state, input)
    })
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
async fn start_repo_worktree(
    app: AppHandle,
    input: StartWorktreeInput,
) -> Result<models::ActionResponse, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<SharedState>();
        let dt = read_default_terminal(&state);
        let response = start_worktree(&app, &state, input.clone(), dt.as_deref())?;
        if response.status == models::ActionStatus::Completed {
            let _ = mark_worktree_opened(&app, &state, &input.worktree_path);
        }
        Ok(response)
    })
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
        if let Ok(repo_root) = git::resolve_repo_root(&input.repo_root) {
            let response = launch_worktree(
                &app,
                &state,
                LaunchWorktreeInput {
                    repo_root: repo_root.to_string_lossy().to_string(),
                    ..input.clone()
                },
                dt.as_deref(),
            )?;
            if response.status == models::ActionStatus::Completed {
                let _ = mark_worktree_opened(&app, &state, &input.worktree_path);
            }
            return Ok(response);
        }
        launch_worktree(&app, &state, input, dt.as_deref())
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
        run_hook_event(&app, &state, input, dt.as_deref())
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

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            app.manage(SharedState::load(app.handle())?);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            bootstrap,
            open_repo,
            save_repo_configs,
            approve_repo_commands,
            create_repo_worktree,
            remove_repo_worktree,
            start_remove_repo_worktree_session,
            get_execution_session_snapshot,
            approve_execution_session_commands,
            dispose_execution_session_snapshot,
            start_repo_worktree,
            launch_repo_worktree,
            run_repo_hook_event,
            preview_repo_prune,
            prune_repo_metadata,
            list_branches,
            list_remote_branches,
            fetch_remote,
            get_default_terminal,
            set_default_terminal,
            set_repo_worktree_root
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
    for id in &["ghostty", "iterm2", "terminal"] {
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
            store
                .repo_worktree_roots
                .insert(repo_root_str.clone(), worktree_root);
            store::persist(&app, &store)?;
        }
        load_repo_snapshot(&app, &state, repo_root_str)
    })
    .await
    .map_err(|e| e.to_string())?
}

fn read_default_terminal(state: &SharedState) -> Option<String> {
    state.store.lock().unwrap().default_terminal.clone()
}

fn detect_tools() -> Vec<models::ToolStatus> {
    vec![
        app_status("vscode", "VS Code", "Visual Studio Code"),
        app_status("cursor", "Cursor", "Cursor"),
        tool_status("terminal", "Terminal", true, None, "app"),
        app_status("ghostty", "Ghostty", "Ghostty"),
        app_status("iterm2", "iTerm2", "iTerm"),
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

fn cli_status(id: &str, label: &str) -> models::ToolStatus {
    let output = std::process::Command::new("which").arg(id).output();
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
