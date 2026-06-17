# Grove

A macOS-first desktop app for managing Git worktrees — launch editors,
terminals, and AI coding agents from worktrees, with lifecycle hooks for
automating setup.

English | [中文](./README_CN.md)

## Screenshot

![Grove](./docs/screenshot.png)

## Features

- **Worktrees** — Scan, create, and remove worktrees with dirty / ahead /
  behind / prunable / locked status. Create from a new branch, an existing local
  branch, or a remote tracking branch, with random branch-name suggestions and
  auto-filled paths.
- **Launchers** — Built-in launchers for Terminal, Ghostty, iTerm2, VS Code,
  Cursor, Claude CLI, Codex CLI, and Gemini CLI, plus custom launchers.
- **Hooks** — 6 lifecycle events automate dependency installs, config-file
  copying, and launches around worktree create / launch / remove. See
  [docs/hooks.md](./docs/hooks.md).
- **CLI** — A `grove` command (like VS Code's `code`) for managing worktrees,
  hooks, and config from the terminal. See [docs/cli.md](./docs/cli.md).
- **GitHub PRs** — Auto-queries and caches associated Pull Requests via the `gh`
  CLI.
- **Single instance** — Multiple `grove open` calls reuse the running app.
- **i18n** — Chinese (default) and English.

## Documentation

- [CLI reference](./docs/cli.md) — every `grove` subcommand, flags, and examples
- [Hooks](./docs/hooks.md) — lifecycle events, step types, template variables
- [Configuration](./docs/configuration.md) — config layers, settings keys, storage

## Stack

- **Frontend**: React 19 + TypeScript + Vite
- **Backend**: Rust (Tauri 2), shelling out to system `git`

## Getting Started

```bash
pnpm install        # Install frontend deps
pnpm build          # Frontend type-check + build
pnpm tauri:dev      # Run in dev mode
pnpm tauri:dist     # Build .dmg
cd src-tauri && cargo test    # Rust tests
cd src-tauri && cargo clippy  # Rust lint
```

## License

MIT
