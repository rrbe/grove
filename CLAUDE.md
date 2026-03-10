# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

A macOS-first Tauri 2 desktop app for managing Git worktrees. React 19 + TypeScript frontend with a Rust backend that shells out to the system `git` CLI.

## Commands

```bash
pnpm install              # install frontend deps
pnpm tauri:dev            # run the full app (frontend + Rust backend)
pnpm build                # frontend-only type-check + vite build
cd src-tauri && cargo test # run Rust backend tests
cd src-tauri && cargo clippy # lint Rust code
```

## Architecture

**Frontend** (`src/`): Single-page React app. All state lives in `App.tsx` — no router, no state library. `src/lib/api.ts` wraps every `@tauri-apps/api/core` `invoke()` call; `src/lib/types.ts` has the shared TypeScript types that mirror the Rust models.

**Backend** (`src-tauri/src/`): Tauri command handlers registered in `lib.rs`. Key modules:
- `git.rs` — shells out to `git worktree list --porcelain`, `git status`, `git rev-list`, etc.
- `config.rs` — loads/saves `.worktree-switcher/config.toml` (project) and `local.toml` (machine-specific overrides), merges them
- `models.rs` — all serde structs shared between commands; camelCase-renamed for the JS bridge
- `actions.rs` — create/remove/start/launch worktrees, run hooks, prune
- `store.rs` — persists recent repos and command approval fingerprints to Tauri's app data dir

**IPC pattern**: Rust structs use `#[serde(rename_all = "camelCase")]`. The frontend calls `invoke<T>("command_name", { input })` and receives camelCase JSON. When adding a new command, register it in `lib.rs`'s `invoke_handler` macro, add the TS wrapper in `api.ts`, and add the type in `types.ts`.

**Approval gate**: Project-defined shell commands (hooks, terminal launchers) require user approval. Fingerprints (SHA-256 of command content) are stored per-repo. If a command's fingerprint isn't approved, the action returns `approval-required` status and the frontend shows a modal.
