# Hooks

Hooks automate custom actions during a worktree's lifecycle — installing
dependencies, copying untracked config files, launching an editor, or running
any shell command. They're configured per-repo in TOML (via the in-app editor
or `grove hook edit`) and run by both the GUI and the [CLI](./cli.md).

## Lifecycle events

There are 6 events. Each runs in a defined working directory:

| Event | Fires | Working directory |
|-------|-------|-------------------|
| `pre-create` | **Before** worktree creation | Repo root |
| `post-create` | **After** worktree creation | Worktree path |
| `pre-launch` | **Before** launcher execution | Worktree path |
| `post-launch` | **After** launcher execution | Worktree path |
| `pre-remove` | **Before** worktree removal | Worktree path |
| `post-remove` | **After** worktree removal | Repo root |

## Step types

Each hook event holds an ordered list of **steps**. There are 4 step types.

### `script` — run any shell command

```toml
[[hooks.post-create]]
type = "script"
run = "echo 'Worktree {branch} ready at {worktree_path}'"
```

### `install` — auto-detect package manager and install dependencies

Without `run`, Grove auto-detects the package manager: pnpm → bun → yarn → npm,
poetry → pdm → pipenv → uv → pip, bundle, cargo build, go mod download,
composer, dotnet restore, gradlew, mvn, etc. Or specify a custom command.

```toml
[[hooks.post-create]]
type = "install"

# Or specify manually
[[hooks.post-create]]
type = "install"
run = "pip install -r requirements.txt"
```

### `copy-files` — copy files from repo root into the new worktree

For untracked config files like `.env.local` that aren't committed but the new
worktree needs. Skips any file that already exists at the target.

```toml
[[hooks.post-create]]
type = "copy-files"
paths = [".env.local", ".npmrc", ".env.production"]
```

### `launch` — trigger a launcher within a hook

```toml
[[hooks.post-create]]
type = "launch"
launcherId = "vscode"
```

## Template variables

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

Scripts also receive the same values as uppercase environment variables:
`$REPO_ROOT`, `$WORKTREE_PATH`, `$BRANCH`, `$BASE_BRANCH`, `$HEAD_SHA`,
`$IS_MAIN_WORKTREE`, `$DEFAULT_REMOTE`.

## Running hooks manually

- **GUI** — trigger any configured event from the "Re-run Hooks" section in the
  worktree detail panel.
- **CLI** — `grove hook run <event>` (see the [CLI reference](./cli.md#hooks)).

## Example

```toml
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
