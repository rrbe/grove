# Worktree Switcher

Worktree Switcher is a macOS-first desktop app for scanning, creating, cleaning, warming, and launching Git worktrees.

## Stack

- Tauri 2
- React 19 + TypeScript + Vite
- Rust backend that shells out to the system `git`

## Features

- Scan `git worktree` state with dirty / ahead / behind / prunable / locked indicators
- Create worktrees from a base branch, an existing local branch, or a remote tracking branch
- Remove worktrees and preview / execute `git worktree prune`
- Project-level hooks from `.worktree-switcher/config.toml` plus local overrides from `.worktree-switcher/local.toml`
- Approval gate for project-defined shell commands and terminal launchers
- Built-in launchers for Terminal, VS Code, Cursor, Claude CLI, Codex CLI, and Gemini CLI
- Cold-start helpers for copying ignored files and generating deterministic ports

## Run

```bash
pnpm install
pnpm tauri:dev
```

For a frontend-only build check:

```bash
pnpm build
```

For backend tests:

```bash
cd src-tauri
cargo test
```

## Config

Project config lives at `.worktree-switcher/config.toml`.

Local, machine-specific overrides live at `.worktree-switcher/local.toml`.

The app seeds a sample project config with:

- built-in launchers
- example hook entries
- cold-start copy rules for `.env`, `.env.local`, and `.npmrc`
- deterministic port templates for `PORT` and `VITE_PORT`
