# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

A macOS-first Tauri 2 desktop app for managing Git worktrees. React 19 + TypeScript frontend with a Rust backend that shells out to the system `git` CLI. i18n support with Chinese (default) and English.

## Commands

```bash
pnpm install              # install frontend deps
pnpm tauri:dev            # run the full app (frontend + Rust backend)
pnpm build                # frontend-only type-check + vite build
cd src-tauri && cargo test # run Rust backend tests
cd src-tauri && cargo clippy # lint Rust code
```

## Architecture

**Frontend** (`src/`): Single-page React app. All state lives in `App.tsx` — no router, no state library. `src/lib/api.ts` wraps every `@tauri-apps/api/core` `invoke()` call; `src/lib/types.ts` has the shared TypeScript types that mirror the Rust models. Translations in `src/locales/`.

**Backend** (`src-tauri/src/`): Tauri command handlers registered in `lib.rs`. Key modules:
- `git.rs` — shells out to `git worktree list --porcelain`, `git status`, `git rev-list`, etc. Auto-detects default branch via `origin/HEAD`.
- `config.rs` — loads `.worktree-switcher/config.toml` (project) and `local.toml` (machine-specific overrides), merges them. Imports `git::detect_default_branch` for the base branch fallback.
- `models.rs` — all serde structs shared between commands; camelCase-renamed for the JS bridge
- `actions.rs` — create/remove/start/launch worktrees, run hooks, prune
- `store.rs` — persists recent repos, PR cache, and approval fingerprints as JSON to Tauri's app data dir (`~/Library/Application Support/`)

**IPC pattern**: Rust structs use `#[serde(rename_all = "camelCase")]`. The frontend calls `invoke<T>("command_name", { input })` and receives camelCase JSON. When adding a new command: register in `lib.rs` `invoke_handler` macro → add TS wrapper in `api.ts` → add type in `types.ts`.

**Approval gate**: Project-defined shell commands (hooks, terminal launchers) require user approval. Fingerprints (SHA-256 of command content) are stored per-repo. If a command's fingerprint isn't approved, the action returns `approval-required` status and the frontend shows a modal.

**Config merging**: `builtin_config()` → auto-detect default branch from git → apply project TOML → apply local TOML. Each layer overrides the previous.

## UI Layout

Master-detail with resizable sidebar. Sidebar: repo picker (with repo info line), worktree list, bottom action buttons (create worktree modal, hooks, settings gear). Main panel: worktree detail or settings page. Create worktree uses a right-side slide-out panel.
