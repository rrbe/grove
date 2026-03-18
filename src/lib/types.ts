export type LauncherKind = "app" | "terminal-cli" | "shell-script" | "applescript";
export type HookEvent =
  | "pre-create"
  | "post-create"
  | "pre-launch"
  | "post-launch"
  | "pre-remove"
  | "post-remove";
export type CreateMode = "new-branch" | "existing-branch" | "remote-branch";
export type ExecutionStatus = "running" | "completed" | "failed";
export type ExecutionEventKind = "log-appended" | "completed" | "failed";
export type LogLevel = "info" | "success" | "error";

export interface BootstrapResponse {
  recentRepos: string[];
  toolStatuses: ToolStatus[];
  lastActiveRepo: string | null;
}

export interface ToolStatus {
  id: string;
  label: string;
  available: boolean;
  location: string | null;
  kind: string;
}

export interface RepoSettings {
  worktreeRoot: string;
  defaultBaseBranch: string;
}

export interface LauncherProfile {
  id: string;
  name: string;
  kind: LauncherKind;
  appOrCmd: string;
  argsTemplate: string[];
  openInTerminal: boolean;
  promptTemplate: string | null;
  isCustom: boolean;
  iconChar: string | null;
}

export interface SaveCustomLauncherInput {
  launcher: LauncherProfile;
  repoRoot: string | null;
}

export interface DeleteCustomLauncherInput {
  launcherId: string;
  repoRoot: string | null;
}

export interface HookStep {
  type: "script" | "launch" | "install" | "copy-files";
  run?: string | null;
  launcherId?: string | null;
  paths?: string[];
}

export interface ResolvedConfig {
  settings: RepoSettings;
  launchers: LauncherProfile[];
  hooks: Partial<Record<HookEvent, HookStep[]>>;
}

export interface WorktreeRecord {
  id: string;
  path: string;
  branch: string | null;
  headSha: string;
  isMain: boolean;
  lockedReason: string | null;
  prunableReason: string | null;
  dirty: boolean;
  ahead: number;
  behind: number;
  lastOpenedAt: string | null;
  headCommitDate: string | null;
  prNumber: number | null;
  prUrl: string | null;
  recentCommits: CommitSummary[];
  changedFiles: FileChange[];
}

export interface CommitSummary {
  sha: string;
  message: string;
  date: string;
  author: string;
}

export type FileStatus = "modified" | "added" | "deleted" | "renamed" | "untracked";

export interface FileChange {
  status: FileStatus;
  path: string;
}

export interface RepoSnapshot {
  repoRoot: string;
  mainWorktreePath: string;
  configText: string;
  configErrors: string[];
  mergedConfig: ResolvedConfig;
  worktrees: WorktreeRecord[];
  recentRepos: string[];
  toolStatuses: ToolStatus[];
}

export interface SaveConfigInput {
  repoRoot: string;
  configText: string;
}

export interface SaveHooksInput {
  repoRoot: string;
  configText: string;
  hooks: Partial<Record<HookEvent, HookStep[]>>;
}

export interface CreateWorktreeInput {
  repoRoot: string;
  mode: CreateMode;
  branch: string;
  baseRef: string | null;
  remoteRef: string | null;
  path: string | null;
  autoStartLaunchers: string[];
}

export interface RemoveWorktreeInput {
  repoRoot: string;
  worktreePath: string;
  force: boolean;
}

export interface LaunchWorktreeInput {
  repoRoot: string;
  worktreePath: string;
  launcherId: string;
  promptOverride: string | null;
}

export interface RunHookEventInput {
  repoRoot: string;
  event: HookEvent;
  worktreePath: string | null;
}

export interface RunLog {
  level: LogLevel;
  message: string;
}

export interface ActionResponse {
  logs: RunLog[];
  repo: RepoSnapshot | null;
}

export interface ExecutionSessionSnapshot {
  sessionId: string;
  title: string;
  repoRoot: string;
  status: ExecutionStatus;
  logs: RunLog[];
  repo: RepoSnapshot | null;
  error: string | null;
}

export interface ShellInfo {
  path: string;
  label: string;
}

export interface ExecutionEvent {
  sessionId: string;
  kind: ExecutionEventKind;
  status: ExecutionStatus | null;
  log: RunLog | null;
  repo: RepoSnapshot | null;
  error: string | null;
}
