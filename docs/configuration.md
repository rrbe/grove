# Configuration

All config and app state lives in a single JSON file at `~/.grove/store.json`
(recent repos, per-repo config, worktree root settings, default terminal, PR
cache, custom launchers, etc.). Grove never writes config files into your
repository.

Per-repo config is authored in TOML — either through the in-app settings page
or with `grove config edit` — and stored back into `store.json`.

## Merge order

Config is merged in order, with each layer overriding the previous:

1. **Built-in defaults** — worktree root `.claude`, base branch auto-detected
   from `origin/HEAD` (falling back to `main`), and the built-in launchers.
2. **Global layer** — app-wide defaults (e.g. a default `worktree_root`).
3. **Per-repo config** — the TOML config for the specific repository.

Use `grove config show` to print the effective merged view and see where each
value comes from. See the [CLI reference](./cli.md#config) for `get` / `set` /
`unset`.

## Settings keys

| Key | Description |
|-----|-------------|
| `worktree-root` | Directory new worktrees are created under (relative to repo root, or absolute) |
| `default-base-branch` | Base branch new branches are created from |

## Example config

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

See [hooks.md](./hooks.md) for the full hook schema and the [CLI
reference](./cli.md) for managing config from the terminal.
