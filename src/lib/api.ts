import { invoke } from "@tauri-apps/api/core";
import type {
  ActionResponse,
  ApproveCommandsInput,
  BootstrapResponse,
  CreateWorktreeInput,
  LaunchWorktreeInput,
  RepoSnapshot,
  RemoveWorktreeInput,
  RunHookEventInput,
  SaveConfigsInput,
  StartWorktreeInput,
} from "./types";

export function bootstrap() {
  return invoke<BootstrapResponse>("bootstrap");
}

export function openRepo(repoRoot: string) {
  return invoke<RepoSnapshot>("open_repo", { repoRoot });
}

export function saveRepoConfigs(input: SaveConfigsInput) {
  return invoke<RepoSnapshot>("save_repo_configs", { input });
}

export function approveRepoCommands(input: ApproveCommandsInput) {
  return invoke<void>("approve_repo_commands", { input });
}

export function createRepoWorktree(input: CreateWorktreeInput) {
  return invoke<ActionResponse>("create_repo_worktree", { input });
}

export function removeRepoWorktree(input: RemoveWorktreeInput) {
  return invoke<ActionResponse>("remove_repo_worktree", { input });
}

export function startRepoWorktree(input: StartWorktreeInput) {
  return invoke<ActionResponse>("start_repo_worktree", { input });
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

export function getDefaultTerminal() {
  return invoke<string>("get_default_terminal");
}

export function setDefaultTerminal(terminalId: string) {
  return invoke<void>("set_default_terminal", { terminalId });
}
