export type LauncherKind = "app" | "terminal-cli";
export type HookEvent =
  | "pre-create"
  | "post-create"
  | "post-start"
  | "pre-launch"
  | "post-launch"
  | "pre-remove"
  | "post-remove"
  | "post-scan";
export type CreateMode = "new-branch" | "existing-branch" | "remote-branch";
export type ActionStatus = "completed" | "approval-required";
export type LogLevel = "info" | "success" | "error";

export interface BootstrapResponse {
  recentRepos: string[];
  toolStatuses: ToolStatus[];
}

export interface ToolStatus {
  id: string;
  label: string;
  available: boolean;
  location: string | null;
  kind: string;
}

export interface ConfigPaths {
  projectPath: string;
  localPath: string;
  projectExists: boolean;
  localExists: boolean;
}

export interface PortTemplate {
  name: string;
  base: number;
  envVar: string;
  urlTemplate: string | null;
}

export interface ColdStartConfig {
  copyFiles: string[];
  ports: PortTemplate[];
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
}

export interface HookStep {
  id: string;
  event: HookEvent;
  type: "script" | "launch";
  enabled: boolean;
  blocking: boolean;
  run: string | null;
  launcherId: string | null;
  promptTemplate: string | null;
}

export interface ResolvedConfig {
  settings: RepoSettings;
  coldStart: ColdStartConfig;
  launchers: LauncherProfile[];
  hooks: HookStep[];
}

export interface PortAssignment {
  name: string;
  envVar: string;
  port: number;
  url: string | null;
}

export interface WarmupPreview {
  copyCandidates: string[];
  ports: PortAssignment[];
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
  warmupPreview: WarmupPreview;
}

export interface RepoSnapshot {
  repoRoot: string;
  mainWorktreePath: string;
  configPaths: ConfigPaths;
  projectConfigText: string;
  localConfigText: string;
  configErrors: string[];
  mergedConfig: ResolvedConfig;
  worktrees: WorktreeRecord[];
  recentRepos: string[];
  toolStatuses: ToolStatus[];
}

export interface SaveConfigsInput {
  repoRoot: string;
  projectConfigText: string;
  localConfigText: string;
}

export interface ApproveCommandsInput {
  repoRoot: string;
  fingerprints: string[];
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

export interface StartWorktreeInput {
  repoRoot: string;
  worktreePath: string;
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

export interface ApprovalRequest {
  fingerprint: string;
  label: string;
  command: string;
  cwd: string;
}

export interface RunLog {
  level: LogLevel;
  message: string;
}

export interface ActionResponse {
  status: ActionStatus;
  logs: RunLog[];
  approvals: ApprovalRequest[];
  repo: RepoSnapshot | null;
}
