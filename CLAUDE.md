# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

Grove — a macOS-first Tauri 2 desktop app for managing Git worktrees. React 19 + TypeScript frontend with a Rust backend that shells out to the system `git` CLI. i18n support with Chinese (default) and English.

## Commands

```bash
pnpm install              # install frontend deps
pnpm tauri:dev            # run the full app (frontend + Rust backend)
pnpm build                # frontend-only type-check + vite build
pnpm test                 # run frontend tests (vitest)
pnpm tauri:build          # build desktop app (no bundle)
pnpm tauri:dist           # build + bundle (app + dmg)
cd src-tauri && cargo test # run Rust backend tests
cd src-tauri && cargo clippy # lint Rust code
```

## Releasing & Version Bump

When asked to **bump version** to `X.Y.Z`, do the full release flow — bumping the version files alone ships nothing; the `vX.Y.Z` tag push is what triggers a release.

1. Update the version in all four places, keeping them in sync:
   - `package.json` → `"version"`
   - `src-tauri/Cargo.toml` → `version`
   - `src-tauri/tauri.conf.json` → `"version"`
   - `src-tauri/Cargo.lock` → the `grove` package entry (run `cargo update -p grove --precise X.Y.Z` in `src-tauri/`, or `cargo check`, to refresh it after editing `Cargo.toml`)
2. Commit on a branch and open a PR (per the branch rules): `chore: bump version to X.Y.Z`.
3. After the PR merges to `main`, create an **annotated** tag on the merge commit and push it (message convention: `Grove vX.Y.Z`):
   ```bash
   git tag -a vX.Y.Z -m "Grove vX.Y.Z"
   git push origin vX.Y.Z
   ```
4. The tag push triggers `.github/workflows/release.yml`, which builds macOS (universal) / Linux / Windows via `tauri-action` and creates a **draft** GitHub release with the bundles attached.
5. Once all three platform builds finish, verify the artifacts then publish the draft: `gh release edit vX.Y.Z --draft=false` (or via the GitHub UI). Watch the build with `gh run watch` / `gh run list --workflow=release.yml`.

Notes:
- The tag **must** use the `v` prefix (`vX.Y.Z`); the workflow only fires on `tags: ['v*']`.
- The release build does **not** sign artifacts — the updater plugin was removed (#29). Do not re-add updater config or `TAURI_SIGNING_PRIVATE_KEY`; a malformed signing key is what broke the v0.12.0 / v0.12.1 release builds.

## Architecture

**Frontend** (`src/`): Single-page React app. All state lives in `App.tsx` — no router, no state library. `src/lib/api.ts` wraps every `@tauri-apps/api/core` `invoke()` call; `src/lib/types.ts` has the shared TypeScript types that mirror the Rust models. `src/lib/theme.tsx` provides ThemeProvider (light/dark/system); `src/lib/i18n.tsx` provides I18nProvider; `src/lib/branch-name-gen.ts` generates random branch name suggestions. Translations in `src/locales/`.

**Backend** (`src-tauri/src/`): All Tauri commands are async (`spawn_blocking`) to keep the UI responsive. Key modules:
- `git.rs` — shells out to `git worktree list --porcelain`, `git status`, `git branch`, `git fetch`, `git rev-list`, etc. Auto-detects default branch via `origin/HEAD`.
- `config.rs` — parses/renders TOML config text for the in-app editor, merges config layers. Imports `git::detect_default_branch` for the base branch fallback.
- `models.rs` — all serde structs shared between commands; camelCase-renamed for the JS bridge
- `actions.rs` — create/remove/start/launch worktrees, run hooks, prune. Streams stdout/stderr as logs; stderr is logged as info unless the process exits non-zero.
- `store.rs` — persists recent repos, PR cache, per-repo config and worktree root overrides, and default terminal as JSON to `~/.grove/store.json`. All functions (`persist`, `load_store`, `store_path`) are Tauri-independent — no `AppHandle` required.
- `cli.rs` — clap-based CLI. Worktree lifecycle verbs live under `grove worktree` (`list`, `new`, `detach`, `attach`, `rm`), with hidden top-level aliases (`grove new`/`detach`/`attach`/`rm`) kept for ergonomics. `detach`/`grove worktree detach` also accepts the legacy alias `convert` (the command was first shipped as `convert`). Other groups: `grove open`, `grove hook run/list/edit`, `grove config …`, `grove cd`, `grove shell-init`. `attach` is the inverse of `detach`: it removes a linked worktree and switches the main worktree onto its branch, carrying uncommitted changes via a stash. The binary is dual-mode: CLI args → terminal mode, no args → GUI. Detected in `main.rs` before Tauri init.
- `platform/` — cross-platform terminal launch abstraction (`open_terminal_at`, `open_terminal_app`) with per-OS implementations (macOS/Windows/Linux)

**IPC pattern**: Rust structs use `#[serde(rename_all = "camelCase")]`. The frontend calls `invoke<T>("command_name", { input })` and receives camelCase JSON. When adding a new command: register in `lib.rs` `invoke_handler` macro → add TS wrapper in `api.ts` → add type in `types.ts`.

**CLI pattern**: The single binary serves both GUI and CLI. `main.rs` checks `should_run_cli()` before initializing Tauri. CLI commands read `~/.grove/store.json` directly and reuse `git.rs`/`config.rs`/`actions.rs` logic. `grove open` forwards to the running instance via `tauri-plugin-single-instance`.

**Config merging**: `builtin_config()` → auto-detect default branch from git → apply per-repo config from app store → apply per-repo worktree root from app store. Each layer overrides the previous. All config is stored in `~/.grove/store.json`, not in repo-level files.

**Storage**: App data lives at `~/.grove/store.json`, NOT in Tauri's default app data dir. Per-repo worktree root settings are stored here too, keyed by repo path. Storage functions are Tauri-independent so both GUI and CLI can use them.

## Design System

All UI work **must** follow `DESIGN_SYSTEM.md`. Key rules:

- **Colors**: Use the documented palette tokens — warm ink tones (`#1c1917` base) with teal accent (`#2e7a6e`). Do not introduce new brand colors.
- **Buttons**: Three variants only — `primary-button` (solid flat teal), `ghost-button` (secondary), `danger-button` (destructive). One primary button per visible form section. Pill radius (`999px`) for all standard buttons.
- **Inputs**: Always use `<Input>`, `<Textarea>`, `<Select>` from `FormControls.tsx`. Focus ring teal. Never use native elements directly.
- **Toast**: Bottom-right, one at a time, auto-dismiss 3s. Two variants: `toast-success` / `toast-error`. Prefix with `✓` / `✗`.
- **Typography**: Sans-serif (`Avenir Next`) for all text, monospace (`SF Mono`) for code/paths. No serif fonts. Do not add new font stacks.
- **Cards**: Warm white (`#fefdfb`), radius `12px`, border only, no shadow. No glass-morphism, no `backdrop-filter`.
- **Modals**: Use `ModalShell` component. Radius `12px`, minimal shadow. Dismiss via Escape + backdrop click.
- **Spacing**: 2px base grid. Common stops: 6, 8, 10, 12, 14, 20, 24px. Follow existing patterns.
- **Transitions**: Buttons `140ms ease`, list items `100ms ease`, slide-out `180ms ease-out`.
- **Dark mode**: Supports Light / Dark / System. All colors use CSS custom properties (`var(--token)`). When adding new UI, always use existing tokens from `:root` — never hardcode colors. Verify new pages/components look correct in both light and dark mode.
- **Preview**: `design-system.html` at project root renders all tokens and components using the real `src/styles.css`. When adjusting colors or tokens, run `pnpm tauri:dev` (Vite dev server on port 1420), then use Chrome DevTools MCP to open `http://localhost:1420/design-system.html` to visually verify changes in real time. Toggle `[data-theme="dark"]` on `<html>` to check dark mode.

## Notes

- All Tauri commands that do git/file I/O must be async (`spawn_blocking`), never blocking the main thread.
- `run_command_streaming` treats stderr as info-level during streaming; only escalates to error if exit code is non-zero (git writes informational messages like "Preparing worktree..." to stderr).
- Split components when necessary—don’t let a single file take on too much responsibility (for example, exceeding 500 lines). This applies to both React UI components and Rust functional modules.
- **Reuse `src/components/` components** — use `Input`, `Textarea`, `Select` from `FormControls.tsx` instead of native `<input>`, `<textarea>`, `<select>`; use `ModalShell` for modals, `Alert` for error banners. Do not introduce new wrapper components for things that already exist.

## UI Layout

Topbar (38px, `titleBarStyle: overlay` with 78px left padding for macOS traffic lights) shows brand + centered repo path. Left sidebar (48px, icon-only) has 4 tabs: Repository, Worktrees, Hooks, Settings. Main content fills the area right of the sidebar. Views: Repository (centered card with repo picker), Worktrees (master-detail grid: 280px worktree list | detail panel; "New Worktree" button in worktree toolbar), Hooks (inline hooks editor), Settings (language, terminal, shell, tray icon, tooling, logs, config). Create worktree uses a right-side slide-out panel.
