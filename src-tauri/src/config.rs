use crate::git;
use crate::models::{
    ConfigFile, HookEvent, HookStep, HookStepType, LauncherKind,
    LauncherProfile, RepoSettings, ResolvedConfig, SettingsPatch,
};
use std::collections::BTreeMap;
use std::path::Path;

#[derive(Debug, Clone)]
pub struct LoadedConfig {
    pub text: String,
    pub merged: ResolvedConfig,
    pub errors: Vec<String>,
}

pub fn load(
    repo_root: &Path,
    stored_config: Option<&ConfigFile>,
    custom_launchers: &[LauncherProfile],
) -> LoadedConfig {
    let mut merged = builtin_config();
    merged.settings.default_base_branch = git::detect_default_branch(repo_root);
    if let Some(config) = stored_config {
        merged = merge_config(merged, config.clone());
    }

    // Merge global custom launchers (from store)
    for launcher in custom_launchers {
        if !merged.launchers.iter().any(|l| l.id == launcher.id) {
            merged.launchers.push(launcher.clone());
        }
    }

    LoadedConfig {
        text: stored_config
            .and_then(|config| render_config_text(config).ok())
            .unwrap_or_else(sample_config_text),
        merged,
        errors: Vec::new(),
    }
}

pub fn parse_config_text(config_text: &str) -> Result<Option<ConfigFile>, String> {
    if config_text.trim().is_empty() {
        return Ok(None);
    }
    let parsed = toml::from_str::<ConfigFile>(config_text)
        .map_err(|error| format!("config is invalid TOML: {error}"))?;
    if is_effectively_empty(&parsed) {
        return Ok(None);
    }
    Ok(Some(parsed))
}

pub fn render_config_text(config: &ConfigFile) -> Result<String, String> {
    toml::to_string_pretty(config).map_err(|error| format!("failed to render config: {error}"))
}

pub fn builtin_config() -> ResolvedConfig {
    ResolvedConfig {
        settings: RepoSettings {
            worktree_root: ".claude".into(),
            default_base_branch: "main".into(),
        },
        launchers: builtin_launchers(),
        hooks: BTreeMap::new(),
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
            is_custom: false,
            icon_char: None,
        },
        LauncherProfile {
            id: "cursor".into(),
            name: "Cursor".into(),
            kind: LauncherKind::App,
            app_or_cmd: "Cursor".into(),
            args_template: vec!["{worktree_path}".into()],
            open_in_terminal: false,
            prompt_template: None,
            is_custom: false,
            icon_char: None,
        },
        LauncherProfile {
            id: "terminal".into(),
            name: "Terminal".into(),
            kind: LauncherKind::App,
            app_or_cmd: "Terminal".into(),
            args_template: vec!["{worktree_path}".into()],
            open_in_terminal: false,
            prompt_template: None,
            is_custom: false,
            icon_char: None,
        },
        LauncherProfile {
            id: "ghostty".into(),
            name: "Ghostty".into(),
            kind: LauncherKind::App,
            app_or_cmd: "Ghostty".into(),
            args_template: vec!["{worktree_path}".into()],
            open_in_terminal: false,
            prompt_template: None,
            is_custom: false,
            icon_char: None,
        },
        LauncherProfile {
            id: "iterm2".into(),
            name: "iTerm2".into(),
            kind: LauncherKind::App,
            app_or_cmd: "iTerm2".into(),
            args_template: vec!["{worktree_path}".into()],
            open_in_terminal: false,
            prompt_template: None,
            is_custom: false,
            icon_char: None,
        },
        LauncherProfile {
            id: "warp".into(),
            name: "Warp".into(),
            kind: LauncherKind::App,
            app_or_cmd: "Warp".into(),
            args_template: vec!["{worktree_path}".into()],
            open_in_terminal: false,
            prompt_template: None,
            is_custom: false,
            icon_char: None,
        },
        LauncherProfile {
            id: "claude".into(),
            name: "Claude CLI".into(),
            kind: LauncherKind::TerminalCli,
            app_or_cmd: "claude".into(),
            args_template: vec![],
            open_in_terminal: true,
            prompt_template: None,
            is_custom: false,
            icon_char: None,
        },
        LauncherProfile {
            id: "codex".into(),
            name: "Codex CLI".into(),
            kind: LauncherKind::TerminalCli,
            app_or_cmd: "codex".into(),
            args_template: vec!["--worktree".into()],
            open_in_terminal: true,
            prompt_template: None,
            is_custom: false,
            icon_char: None,
        },
        LauncherProfile {
            id: "gemini".into(),
            name: "Gemini CLI".into(),
            kind: LauncherKind::TerminalCli,
            app_or_cmd: "gemini".into(),
            args_template: vec![],
            open_in_terminal: true,
            prompt_template: None,
            is_custom: false,
            icon_char: None,
        },
    ]
}

pub fn sample_config_text() -> String {
    toml::to_string_pretty(&ConfigFile {
        settings: SettingsPatch {
            worktree_root: Some(".claude".into()),
            default_base_branch: Some("main".into()),
        },
        launchers: builtin_launchers(),
        hooks: BTreeMap::from([(
            HookEvent::PostCreate,
            vec![
                HookStep {
                    step_type: HookStepType::CopyFiles,
                    run: None,
                    launcher_id: None,
                    paths: vec![".env".into(), ".env.local".into(), ".npmrc".into()],
                    shell: None,
                },
                HookStep {
                    step_type: HookStepType::Install,
                    run: None,
                    launcher_id: None,
                    paths: Vec::new(),
                    shell: None,
                },
                HookStep {
                    step_type: HookStepType::Script,
                    run: Some("echo \"Worktree ready at $WORKTREE_PATH\"".into()),
                    launcher_id: None,
                    paths: Vec::new(),
                    shell: None,
                },
            ],
        )]),
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

    let mut launchers = BTreeMap::new();
    for launcher in base.launchers {
        launchers.insert(launcher.id.clone(), launcher);
    }
    for launcher in patch.launchers {
        launchers.insert(launcher.id.clone(), launcher);
    }
    base.launchers = launchers.into_values().collect();

    for (event, steps) in patch.hooks {
        base.hooks.insert(event, steps);
    }
    base
}

pub fn is_effectively_empty(config: &ConfigFile) -> bool {
    config.settings.worktree_root.is_none()
        && config.settings.default_base_branch.is_none()
        && config.launchers.is_empty()
        && config.hooks.is_empty()
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
    fn merge_replaces_launcher_and_hooks_by_event() {
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
                    is_custom: false,
                    icon_char: None,
                }],
                hooks: BTreeMap::from([(
                    HookEvent::PostCreate,
                    vec![HookStep {
                        step_type: HookStepType::Script,
                        run: Some("echo updated".into()),
                        launcher_id: None,
                        paths: Vec::new(),
                        shell: None,
                    }],
                )]),
                ..ConfigFile::default()
            },
        );

        let vscode = merged
            .launchers
            .iter()
            .find(|launcher| launcher.id == "vscode")
            .expect("vscode launcher");
        assert_eq!(vscode.name, "VS Code Stable");
        let post_create = merged
            .hooks
            .get(&HookEvent::PostCreate)
            .expect("post-create hooks");
        assert_eq!(post_create.len(), 1);
        assert_eq!(post_create[0].run.as_deref(), Some("echo updated"));
    }

    #[test]
    fn parse_empty_config_as_none() {
        assert!(parse_config_text("").unwrap().is_none());
        assert!(parse_config_text("[settings]\n").unwrap().is_none());
    }

    #[test]
    fn parse_structured_hook_actions() {
        let parsed = parse_config_text(
            r#"
[[hooks.post-create]]
type = "copy-files"
paths = [".env.local", ".npmrc"]

[[hooks.post-create]]
type = "install"
"#,
        )
        .unwrap()
        .expect("config");

        let post_create = parsed
            .hooks
            .get(&HookEvent::PostCreate)
            .expect("post-create hooks");
        assert_eq!(post_create.len(), 2);
        assert_eq!(post_create[0].step_type, HookStepType::CopyFiles);
        assert_eq!(post_create[0].paths, vec![".env.local", ".npmrc"]);
        assert_eq!(post_create[1].step_type, HookStepType::Install);
    }
}
