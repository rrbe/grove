mod actions;
mod config;
mod git;
mod models;
mod store;

use actions::{
    approve_fingerprints, create_worktree, launch_worktree, mark_worktree_opened, preview_prune,
    prune_repo, remove_worktree, run_hook_event, start_worktree,
};
use config::save;
use models::{
    ApproveCommandsInput, BootstrapResponse, CreateWorktreeInput, LaunchWorktreeInput,
    RemoveWorktreeInput, RepoSnapshot, RunHookEventInput, SaveConfigsInput, StartWorktreeInput,
};
use store::{push_recent, SharedState};
use tauri::{AppHandle, Manager, State};

#[tauri::command]
fn bootstrap(state: State<'_, SharedState>) -> BootstrapResponse {
    let store = state.store.lock().unwrap();
    BootstrapResponse {
        recent_repos: store.recent_repos.clone(),
        tool_statuses: detect_tools(),
    }
}

#[tauri::command]
fn open_repo(
    app: AppHandle,
    state: State<'_, SharedState>,
    repo_root: String,
) -> Result<RepoSnapshot, String> {
    load_repo_snapshot(&app, &state, repo_root)
}

pub fn load_repo_snapshot(
    app: &AppHandle,
    state: &SharedState,
    repo_root: String,
) -> Result<RepoSnapshot, String> {
    let repo_root = git::resolve_repo_root(&repo_root)?;
    let loaded = config::load(&repo_root)?;
    let mut store = state.store.lock().unwrap();
    push_recent(&mut store, &repo_root.to_string_lossy());
    store::persist(app, &store)?;
    let worktrees = git::scan_worktrees(&repo_root, &loaded.merged.cold_start, &store)?;
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
fn save_repo_configs(
    app: AppHandle,
    state: State<'_, SharedState>,
    input: SaveConfigsInput,
) -> Result<RepoSnapshot, String> {
    let repo_root = git::resolve_repo_root(&input.repo_root)?;
    save(
        &repo_root,
        &input.project_config_text,
        &input.local_config_text,
    )?;
    load_repo_snapshot(&app, &state, repo_root.to_string_lossy().to_string())
}

#[tauri::command]
fn approve_repo_commands(
    app: AppHandle,
    state: State<'_, SharedState>,
    input: ApproveCommandsInput,
) -> Result<(), String> {
    let repo_root = git::resolve_repo_root(&input.repo_root)?;
    approve_fingerprints(
        &app,
        &state,
        &repo_root.to_string_lossy(),
        &input.fingerprints,
    )
}

#[tauri::command]
fn create_repo_worktree(
    app: AppHandle,
    state: State<'_, SharedState>,
    input: CreateWorktreeInput,
) -> Result<models::ActionResponse, String> {
    create_worktree(&app, &state, input)
}

#[tauri::command]
fn remove_repo_worktree(
    app: AppHandle,
    state: State<'_, SharedState>,
    input: RemoveWorktreeInput,
) -> Result<models::ActionResponse, String> {
    remove_worktree(&app, &state, input)
}

#[tauri::command]
fn start_repo_worktree(
    app: AppHandle,
    state: State<'_, SharedState>,
    input: StartWorktreeInput,
) -> Result<models::ActionResponse, String> {
    start_worktree(&app, &state, input)
}

#[tauri::command]
fn launch_repo_worktree(
    app: AppHandle,
    state: State<'_, SharedState>,
    input: LaunchWorktreeInput,
) -> Result<models::ActionResponse, String> {
    if let Ok(repo_root) = git::resolve_repo_root(&input.repo_root) {
        let response = launch_worktree(
            &app,
            &state,
            LaunchWorktreeInput {
                repo_root: repo_root.to_string_lossy().to_string(),
                ..input.clone()
            },
        )?;
        if response.status == models::ActionStatus::Completed {
            let _ = mark_worktree_opened(&app, &state, &input.worktree_path);
        }
        return Ok(response);
    }
    launch_worktree(&app, &state, input)
}

#[tauri::command]
fn run_repo_hook_event(
    app: AppHandle,
    state: State<'_, SharedState>,
    input: RunHookEventInput,
) -> Result<models::ActionResponse, String> {
    run_hook_event(&app, &state, input)
}

#[tauri::command]
fn preview_repo_prune(repo_root: String) -> Result<Vec<String>, String> {
    preview_prune(&repo_root)
}

#[tauri::command]
fn prune_repo_metadata(
    app: AppHandle,
    state: State<'_, SharedState>,
    repo_root: String,
) -> Result<models::ActionResponse, String> {
    prune_repo(&app, &state, repo_root)
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
            start_repo_worktree,
            launch_repo_worktree,
            run_repo_hook_event,
            preview_repo_prune,
            prune_repo_metadata
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

fn detect_tools() -> Vec<models::ToolStatus> {
    vec![
        tool_status("terminal", "Terminal", true, None, "app"),
        app_status("vscode", "VS Code", "Visual Studio Code"),
        app_status("cursor", "Cursor", "Cursor"),
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
