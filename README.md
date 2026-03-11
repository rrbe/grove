# Grove

A macOS-first desktop app for scanning, creating, cleaning, and launching Git worktrees.

## Stack

- Tauri 2 (macOS 13.0+)
- React 19 + TypeScript + Vite
- Rust backend shelling out to system `git`

## Features

- Scan `git worktree` state with dirty / ahead / behind / prunable / locked indicators
- Create worktrees from a new branch, existing local branch, or remote tracking branch
- Live path preview with branch name sanitization
- Remove worktrees and preview / execute `git worktree prune`
- Auto-detect default branch from `origin/HEAD` (falls back to `main`/`master`)
- Project-level hooks from `.worktree-switcher/config.toml` plus local overrides from `.worktree-switcher/local.toml`
- Approval gate for project-defined shell commands and terminal launchers
- Built-in launchers for Terminal, VS Code, Cursor, Claude CLI, Codex CLI, and Gemini CLI
- Cold-start helpers for copying ignored files and generating deterministic ports
- Recent commits per worktree, PR badge linking
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

Project config lives at `.worktree-switcher/config.toml`. Local, machine-specific overrides at `.worktree-switcher/local.toml`.

The app seeds a sample project config with:

- Built-in launchers (Terminal, VS Code, Cursor, Claude/Codex/Gemini CLI)
- Example hook entries for post-create, post-start, post-scan events
- Cold-start copy rules for `.env`, `.env.local`, `.npmrc`
- Deterministic port templates for `PORT` and `VITE_PORT`

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `⌘,` | Toggle settings page |
| `Escape` | Close create worktree modal |
