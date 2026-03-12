use crate::git;
use crate::models::{
    ColdStartConfig, ColdStartPatch, ConfigFile, ConfigPaths, HookEvent, HookStep, HookStepType,
    LauncherKind, LauncherProfile, PortTemplate, RepoSettings, ResolvedConfig, SettingsPatch,
};
use std::{
    collections::BTreeMap,
    fs,
    path::{Path, PathBuf},
};

#[derive(Debug, Clone)]
pub struct LoadedConfig {
    pub paths: ConfigPaths,
    pub project_text: String,
    pub local_text: String,
    pub merged: ResolvedConfig,
    pub errors: Vec<String>,
}

pub fn project_config_path(repo_root: &Path) -> PathBuf {
    repo_root.join(".worktree-switcher").join("config.toml")
}

pub fn local_config_path(repo_root: &Path) -> PathBuf {
    repo_root.join(".worktree-switcher").join("local.toml")
}

pub fn load(repo_root: &Path) -> Result<LoadedConfig, String> {
    let project_path = project_config_path(repo_root);
    let local_path = local_config_path(repo_root);
    let project_exists = project_path.exists();
    let local_exists = local_path.exists();
    let mut errors = Vec::new();
    let project_text = if project_exists {
        fs::read_to_string(&project_path)
            .map_err(|error| format!("failed to read {}: {error}", project_path.display()))?
    } else {
        sample_project_text()
    };
    let local_text = if local_exists {
        fs::read_to_string(&local_path)
            .map_err(|error| format!("failed to read {}: {error}", local_path.display()))?
    } else {
        String::new()
    };
    let mut merged = builtin_config();
    // Auto-detect default branch from git before applying user config
    merged.settings.default_base_branch = git::detect_default_branch(repo_root);
    if project_exists && !project_text.trim().is_empty() {
        match toml::from_str::<ConfigFile>(&project_text) {
            Ok(file) => merged = merge_config(merged, file),
            Err(error) => errors.push(format!("project config parse error: {error}")),
        }
    }
    if !local_text.trim().is_empty() {
        match toml::from_str::<ConfigFile>(&local_text) {
            Ok(file) => merged = merge_config(merged, file),
            Err(error) => errors.push(format!("local config parse error: {error}")),
        }
    }

    Ok(LoadedConfig {
        paths: ConfigPaths {
            project_path: project_path.to_string_lossy().to_string(),
            local_path: local_path.to_string_lossy().to_string(),
            project_exists,
            local_exists,
        },
        project_text,
        local_text,
        merged,
        errors,
    })
}

pub fn save(
    repo_root: &Path,
    project_text: &str,
    local_text: &str,
) -> Result<LoadedConfig, String> {
    if !project_text.trim().is_empty() {
        toml::from_str::<ConfigFile>(project_text)
            .map_err(|error| format!("project config is invalid TOML: {error}"))?;
    }
    if !local_text.trim().is_empty() {
        toml::from_str::<ConfigFile>(local_text)
            .map_err(|error| format!("local config is invalid TOML: {error}"))?;
    }
    let config_dir = repo_root.join(".worktree-switcher");
    fs::create_dir_all(&config_dir)
        .map_err(|error| format!("failed to create {}: {error}", config_dir.display()))?;
    fs::write(project_config_path(repo_root), project_text)
        .map_err(|error| format!("failed to write project config: {error}"))?;
    fs::write(local_config_path(repo_root), local_text)
        .map_err(|error| format!("failed to write local config: {error}"))?;
    load(repo_root)
}

pub fn builtin_config() -> ResolvedConfig {
    ResolvedConfig {
        settings: RepoSettings {
            worktree_root: ".worktrees".into(),
            default_base_branch: "main".into(),
        },
        cold_start: ColdStartConfig {
            copy_files: vec![".env".into(), ".env.local".into(), ".npmrc".into()],
            ports: vec![
                PortTemplate {
                    name: "web".into(),
                    base: 3000,
                    env_var: "PORT".into(),
                    url_template: Some("http://localhost:{port}".into()),
                },
                PortTemplate {
                    name: "vite".into(),
                    base: 5173,
                    env_var: "VITE_PORT".into(),
                    url_template: Some("http://localhost:{port}".into()),
                },
            ],
        },
        launchers: builtin_launchers(),
        hooks: builtin_hooks(),
    }
}

fn builtin_launchers() -> Vec<LauncherProfile> {
    vec![
        LauncherProfile {
            id: "vscode".into(),
            name: "VS Code".into(),
            kind: LauncherKind::App,
            app_or_cmd: "Visual Studio Code".into(),
            args_template: vec!["{worktree_path}".into()],
            open_in_terminal: false,
            prompt_template: None,
        },
        LauncherProfile {
            id: "cursor".into(),
            name: "Cursor".into(),
            kind: LauncherKind::App,
            app_or_cmd: "Cursor".into(),
            args_template: vec!["{worktree_path}".into()],
            open_in_terminal: false,
            prompt_template: None,
        },
        LauncherProfile {
            id: "terminal".into(),
            name: "Terminal".into(),
            kind: LauncherKind::App,
            app_or_cmd: "Terminal".into(),
            args_template: vec!["{worktree_path}".into()],
            open_in_terminal: false,
            prompt_template: None,
        },
        LauncherProfile {
            id: "ghostty".into(),
            name: "Ghostty".into(),
            kind: LauncherKind::App,
            app_or_cmd: "Ghostty".into(),
            args_template: vec!["{worktree_path}".into()],
            open_in_terminal: false,
            prompt_template: None,
        },
        LauncherProfile {
            id: "iterm2".into(),
            name: "iTerm2".into(),
            kind: LauncherKind::App,
            app_or_cmd: "iTerm2".into(),
            args_template: vec!["{worktree_path}".into()],
            open_in_terminal: false,
            prompt_template: None,
        },
        LauncherProfile {
            id: "claude".into(),
            name: "Claude CLI".into(),
            kind: LauncherKind::TerminalCli,
            app_or_cmd: "claude".into(),
            args_template: vec![],
            open_in_terminal: true,
            prompt_template: None,
        },
        LauncherProfile {
            id: "codex".into(),
            name: "Codex CLI".into(),
            kind: LauncherKind::TerminalCli,
            app_or_cmd: "codex".into(),
            args_template: vec!["--worktree".into()],
            open_in_terminal: true,
            prompt_template: None,
        },
        LauncherProfile {
            id: "gemini".into(),
            name: "Gemini CLI".into(),
            kind: LauncherKind::TerminalCli,
            app_or_cmd: "gemini".into(),
            args_template: vec![],
            open_in_terminal: true,
            prompt_template: None,
        },
    ]
}

fn builtin_hooks() -> Vec<HookStep> {
    vec![HookStep {
        id: "warmup-note".into(),
        event: HookEvent::PostCreate,
        step_type: HookStepType::Script,
        enabled: false,
        blocking: true,
        run: Some("echo \"Worktree ready at $WORKTREE_PATH\"".into()),
        launcher_id: None,
        prompt_template: None,
    }]
}

pub fn sample_project_text() -> String {
    toml::to_string_pretty(&ConfigFile {
        settings: SettingsPatch {
            worktree_root: Some(".worktrees".into()),
            default_base_branch: Some("main".into()),
        },
        cold_start: ColdStartPatch {
            copy_files: Some(vec![".env".into(), ".env.local".into(), ".npmrc".into()]),
            ports: Some(vec![
                PortTemplate {
                    name: "web".into(),
                    base: 3000,
                    env_var: "PORT".into(),
                    url_template: Some("http://localhost:{port}".into()),
                },
                PortTemplate {
                    name: "vite".into(),
                    base: 5173,
                    env_var: "VITE_PORT".into(),
                    url_template: Some("http://localhost:{port}".into()),
                },
            ]),
        },
        launchers: builtin_launchers(),
        hooks: vec![
            HookStep {
                id: "copy-env-note".into(),
                event: HookEvent::PostCreate,
                step_type: HookStepType::Script,
                enabled: false,
                blocking: true,
                run: Some("echo \"Copied warmup files for $BRANCH\"".into()),
                launcher_id: None,
                prompt_template: None,
            },
            HookStep {
                id: "open-vscode".into(),
                event: HookEvent::PostStart,
                step_type: HookStepType::Launch,
                enabled: false,
                blocking: true,
                run: None,
                launcher_id: Some("vscode".into()),
                prompt_template: None,
            },
        ],
    })
    .unwrap_or_default()
}

pub fn merge_config(mut base: ResolvedConfig, patch: ConfigFile) -> ResolvedConfig {
    if let Some(worktree_root) = patch.settings.worktree_root {
        base.settings.worktree_root = worktree_root;
    }
    if let Some(default_base_branch) = patch.settings.default_base_branch {
        base.settings.default_base_branch = default_base_branch;
    }
    if let Some(copy_files) = patch.cold_start.copy_files {
        base.cold_start.copy_files = copy_files;
    }
    if let Some(ports) = patch.cold_start.ports {
        base.cold_start.ports = ports;
    }

    let mut launchers = BTreeMap::new();
    for launcher in base.launchers {
        launchers.insert(launcher.id.clone(), launcher);
    }
    for launcher in patch.launchers {
        launchers.insert(launcher.id.clone(), launcher);
    }
    base.launchers = launchers.into_values().collect();

    let mut hooks = BTreeMap::new();
    for hook in base.hooks {
        hooks.insert((hook.event.clone(), hook.id.clone()), hook);
    }
    for hook in patch.hooks {
        hooks.insert((hook.event.clone(), hook.id.clone()), hook);
    }
    base.hooks = hooks.into_values().collect();
    base
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builtin_codex_launcher_uses_worktree_flag() {
        let codex = builtin_launchers()
            .into_iter()
            .find(|launcher| launcher.id == "codex")
            .expect("codex launcher");

        assert_eq!(codex.args_template, vec!["--worktree"]);
    }

    #[test]
    fn merge_replaces_launcher_and_hook_by_id() {
        let base = builtin_config();
        let merged = merge_config(
            base,
            ConfigFile {
                launchers: vec![LauncherProfile {
                    id: "vscode".into(),
                    name: "VS Code Stable".into(),
                    kind: LauncherKind::App,
                    app_or_cmd: "Visual Studio Code".into(),
                    args_template: vec!["{worktree_path}".into(), "--reuse-window".into()],
                    open_in_terminal: false,
                    prompt_template: None,
                }],
                hooks: vec![HookStep {
                    id: "warmup-note".into(),
                    event: HookEvent::PostCreate,
                    step_type: HookStepType::Script,
                    enabled: true,
                    blocking: true,
                    run: Some("echo updated".into()),
                    launcher_id: None,
                    prompt_template: None,
                }],
                ..ConfigFile::default()
            },
        );

        let vscode = merged
            .launchers
            .iter()
            .find(|launcher| launcher.id == "vscode")
            .expect("vscode launcher");
        assert_eq!(vscode.name, "VS Code Stable");
        let hook = merged
            .hooks
            .iter()
            .find(|hook| hook.id == "warmup-note")
            .expect("hook");
        assert_eq!(hook.run.as_deref(), Some("echo updated"));
    }
}
