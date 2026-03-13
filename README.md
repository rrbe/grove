# Grove

A macOS-first desktop app for managing Git worktrees — scan, create, launch, and clean up worktrees from a single UI.

## Stack

- Tauri 2 (macOS 13.0+)
- React 19 + TypeScript + Vite
- Rust backend shelling out to system `git`

## Features

- Scan `git worktree` state with dirty / ahead / behind / prunable / locked indicators
- Create worktrees from new branch, existing local branch, or remote tracking branch with branch dropdown selectors
- Auto-suggest random branch names, auto-fill target paths
- Remove worktrees with streamed execution logs and preview / execute `git worktree prune`
- Auto-detect default branch from `origin/HEAD` (falls back to `main`/`master`)
- Per-repo configurable worktree root directory (stored in app settings, not in the repo)
- Project-level hooks (pre-create, post-create, post-start, post-scan) via `.grove/config.toml`
- Approval gate for project-defined shell commands and terminal launchers
- Built-in launchers for Terminal, Ghostty, iTerm2, VS Code, Cursor, Claude CLI, Codex CLI, and Gemini CLI
- Cold-start helpers: copy ignored files (`.env`, `.npmrc`) and generate deterministic ports
- Recent commits per worktree, GitHub PR badge linking via `gh` CLI
- i18n: Chinese (default) and English

## Run

```bash
pnpm install
pnpm tauri:dev
```

Frontend-only type-check + build:

```bash
pnpm build
```

Backend tests:

```bash
cd src-tauri && cargo test
```

## Config

App state is stored at `~/.grove/store.json` (recent repos, approvals, per-repo worktree root settings, default terminal, etc.).

Per-repo project config can optionally be placed at `.grove/config.toml` in the repo root, with machine-specific local overrides at `.grove/local.toml` (add to `.gitignore`).

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `⌘,` | Toggle settings page |
| `Escape` | Close create worktree modal |
