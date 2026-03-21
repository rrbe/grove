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
- `config.rs` — parses/renders TOML config text for the in-app editor, merges config layers. Imports `git::detect_default_branch` for the base branch fallback.
- `models.rs` — all serde structs shared between commands; camelCase-renamed for the JS bridge
- `actions.rs` — create/remove/start/launch worktrees, run hooks, prune. Streams stdout/stderr as logs; stderr is logged as info unless the process exits non-zero.
- `store.rs` — persists recent repos, PR cache, per-repo config and worktree root overrides, and default terminal as JSON to `~/.grove/store.json`

**IPC pattern**: Rust structs use `#[serde(rename_all = "camelCase")]`. The frontend calls `invoke<T>("command_name", { input })` and receives camelCase JSON. When adding a new command: register in `lib.rs` `invoke_handler` macro → add TS wrapper in `api.ts` → add type in `types.ts`.

**Config merging**: `builtin_config()` → auto-detect default branch from git → apply per-repo config from app store → apply per-repo worktree root from app store. Each layer overrides the previous. All config is stored in `~/.grove/store.json`, not in repo-level files.

**Storage**: App data lives at `~/.grove/store.json`, NOT in Tauri's default app data dir. Per-repo worktree root settings are stored here too, keyed by repo path.

## Design System

All UI work **must** follow `DESIGN_SYSTEM.md`. Key rules:

- **Colors**: Use the documented palette tokens — warm ink tones (`#10212e` base) with teal accent (`#2e6b63`). Do not introduce new brand colors.
- **Buttons**: Three variants only — `primary-button` (gradient CTA), `ghost-button` (secondary), `danger-button` (destructive). One primary button per visible form section. Pill radius (`999px`) for all standard buttons.
- **Inputs**: Always use `<Input>`, `<Textarea>`, `<Select>` from `FormControls.tsx`. Radius `14px`, focus ring teal. Never use native elements directly.
- **Toast**: Bottom-right, one at a time, auto-dismiss 3s. Two variants: `toast-success` / `toast-error`. Prefix with `✓` / `✗`.
- **Typography**: Serif (`Iowan Old Style`) for feature headings, sans-serif (`Avenir Next`) for UI, monospace (`SF Mono`) for code/paths. Do not add new font stacks.
- **Cards**: Semi-transparent white (`rgba(255,255,255,0.74)`), radius `20px`. Glass-morphism (`backdrop-filter: blur`) only on the topbar.
- **Modals**: Use `ModalShell` component. Radius `24px`, warm off-white surface. Dismiss via Escape + backdrop click.
- **Spacing**: 2px base grid. Common stops: 6, 8, 10, 12, 14, 20, 24px. Follow existing patterns.
- **Transitions**: Buttons `140ms ease`, list items `100ms ease`, slide-out `180ms ease-out`.
- **Dark mode**: Supports Light / Dark / System. All colors use CSS custom properties (`var(--token)`). When adding new UI, always use existing tokens from `:root` — never hardcode colors. Verify new pages/components look correct in both light and dark mode.

## Notes

- All Tauri commands that do git/file I/O must be async (`spawn_blocking`), never blocking the main thread.
- `run_command_streaming` treats stderr as info-level during streaming; only escalates to error if exit code is non-zero (git writes informational messages like "Preparing worktree..." to stderr).
- Split components when necessary—don’t let a single file take on too much responsibility (for example, exceeding 500 lines). This applies to both React UI components and Rust functional modules.
- **Reuse `src/components/` components** — use `Input`, `Textarea`, `Select` from `FormControls.tsx` instead of native `<input>`, `<textarea>`, `<select>`; use `ModalShell` for modals, `Alert` for error banners. Do not introduce new wrapper components for things that already exist.

## UI Layout

Top navigation bar (38px, `titleBarStyle: overlay` with 78px left padding for macOS traffic lights) + full-width content area. Topbar: brand, 4 tabs (Repository, Worktrees, Hooks, Settings), "New Worktree" button on the right. Views: Repository (centered card with repo picker), Worktrees (master-detail grid: 280px worktree list | detail panel), Hooks (inline hooks editor), Settings (language, terminal, shell, tray icon, tooling, logs, config). Create worktree uses a right-side slide-out panel.
