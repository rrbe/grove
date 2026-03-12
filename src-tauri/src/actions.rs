use crate::{
    config::{self, LoadedConfig},
    git,
    models::{
        ActionResponse, ActionStatus, ApprovalRequest, CreateMode, CreateWorktreeInput, HookEvent,
        HookStepType, LaunchWorktreeInput, LauncherKind, LauncherProfile, LogLevel,
        RemoveWorktreeInput, RunHookEventInput, RunLog, StartWorktreeInput, WorktreeRecord,
    },
    store::{approve, is_approved, persist, push_recent, touch_worktree, SharedState},
};
use chrono::Utc;
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeMap,
    fs,
    path::{Path, PathBuf},
    process::{Command, Stdio},
};
use tauri::AppHandle;

#[derive(Clone)]
struct TemplateContext {
    values: BTreeMap<String, String>,
    ports: BTreeMap<String, (u16, Option<String>)>,
}

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
    CopyWarmupFiles {
        repo_root: PathBuf,
        worktree_path: PathBuf,
        files: Vec<String>,
    },
    WriteGeneratedEnv {
        worktree_path: PathBuf,
        context: TemplateContext,
    },
    Script {
        label: String,
        cwd: PathBuf,
        command: String,
        blocking: bool,
        approval: Option<ApprovalRequest>,
        context: TemplateContext,
    },
    Launch {
        label: String,
        cwd: PathBuf,
        launcher: LauncherProfile,
        command_preview: String,
        rendered_args: Vec<String>,
        approval: Option<ApprovalRequest>,
        context: TemplateContext,
        terminal_id: Option<String>,
    },
}

pub fn create_worktree(
    app: &AppHandle,
    state: &SharedState,
    input: CreateWorktreeInput,
    default_terminal: Option<&str>,
) -> Result<ActionResponse, String> {
    let repo_root = git::resolve_repo_root(&input.repo_root)?;
    let loaded = config::load(&repo_root)?;
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
        &loaded,
    );

    let mut steps = Vec::new();
    steps.extend(plan_hooks(
        &repo_root,
        &loaded,
        HookEvent::PreCreate,
        &context,
        default_terminal,
    )?);
    steps.push(ExecutionStep::GitCreate {
        repo_root: repo_root.clone(),
        mode: input.mode,
        branch: branch.clone(),
        base_ref: Some(base_ref.clone()),
        remote_ref: input.remote_ref.clone(),
        worktree_path: worktree_path.clone(),
    });
    if !loaded.merged.cold_start.copy_files.is_empty() {
        steps.push(ExecutionStep::CopyWarmupFiles {
            repo_root: repo_root.clone(),
            worktree_path: worktree_path.clone(),
            files: loaded.merged.cold_start.copy_files.clone(),
        });
    }
    steps.push(ExecutionStep::WriteGeneratedEnv {
        worktree_path: worktree_path.clone(),
        context: context.clone(),
    });
    steps.extend(plan_hooks(
        &repo_root,
        &loaded,
        HookEvent::PostCreate,
        &context,
        default_terminal,
    )?);

    if !input.auto_start_launchers.is_empty() {
        steps.extend(plan_hooks(
            &repo_root,
            &loaded,
            HookEvent::PostStart,
            &context,
            default_terminal,
        )?);
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
) -> Result<ActionResponse, String> {
    let repo_root = git::resolve_repo_root(&input.repo_root)?;
    let loaded = config::load(&repo_root)?;
    let worktrees = git::scan_worktrees(
        &repo_root,
        &loaded.merged.cold_start,
        &state.store.lock().unwrap(),
    )?;
    let worktree = find_worktree(&worktrees, &input.worktree_path)?;
    if worktree.is_main {
        return Err("cannot remove the main worktree".into());
    }
    let context = build_context_from_worktree(&repo_root, &loaded, worktree, false);
    let mut steps = plan_hooks(&repo_root, &loaded, HookEvent::PreRemove, &context, default_terminal)?;
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
    )?);
    execute(app, state, &repo_root, steps)
}

pub fn start_worktree(
    app: &AppHandle,
    state: &SharedState,
    input: StartWorktreeInput,
    default_terminal: Option<&str>,
) -> Result<ActionResponse, String> {
    run_event_internal(
        app,
        state,
        input.repo_root,
        HookEvent::PostStart,
        Some(input.worktree_path),
        default_terminal,
    )
}

pub fn run_hook_event(
    app: &AppHandle,
    state: &SharedState,
    input: RunHookEventInput,
    default_terminal: Option<&str>,
) -> Result<ActionResponse, String> {
    run_event_internal(
        app,
        state,
        input.repo_root,
        input.event,
        input.worktree_path,
        default_terminal,
    )
}

pub fn launch_worktree(
    app: &AppHandle,
    state: &SharedState,
    input: LaunchWorktreeInput,
    default_terminal: Option<&str>,
) -> Result<ActionResponse, String> {
    let repo_root = git::resolve_repo_root(&input.repo_root)?;
    let loaded = config::load(&repo_root)?;
    let worktrees = git::scan_worktrees(
        &repo_root,
        &loaded.merged.cold_start,
        &state.store.lock().unwrap(),
    )?;
    let worktree = find_worktree(&worktrees, &input.worktree_path)?;
    let context = build_context_from_worktree(&repo_root, &loaded, worktree, false);
    let mut steps = plan_hooks(&repo_root, &loaded, HookEvent::PreLaunch, &context, default_terminal)?;
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
) -> Result<ActionResponse, String> {
    let repo_root = git::resolve_repo_root(&repo_root)?;
    let loaded = config::load(&repo_root)?;
    let worktree_context = if let Some(path) = worktree_path {
        let worktrees = git::scan_worktrees(
            &repo_root,
            &loaded.merged.cold_start,
            &state.store.lock().unwrap(),
        )?;
        let worktree = find_worktree(&worktrees, &path)?;
        build_context_from_worktree(&repo_root, &loaded, worktree, event == HookEvent::PostScan)
    } else {
        build_context(
            &repo_root,
            &repo_root,
            None,
            Some(loaded.merged.settings.default_base_branch.clone()),
            git::resolve_head_sha(&repo_root, "HEAD")?,
            true,
            git::detect_default_remote(&repo_root).unwrap_or_else(|| "origin".into()),
            &loaded,
        )
    };
    let steps = plan_hooks(&repo_root, &loaded, event, &worktree_context, default_terminal)?;
    execute(app, state, &repo_root, steps)
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

fn plan_hooks(
    repo_root: &Path,
    loaded: &LoadedConfig,
    event: HookEvent,
    context: &TemplateContext,
    default_terminal: Option<&str>,
) -> Result<Vec<ExecutionStep>, String> {
    let mut steps = Vec::new();
    let hook_cwd = if matches!(event, HookEvent::PreCreate | HookEvent::PostScan) {
        repo_root.to_path_buf()
    } else {
        PathBuf::from(&context.values["worktree_path"])
    };
    for hook in loaded
        .merged
        .hooks
        .iter()
        .filter(|hook| hook.enabled && hook.event == event)
    {
        match hook.step_type {
            HookStepType::Script => {
                let raw = hook
                    .run
                    .as_deref()
                    .ok_or_else(|| format!("hook {} is missing run", hook.id))?;
                let command = render_template(raw, context);
                let approval = Some(build_approval(
                    repo_root,
                    &format!("hook:{}:{}", hook.event.label(), hook.id),
                    &hook_cwd.to_string_lossy(),
                    &command,
                ));
                steps.push(ExecutionStep::Script {
                    label: format!("Hook {} ({})", hook.id, hook.event.label()),
                    cwd: hook_cwd.clone(),
                    command,
                    blocking: hook.blocking,
                    approval,
                    context: context.clone(),
                });
            }
            HookStepType::Launch => {
                let launcher_id = hook
                    .launcher_id
                    .as_deref()
                    .ok_or_else(|| format!("hook {} is missing launcherId", hook.id))?;
                steps.extend(plan_launch_action(
                    repo_root,
                    loaded,
                    context,
                    launcher_id,
                    hook.prompt_template.as_deref(),
                    true,
                    default_terminal,
                )?);
            }
        }
    }
    Ok(steps)
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
        LauncherKind::App => format!(
            "open -a {} {}",
            launcher.app_or_cmd,
            rendered_args.join(" ")
        ),
        LauncherKind::TerminalCli => format!("{} {}", launcher.app_or_cmd, rendered_args.join(" "))
            .trim()
            .to_string(),
    };
    let approval = None;

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
        approval,
        context: context.clone(),
        terminal_id: default_terminal.map(String::from),
    }])
}

fn execute(
    app: &AppHandle,
    state: &SharedState,
    repo_root: &Path,
    steps: Vec<ExecutionStep>,
) -> Result<ActionResponse, String> {
    let missing_approvals = {
        let store = state.store.lock().unwrap();
        steps
            .iter()
            .filter_map(|step| step.approval())
            .filter(|approval| {
                !is_approved(&store, &repo_root.to_string_lossy(), &approval.fingerprint)
            })
            .cloned()
            .collect::<Vec<_>>()
    };

    if !missing_approvals.is_empty() {
        return Ok(ActionResponse {
            status: ActionStatus::ApprovalRequired,
            logs: vec![RunLog {
                level: LogLevel::Info,
                message: "This action requires approval before running project-defined commands."
                    .into(),
            }],
            approvals: dedupe_approvals(missing_approvals),
            repo: None,
        });
    }

    let mut logs = Vec::new();
    for step in steps {
        step.run(&mut logs)?;
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
    Ok(ActionResponse {
        status: ActionStatus::Completed,
        logs,
        approvals: Vec::new(),
        repo,
    })
}

impl ExecutionStep {
    fn approval(&self) -> Option<&ApprovalRequest> {
        match self {
            ExecutionStep::Script { approval, .. } => approval.as_ref(),
            ExecutionStep::Launch { approval, .. } => approval.as_ref(),
            _ => None,
        }
    }

    fn run(self, logs: &mut Vec<RunLog>) -> Result<(), String> {
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
                        let output = git::run_git_owned(&repo_root, &args)?;
                        logs.push(info(format!(
                            "Created worktree {} from remote {}",
                            worktree_path.display(),
                            remote_ref
                        )));
                        let _ = git::run_git_owned(
                            &worktree_path,
                            &[
                                "branch".into(),
                                "--set-upstream-to".into(),
                                remote_ref,
                                branch,
                            ],
                        )?;
                        if !output.trim().is_empty() {
                            logs.push(info(output.trim().to_string()));
                        }
                        return Ok(());
                    }
                }
                let output = git::run_git_owned(&repo_root, &args)?;
                logs.push(info(format!(
                    "Created worktree {}",
                    worktree_path.display()
                )));
                if !output.trim().is_empty() {
                    logs.push(info(output.trim().to_string()));
                }
                Ok(())
            }
            ExecutionStep::GitRemove {
                repo_root,
                worktree_path,
                force,
                unlock_first,
            } => {
                if unlock_first {
                    let _ = git::run_git_owned(
                        &repo_root,
                        &[
                            "worktree".into(),
                            "unlock".into(),
                            worktree_path.to_string_lossy().to_string(),
                        ],
                    )?;
                    logs.push(info(format!("Unlocked {}", worktree_path.display())));
                }
                let mut args = vec![
                    "worktree".into(),
                    "remove".into(),
                    worktree_path.to_string_lossy().to_string(),
                ];
                if force {
                    args.push("--force".into());
                }
                let output = git::run_git_owned(&repo_root, &args)?;
                logs.push(info(format!(
                    "Removed worktree {}",
                    worktree_path.display()
                )));
                if !output.trim().is_empty() {
                    logs.push(info(output.trim().to_string()));
                }
                Ok(())
            }
            ExecutionStep::GitPrune { repo_root } => {
                let output = git::run_git_owned(
                    &repo_root,
                    &["worktree".into(), "prune".into(), "--verbose".into()],
                )?;
                if output.trim().is_empty() {
                    logs.push(info("No stale worktree metadata to prune.".into()));
                } else {
                    logs.push(info(output.trim().to_string()));
                }
                Ok(())
            }
            ExecutionStep::CopyWarmupFiles {
                repo_root,
                worktree_path,
                files,
            } => {
                let mut copied = 0;
                for relative in files {
                    let source = repo_root.join(&relative);
                    let target = worktree_path.join(&relative);
                    if !source.exists() || target.exists() {
                        continue;
                    }
                    if let Some(parent) = target.parent() {
                        fs::create_dir_all(parent).map_err(|error| {
                            format!("failed to create {}: {error}", parent.display())
                        })?;
                    }
                    fs::copy(&source, &target).map_err(|error| {
                        format!(
                            "failed to copy {} to {}: {error}",
                            source.display(),
                            target.display()
                        )
                    })?;
                    copied += 1;
                }
                logs.push(info(format!(
                    "Warmup copied {} file(s) into {}",
                    copied,
                    worktree_path.display()
                )));
                Ok(())
            }
            ExecutionStep::WriteGeneratedEnv {
                worktree_path,
                context,
            } => {
                let env_dir = worktree_path.join(".worktree-switcher");
                fs::create_dir_all(&env_dir)
                    .map_err(|error| format!("failed to create {}: {error}", env_dir.display()))?;
                let mut content = String::from("# Generated by Worktree Switcher\n");
                for (name, (port, url)) in &context.ports {
                    content.push_str(&format!("WTS_PORT_{}={}\n", sanitize_env(name), port));
                    if let Some(url) = url {
                        content.push_str(&format!("WTS_URL_{}={}\n", sanitize_env(name), url));
                    }
                }
                fs::write(env_dir.join("generated.env"), content)
                    .map_err(|error| format!("failed to write generated env: {error}"))?;
                logs.push(info(format!(
                    "Generated warmup env for {}",
                    worktree_path.display()
                )));
                Ok(())
            }
            ExecutionStep::Script {
                label,
                cwd,
                command,
                blocking,
                context,
                ..
            } => {
                logs.push(info(format!("{label}: {}", command.trim())));
                if blocking {
                    let output = Command::new("/bin/zsh")
                        .arg("-lc")
                        .arg(&command)
                        .current_dir(&cwd)
                        .envs(build_envs(&context))
                        .output()
                        .map_err(|error| {
                            format!("failed to run hook in {}: {error}", cwd.display())
                        })?;
                    push_output_logs(logs, &label, &output.stdout, &output.stderr);
                    if !output.status.success() {
                        return Err(format!("{label} failed with status {}", output.status));
                    }
                } else {
                    Command::new("/bin/zsh")
                        .arg("-lc")
                        .arg(&command)
                        .current_dir(&cwd)
                        .envs(build_envs(&context))
                        .stdin(Stdio::null())
                        .stdout(Stdio::null())
                        .stderr(Stdio::null())
                        .spawn()
                        .map_err(|error| {
                            format!("failed to spawn hook in {}: {error}", cwd.display())
                        })?;
                }
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
                logs.push(info(format!("{label}: {command_preview}")));
                match launcher.kind {
                    LauncherKind::App => {
                        let app_name = launcher.app_or_cmd.as_str();
                        if matches!(app_name, "Terminal" | "Ghostty" | "iTerm2") {
                            let worktree_path = &context.values["worktree_path"];
                            open_terminal_app(app_name, worktree_path)?;
                        } else {
                            let mut command = Command::new("open");
                            command
                                .arg("-a")
                                .arg(&launcher.app_or_cmd)
                                .args(&rendered_args);
                            let output =
                                command.current_dir(&cwd).output().map_err(|error| {
                                    format!("failed to launch {}: {error}", launcher.name)
                                })?;
                            if !output.status.success() {
                                return Err(format!(
                                    "{} failed with status {}",
                                    launcher.name, output.status
                                ));
                            }
                        }
                    }
                    LauncherKind::TerminalCli => {
                        let command = render_terminal_command(&launcher.app_or_cmd, &rendered_args);
                        let term = terminal_id.as_deref().unwrap_or("terminal");
                        open_terminal_at(term, &cwd, &command, &context)?;
                    }
                }
                Ok(())
            }
        }
    }
}

fn render_terminal_command(cmd: &str, args: &[String]) -> String {
    let mut parts = vec![shell_quote(cmd)];
    parts.extend(args.iter().map(|arg| shell_quote(arg)));
    parts.join(" ")
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

    match terminal_id {
        "iterm2" => run_script_in_iterm2(&script),
        "ghostty" => run_script_in_ghostty(&script),
        _ => run_script_in_terminal_app(&script),
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
    // Write script to temp file to avoid fragile keystroke simulation for long commands
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

fn open_terminal_app(app_name: &str, cwd: &str) -> Result<(), String> {
    let script = match app_name {
        "Terminal" => {
            format!(
                "tell application \"Terminal\" to do script {}\ntell application \"Terminal\" to activate",
                apple_quote(&format!("cd {}", shell_quote(cwd)))
            )
        }
        "Ghostty" => {
            // Try AppleScript first, fallback to open -a
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
                    // Fallback: open -a Ghostty
                    let output = Command::new("open")
                        .arg("-a")
                        .arg("Ghostty")
                        .arg(cwd)
                        .output()
                        .map_err(|e| format!("failed to open Ghostty: {e}"))?;
                    if !output.status.success() {
                        return Err(format!(
                            "Ghostty failed with status {}",
                            output.status
                        ));
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

fn push_output_logs(logs: &mut Vec<RunLog>, label: &str, stdout: &[u8], stderr: &[u8]) {
    let stdout = String::from_utf8_lossy(stdout);
    for line in stdout
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
    {
        logs.push(info(format!("{label}: {line}")));
    }
    let stderr = String::from_utf8_lossy(stderr);
    for line in stderr
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
    {
        logs.push(RunLog {
            level: LogLevel::Error,
            message: format!("{label}: {line}"),
        });
    }
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
    for (name, (port, url)) in &context.ports {
        envs.insert(format!("WTS_PORT_{}", sanitize_env(name)), port.to_string());
        if let Some(url) = url {
            envs.insert(format!("WTS_URL_{}", sanitize_env(name)), url.clone());
        }
    }
    envs
}

fn render_template(template: &str, context: &TemplateContext) -> String {
    let mut rendered = template.to_string();
    for (key, value) in &context.values {
        rendered = rendered.replace(&format!("{{{key}}}"), value);
    }
    for (name, (port, url)) in &context.ports {
        rendered = rendered.replace(&format!("{{port:{name}}}"), &port.to_string());
        if let Some(url) = url {
            rendered = rendered.replace(&format!("{{url:{name}}}"), url);
        }
    }
    rendered
}

fn build_approval(repo_root: &Path, label: &str, cwd: &str, command: &str) -> ApprovalRequest {
    let normalized = format!("{}\n{}\n{}", label.trim(), cwd.trim(), command.trim());
    let mut hasher = Sha256::new();
    hasher.update(repo_root.to_string_lossy().as_bytes());
    hasher.update(normalized.as_bytes());
    let fingerprint = hasher
        .finalize()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect();
    ApprovalRequest {
        fingerprint,
        label: label.into(),
        command: command.into(),
        cwd: cwd.into(),
    }
}

fn dedupe_approvals(items: Vec<ApprovalRequest>) -> Vec<ApprovalRequest> {
    let mut deduped = BTreeMap::new();
    for item in items {
        deduped.insert(item.fingerprint.clone(), item);
    }
    deduped.into_values().collect()
}

fn build_context(
    repo_root: &Path,
    worktree_path: &Path,
    branch: Option<String>,
    base_branch: Option<String>,
    head_sha: String,
    is_main: bool,
    default_remote: String,
    loaded: &LoadedConfig,
) -> TemplateContext {
    let warmup = git::build_warmup_preview(
        repo_root,
        worktree_path,
        branch.as_deref(),
        &loaded.merged.cold_start,
    );
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
    let mut ports = BTreeMap::new();
    for port in warmup.ports {
        ports.insert(port.name, (port.port, port.url));
    }
    TemplateContext { values, ports }
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
        loaded,
    )
}

fn shell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\"'\"'"))
}

fn apple_quote(value: &str) -> String {
    format!("\"{}\"", value.replace('\\', "\\\\").replace('"', "\\\""))
}

fn sanitize_env(value: &str) -> String {
    value
        .chars()
        .map(|char| match char {
            'a'..='z' => char.to_ascii_uppercase(),
            'A'..='Z' | '0'..='9' => char,
            _ => '_',
        })
        .collect()
}

fn info(message: String) -> RunLog {
    RunLog {
        level: LogLevel::Info,
        message,
    }
}

pub fn approve_fingerprints(
    app: &AppHandle,
    state: &SharedState,
    repo_root: &str,
    fingerprints: &[String],
) -> Result<(), String> {
    let mut store = state.store.lock().unwrap();
    approve(
        &mut store,
        repo_root,
        fingerprints,
        &Utc::now().to_rfc3339(),
    );
    persist(app, &store)
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

    #[test]
    fn render_template_replaces_ports() {
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
            ports: BTreeMap::from([("web".into(), (3123, Some("http://localhost:3123".into())))]),
        };
        assert_eq!(
            render_template("open {url:web} on {branch}", &context),
            "open http://localhost:3123 on feat"
        );
    }
}
