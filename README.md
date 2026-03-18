# Grove

A macOS-first desktop app for managing Git worktrees — launch editors, terminals, and AI coding agents from worktrees, with lifecycle hooks for automating setup.

## Screenshot

![Image.png](./docs/screenshot.png)

## Features

### Worktree

- **Scan** — Parses all worktrees via `git worktree list --porcelain`, showing dirty / ahead / behind / prunable / locked status
- **Create** — New branch, existing local branch, or remote tracking branch modes with branch dropdowns, random branch name suggestions, and auto-filled target paths
- **Remove** — Streamed execution logs, preview and execute `git worktree prune`
- **Launch** — Built-in launchers for Terminal, Ghostty, iTerm2, VS Code, Cursor, Claude CLI, Codex CLI, Gemini CLI, plus custom launchers

### Hooks

6 lifecycle hook events to automate custom actions during worktree creation, launch, and removal:

| Event | Fires | Working directory |
|-------|-------|-------------------|
| `pre-create` | **Before** worktree creation | Repo root |
| `post-create` | **After** worktree creation | Worktree path |
| `pre-launch` | **Before** launcher execution | Worktree path |
| `post-launch` | **After** launcher execution | Worktree path |
| `pre-remove` | **Before** worktree removal | Worktree path |
| `post-remove` | **After** worktree removal | Repo root |

Each hook consists of one or more **steps**, with 4 step types:

#### `script` — Run any shell command

```toml
[[hooks.post-create]]
type = "script"
run = "echo 'Worktree {branch} ready at {worktree_path}'"
```

#### `install` — Auto-detect package manager and install dependencies

Without `run`, auto-detects: pnpm → bun → yarn → npm, poetry → pdm → pipenv → uv → pip, bundle, cargo build, go mod download, composer, dotnet restore, gradlew, mvn, etc. Or specify a custom command.

```toml
[[hooks.post-create]]
type = "install"

# Or specify manually
[[hooks.post-create]]
type = "install"
run = "pip install -r requirements.txt"
```

#### `copy-files` — Copy files from repo root to new worktree

For copying untracked config files like `.env.local`. Skips if target already exists.

```toml
[[hooks.post-create]]
type = "copy-files"
paths = [".env.local", ".npmrc", ".env.production"]
```

#### `launch` — Trigger a launcher within a hook

```toml
[[hooks.post-create]]
type = "launch"
launcherId = "vscode"
```

#### Template variables

Use `{variable}` syntax in `run` fields to reference context variables:

| Variable | Description | Example |
|----------|-------------|---------|
| `{repo_root}` | Repo root path | `/Users/me/myrepo` |
| `{worktree_path}` | Worktree path | `/Users/me/myrepo/.worktrees/feat` |
| `{branch}` | Branch name | `feature/new-ui` |
| `{base_branch}` | Base branch name | `main` |
| `{head_sha}` | HEAD commit SHA | `a1b2c3d4...` |
| `{default_remote}` | Default remote | `origin` |
| `{is_main_worktree}` | Is main worktree | `true` / `false` |

Scripts also receive uppercase environment variables: `$REPO_ROOT`, `$WORKTREE_PATH`, `$BRANCH`, `$BASE_BRANCH`, `$HEAD_SHA`, `$IS_MAIN_WORKTREE`, `$DEFAULT_REMOTE`.

#### Re-run hooks

Manually trigger any configured hook event from the "Re-run Hooks" section in the worktree detail panel.

### Other

- **GitHub PR integration** — Auto-queries and caches associated Pull Requests via `gh` CLI
- **i18n** — Chinese (default) and English

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

## Config

All config and app state is stored at `~/.grove/store.json` (recent repos, per-repo config, worktree root settings, default terminal, etc.). Grove does not write config files into the repository.

Per-repo config is edited via the in-app settings page (TOML format). Config is merged in order (later overrides earlier):

1. **Built-in defaults** — worktree root `.claude`, base branch `main`, built-in launchers
2. **Repo config** — TOML config edited in the UI

### Example config

```toml
[settings]
worktree-root = ".worktrees"
default-base-branch = "main"

[[hooks.post-create]]
type = "copy-files"
paths = [".env.local", ".env.production"]

[[hooks.post-create]]
type = "install"

[[hooks.post-create]]
type = "script"
run = "echo 'Worktree ready at $WORKTREE_PATH'"

[[hooks.post-create]]
type = "launch"
launcherId = "vscode"

[[hooks.pre-remove]]
type = "script"
run = "echo 'Cleaning up {branch}...'"
```

## License

MIT
