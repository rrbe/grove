# CLI Reference

Grove ships a `grove` command-line tool alongside the desktop app — the same
binary serves both. Run it with no arguments to launch the GUI; run it with a
subcommand to stay in the terminal.

The CLI follows a `<noun> <verb>` pattern (`grove worktree new`, `grove hook
run`, `grove config set`) and reuses the exact logic of the GUI: it reads the
same `~/.grove/store.json`, runs the same hooks, and shells out to the same
`git`.

## Installing

In the app, go to **Settings → CLI Command → Install CLI**. This symlinks the
running binary to `/usr/local/bin/grove`:

```
/usr/local/bin/grove -> /Applications/Grove.app/Contents/MacOS/Grove
```

If `/usr/local/bin` isn't writable, the app prints the manual command to run:

```bash
sudo ln -sf /Applications/Grove.app/Contents/MacOS/Grove /usr/local/bin/grove
```

Verify with `grove --version`.

## Command overview

| Command | Description |
|---------|-------------|
| `grove [path]` | Open a repository in the Grove GUI (defaults to `.`) |
| `grove open [path]` | Same as above, explicit form |
| `grove worktree list` | List worktrees for the current repo |
| `grove worktree new <branch>` | Create a worktree for a branch |
| `grove worktree detach [path]` | Move the current branch into its own worktree |
| `grove worktree attach [branch]` | Fold a worktree's branch back onto the main worktree |
| `grove worktree rm [branch]` | Remove a worktree |
| `grove hook run <event>` | Run hooks for a lifecycle event |
| `grove hook list` | List configured hooks |
| `grove hook edit` | Edit hooks in `$EDITOR` |
| `grove config show` | Print the effective configuration |
| `grove config get/set/unset <key>` | Read or write a config value |
| `grove config path` | Print the path to `store.json` |
| `grove config edit` | Edit the full repo config in `$EDITOR` |
| `grove cd [branch]` | Print a worktree path (pair with `shell-init` to actually `cd`) |
| `grove shell-init <shell>` | Print a shell snippet that wires `grove cd` into your shell |

The worktree lifecycle verbs also have shorter top-level aliases: `grove new`,
`grove detach`, `grove attach`, `grove rm`.

## Opening the GUI

```bash
grove .                  # open the current repo in the GUI
grove open ~/code/myapp  # open a specific repo
```

`grove open` forwards to the already-running instance, so repeated calls reuse
the same window rather than spawning new ones.

## Worktrees

### `grove worktree list`

Lists every worktree for the current repository. The main worktree is marked
with `*`, and dirty worktrees are flagged.

```
* /Users/me/myapp                 main
  /Users/me/myapp/.worktrees/login feat/login [dirty]
```

### `grove worktree new <branch>`

Creates a worktree, running `pre-create` / `post-create` hooks.

```bash
grove worktree new feat/login                 # new branch off the default base
grove worktree new fix/bug -b release/2.0     # new branch off a specific base
grove worktree new feat/login --existing      # use an existing local branch
grove worktree new feat/login -r origin/feat/login   # track a remote branch
grove worktree new feat/login -p ../login-wt  # custom worktree path
```

| Flag | Description |
|------|-------------|
| `-b, --base <REF>` | Base ref for new branches (default: configured base branch) |
| `-p, --path <PATH>` | Custom worktree path (overrides the configured worktree root) |
| `-r, --remote <REMOTE_REF>` | Track a remote branch and set upstream |
| `--existing` | Use an existing local branch instead of creating one |
| `--no-hooks` | Skip `pre-create` / `post-create` hooks |
| `-q, --quiet` | Print only the resulting path on stdout (logs go to stderr) |

`--quiet` makes the command scriptable:

```bash
cd "$(grove worktree new feat/login -q)"
```

### `grove worktree detach [path]`

Moves the main worktree's current branch into a new linked worktree, then
switches the main worktree back onto the base branch. Useful when you started
work on `main` and want to move it aside. Requires a clean main worktree.

```bash
grove worktree detach                 # detach the current branch
grove worktree detach ../my-feature   # detach to a specific path
grove worktree detach -b develop      # switch main back onto a specific base
```

> Also available as `grove detach`. The legacy alias `grove convert` still works.

### `grove worktree attach [branch]`

The inverse of `detach`: removes a linked worktree and switches the main
worktree onto its branch. Uncommitted changes are carried over via a stash, so
committed work is never at risk.

```bash
grove worktree attach feat/login   # attach by branch name
grove worktree attach              # attach the worktree you're standing in
grove worktree attach -y           # skip the confirmation prompt
```

| Flag | Description |
|------|-------------|
| `-y, --yes` | Skip the confirmation prompt |
| `-f, --force` | Force removal of a locked worktree |
| `--no-hooks` | Skip `pre-remove` / `post-remove` hooks |

### `grove worktree rm [branch]`

Removes a worktree. With no branch argument, removes the worktree containing the
current directory (never the main worktree).

```bash
grove worktree rm feat/login        # remove by branch name
grove worktree rm                   # remove the worktree you're standing in
grove worktree rm feat/login -y     # skip confirmation
grove worktree rm feat/login --dry-run   # preview without removing
grove worktree rm feat/login -f --prune  # force, then prune stale entries
```

| Flag | Description |
|------|-------------|
| `-y, --yes` | Skip the confirmation prompt |
| `-f, --force` | Force removal (allows dirty worktrees, unlocks locked ones) |
| `--dry-run` | Print what would happen without making changes |
| `--no-hooks` | Skip `pre-remove` / `post-remove` hooks |
| `--prune` | Run `git worktree prune` after removal |

> Also available as `grove rm` / `grove remove`. When not attached to a TTY, the
> confirmation can't be shown, so scripts must pass `-y`.

## Hooks

See [hooks.md](./hooks.md) for the full hook model. From the CLI:

### `grove hook run <event>`

Runs the configured steps for a lifecycle event. The repo root and worktree are
auto-detected from the current directory.

```bash
grove hook run post-create               # run post-create in the current worktree
grove hook run post-create --worktree ../login-wt   # target a specific worktree
```

Events: `pre-create`, `post-create`, `pre-launch`, `post-launch`,
`pre-remove`, `post-remove`.

### `grove hook list`

Prints the configured hooks for the current repository, grouped by event.

### `grove hook edit`

Opens the repo's hooks in `$EDITOR` (TOML). Invalid TOML re-prompts so you can
fix it without losing your edits.

## Config

See [configuration.md](./configuration.md) for how config layers merge. From the
CLI:

### `grove config show`

Prints the effective (merged) configuration for the current repo, annotating
where each value comes from.

```bash
grove config show            # effective merged view
grove config show --global   # only the app-wide global layer
grove config show --repo     # only this repo's overrides
```

### `grove config get / set / unset`

```bash
grove config get worktree_root                # effective value
grove config set worktree_root .worktrees     # per-repo override
grove config set worktree_root .wt --global   # app-wide default
grove config unset worktree_root              # clear the per-repo value
```

Supported keys: `worktree_root`, `default_base_branch`. The `config`
subcommand accepts snake_case or camelCase (`worktree_root` / `worktreeRoot`) —
note this differs from the kebab-case keys used in the TOML config file
(`worktree-root`). Per-repo is the default scope; `--global` writes the app-wide
default (only `worktree_root` supports a global layer).

### `grove config path` / `grove config edit`

```bash
grove config path   # print ~/.grove/store.json
grove config edit   # edit the full repo config (settings + launchers + hooks)
```

## `cd` into worktrees

`grove cd` prints a worktree's path; on its own it can't change your shell's
directory. Wire it up with `shell-init` once and `grove cd <branch>` will `cd`
for you.

Add to your shell rc file:

```bash
# ~/.zshrc or ~/.bashrc
eval "$(grove shell-init zsh)"     # or: bash

# ~/.config/fish/config.fish
grove shell-init fish | source
```

Then:

```bash
grove cd feat/login   # cd into the feat/login worktree
grove cd login        # substring match also works
grove cd              # cd back to the main worktree
```

The shell wrapper also makes `grove detach` and `grove attach` change your
directory to the resulting worktree after they run.
