import { invoke } from "@tauri-apps/api/core";
import type {
  ActionResponse,
  BootstrapResponse,
  CreateWorktreeInput,
  DeleteCustomLauncherInput,
  ExecutionSessionSnapshot,
  LaunchWorktreeInput,
  RepoSnapshot,
  RemoveWorktreeInput,
  RunHookEventInput,
  SaveConfigInput,
  SaveCustomLauncherInput,
  SaveHooksInput,
  ShellInfo,
} from "./types";

export function getAppVersion() {
  return invoke<string>("get_app_version");
}

export function bootstrap() {
  return invoke<BootstrapResponse>("bootstrap");
}

export function openRepo(repoRoot: string) {
  return invoke<RepoSnapshot>("open_repo", { repoRoot });
}

export function saveRepoConfig(input: SaveConfigInput) {
  return invoke<RepoSnapshot>("save_repo_config", { input });
}

export function saveRepoHooks(input: SaveHooksInput) {
  return invoke<RepoSnapshot>("save_repo_hooks", { input });
}

export function createRepoWorktree(input: CreateWorktreeInput) {
  return invoke<ActionResponse>("create_repo_worktree", { input });
}

export function removeRepoWorktree(input: RemoveWorktreeInput) {
  return invoke<ActionResponse>("remove_repo_worktree", { input });
}

export function startRemoveRepoWorktreeSession(input: RemoveWorktreeInput) {
  return invoke<ExecutionSessionSnapshot>("start_remove_repo_worktree_session", { input });
}

export function getExecutionSessionSnapshot(sessionId: string) {
  return invoke<ExecutionSessionSnapshot>("get_execution_session_snapshot", { sessionId });
}

export function disposeExecutionSession(sessionId: string) {
  return invoke<void>("dispose_execution_session_snapshot", { sessionId });
}

export function launchRepoWorktree(input: LaunchWorktreeInput) {
  return invoke<ActionResponse>("launch_repo_worktree", { input });
}

export function runRepoHookEvent(input: RunHookEventInput) {
  return invoke<ActionResponse>("run_repo_hook_event", { input });
}

export function previewRepoPrune(repoRoot: string) {
  return invoke<string[]>("preview_repo_prune", { repoRoot });
}

export function pruneRepoMetadata(repoRoot: string) {
  return invoke<ActionResponse>("prune_repo_metadata", { repoRoot });
}

export function listBranches(repoRoot: string) {
  return invoke<string[]>("list_branches", { repoRoot });
}

export function listRemoteBranches(repoRoot: string) {
  return invoke<string[]>("list_remote_branches", { repoRoot });
}

export function fetchRemote(repoRoot: string) {
  return invoke<string>("fetch_remote", { repoRoot });
}

export function getDefaultTerminal() {
  return invoke<string>("get_default_terminal");
}

export function setDefaultTerminal(terminalId: string) {
  return invoke<void>("set_default_terminal", { terminalId });
}

export function getFileDiff(worktreePath: string, filePath: string, status: string) {
  return invoke<string>("get_file_diff", { worktreePath, filePath, status });
}

export function setWorktreeRoot(repoRoot: string, worktreeRoot: string) {
  return invoke<RepoSnapshot>("set_repo_worktree_root", { repoRoot, worktreeRoot });
}

export function detectInstallCommand(repoRoot: string) {
  return invoke<string | null>("detect_install_command", { repoRoot });
}

export function listInstalledApps() {
  return invoke<string[]>("list_installed_apps");
}

export function saveCustomLauncher(input: SaveCustomLauncherInput) {
  return invoke<RepoSnapshot>("save_custom_launcher", { input });
}

export function deleteCustomLauncher(input: DeleteCustomLauncherInput) {
  return invoke<RepoSnapshot>("delete_custom_launcher", { input });
}

export function listAvailableShells() {
  return invoke<ShellInfo[]>("list_available_shells");
}

export function getDefaultShell() {
  return invoke<string>("get_default_shell");
}

export function setDefaultShell(shell: string) {
  return invoke<void>("set_default_shell", { shell });
}

export function getShowTrayIcon() {
  return invoke<boolean>("get_show_tray_icon");
}

export function setShowTrayIcon(enabled: boolean) {
  return invoke<void>("set_show_tray_icon", { enabled });
}

export function getThemeMode() {
  return invoke<string>("get_theme_mode");
}

export function setThemeMode(mode: string) {
  return invoke<void>("set_theme_mode", { mode });
}

export function openRepoWindow(repoPath: string) {
  return invoke<void>("open_repo_window", { repoPath });
}

export function checkGroveCliInstalled() {
  return invoke<boolean>("check_grove_cli_installed");
}

export function installGroveCli() {
  return invoke<string>("install_grove_cli");
}

export function uninstallGroveCli() {
  return invoke<string>("uninstall_grove_cli");
}
