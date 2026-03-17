# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

Grove — a macOS-first Tauri 2 desktop app for managing Git worktrees. React 19 + TypeScript frontend with a Rust backend that shells out to the system `git` CLI. i18n support with Chinese (default) and English.

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

**Backend** (`src-tauri/src/`): All Tauri commands are async (`spawn_blocking`) to keep the UI responsive. Key modules:
- `git.rs` — shells out to `git worktree list --porcelain`, `git status`, `git branch`, `git fetch`, `git rev-list`, etc. Auto-detects default branch via `origin/HEAD`.
- `config.rs` — loads `.grove/config.toml` (project) and `local.toml` (machine-specific overrides), merges them. Imports `git::detect_default_branch` for the base branch fallback.
- `models.rs` — all serde structs shared between commands; camelCase-renamed for the JS bridge
- `actions.rs` — create/remove/start/launch worktrees, run hooks, prune. Streams stdout/stderr as logs; stderr is logged as info unless the process exits non-zero.
- `store.rs` — persists recent repos, PR cache, approval fingerprints, per-repo worktree root overrides, and default terminal as JSON to `~/.grove/store.json`

**IPC pattern**: Rust structs use `#[serde(rename_all = "camelCase")]`. The frontend calls `invoke<T>("command_name", { input })` and receives camelCase JSON. When adding a new command: register in `lib.rs` `invoke_handler` macro → add TS wrapper in `api.ts` → add type in `types.ts`.

**Approval gate**: Project-defined shell commands (hooks, terminal launchers) require user approval. Fingerprints (SHA-256 of command content) are stored per-repo. If a command's fingerprint isn't approved, the action returns `approval-required` status and the frontend shows a modal.

**Config merging**: `builtin_config()` → auto-detect default branch from git → apply project TOML → apply local TOML → apply per-repo worktree root from app store. Each layer overrides the previous.

**Storage**: App data lives at `~/.grove/store.json`, NOT in Tauri's default app data dir. Per-repo worktree root settings are stored here too, keyed by repo path.

## Notes

- All Tauri commands that do git/file I/O must be async (`spawn_blocking`), never blocking the main thread.
- `run_command_streaming` treats stderr as info-level during streaming; only escalates to error if exit code is non-zero (git writes informational messages like "Preparing worktree..." to stderr).
- **Reuse `src/components/` components** — use `Input`, `Textarea`, `Select` from `FormControls.tsx` instead of native `<input>`, `<textarea>`, `<select>`; use `ModalShell` for modals, `Alert` for error banners. Do not introduce new wrapper components for things that already exist.

## UI Layout

Master-detail with resizable sidebar. Sidebar: repo picker (with repo info line), worktree list, bottom action buttons (create worktree modal, hooks, settings gear). Main panel: worktree detail or settings page. Create worktree uses a right-side slide-out panel with branch dropdowns and auto-filled target path.
