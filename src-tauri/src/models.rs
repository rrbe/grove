use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BootstrapResponse {
    pub recent_repos: Vec<String>,
    pub tool_statuses: Vec<ToolStatus>,
    pub last_active_repo: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepoSnapshot {
    pub repo_root: String,
    pub main_worktree_path: String,
    pub config_paths: ConfigPaths,
    pub project_config_text: String,
    pub local_config_text: String,
    pub config_errors: Vec<String>,
    pub merged_config: ResolvedConfig,
    pub worktrees: Vec<WorktreeRecord>,
    pub recent_repos: Vec<String>,
    pub tool_statuses: Vec<ToolStatus>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigPaths {
    pub project_path: String,
    pub local_path: String,
    pub project_exists: bool,
    pub local_exists: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeRecord {
    pub id: String,
    pub path: String,
    pub branch: Option<String>,
    pub head_sha: String,
    pub is_main: bool,
    pub locked_reason: Option<String>,
    pub prunable_reason: Option<String>,
    pub dirty: bool,
    pub ahead: u32,
    pub behind: u32,
    pub last_opened_at: Option<String>,
    pub head_commit_date: Option<String>,
    pub warmup_preview: WarmupPreview,
    pub pr_number: Option<u32>,
    pub pr_url: Option<String>,
    pub recent_commits: Vec<CommitSummary>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitSummary {
    pub sha: String,
    pub message: String,
    pub date: String,
    pub author: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WarmupPreview {
    pub copy_candidates: Vec<String>,
    pub ports: Vec<PortAssignment>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PortAssignment {
    pub name: String,
    pub env_var: String,
    pub port: u16,
    pub url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolStatus {
    pub id: String,
    pub label: String,
    pub available: bool,
    pub location: Option<String>,
    pub kind: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedConfig {
    pub settings: RepoSettings,
    pub cold_start: ColdStartConfig,
    pub launchers: Vec<LauncherProfile>,
    pub hooks: Vec<HookStep>,
}

impl Default for ResolvedConfig {
    fn default() -> Self {
        Self {
            settings: RepoSettings::default(),
            cold_start: ColdStartConfig::default(),
            launchers: Vec::new(),
            hooks: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RepoSettings {
    pub worktree_root: String,
    pub default_base_branch: String,
}

impl Default for RepoSettings {
    fn default() -> Self {
        Self {
            worktree_root: ".worktrees".into(),
            default_base_branch: "main".into(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ColdStartConfig {
    pub copy_files: Vec<String>,
    pub ports: Vec<PortTemplate>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PortTemplate {
    pub name: String,
    pub base: u16,
    pub env_var: String,
    pub url_template: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum LauncherKind {
    App,
    TerminalCli,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LauncherProfile {
    pub id: String,
    pub name: String,
    pub kind: LauncherKind,
    pub app_or_cmd: String,
    #[serde(default)]
    pub args_template: Vec<String>,
    #[serde(default)]
    pub open_in_terminal: bool,
    pub prompt_template: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash, PartialOrd, Ord)]
#[serde(rename_all = "kebab-case")]
pub enum HookEvent {
    PreCreate,
    PostCreate,
    PostStart,
    PreLaunch,
    PostLaunch,
    PreRemove,
    PostRemove,
    PostScan,
}

impl HookEvent {
    pub fn label(&self) -> &'static str {
        match self {
            HookEvent::PreCreate => "pre-create",
            HookEvent::PostCreate => "post-create",
            HookEvent::PostStart => "post-start",
            HookEvent::PreLaunch => "pre-launch",
            HookEvent::PostLaunch => "post-launch",
            HookEvent::PreRemove => "pre-remove",
            HookEvent::PostRemove => "post-remove",
            HookEvent::PostScan => "post-scan",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum HookStepType {
    Script,
    Launch,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HookStep {
    pub id: String,
    pub event: HookEvent,
    #[serde(rename = "type")]
    pub step_type: HookStepType,
    #[serde(default = "default_enabled")]
    pub enabled: bool,
    #[serde(default = "default_blocking")]
    pub blocking: bool,
    pub run: Option<String>,
    pub launcher_id: Option<String>,
    pub prompt_template: Option<String>,
}

const fn default_enabled() -> bool {
    true
}

const fn default_blocking() -> bool {
    true
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ConfigFile {
    #[serde(default)]
    pub settings: SettingsPatch,
    #[serde(default)]
    pub cold_start: ColdStartPatch,
    #[serde(default)]
    pub launchers: Vec<LauncherProfile>,
    #[serde(default)]
    pub hooks: Vec<HookStep>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SettingsPatch {
    pub worktree_root: Option<String>,
    pub default_base_branch: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ColdStartPatch {
    pub copy_files: Option<Vec<String>>,
    pub ports: Option<Vec<PortTemplate>>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveConfigsInput {
    pub repo_root: String,
    pub project_config_text: String,
    pub local_config_text: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApproveCommandsInput {
    pub repo_root: String,
    pub fingerprints: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateWorktreeInput {
    pub repo_root: String,
    pub mode: CreateMode,
    pub branch: String,
    pub base_ref: Option<String>,
    pub remote_ref: Option<String>,
    pub path: Option<String>,
    #[serde(default)]
    pub auto_start_launchers: Vec<String>,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum CreateMode {
    NewBranch,
    ExistingBranch,
    RemoteBranch,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoveWorktreeInput {
    pub repo_root: String,
    pub worktree_path: String,
    #[serde(default)]
    pub force: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartWorktreeInput {
    pub repo_root: String,
    pub worktree_path: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LaunchWorktreeInput {
    pub repo_root: String,
    pub worktree_path: String,
    pub launcher_id: String,
    pub prompt_override: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunHookEventInput {
    pub repo_root: String,
    pub event: HookEvent,
    pub worktree_path: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActionResponse {
    pub status: ActionStatus,
    pub logs: Vec<RunLog>,
    pub approvals: Vec<ApprovalRequest>,
    pub repo: Option<RepoSnapshot>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum ActionStatus {
    Completed,
    ApprovalRequired,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunLog {
    pub level: LogLevel,
    pub message: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum LogLevel {
    Info,
    Success,
    Error,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApprovalRequest {
    pub fingerprint: String,
    pub label: String,
    pub command: String,
    pub cwd: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApprovalRecord {
    pub repo_root: String,
    pub fingerprint: String,
    pub approved_at: String,
}
