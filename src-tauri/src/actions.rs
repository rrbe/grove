use crate::{
    config::{self, LoadedConfig},
    git,
    models::{
        ActionResponse, CreateMode, CreateWorktreeInput, ExecutionEvent, ExecutionEventKind,
        ExecutionSessionSnapshot, ExecutionStatus, HookEvent, HookStepType,
        LaunchWorktreeInput, LauncherKind, LauncherProfile, LogLevel,
        RemoveWorktreeInput, RunHookEventInput, RunLog, WorktreeRecord,
    },
    store::{persist, push_recent, touch_worktree, SharedState},
};
use chrono::Utc;
use std::{
    collections::BTreeMap,
    fs,
    io::{BufRead, BufReader},
    path::{Component, Path, PathBuf},
    process::{Command, Stdio},
    sync::{
        atomic::{AtomicU64, Ordering},
        mpsc, LazyLock, Mutex,
    },
    thread,
};
use tauri::{AppHandle, Emitter, Manager};

#[derive(Clone)]
struct TemplateContext {
    values: BTreeMap<String, String>,
}

#[derive(Clone)]
enum ExecutionStep {
    GitCreate {
        repo_root: PathBuf,
        mode: CreateMode,
        branch: String,
        base_ref: Option<String>,
        remote_ref: Option<String>,
        worktree_path: PathBuf,
    },
    GitRemove {
        repo_root: PathBuf,
        worktree_path: PathBuf,
        force: bool,
        unlock_first: bool,
    },
    GitPrune {
        repo_root: PathBuf,
    },
    InstallDependencies {
        label: String,
        worktree_path: PathBuf,
        custom_command: Option<String>,
        shell: String,
    },
    CopyProjectFiles {
        label: String,
        repo_root: PathBuf,
        worktree_path: PathBuf,
        paths: Vec<String>,
    },
    Script {
        label: String,
        cwd: PathBuf,
        command: String,
        context: TemplateContext,
        shell: String,
    },
    Launch {
        label: String,
        cwd: PathBuf,
        launcher: LauncherProfile,
        command_preview: String,
        rendered_args: Vec<String>,
        context: TemplateContext,
        terminal_id: Option<String>,
    },
}

const EXECUTION_EVENT_NAME: &str = "execution-event";

static EXECUTION_SESSIONS: LazyLock<Mutex<BTreeMap<String, ExecutionSessionState>>> =
    LazyLock::new(|| Mutex::new(BTreeMap::new()));
static NEXT_SESSION_ID: AtomicU64 = AtomicU64::new(1);

#[derive(Clone)]
struct ExecutionSessionState {
    snapshot: ExecutionSessionSnapshot,
}

#[derive(Clone)]
struct PlannedExecution {
    repo_root: PathBuf,
    title: String,
    steps: Vec<ExecutionStep>,
}

pub fn create_worktree(
    app: &AppHandle,
    state: &SharedState,
    input: CreateWorktreeInput,
    default_terminal: Option<&str>,
    default_shell: &str,
) -> Result<ActionResponse, String> {
    let repo_root = git::resolve_repo_root(&input.repo_root)?;
    let loaded = load_repo_config(state, &repo_root);
    let default_remote = git::detect_default_remote(&repo_root).unwrap_or_else(|| "origin".into());
    let branch = input.branch.trim().to_string();
    if branch.is_empty() {
        return Err("branch cannot be empty".into());
    }
    let base_ref = input
        .base_ref
        .clone()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| loaded.merged.settings.default_base_branch.clone());
    let worktree_path = resolve_create_path(&repo_root, &loaded, &branch, input.path.as_deref())?;
    let head_sha = match input.mode {
        CreateMode::NewBranch => git::resolve_head_sha(&repo_root, &base_ref)?,
        CreateMode::ExistingBranch => {
            git::resolve_head_sha(&repo_root, &format!("refs/heads/{branch}"))?
        }
        CreateMode::RemoteBranch => {
            let remote_ref = input
                .remote_ref
                .clone()
                .ok_or_else(|| "remote branch mode requires remoteRef".to_string())?;
            git::resolve_head_sha(&repo_root, &remote_ref)?
        }
    };
    let context = build_context(
        &repo_root,
        &worktree_path,
        Some(branch.clone()),
        Some(base_ref.clone()),
        head_sha,
        false,
        default_remote,
    );

    let mut steps = Vec::new();
    steps.extend(plan_hooks(
        &repo_root,
        &loaded,
        HookEvent::PreCreate,
        &context,
        default_terminal,
        default_shell,
    )?);
    steps.push(ExecutionStep::GitCreate {
        repo_root: repo_root.clone(),
        mode: input.mode,
        branch: branch.clone(),
        base_ref: Some(base_ref.clone()),
        remote_ref: input.remote_ref.clone(),
        worktree_path: worktree_path.clone(),
    });
    steps.extend(plan_hooks(
        &repo_root,
        &loaded,
        HookEvent::PostCreate,
        &context,
        default_terminal,
        default_shell,
    )?);

    if !input.auto_start_launchers.is_empty() {
        for launcher_id in &input.auto_start_launchers {
            steps.extend(plan_launch_action(
                &repo_root,
                &loaded,
                &context,
                launcher_id,
                None,
                false,
                default_terminal,
            )?);
        }
    }

    execute(app, state, &repo_root, steps)
}

pub fn remove_worktree(
    app: &AppHandle,
    state: &SharedState,
    input: RemoveWorktreeInput,
    default_terminal: Option<&str>,
    default_shell: &str,
) -> Result<ActionResponse, String> {
    let planned = plan_remove_worktree_execution(state, input, default_terminal, default_shell)?;
    execute(app, state, &planned.repo_root, planned.steps)
}

pub fn start_remove_worktree_session(
    app: &AppHandle,
    state: &SharedState,
    input: RemoveWorktreeInput,
    default_terminal: Option<&str>,
    default_shell: &str,
) -> Result<ExecutionSessionSnapshot, String> {
    let planned = plan_remove_worktree_execution(state, input, default_terminal, default_shell)?;
    let session_id = next_session_id();
    let snapshot = ExecutionSessionSnapshot {
        session_id: session_id.clone(),
        title: planned.title,
        repo_root: planned.repo_root.to_string_lossy().to_string(),
        status: ExecutionStatus::Running,
        logs: Vec::new(),
        repo: None,
        error: None,
    };

    insert_session(ExecutionSessionState {
        snapshot: snapshot.clone(),
    });
    spawn_session_execution(app.clone(), session_id, planned.repo_root, planned.steps);

    Ok(snapshot)
}

pub fn get_execution_session(session_id: &str) -> Result<ExecutionSessionSnapshot, String> {
    session_snapshot(session_id).ok_or_else(|| format!("execution session not found: {session_id}"))
}

pub fn dispose_execution_session(session_id: &str) -> Result<(), String> {
    remove_session(session_id);
    Ok(())
}

pub fn run_hook_event(
    app: &AppHandle,
    state: &SharedState,
    input: RunHookEventInput,
    default_terminal: Option<&str>,
    default_shell: &str,
) -> Result<ActionResponse, String> {
    run_event_internal(
        app,
        state,
        input.repo_root,
        input.event,
        input.worktree_path,
        default_terminal,
        default_shell,
    )
}

pub fn launch_worktree(
    app: &AppHandle,
    state: &SharedState,
    input: LaunchWorktreeInput,
    default_terminal: Option<&str>,
    default_shell: &str,
) -> Result<ActionResponse, String> {
    let repo_root = git::resolve_repo_root(&input.repo_root)?;
    let loaded = load_repo_config(state, &repo_root);
    let worktrees = git::scan_worktrees(
        &repo_root,
        &state.store.lock().unwrap(),
    )?;
    let worktree = find_worktree(&worktrees, &input.worktree_path)?;
    let context = build_context_from_worktree(&repo_root, &loaded, worktree, false);
    let mut steps = plan_hooks(
        &repo_root,
        &loaded,
        HookEvent::PreLaunch,
        &context,
        default_terminal,
        default_shell,
    )?;
    steps.extend(plan_launch_action(
        &repo_root,
        &loaded,
        &context,
        &input.launcher_id,
        input.prompt_override.as_deref(),
        true,
        default_terminal,
    )?);
    steps.extend(plan_hooks(
        &repo_root,
        &loaded,
        HookEvent::PostLaunch,
        &context,
        default_terminal,
        default_shell,
    )?);
    execute(app, state, &repo_root, steps)
}

pub fn preview_prune(repo_root: &str) -> Result<Vec<String>, String> {
    let repo_root = git::resolve_repo_root(repo_root)?;
    git::list_prune_candidates(&repo_root)
}

pub fn prune_repo(
    app: &AppHandle,
    state: &SharedState,
    repo_root: String,
) -> Result<ActionResponse, String> {
    let repo_root = git::resolve_repo_root(&repo_root)?;
    let steps = vec![ExecutionStep::GitPrune {
        repo_root: repo_root.clone(),
    }];
    execute(app, state, &repo_root, steps)
}

fn run_event_internal(
    app: &AppHandle,
    state: &SharedState,
    repo_root: String,
    event: HookEvent,
    worktree_path: Option<String>,
    default_terminal: Option<&str>,
    default_shell: &str,
) -> Result<ActionResponse, String> {
    let repo_root = git::resolve_repo_root(&repo_root)?;
    let loaded = load_repo_config(state, &repo_root);
    let worktree_context = if let Some(path) = worktree_path {
        let worktrees = git::scan_worktrees(
            &repo_root,
            &state.store.lock().unwrap(),
        )?;
        let worktree = find_worktree(&worktrees, &path)?;
        build_context_from_worktree(&repo_root, &loaded, worktree, false)
    } else {
        build_context(
            &repo_root,
            &repo_root,
            None,
            Some(loaded.merged.settings.default_base_branch.clone()),
            git::resolve_head_sha(&repo_root, "HEAD")?,
            true,
            git::detect_default_remote(&repo_root).unwrap_or_else(|| "origin".into()),
        )
    };
    let steps = plan_hooks(
        &repo_root,
        &loaded,
        event,
        &worktree_context,
        default_terminal,
        default_shell,
    )?;
    execute(app, state, &repo_root, steps)
}

fn plan_remove_worktree_execution(
    state: &SharedState,
    input: RemoveWorktreeInput,
    default_terminal: Option<&str>,
    default_shell: &str,
) -> Result<PlannedExecution, String> {
    let repo_root = git::resolve_repo_root(&input.repo_root)?;
    let loaded = load_repo_config(state, &repo_root);
    let worktrees = git::scan_worktrees(
        &repo_root,
        &state.store.lock().unwrap(),
    )?;
    let worktree = find_worktree(&worktrees, &input.worktree_path)?;
    if worktree.is_main {
        return Err("cannot remove the main worktree".into());
    }
    let context = build_context_from_worktree(&repo_root, &loaded, worktree, false);
    let mut steps = plan_hooks(
        &repo_root,
        &loaded,
        HookEvent::PreRemove,
        &context,
        default_terminal,
        default_shell,
    )?;
    steps.push(ExecutionStep::GitRemove {
        repo_root: repo_root.clone(),
        worktree_path: PathBuf::from(&worktree.path),
        force: input.force,
        unlock_first: input.force && worktree.locked_reason.is_some(),
    });
    steps.extend(plan_hooks(
        &repo_root,
        &loaded,
        HookEvent::PostRemove,
        &context,
        default_terminal,
        default_shell,
    )?);
    Ok(PlannedExecution {
        repo_root,
        title: format!(
            "Delete {}",
            worktree.branch.as_deref().unwrap_or("worktree")
        ),
        steps,
    })
}

fn next_session_id() -> String {
    format!("exec-{}", NEXT_SESSION_ID.fetch_add(1, Ordering::Relaxed))
}

fn insert_session(session: ExecutionSessionState) {
    EXECUTION_SESSIONS
        .lock()
        .unwrap()
        .insert(session.snapshot.session_id.clone(), session);
}

fn remove_session(session_id: &str) -> Option<ExecutionSessionState> {
    EXECUTION_SESSIONS.lock().unwrap().remove(session_id)
}

fn session_snapshot(session_id: &str) -> Option<ExecutionSessionSnapshot> {
    EXECUTION_SESSIONS
        .lock()
        .unwrap()
        .get(session_id)
        .map(|session| session.snapshot.clone())
}

fn emit_execution_event(app: &AppHandle, event: ExecutionEvent) -> Result<(), String> {
    app.emit(EXECUTION_EVENT_NAME, event)
        .map_err(|error| format!("failed to emit execution event: {error}"))
}

fn spawn_session_execution(
    app: AppHandle,
    session_id: String,
    repo_root: PathBuf,
    steps: Vec<ExecutionStep>,
) {
    thread::spawn(move || {
        if let Err(error) = run_session_execution(&app, &session_id, &repo_root, steps) {
            let _ = fail_session(&app, &session_id, error);
        }
    });
}

fn run_session_execution(
    app: &AppHandle,
    session_id: &str,
    repo_root: &Path,
    steps: Vec<ExecutionStep>,
) -> Result<(), String> {
    let mut sink = SessionLogWriter {
        app: app.clone(),
        session_id: session_id.to_string(),
    };
    for step in steps {
        step.run(&mut sink)?;
    }

    let now = Utc::now().to_rfc3339();
    {
        let state = app.state::<SharedState>();
        let mut store = state.store.lock().unwrap();
        push_recent(&mut store, &repo_root.to_string_lossy());
        persist(app, &store)?;
    }
    let repo = {
        let state = app.state::<SharedState>();
        crate::load_repo_snapshot(app, &state, repo_root.to_string_lossy().to_string())?
    };

    let final_log = RunLog {
        level: LogLevel::Success,
        message: format!("Action completed at {now}"),
    };
    sink.push(final_log.clone());

    {
        let mut sessions = EXECUTION_SESSIONS.lock().unwrap();
        let session = sessions
            .get_mut(session_id)
            .ok_or_else(|| format!("execution session not found: {session_id}"))?;
        session.snapshot.status = ExecutionStatus::Completed;
        session.snapshot.repo = Some(repo.clone());
        session.snapshot.error = None;
    }

    emit_execution_event(
        app,
        ExecutionEvent {
            session_id: session_id.to_string(),
            kind: ExecutionEventKind::Completed,
            status: Some(ExecutionStatus::Completed),
            log: None,
            repo: Some(repo),
            error: None,
        },
    )
}

fn fail_session(app: &AppHandle, session_id: &str, error: String) -> Result<(), String> {
    let error_log = RunLog {
        level: LogLevel::Error,
        message: error.clone(),
    };
    {
        let mut sessions = EXECUTION_SESSIONS.lock().unwrap();
        let session = sessions
            .get_mut(session_id)
            .ok_or_else(|| format!("execution session not found: {session_id}"))?;
        session.snapshot.logs.push(error_log.clone());
        session.snapshot.status = ExecutionStatus::Failed;
        session.snapshot.error = Some(error.clone());
    }
    emit_execution_event(
        app,
        ExecutionEvent {
            session_id: session_id.to_string(),
            kind: ExecutionEventKind::Failed,
            status: Some(ExecutionStatus::Failed),
            log: Some(error_log),
            repo: None,
            error: Some(error),
        },
    )
}

fn find_worktree<'a>(
    worktrees: &'a [WorktreeRecord],
    path: &str,
) -> Result<&'a WorktreeRecord, String> {
    worktrees
        .iter()
        .find(|worktree| worktree.path == path)
        .ok_or_else(|| format!("worktree not found: {path}"))
}

fn resolve_create_path(
    repo_root: &Path,
    loaded: &LoadedConfig,
    branch: &str,
    explicit_path: Option<&str>,
) -> Result<PathBuf, String> {
    let path = explicit_path
        .filter(|value| !value.trim().is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            repo_root
                .join(&loaded.merged.settings.worktree_root)
                .join(sanitize_branch(branch))
        });
    if path.is_absolute() {
        Ok(path)
    } else {
        Ok(repo_root.join(path))
    }
}

fn sanitize_branch(branch: &str) -> String {
    branch
        .chars()
        .map(|char| match char {
            'a'..='z' | 'A'..='Z' | '0'..='9' | '-' | '_' => char,
            _ => '-',
        })
        .collect()
}

fn load_repo_config(state: &SharedState, repo_root: &Path) -> LoadedConfig {
    let repo_root_key = repo_root.to_string_lossy().to_string();
    let store = state.store.lock().unwrap();
    let stored_config = store.repo_configs.get(&repo_root_key).cloned();
    let custom_launchers = store.custom_launchers.clone();
    drop(store);
    config::load(repo_root, stored_config.as_ref(), &custom_launchers)
}

fn plan_hooks(
    repo_root: &Path,
    loaded: &LoadedConfig,
    event: HookEvent,
    context: &TemplateContext,
    default_terminal: Option<&str>,
    default_shell: &str,
) -> Result<Vec<ExecutionStep>, String> {
    let mut steps = Vec::new();
    let hook_cwd = if matches!(event, HookEvent::PreCreate) {
        repo_root.to_path_buf()
    } else {
        PathBuf::from(&context.values["worktree_path"])
    };
    let event_label = event.label().to_string();
    for (i, hook) in loaded
        .merged
        .hooks
        .get(&event)
        .into_iter()
        .flatten()
        .enumerate()
    {
        let label = hook_label(&event_label, i);
        match hook.step_type {
            HookStepType::Script => {
                let raw = hook
                    .run
                    .as_deref()
                    .ok_or_else(|| "script hook is missing run field".to_string())?;
                let command = render_template(raw, context);
                let shell = hook.shell.as_deref().unwrap_or(default_shell).to_string();
                steps.push(ExecutionStep::Script {
                    label,
                    cwd: hook_cwd.clone(),
                    command,
                    context: context.clone(),
                    shell,
                });
            }
            HookStepType::Launch => {
                let launcher_id = hook
                    .launcher_id
                    .as_deref()
                    .ok_or_else(|| "launch hook is missing launcherId".to_string())?;
                steps.extend(plan_launch_action(
                    repo_root,
                    loaded,
                    context,
                    launcher_id,
                    None,
                    true,
                    default_terminal,
                )?);
            }
            HookStepType::Install => {
                let shell = hook.shell.as_deref().unwrap_or(default_shell).to_string();
                steps.push(ExecutionStep::InstallDependencies {
                    label,
                    worktree_path: PathBuf::from(&context.values["worktree_path"]),
                    custom_command: hook.run.clone().filter(|s| !s.trim().is_empty()),
                    shell,
                });
            }
            HookStepType::CopyFiles => {
                if hook.paths.is_empty() {
                    return Err(format!(
                        "Hook {} step {}: copy-files is missing paths",
                        event_label,
                        i + 1
                    ));
                }
                steps.push(ExecutionStep::CopyProjectFiles {
                    label,
                    repo_root: repo_root.to_path_buf(),
                    worktree_path: PathBuf::from(&context.values["worktree_path"]),
                    paths: hook.paths.clone(),
                });
            }
        }
    }
    Ok(steps)
}

fn hook_label(event_label: &str, step_index: usize) -> String {
    format!("Hook {} step {}", event_label, step_index + 1)
}

fn plan_launch_action(
    _repo_root: &Path,
    loaded: &LoadedConfig,
    context: &TemplateContext,
    launcher_id: &str,
    prompt_override: Option<&str>,
    include_label: bool,
    default_terminal: Option<&str>,
) -> Result<Vec<ExecutionStep>, String> {
    let launcher = loaded
        .merged
        .launchers
        .iter()
        .find(|launcher| launcher.id == launcher_id)
        .ok_or_else(|| format!("launcher not found: {launcher_id}"))?
        .clone();

    let mut rendered_args: Vec<String> = launcher
        .args_template
        .iter()
        .map(|arg| render_template(arg, context))
        .collect();
    if let Some(prompt) = prompt_override.or(launcher.prompt_template.as_deref()) {
        let rendered_prompt = render_template(prompt, context);
        if !rendered_prompt.trim().is_empty() {
            rendered_args.push(rendered_prompt);
        }
    }
    let command_preview = match launcher.kind {
        LauncherKind::App => {
            #[cfg(target_os = "macos")]
            {
                format!(
                    "open -a {} {}",
                    launcher.app_or_cmd,
                    rendered_args.join(" ")
                )
            }
            #[cfg(target_os = "windows")]
            {
                format!(
                    "start {} {}",
                    launcher.app_or_cmd,
                    rendered_args.join(" ")
                )
            }
            #[cfg(target_os = "linux")]
            {
                format!(
                    "{} {}",
                    launcher.app_or_cmd,
                    rendered_args.join(" ")
                )
            }
        }
        LauncherKind::TerminalCli => format!("{} {}", launcher.app_or_cmd, rendered_args.join(" "))
            .trim()
            .to_string(),
        LauncherKind::ShellScript => format!("sh {}", launcher.app_or_cmd),
        LauncherKind::AppleScript => format!("osascript {}", launcher.app_or_cmd),
    };

    Ok(vec![ExecutionStep::Launch {
        label: if include_label {
            format!("Launcher {}", launcher.name)
        } else {
            launcher.name.clone()
        },
        cwd: PathBuf::from(&context.values["worktree_path"]),
        launcher,
        command_preview,
        rendered_args,
        context: context.clone(),
        terminal_id: default_terminal.map(String::from),
    }])
}

trait LogWriter {
    fn push(&mut self, log: RunLog);
}

struct VecLogWriter<'a> {
    logs: &'a mut Vec<RunLog>,
}

impl LogWriter for VecLogWriter<'_> {
    fn push(&mut self, log: RunLog) {
        self.logs.push(log);
    }
}

struct SessionLogWriter {
    app: AppHandle,
    session_id: String,
}

impl LogWriter for SessionLogWriter {
    fn push(&mut self, log: RunLog) {
        {
            let mut sessions = EXECUTION_SESSIONS.lock().unwrap();
            if let Some(session) = sessions.get_mut(&self.session_id) {
                session.snapshot.logs.push(log.clone());
            }
        }
        let _ = emit_execution_event(
            &self.app,
            ExecutionEvent {
                session_id: self.session_id.clone(),
                kind: ExecutionEventKind::LogAppended,
                status: None,
                log: Some(log),
                repo: None,
                error: None,
            },
        );
    }
}

fn execute(
    app: &AppHandle,
    state: &SharedState,
    repo_root: &Path,
    steps: Vec<ExecutionStep>,
) -> Result<ActionResponse, String> {
    let mut logs = Vec::new();
    let mut sink = VecLogWriter { logs: &mut logs };
    for step in steps {
        step.run(&mut sink)?;
    }
    let now = Utc::now().to_rfc3339();
    {
        let mut store = state.store.lock().unwrap();
        push_recent(&mut store, &repo_root.to_string_lossy());
        persist(app, &store)?;
    }
    let repo = Some(crate::load_repo_snapshot(
        app,
        state,
        repo_root.to_string_lossy().to_string(),
    )?);
    logs.push(RunLog {
        level: LogLevel::Success,
        message: format!("Action completed at {now}"),
    });
    Ok(ActionResponse { logs, repo })
}

impl ExecutionStep {
    fn run(self, sink: &mut impl LogWriter) -> Result<(), String> {
        match self {
            ExecutionStep::GitCreate {
                repo_root,
                mode,
                branch,
                base_ref,
                remote_ref,
                worktree_path,
            } => {
                if let Some(parent) = worktree_path.parent() {
                    fs::create_dir_all(parent).map_err(|error| {
                        format!(
                            "failed to create parent directory {}: {error}",
                            parent.display()
                        )
                    })?;
                }
                let mut args = vec![
                    "worktree".to_string(),
                    "add".to_string(),
                    worktree_path.to_string_lossy().to_string(),
                ];
                match mode {
                    CreateMode::NewBranch => {
                        args.insert(2, "-b".into());
                        args.insert(3, branch);
                        if let Some(base_ref) = base_ref {
                            args.push(base_ref);
                        }
                    }
                    CreateMode::ExistingBranch => {
                        args.push(branch);
                    }
                    CreateMode::RemoteBranch => {
                        let remote_ref =
                            remote_ref.ok_or_else(|| "remoteRef is required".to_string())?;
                        args.insert(2, "-b".into());
                        args.insert(3, branch.clone());
                        args.push(remote_ref.clone());
                        run_git_command_streaming(sink, &repo_root, &args, "git")?;
                        run_git_command_streaming(
                            sink,
                            &worktree_path,
                            &[
                                "branch".into(),
                                "--set-upstream-to".into(),
                                remote_ref,
                                branch,
                            ],
                            "git",
                        )?;
                        sink.push(info(format!(
                            "Created worktree {} from remote",
                            worktree_path.display()
                        )));
                        return Ok(());
                    }
                }
                run_git_command_streaming(sink, &repo_root, &args, "git")?;
                sink.push(info(format!(
                    "Created worktree {}",
                    worktree_path.display()
                )));
                Ok(())
            }
            ExecutionStep::GitRemove {
                repo_root,
                worktree_path,
                force,
                unlock_first,
            } => {
                if unlock_first {
                    run_git_command_streaming(
                        sink,
                        &repo_root,
                        &[
                            "worktree".into(),
                            "unlock".into(),
                            worktree_path.to_string_lossy().to_string(),
                        ],
                        "git",
                    )?;
                    sink.push(info(format!("Unlocked {}", worktree_path.display())));
                }
                let mut args = vec![
                    "worktree".into(),
                    "remove".into(),
                    worktree_path.to_string_lossy().to_string(),
                ];
                if force {
                    args.push("--force".into());
                }
                run_git_command_streaming(sink, &repo_root, &args, "git")?;
                sink.push(info(format!(
                    "Removed worktree {}",
                    worktree_path.display()
                )));
                Ok(())
            }
            ExecutionStep::GitPrune { repo_root } => {
                run_git_command_streaming(
                    sink,
                    &repo_root,
                    &["worktree".into(), "prune".into(), "--verbose".into()],
                    "git",
                )?;
                Ok(())
            }
            ExecutionStep::InstallDependencies {
                label,
                worktree_path,
                custom_command,
                shell,
            } => run_install_dependencies(sink, &label, &worktree_path, custom_command.as_deref(), &shell),
            ExecutionStep::CopyProjectFiles {
                label,
                repo_root,
                worktree_path,
                paths,
            } => run_copy_project_files(sink, &label, &repo_root, &worktree_path, &paths),
            ExecutionStep::Script {
                label,
                cwd,
                command,
                context,
                shell,
            } => {
                run_shell_command_streaming(
                    sink,
                    &label,
                    &cwd,
                    &command,
                    build_envs(&context),
                    &shell,
                )?;
                Ok(())
            }
            ExecutionStep::Launch {
                label,
                cwd,
                launcher,
                command_preview,
                rendered_args,
                context,
                terminal_id,
                ..
            } => {
                sink.push(command_preview_log(&command_preview));
                match launcher.kind {
                    LauncherKind::App => {
                        let app_name = launcher.app_or_cmd.as_str();
                        // Check if this is a known terminal app
                        #[cfg(target_os = "macos")]
                        let is_terminal_app =
                            matches!(app_name, "Terminal" | "Ghostty" | "iTerm2" | "Warp");
                        #[cfg(not(target_os = "macos"))]
                        let is_terminal_app = false;

                        if is_terminal_app {
                            let worktree_path = &context.values["worktree_path"];
                            crate::platform::open_terminal_app(app_name, worktree_path)?;
                        } else {
                            crate::platform::open_app(
                                &launcher.app_or_cmd,
                                &rendered_args,
                                &cwd,
                            )?;
                        }
                    }
                    LauncherKind::TerminalCli => {
                        let command = render_terminal_command(&launcher.app_or_cmd, &rendered_args);
                        let term = terminal_id.as_deref().unwrap_or("terminal");
                        open_terminal_at(term, &cwd, &command, &context)?;
                    }
                    LauncherKind::ShellScript => {
                        let rendered_cmd = render_template(&launcher.app_or_cmd, &context);
                        let term = terminal_id.as_deref().unwrap_or("terminal");
                        open_terminal_at(term, &cwd, &rendered_cmd, &context)?;
                    }
                    LauncherKind::AppleScript => {
                        if !crate::platform::supports_applescript() {
                            return Err(
                                "AppleScript launchers are only supported on macOS".into(),
                            );
                        }
                        let rendered_script = render_template(&launcher.app_or_cmd, &context);
                        let osascript_cmd =
                            format!("osascript -e {}", shell_quote(&rendered_script));
                        let term = terminal_id.as_deref().unwrap_or("terminal");
                        open_terminal_at(term, &cwd, &osascript_cmd, &context)?;
                    }
                }
                sink.push(info(format!("{label}: launched")));
                Ok(())
            }
        }
    }
}

fn run_install_dependencies(
    sink: &mut impl LogWriter,
    label: &str,
    worktree_path: &Path,
    custom_command: Option<&str>,
    shell: &str,
) -> Result<(), String> {
    if !worktree_path.exists() {
        return Err(format!(
            "worktree path does not exist yet: {}",
            worktree_path.display()
        ));
    }
    let full_command = match custom_command {
        Some(cmd) => cmd.to_string(),
        None => detect_install_command(worktree_path)
            .ok_or_else(|| "could not detect install command; please specify one manually".to_string())?,
    };
    let shell_bin = if cfg!(target_os = "windows") { "cmd" } else { shell };
    let flag = if cfg!(target_os = "windows") { "/C" } else { "-lc" };
    let mut process = Command::new(shell_bin);
    process.arg(flag).arg(&full_command).current_dir(worktree_path);
    run_command_streaming(
        sink,
        label,
        &full_command,
        &format!("failed to run install in {}", worktree_path.display()),
        process,
    )
}

/// Detects the most likely install command for a project directory by checking
/// for lockfiles and manifest files across multiple language ecosystems.
pub fn detect_install_command(dir: &Path) -> Option<String> {
    // Node.js
    if dir.join("pnpm-lock.yaml").exists() {
        return Some("pnpm install".into());
    }
    if dir.join("bun.lockb").exists() || dir.join("bun.lock").exists() {
        return Some("bun install".into());
    }
    if dir.join("yarn.lock").exists() {
        return Some("yarn install".into());
    }
    if dir.join("package-lock.json").exists() {
        return Some("npm install".into());
    }
    // If package.json exists but no lockfile, fall back to npm
    if dir.join("package.json").exists() {
        return Some("npm install".into());
    }
    // Python
    if dir.join("poetry.lock").exists() {
        return Some("poetry install".into());
    }
    if dir.join("pdm.lock").exists() {
        return Some("pdm install".into());
    }
    if dir.join("Pipfile.lock").exists() || dir.join("Pipfile").exists() {
        return Some("pipenv install".into());
    }
    if dir.join("uv.lock").exists() {
        return Some("uv sync".into());
    }
    if dir.join("requirements.txt").exists() {
        return Some("pip install -r requirements.txt".into());
    }
    // Ruby
    if dir.join("Gemfile.lock").exists() || dir.join("Gemfile").exists() {
        return Some("bundle install".into());
    }
    // Rust
    if dir.join("Cargo.lock").exists() || dir.join("Cargo.toml").exists() {
        return Some("cargo build".into());
    }
    // Go
    if dir.join("go.sum").exists() || dir.join("go.mod").exists() {
        return Some("go mod download".into());
    }
    // PHP
    if dir.join("composer.lock").exists() || dir.join("composer.json").exists() {
        return Some("composer install".into());
    }
    // .NET
    if dir.join("packages.lock.json").exists()
        || std::fs::read_dir(dir)
            .ok()
            .map(|entries| {
                entries
                    .filter_map(|e| e.ok())
                    .any(|e| {
                        e.path()
                            .extension()
                            .is_some_and(|ext| ext == "csproj" || ext == "sln")
                    })
            })
            .unwrap_or(false)
    {
        return Some("dotnet restore".into());
    }
    // Java / Kotlin
    if dir.join("gradlew").exists() {
        return Some("./gradlew build".into());
    }
    if dir.join("pom.xml").exists() {
        return Some("mvn install".into());
    }
    None
}

fn run_copy_project_files(
    sink: &mut impl LogWriter,
    label: &str,
    repo_root: &Path,
    worktree_path: &Path,
    paths: &[String],
) -> Result<(), String> {
    if !worktree_path.exists() {
        return Err(format!(
            "worktree path does not exist yet: {}",
            worktree_path.display()
        ));
    }

    let mut copied = 0usize;
    let mut skipped = 0usize;
    for raw_path in paths {
        let relative = validate_project_relative_path(raw_path)?;
        let source = repo_root.join(&relative);
        if !source.exists() {
            skipped += 1;
            sink.push(info(format!(
                "{label}: skipped missing {}",
                source.display()
            )));
            continue;
        }
        let target = worktree_path.join(&relative);
        if target.exists() {
            skipped += 1;
            sink.push(info(format!(
                "{label}: skipped existing {}",
                target.display()
            )));
            continue;
        }

        copy_path(&source, &target, false)?;
        copied += 1;
    }

    sink.push(info(format!(
        "{label}: copied {copied} path(s), skipped {skipped}"
    )));
    Ok(())
}

fn validate_project_relative_path(raw_path: &str) -> Result<PathBuf, String> {
    let path = Path::new(raw_path);
    if path.as_os_str().is_empty() {
        return Err("hook path cannot be empty".into());
    }
    let mut normalized = PathBuf::new();
    for component in path.components() {
        match component {
            Component::Normal(part) => normalized.push(part),
            Component::CurDir => {}
            Component::ParentDir | Component::RootDir | Component::Prefix(_) => {
                return Err(format!("hook path must stay inside the repo: {raw_path}"));
            }
        }
    }
    if normalized.as_os_str().is_empty() {
        return Err(format!("hook path must point to a repo-relative file: {raw_path}"));
    }
    Ok(normalized)
}

fn copy_path(source: &Path, target: &Path, overwrite: bool) -> Result<(), String> {
    if source.is_dir() {
        if target.exists() && target.is_file() {
            return Err(format!(
                "cannot replace file {} with directory {}",
                target.display(),
                source.display()
            ));
        }
        fs::create_dir_all(target)
            .map_err(|error| format!("failed to create {}: {error}", target.display()))?;
        for entry in fs::read_dir(source)
            .map_err(|error| format!("failed to read {}: {error}", source.display()))?
        {
            let entry = entry.map_err(|error| {
                format!("failed to read directory entry in {}: {error}", source.display())
            })?;
            copy_path(&entry.path(), &target.join(entry.file_name()), overwrite)?;
        }
        return Ok(());
    }

    if target.exists() && target.is_dir() {
        return Err(format!(
            "cannot replace directory {} with file {}",
            target.display(),
            source.display()
        ));
    }
    if target.exists() && !overwrite {
        return Ok(());
    }
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("failed to create {}: {error}", parent.display()))?;
    }
    fs::copy(source, target).map_err(|error| {
        format!(
            "failed to copy {} to {}: {error}",
            source.display(),
            target.display()
        )
    })?;
    Ok(())
}

fn render_terminal_command(cmd: &str, args: &[String]) -> String {
    let mut parts = vec![shell_quote(cmd)];
    parts.extend(args.iter().map(|arg| shell_quote(arg)));
    parts.join(" ")
}

fn command_preview_log(command: &str) -> RunLog {
    info(format!("$ {}", command.trim()))
}

fn run_git_command_streaming(
    sink: &mut impl LogWriter,
    repo_root: &Path,
    args: &[String],
    label: &str,
) -> Result<(), String> {
    let command_preview = format!(
        "git -C {} {}",
        shell_quote(&repo_root.to_string_lossy()),
        args.iter()
            .map(|arg| shell_quote(arg))
            .collect::<Vec<_>>()
            .join(" ")
    );
    let mut command = Command::new("git");
    command.arg("-C").arg(repo_root).args(args);
    run_command_streaming(
        sink,
        label,
        &command_preview,
        &format!("failed to run git in {}", repo_root.display()),
        command,
    )
}

fn run_shell_command_streaming(
    sink: &mut impl LogWriter,
    label: &str,
    cwd: &Path,
    command: &str,
    envs: BTreeMap<String, String>,
    shell: &str,
) -> Result<(), String> {
    let mut child = Command::new(shell);
    child.arg("-lc").arg(command).current_dir(cwd).envs(envs);
    run_command_streaming(
        sink,
        label,
        command.trim(),
        &format!("failed to run hook in {}", cwd.display()),
        child,
    )
}

fn run_command_streaming(
    sink: &mut impl LogWriter,
    label: &str,
    command_preview: &str,
    spawn_context: &str,
    mut command: Command,
) -> Result<(), String> {
    sink.push(command_preview_log(command_preview));
    command.stdout(Stdio::piped()).stderr(Stdio::piped());
    let mut child = command
        .spawn()
        .map_err(|error| format!("{spawn_context}: {error}"))?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "failed to capture stdout".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "failed to capture stderr".to_string())?;

    let (tx, rx) = mpsc::channel::<(bool, String)>();
    let stdout_tx = tx.clone();
    thread::spawn(move || stream_reader(stdout, false, stdout_tx));
    let stderr_tx = tx.clone();
    thread::spawn(move || stream_reader(stderr, true, stderr_tx));
    drop(tx);

    let mut stderr_lines = Vec::new();
    for (is_stderr, line) in rx {
        if is_stderr {
            // Buffer stderr – git writes informational messages (e.g. "Preparing
            // worktree") to stderr even on success.  We log them as info for now
            // and only escalate to error if the process exits non-zero.
            stderr_lines.push(line.clone());
            sink.push(info(format!("{label}: {line}")));
        } else {
            sink.push(info(format!("{label}: {line}")));
        }
    }

    let status = child
        .wait()
        .map_err(|error| format!("failed waiting for command: {error}"))?;
    if !status.success() {
        // Re-emit stderr as errors so callers see the real failure reason.
        for line in &stderr_lines {
            sink.push(RunLog {
                level: LogLevel::Error,
                message: format!("{label}: {line}"),
            });
        }
        return Err(format!("{label} failed with status {status}"));
    }
    Ok(())
}

fn stream_reader<R: std::io::Read + Send + 'static>(
    reader: R,
    is_error: bool,
    tx: mpsc::Sender<(bool, String)>,
) {
    let reader = BufReader::new(reader);
    for line in reader.lines() {
        let Ok(line) = line else { break };
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        if tx.send((is_error, trimmed.to_string())).is_err() {
            break;
        }
    }
}

fn open_terminal_at(
    terminal_id: &str,
    cwd: &Path,
    command: &str,
    context: &TemplateContext,
) -> Result<(), String> {
    let mut script = format!("cd {} && {}", shell_quote(&cwd.to_string_lossy()), command);
    let env_exports = build_envs(context)
        .into_iter()
        .map(|(key, value)| format!("export {}={}", key, shell_quote(&value)))
        .collect::<Vec<_>>()
        .join("; ");
    if !env_exports.is_empty() {
        script = format!("{env_exports}; {script}");
    }

    crate::platform::open_terminal_at(terminal_id, cwd, &script)
}

fn build_envs(context: &TemplateContext) -> BTreeMap<String, String> {
    let mut envs = BTreeMap::new();
    envs.insert("REPO_ROOT".into(), context.values["repo_root"].clone());
    envs.insert(
        "WORKTREE_PATH".into(),
        context.values["worktree_path"].clone(),
    );
    envs.insert(
        "BRANCH".into(),
        context.values.get("branch").cloned().unwrap_or_default(),
    );
    envs.insert(
        "BASE_BRANCH".into(),
        context
            .values
            .get("base_branch")
            .cloned()
            .unwrap_or_default(),
    );
    envs.insert("HEAD_SHA".into(), context.values["head_sha"].clone());
    envs.insert(
        "IS_MAIN_WORKTREE".into(),
        context.values["is_main_worktree"].clone(),
    );
    envs.insert(
        "DEFAULT_REMOTE".into(),
        context.values["default_remote"].clone(),
    );
    envs
}

fn render_template(template: &str, context: &TemplateContext) -> String {
    let mut rendered = template.to_string();
    for (key, value) in &context.values {
        rendered = rendered.replace(&format!("{{{key}}}"), value);
    }
    rendered
}

fn build_context(
    repo_root: &Path,
    worktree_path: &Path,
    branch: Option<String>,
    base_branch: Option<String>,
    head_sha: String,
    is_main: bool,
    default_remote: String,
) -> TemplateContext {
    let mut values = BTreeMap::new();
    values.insert("repo_root".into(), repo_root.to_string_lossy().to_string());
    values.insert(
        "worktree_path".into(),
        worktree_path.to_string_lossy().to_string(),
    );
    values.insert("branch".into(), branch.unwrap_or_default());
    values.insert("base_branch".into(), base_branch.unwrap_or_default());
    values.insert("head_sha".into(), head_sha);
    values.insert("is_main_worktree".into(), is_main.to_string());
    values.insert("default_remote".into(), default_remote);
    TemplateContext { values }
}

fn build_context_from_worktree(
    repo_root: &Path,
    loaded: &LoadedConfig,
    worktree: &WorktreeRecord,
    is_main_override: bool,
) -> TemplateContext {
    build_context(
        repo_root,
        Path::new(&worktree.path),
        worktree.branch.clone(),
        Some(loaded.merged.settings.default_base_branch.clone()),
        worktree.head_sha.clone(),
        if is_main_override {
            true
        } else {
            worktree.is_main
        },
        git::detect_default_remote(repo_root).unwrap_or_else(|| "origin".into()),
    )
}

fn shell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\"'\"'"))
}

fn info(message: String) -> RunLog {
    RunLog {
        level: LogLevel::Info,
        message,
    }
}

pub fn mark_worktree_opened(
    app: &AppHandle,
    state: &SharedState,
    worktree_path: &str,
) -> Result<(), String> {
    let mut store = state.store.lock().unwrap();
    touch_worktree(&mut store, worktree_path, &Utc::now().to_rfc3339());
    persist(app, &store)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::ExecutionStatus;
    use tempfile::tempdir;

    #[test]
    fn render_template_replaces_values() {
        let context = TemplateContext {
            values: BTreeMap::from([
                ("repo_root".into(), "/repo".into()),
                ("worktree_path".into(), "/repo/.worktrees/feat".into()),
                ("branch".into(), "feat".into()),
                ("base_branch".into(), "main".into()),
                ("head_sha".into(), "abc".into()),
                ("is_main_worktree".into(), "false".into()),
                ("default_remote".into(), "origin".into()),
            ]),
        };
        assert_eq!(
            render_template("checkout {branch} at {worktree_path}", &context),
            "checkout feat at /repo/.worktrees/feat"
        );
    }

    #[test]
    fn run_command_streaming_keeps_successful_stderr_as_info() {
        let mut logs = Vec::new();
        let mut sink = VecLogWriter { logs: &mut logs };

        #[cfg(not(target_os = "windows"))]
        let command = {
            let mut cmd = Command::new("sh");
            cmd.arg("-c").arg("printf 'progress\\n' 1>&2");
            cmd
        };
        #[cfg(target_os = "windows")]
        let command = {
            let mut cmd = Command::new("cmd");
            cmd.args(["/C", "echo progress 1>&2"]);
            cmd
        };

        run_command_streaming(
            &mut sink,
            "test",
            "echo progress 1>&2",
            "failed to run test command",
            command,
        )
        .unwrap();

        assert!(logs
            .iter()
            .any(|log| { matches!(log.level, LogLevel::Info) && log.message == "test: progress" }));
        assert!(!logs.iter().any(|log| matches!(log.level, LogLevel::Error)));
    }

    #[test]
    fn dispose_execution_session_removes_finished_session() {
        let session_id = "exec-test-dispose".to_string();
        {
            let mut sessions = EXECUTION_SESSIONS.lock().unwrap();
            sessions.clear();
            sessions.insert(
                session_id.clone(),
                ExecutionSessionState {
                    snapshot: ExecutionSessionSnapshot {
                        session_id: session_id.clone(),
                        title: "Delete feat".into(),
                        repo_root: "/repo".into(),
                        status: ExecutionStatus::Completed,
                        logs: vec![],
                        repo: None,
                        error: None,
                    },
                },
            );
        }

        dispose_execution_session(&session_id).unwrap();

        assert!(session_snapshot(&session_id).is_none());
        EXECUTION_SESSIONS.lock().unwrap().clear();
    }

    #[test]
    fn validate_project_relative_path_rejects_parent_segments() {
        assert!(validate_project_relative_path("../.env").is_err());
        assert!(validate_project_relative_path("/tmp/.env").is_err());
        assert_eq!(
            validate_project_relative_path("./config/.env").unwrap(),
            PathBuf::from("config/.env")
        );
    }

    #[test]
    fn detect_install_command_pnpm() {
        let dir = tempdir().unwrap();
        fs::write(dir.path().join("pnpm-lock.yaml"), "lockfileVersion: '9.0'").unwrap();
        assert_eq!(detect_install_command(dir.path()), Some("pnpm install".into()));
    }

    #[test]
    fn detect_install_command_poetry() {
        let dir = tempdir().unwrap();
        fs::write(dir.path().join("poetry.lock"), "").unwrap();
        assert_eq!(detect_install_command(dir.path()), Some("poetry install".into()));
    }

    #[test]
    fn detect_install_command_cargo() {
        let dir = tempdir().unwrap();
        fs::write(dir.path().join("Cargo.toml"), "[package]").unwrap();
        assert_eq!(detect_install_command(dir.path()), Some("cargo build".into()));
    }

    #[test]
    fn detect_install_command_none() {
        let dir = tempdir().unwrap();
        assert_eq!(detect_install_command(dir.path()), None);
    }

    #[test]
    fn copy_project_files_preserves_existing_file() {
        let repo_root = tempdir().unwrap();
        let worktree_path = tempdir().unwrap();
        fs::write(repo_root.path().join(".env.local"), "source").unwrap();
        fs::write(worktree_path.path().join(".env.local"), "existing").unwrap();

        let mut logs = Vec::new();
        let mut sink = VecLogWriter { logs: &mut logs };
        run_copy_project_files(
            &mut sink,
            "Hook post-create step 1",
            repo_root.path(),
            worktree_path.path(),
            &[".env.local".into()],
        )
        .unwrap();

        assert_eq!(
            fs::read_to_string(worktree_path.path().join(".env.local")).unwrap(),
            "existing"
        );
        assert!(logs.iter().any(|log| log.message.contains("skipped existing")));
    }
}
