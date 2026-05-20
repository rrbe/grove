use crate::{
    actions::{self, LogWriter},
    config, git,
    models::{CreateMode, CreateWorktreeInput, HookEvent, LogLevel, RemoveWorktreeInput, RunLog},
    store,
};
use clap::{Parser, Subcommand, ValueEnum};
use std::io::{IsTerminal, Write};
use std::path::Path;
use std::process;

#[derive(Parser)]
#[command(
    name = "grove",
    version = concat!(env!("CARGO_PKG_VERSION"), "-", env!("GROVE_COMMIT_HASH")),
    about = "Grove — Git worktree manager",
    arg_required_else_help = true
)]
struct Cli {
    #[command(subcommand)]
    command: Option<Commands>,

    /// Path to open in Grove GUI
    #[arg(value_name = "PATH")]
    path: Option<String>,
}

#[derive(Subcommand)]
enum Commands {
    /// Open a repository in the Grove GUI
    Open {
        /// Repository path (defaults to current directory)
        #[arg(default_value = ".")]
        path: String,
    },
    /// Manage hooks
    Hook {
        #[command(subcommand)]
        command: HookCommands,
    },
    /// Manage worktrees
    Worktree {
        #[command(subcommand)]
        command: WorktreeCommands,
    },
    /// View or change Grove configuration
    Config {
        #[command(subcommand)]
        command: ConfigCommands,
    },
    /// Create a worktree for a branch
    New {
        /// Branch name (created if it does not exist)
        branch: String,
        /// Base ref for new branches (default: configured default base)
        #[arg(short = 'b', long, value_name = "REF")]
        base: Option<String>,
        /// Custom worktree path (overrides the configured worktree root)
        #[arg(short = 'p', long, value_name = "PATH")]
        path: Option<String>,
        /// Track a remote branch (sets upstream); implies --remote-branch
        #[arg(short = 'r', long, value_name = "REMOTE_REF", conflicts_with = "existing")]
        remote: Option<String>,
        /// Use an existing local branch instead of creating a new one
        #[arg(long, conflicts_with = "remote")]
        existing: bool,
        /// Skip pre-create / post-create hooks
        #[arg(long)]
        no_hooks: bool,
        /// Only print the resulting worktree path on stdout (logs to stderr)
        #[arg(short = 'q', long)]
        quiet: bool,
    },
    /// Print the path of a worktree by branch (use with `grove shell-init` to actually cd)
    Cd {
        /// Branch name (defaults to the main worktree)
        branch: Option<String>,
    },
    /// Print a shell snippet that wires `grove cd` into the current shell
    ShellInit {
        /// Shell to emit init for
        #[arg(value_enum)]
        shell: ShellKind,
    },
    /// Remove a worktree
    #[command(alias = "remove")]
    Rm {
        /// Branch name (defaults to the worktree containing the current directory)
        branch: Option<String>,
        /// Skip the confirmation prompt
        #[arg(short = 'y', long)]
        yes: bool,
        /// Force removal (allows dirty worktrees, unlocks locked ones)
        #[arg(short = 'f', long)]
        force: bool,
        /// Print what would happen without making changes
        #[arg(long)]
        dry_run: bool,
        /// Skip pre-remove / post-remove hooks
        #[arg(long)]
        no_hooks: bool,
        /// Run `git worktree prune` after removal
        #[arg(long)]
        prune: bool,
    },
}

#[derive(Subcommand)]
enum HookCommands {
    /// Run hooks for a given event
    Run {
        /// Hook event (pre-create, post-create, pre-launch, post-launch, pre-remove, post-remove)
        event: HookEvent,
        /// Worktree path (auto-detected from current directory if omitted)
        #[arg(long)]
        worktree: Option<String>,
    },
    /// List configured hooks for the current repository
    List,
    /// Edit the hooks for the current repository in $EDITOR
    Edit,
}

#[derive(Subcommand)]
enum WorktreeCommands {
    /// List worktrees for the current repository
    List,
}

#[derive(Copy, Clone, ValueEnum)]
enum ShellKind {
    Zsh,
    Bash,
    Fish,
}

#[derive(Subcommand)]
enum ConfigCommands {
    /// Print the effective configuration (defaults to merged view)
    Show {
        /// Show only the global layer (default = effective merged view)
        #[arg(long, conflicts_with = "repo")]
        global: bool,
        /// Show only the per-repo layer
        #[arg(long, conflicts_with = "global")]
        repo: bool,
    },
    /// Get a single value (effective by default)
    Get {
        /// Key to read (e.g. worktree_root, default_base_branch)
        key: String,
        /// Read from the global layer instead of the effective merged value
        #[arg(long, conflicts_with = "repo")]
        global: bool,
        /// Read from the per-repo layer only
        #[arg(long, conflicts_with = "global")]
        repo: bool,
    },
    /// Set a value (per-repo by default; pass --global for app-wide default)
    Set {
        /// Key to write (e.g. worktree_root, default_base_branch)
        key: String,
        /// Value to set; pass an empty string to clear
        value: String,
        /// Set the app-wide global default instead of per-repo
        #[arg(long)]
        global: bool,
    },
    /// Clear a value (per-repo by default; pass --global for app-wide default)
    Unset {
        /// Key to clear
        key: String,
        /// Clear the app-wide global default instead of per-repo
        #[arg(long)]
        global: bool,
    },
    /// Print the on-disk path to ~/.grove/store.json
    Path,
    /// Edit the full repo config (settings + launchers + hooks) in $EDITOR
    Edit,
}

pub struct StdioLogWriter;

impl LogWriter for StdioLogWriter {
    fn push(&mut self, log: RunLog) {
        match log.level {
            LogLevel::Error => eprintln!("{}", log.message),
            _ => println!("{}", log.message),
        }
    }
}

struct StderrLogWriter;

impl LogWriter for StderrLogWriter {
    fn push(&mut self, log: RunLog) {
        eprintln!("{}", log.message);
    }
}

const CLI_SUBCOMMANDS: &[&str] = &[
    "open",
    "hook",
    "worktree",
    "config",
    "new",
    "rm",
    "remove",
    "cd",
    "shell-init",
    "help",
    "--help",
    "-h",
    "--version",
    "-V",
];

/// Returns true if the process was invoked with CLI arguments that indicate
/// CLI mode rather than GUI mode.
pub fn should_run_cli() -> bool {
    let args: Vec<String> = std::env::args().collect();
    if args.len() <= 1 {
        return false;
    }
    let first = &args[1];
    // Known subcommand or flag → CLI mode
    if CLI_SUBCOMMANDS.contains(&first.as_str()) {
        return true;
    }
    // A bare path argument (not a --flag) → CLI open mode
    if !first.starts_with('-') {
        return true;
    }
    // Internal flags used by CLI open (e.g., --open-repo) are NOT CLI mode —
    // they are passed to the GUI app by `grove open`.
    false
}

pub fn main() {
    let cli = Cli::parse();

    let result = match cli.command {
        Some(Commands::Open { path }) => cmd_open(&path),
        Some(Commands::Hook { command }) => match command {
            HookCommands::Run { event, worktree } => cmd_hook_run(event, worktree.as_deref()),
            HookCommands::List => cmd_hook_list(),
            HookCommands::Edit => cmd_hook_edit(),
        },
        Some(Commands::Worktree { command }) => match command {
            WorktreeCommands::List => cmd_worktree_list(),
        },
        Some(Commands::Config { command }) => cmd_config(command),
        Some(Commands::New {
            branch,
            base,
            path,
            remote,
            existing,
            no_hooks,
            quiet,
        }) => cmd_new(NewArgs {
            branch,
            base,
            path,
            remote,
            existing,
            no_hooks,
            quiet,
        }),
        Some(Commands::Cd { branch }) => cmd_cd(branch.as_deref()),
        Some(Commands::ShellInit { shell }) => {
            print!("{}", shell_init_snippet(shell));
            Ok(())
        }
        Some(Commands::Rm {
            branch,
            yes,
            force,
            dry_run,
            no_hooks,
            prune,
        }) => cmd_rm(RmArgs {
            branch,
            yes,
            force,
            dry_run,
            no_hooks,
            prune,
        }),
        None => {
            if let Some(path) = cli.path {
                cmd_open(&path)
            } else {
                // Should not happen due to arg_required_else_help
                Ok(())
            }
        }
    };

    if let Err(error) = result {
        eprintln!("error: {error}");
        process::exit(1);
    }
}

fn cmd_open(path: &str) -> Result<(), String> {
    let repo_root = git::resolve_repo_root(path)?;
    let repo_str = repo_root.to_string_lossy().to_string();

    #[cfg(target_os = "macos")]
    {
        // Find the app bundle path from the current executable.
        // The executable is at Grove.app/Contents/MacOS/Grove.
        let exe = std::env::current_exe()
            .map_err(|e| format!("cannot determine executable path: {e}"))?;
        let app_bundle = exe
            .parent() // MacOS/
            .and_then(|p| p.parent()) // Contents/
            .and_then(|p| p.parent()); // Grove.app/

        let status = if let Some(bundle) = app_bundle {
            if bundle.extension().is_some_and(|ext| ext == "app") {
                std::process::Command::new("open")
                    .arg("-a")
                    .arg(bundle)
                    .arg("--args")
                    .arg("--open-repo")
                    .arg(&repo_str)
                    .status()
            } else {
                // Running from cargo build, not inside .app bundle
                std::process::Command::new("open")
                    .arg("-a")
                    .arg("Grove")
                    .arg("--args")
                    .arg("--open-repo")
                    .arg(&repo_str)
                    .status()
            }
        } else {
            std::process::Command::new("open")
                .arg("-a")
                .arg("Grove")
                .arg("--args")
                .arg("--open-repo")
                .arg(&repo_str)
                .status()
        };

        match status {
            Ok(s) if s.success() => Ok(()),
            Ok(_) => Err("failed to open Grove app".into()),
            Err(e) => Err(format!("failed to launch Grove: {e}")),
        }
    }

    #[cfg(target_os = "windows")]
    {
        let exe = std::env::current_exe()
            .map_err(|e| format!("cannot determine executable path: {e}"))?;
        std::process::Command::new(exe)
            .arg("--open-repo")
            .arg(&repo_str)
            .spawn()
            .map_err(|e| format!("failed to launch Grove: {e}"))?;
        Ok(())
    }

    #[cfg(target_os = "linux")]
    {
        let exe = std::env::current_exe()
            .map_err(|e| format!("cannot determine executable path: {e}"))?;
        std::process::Command::new(exe)
            .arg("--open-repo")
            .arg(&repo_str)
            .spawn()
            .map_err(|e| format!("failed to launch Grove: {e}"))?;
        Ok(())
    }
}

fn cmd_hook_run(event: HookEvent, worktree: Option<&str>) -> Result<(), String> {
    // Auto-detect repo root and worktree from cwd
    let cwd = std::env::current_dir()
        .map_err(|e| format!("cannot determine current directory: {e}"))?;
    let cwd_str = cwd.to_string_lossy().to_string();

    let repo_root = git::resolve_repo_root(&cwd_str)?;
    let repo_root_str = repo_root.to_string_lossy().to_string();

    // Determine worktree path: explicit flag > auto-detect from cwd
    let worktree_path = if let Some(wt) = worktree {
        Some(
            std::path::Path::new(wt)
                .canonicalize()
                .map_err(|e| format!("invalid worktree path: {e}"))?
                .to_string_lossy()
                .to_string(),
        )
    } else {
        // Check if cwd is inside a worktree
        auto_detect_worktree(&repo_root_str, &cwd_str)?
    };

    let mut sink = StdioLogWriter;
    actions::run_hooks_cli(
        &repo_root_str,
        event,
        worktree_path.as_deref(),
        &mut sink,
    )
}

fn cmd_hook_list() -> Result<(), String> {
    let repo_root = current_repo_root()?;
    let app_store = store::load_store()?;
    let repo_root_str = repo_root.to_string_lossy().to_string();
    let stored_config = app_store.repo_configs.get(&repo_root_str).cloned();
    let loaded = config::load(
        &repo_root,
        stored_config.as_ref(),
        &app_store.custom_launchers,
        app_store.default_worktree_root.as_deref(),
    );

    let mut found = false;
    for event in HookEvent::ALL {
        if let Some(steps) = loaded.merged.hooks.get(event) {
            if !steps.is_empty() {
                found = true;
                println!("{}:", event.label());
                for (i, step) in steps.iter().enumerate() {
                    let desc = match step.step_type {
                        crate::models::HookStepType::Script => {
                            step.run.as_deref().unwrap_or("(no command)")
                        }
                        crate::models::HookStepType::Install => {
                            step.run.as_deref().unwrap_or("(auto-detect)")
                        }
                        crate::models::HookStepType::Launch => {
                            step.launcher_id.as_deref().unwrap_or("(no launcher)")
                        }
                        crate::models::HookStepType::CopyFiles => "(copy files)",
                    };
                    println!("  {}. [{}] {}", i + 1, step.step_type.label(), desc);
                }
            }
        }
    }

    if !found {
        println!("No hooks configured for this repository.");
    }
    Ok(())
}

fn cmd_worktree_list() -> Result<(), String> {
    let repo_root = current_repo_root()?;
    let store = store::load_store()?;
    let worktrees = git::scan_worktrees(&repo_root, &store)?;

    if worktrees.is_empty() {
        println!("No worktrees found.");
        return Ok(());
    }

    // Find max path length for alignment
    let max_path = worktrees.iter().map(|w| w.path.len()).max().unwrap_or(0);

    for wt in &worktrees {
        let branch_display = wt.branch.as_deref().unwrap_or("(detached)");
        let marker = if wt.is_main { " *" } else { "  " };
        let status = if wt.dirty { " [dirty]" } else { "" };
        println!(
            "{marker} {:<width$}  {branch_display}{status}",
            wt.path,
            width = max_path
        );
    }
    Ok(())
}

// ── Config subcommand ──────────────────────────────────────────────────────

#[derive(Copy, Clone)]
enum ConfigKey {
    WorktreeRoot,
    DefaultBaseBranch,
}

impl ConfigKey {
    fn parse(input: &str) -> Result<Self, String> {
        let normalized = input.trim().trim_start_matches("settings.");
        match normalized {
            "worktree_root" | "worktreeRoot" => Ok(Self::WorktreeRoot),
            "default_base_branch" | "defaultBaseBranch" => Ok(Self::DefaultBaseBranch),
            other => Err(format!(
                "unknown config key: {other}\n  supported: worktree_root, default_base_branch"
            )),
        }
    }

    fn label(self) -> &'static str {
        match self {
            Self::WorktreeRoot => "worktree_root",
            Self::DefaultBaseBranch => "default_base_branch",
        }
    }

    fn global_supported(self) -> bool {
        matches!(self, Self::WorktreeRoot)
    }
}

fn cmd_config(command: ConfigCommands) -> Result<(), String> {
    match command {
        ConfigCommands::Show { global, repo } => cmd_config_show(global, repo),
        ConfigCommands::Get { key, global, repo } => cmd_config_get(&key, global, repo),
        ConfigCommands::Set { key, value, global } => cmd_config_set(&key, &value, global),
        ConfigCommands::Unset { key, global } => cmd_config_unset(&key, global),
        ConfigCommands::Path => cmd_config_path(),
        ConfigCommands::Edit => cmd_config_edit(),
    }
}

fn cmd_config_path() -> Result<(), String> {
    println!("{}", store::store_path()?.display());
    Ok(())
}

fn cmd_config_show(global_only: bool, repo_only: bool) -> Result<(), String> {
    let store_data = store::load_store()?;

    if global_only {
        print_global_layer(&store_data);
        return Ok(());
    }

    let repo_root = current_repo_root().ok();
    if repo_only {
        let repo_root = repo_root
            .ok_or_else(|| "not inside a git repository — pass --global or run from a repo".to_string())?;
        let repo_key = repo_root.to_string_lossy().to_string();
        println!("[repo {repo_key}]");
        match store_data.repo_configs.get(&repo_key) {
            Some(config) => print!("{}", config::render_config_text(config)?),
            None => println!("# (no per-repo overrides)"),
        }
        return Ok(());
    }

    let Some(repo_root) = repo_root else {
        print_global_layer(&store_data);
        eprintln!("\nhint: not inside a git repository — only global settings are shown");
        return Ok(());
    };

    let repo_key = repo_root.to_string_lossy().to_string();
    let stored_config = store_data.repo_configs.get(&repo_key).cloned();
    let loaded = config::load(
        &repo_root,
        stored_config.as_ref(),
        &store_data.custom_launchers,
        store_data.default_worktree_root.as_deref(),
    );

    println!("# effective config for {repo_key}");
    println!(
        "worktree_root       = {:?}  # {}",
        loaded.merged.settings.worktree_root,
        describe_worktree_root_source(&store_data, &repo_key),
    );
    println!(
        "default_base_branch = {:?}  # {}",
        loaded.merged.settings.default_base_branch,
        describe_base_branch_source(&store_data, &repo_key),
    );
    Ok(())
}

fn print_global_layer(store: &store::AppStore) {
    println!("[global]");
    match store.default_worktree_root.as_deref() {
        Some(value) => println!("worktree_root = {value:?}"),
        None => println!("# (unset)"),
    }
}

fn describe_worktree_root_source(store: &store::AppStore, repo_key: &str) -> String {
    if store
        .repo_configs
        .get(repo_key)
        .and_then(|c| c.settings.worktree_root.as_deref())
        .is_some()
    {
        "from per-repo override".into()
    } else if store.default_worktree_root.is_some() {
        "from global default".into()
    } else {
        "from built-in default".into()
    }
}

fn describe_base_branch_source(store: &store::AppStore, repo_key: &str) -> String {
    if store
        .repo_configs
        .get(repo_key)
        .and_then(|c| c.settings.default_base_branch.as_deref())
        .is_some()
    {
        "from per-repo override".into()
    } else {
        "detected from git".into()
    }
}

fn cmd_config_get(key: &str, global_only: bool, repo_only: bool) -> Result<(), String> {
    let parsed = ConfigKey::parse(key)?;
    let store_data = store::load_store()?;

    if global_only {
        if !parsed.global_supported() {
            return Err(format!(
                "{} has no global-layer value (only per-repo)",
                parsed.label()
            ));
        }
        match parsed {
            ConfigKey::WorktreeRoot => {
                if let Some(value) = store_data.default_worktree_root.as_deref() {
                    println!("{value}");
                }
            }
            ConfigKey::DefaultBaseBranch => {}
        }
        return Ok(());
    }

    let repo_root = current_repo_root()?;
    let repo_key = repo_root.to_string_lossy().to_string();

    if repo_only {
        let stored = store_data.repo_configs.get(&repo_key);
        let value = stored.and_then(|c| match parsed {
            ConfigKey::WorktreeRoot => c.settings.worktree_root.as_deref(),
            ConfigKey::DefaultBaseBranch => c.settings.default_base_branch.as_deref(),
        });
        if let Some(value) = value {
            println!("{value}");
        }
        return Ok(());
    }

    let stored_config = store_data.repo_configs.get(&repo_key).cloned();
    let loaded = config::load(
        &repo_root,
        stored_config.as_ref(),
        &store_data.custom_launchers,
        store_data.default_worktree_root.as_deref(),
    );
    let value = match parsed {
        ConfigKey::WorktreeRoot => &loaded.merged.settings.worktree_root,
        ConfigKey::DefaultBaseBranch => &loaded.merged.settings.default_base_branch,
    };
    println!("{value}");
    Ok(())
}

fn cmd_config_set(key: &str, value: &str, global: bool) -> Result<(), String> {
    let parsed = ConfigKey::parse(key)?;
    let new_value = store::trim_to_option(value);
    let mut store_data = store::load_store()?;

    if global {
        if !parsed.global_supported() {
            return Err(format!(
                "{} cannot be set globally (only per-repo)",
                parsed.label()
            ));
        }
        store_data.default_worktree_root = new_value.clone();
        store::persist(&store_data)?;
        report_set("global", parsed.label(), new_value.as_deref());
        return Ok(());
    }

    let repo_root = current_repo_root()?;
    let repo_key = repo_root.to_string_lossy().to_string();
    let entry = store_data.repo_configs.entry(repo_key.clone()).or_default();
    match parsed {
        ConfigKey::WorktreeRoot => entry.settings.worktree_root = new_value.clone(),
        ConfigKey::DefaultBaseBranch => entry.settings.default_base_branch = new_value.clone(),
    }
    if config::is_effectively_empty(entry) {
        store_data.repo_configs.remove(&repo_key);
    }
    store::persist(&store_data)?;
    report_set("repo", parsed.label(), new_value.as_deref());
    Ok(())
}

fn report_set(scope: &str, key: &str, value: Option<&str>) {
    match value {
        Some(v) => println!("{scope}.{key} = {v:?}"),
        None => println!("{scope}.{key} cleared"),
    }
}

fn cmd_config_unset(key: &str, global: bool) -> Result<(), String> {
    cmd_config_set(key, "", global)
}

fn current_repo_root() -> Result<std::path::PathBuf, String> {
    let cwd = std::env::current_dir()
        .map_err(|e| format!("cannot determine current directory: {e}"))?;
    git::main_worktree_root(&cwd.to_string_lossy())
}

// ── new / rm subcommands ───────────────────────────────────────────────────

struct NewArgs {
    branch: String,
    base: Option<String>,
    path: Option<String>,
    remote: Option<String>,
    existing: bool,
    no_hooks: bool,
    quiet: bool,
}

fn cmd_new(args: NewArgs) -> Result<(), String> {
    let repo_root = current_repo_root()?;
    let mode = if args.remote.is_some() {
        CreateMode::RemoteBranch
    } else if args.existing {
        CreateMode::ExistingBranch
    } else {
        CreateMode::NewBranch
    };
    let input = CreateWorktreeInput {
        repo_root: repo_root.to_string_lossy().to_string(),
        mode,
        branch: args.branch,
        base_ref: args.base,
        remote_ref: args.remote,
        path: args.path,
        auto_start_launchers: Vec::new(),
    };
    let state = actions::build_cli_state()?;
    let worktree_path = if args.quiet {
        let mut sink = StderrLogWriter;
        actions::create_worktree_cli(&state, input, args.no_hooks, &mut sink)?
    } else {
        let mut sink = StdioLogWriter;
        actions::create_worktree_cli(&state, input, args.no_hooks, &mut sink)?
    };
    if args.quiet {
        println!("{}", worktree_path.display());
    } else {
        eprintln!("\n→ {}", worktree_path.display());
    }
    Ok(())
}

struct RmArgs {
    branch: Option<String>,
    yes: bool,
    force: bool,
    dry_run: bool,
    no_hooks: bool,
    prune: bool,
}

fn cmd_rm(args: RmArgs) -> Result<(), String> {
    let repo_root = current_repo_root()?;
    let state = actions::build_cli_state()?;
    let worktrees = {
        let store_guard = state.store.lock().unwrap();
        git::scan_worktrees(&repo_root, &store_guard)?
    };

    let cwd = std::env::current_dir()
        .map_err(|e| format!("cannot determine current directory: {e}"))?;
    let target = resolve_rm_target(&worktrees, args.branch.as_deref(), &cwd)?;

    print_rm_plan(target, args.prune, args.force);

    let blockers = collect_rm_blockers(target, args.force);
    if !blockers.is_empty() {
        if args.dry_run {
            for blocker in &blockers {
                eprintln!("warning: {blocker}");
            }
        } else {
            return Err(blockers.join("\n"));
        }
    }

    if args.dry_run {
        eprintln!("(dry run — no changes made)");
        return Ok(());
    }

    if !args.yes {
        confirm_or_abort(target)?;
    }

    let input = RemoveWorktreeInput {
        repo_root: repo_root.to_string_lossy().to_string(),
        worktree_path: target.path.clone(),
        force: args.force,
    };
    let mut sink = StderrLogWriter;
    actions::remove_worktree_cli(&state, input, args.no_hooks, args.prune, &mut sink)
}

fn collect_rm_blockers(target: &crate::models::WorktreeRecord, force: bool) -> Vec<String> {
    let mut blockers = Vec::new();
    if target.is_main {
        blockers.push("cannot remove the main worktree".into());
    }
    if target.dirty && !force {
        blockers.push(format!(
            "worktree has uncommitted changes — pass -f to force\n  path: {}",
            target.path
        ));
    }
    blockers
}

fn resolve_rm_target<'a>(
    worktrees: &'a [crate::models::WorktreeRecord],
    branch: Option<&str>,
    cwd: &Path,
) -> Result<&'a crate::models::WorktreeRecord, String> {
    if let Some(branch) = branch {
        worktrees
            .iter()
            .find(|w| w.branch.as_deref() == Some(branch))
            .ok_or_else(|| format!("no worktree found for branch '{branch}'"))
    } else {
        worktrees
            .iter()
            .filter(|w| !w.is_main)
            .find(|w| cwd.starts_with(&w.path))
            .ok_or_else(|| {
                "not inside a worktree — pass a branch name, or cd into the worktree to remove"
                    .to_string()
            })
    }
}

fn print_rm_plan(target: &crate::models::WorktreeRecord, prune: bool, force: bool) {
    eprintln!("worktree: {}", target.path);
    eprintln!(
        "branch:   {}",
        target.branch.as_deref().unwrap_or("(detached)")
    );
    let mut status_bits = Vec::new();
    if target.dirty {
        status_bits.push("dirty".to_string());
    }
    if target.ahead > 0 {
        status_bits.push(format!("{} ahead", target.ahead));
    }
    if target.behind > 0 {
        status_bits.push(format!("{} behind", target.behind));
    }
    if target.locked_reason.is_some() {
        status_bits.push("locked".to_string());
    }
    if !status_bits.is_empty() {
        eprintln!("status:   {}", status_bits.join(", "));
    }
    if force {
        eprintln!("force:    yes");
    }
    if prune {
        eprintln!("after:    git worktree prune");
    }
    eprintln!();
}

fn confirm_or_abort(target: &crate::models::WorktreeRecord) -> Result<(), String> {
    if !std::io::stderr().is_terminal() {
        return Err("not a TTY — pass -y to confirm".into());
    }
    let branch = target.branch.as_deref().unwrap_or("(detached)");
    eprint!("delete worktree '{branch}' at {}? [y/N] ", target.path);
    std::io::stderr().flush().ok();
    let mut answer = String::new();
    std::io::stdin()
        .read_line(&mut answer)
        .map_err(|e| format!("failed to read input: {e}"))?;
    let trimmed = answer.trim().to_lowercase();
    if trimmed == "y" || trimmed == "yes" {
        Ok(())
    } else {
        Err("aborted".into())
    }
}

// ── cd / shell-init subcommands ────────────────────────────────────────────

fn cmd_cd(branch: Option<&str>) -> Result<(), String> {
    let repo_root = current_repo_root()?;
    let target_path = match branch {
        None => repo_root.to_string_lossy().into_owned(),
        Some(query) => {
            let worktrees = git::list_worktrees(&repo_root)?;
            match match_branch(&worktrees, query) {
                MatchOutcome::Single(path) => path,
                MatchOutcome::None => {
                    return Err(format!("no worktree matches '{query}'"));
                }
                MatchOutcome::Multiple(candidates) => {
                    return Err(format!(
                        "'{query}' matches multiple worktrees:\n  {}\nhint: pass the full branch name",
                        candidates.join("\n  "),
                    ));
                }
            }
        }
    };
    println!("{target_path}");
    Ok(())
}

#[cfg_attr(test, derive(Debug))]
enum MatchOutcome {
    None,
    Single(String),
    Multiple(Vec<String>),
}

fn match_branch(worktrees: &[git::ParsedWorktree], query: &str) -> MatchOutcome {
    let exact: Vec<&git::ParsedWorktree> = worktrees
        .iter()
        .filter(|w| w.branch.as_deref() == Some(query))
        .collect();
    if !exact.is_empty() {
        return finalize_matches(&exact);
    }
    let fuzzy: Vec<&git::ParsedWorktree> = worktrees
        .iter()
        .filter(|w| w.branch.as_deref().is_some_and(|b| b.contains(query)))
        .collect();
    finalize_matches(&fuzzy)
}

fn finalize_matches(matches: &[&git::ParsedWorktree]) -> MatchOutcome {
    match matches {
        [] => MatchOutcome::None,
        [only] => MatchOutcome::Single(only.path.to_string_lossy().into_owned()),
        many => MatchOutcome::Multiple(
            many.iter().filter_map(|w| w.branch.clone()).collect(),
        ),
    }
}

fn shell_init_snippet(shell: ShellKind) -> &'static str {
    match shell {
        ShellKind::Zsh | ShellKind::Bash => POSIX_SHELL_INIT,
        ShellKind::Fish => FISH_SHELL_INIT,
    }
}

const POSIX_SHELL_INIT: &str = r#"grove() {
  if [ "$1" = "cd" ]; then
    shift
    local _grove_target
    _grove_target=$(command grove cd "$@") || return $?
    cd "$_grove_target"
  else
    command grove "$@"
  fi
}
"#;

const FISH_SHELL_INIT: &str = r#"function grove
    if test "$argv[1]" = "cd"
        set -e argv[1]
        set -l _grove_target (command grove cd $argv)
        or return $status
        cd $_grove_target
    else
        command grove $argv
    end
end
"#;

// ── config edit / hook edit ────────────────────────────────────────────────

fn cmd_config_edit() -> Result<(), String> {
    let repo_root = current_repo_root()?;
    let repo_key = repo_root.to_string_lossy().to_string();
    let mut store_data = store::load_store()?;
    let initial = match store_data.repo_configs.get(&repo_key) {
        Some(cfg) => config::render_config_text(cfg)?,
        None => config::sample_config_text(),
    };

    let Some(parsed) = edit_in_loop(&initial, "config", config::parse_config_text)? else {
        eprintln!("no changes; config left unchanged");
        return Ok(());
    };
    let new_config = parsed.unwrap_or_default();
    if config::is_effectively_empty(&new_config) {
        store_data.repo_configs.remove(&repo_key);
    } else {
        store_data.repo_configs.insert(repo_key.clone(), new_config);
    }
    store::persist(&store_data)?;
    eprintln!("config saved for {repo_key}");
    Ok(())
}

fn cmd_hook_edit() -> Result<(), String> {
    let repo_root = current_repo_root()?;
    let repo_key = repo_root.to_string_lossy().to_string();
    let mut store_data = store::load_store()?;
    let existing = store_data
        .repo_configs
        .get(&repo_key)
        .cloned()
        .unwrap_or_default();

    let initial = if existing.hooks.is_empty() {
        HOOKS_EDIT_TEMPLATE.to_string()
    } else {
        config::render_hooks_text(&existing.hooks)?
    };

    let Some(new_hooks) = edit_in_loop(&initial, "hooks", config::parse_hooks_text)? else {
        eprintln!("no changes; hooks left unchanged");
        return Ok(());
    };
    let mut new_config = existing;
    new_config.hooks = new_hooks;
    if config::is_effectively_empty(&new_config) {
        store_data.repo_configs.remove(&repo_key);
    } else {
        store_data.repo_configs.insert(repo_key.clone(), new_config);
    }
    store::persist(&store_data)?;
    eprintln!("hooks saved for {repo_key}");
    Ok(())
}

const HOOKS_EDIT_TEMPLATE: &str = r#"# Edit hooks below. The schema is a [[hooks.<event>]] array of step tables.
#
# Events: pre-create, post-create, pre-launch, post-launch, pre-remove, post-remove
# Step types:
#   type = "script"      run = "echo hello"
#   type = "install"     run = "pnpm install"   # optional, auto-detected if omitted
#   type = "launch"      launcherId = "vscode"
#   type = "copy-files"  paths = [".env", ".env.local"]
#
# Save an empty file (or delete everything) to clear all hooks.

# [[hooks.post-create]]
# type = "install"
"#;

/// Open `initial_text` in the user's editor, then run `parse` on the saved
/// content.
///
/// Returns `Ok(None)` if the user closed the editor without modifying the
/// file (the caller should treat this as a no-op, not persist anything).
/// Returns `Ok(Some(value))` on a successful parse of edited content.
///
/// On parse failure with a TTY, prompts to retry — the editor reopens with
/// the user's last edit, not the original template. On non-TTY (no way to
/// prompt), the parse error is returned directly so the caller sees the real
/// problem instead of a "not a TTY" mask.
fn edit_in_loop<F, T>(
    initial_text: &str,
    file_name_hint: &str,
    parse: F,
) -> Result<Option<T>, String>
where
    F: Fn(&str) -> Result<T, String>,
{
    let tmp = tempfile::Builder::new()
        .prefix(&format!("grove-{file_name_hint}-"))
        .suffix(".toml")
        .tempfile()
        .map_err(|error| format!("cannot create tmp file: {error}"))?;
    std::fs::write(tmp.path(), initial_text)
        .map_err(|error| format!("cannot write tmp file: {error}"))?;

    loop {
        spawn_editor(tmp.path())?;
        let edited = std::fs::read_to_string(tmp.path())
            .map_err(|error| format!("cannot read edited file: {error}"))?;
        if edited == initial_text {
            return Ok(None);
        }
        match parse(&edited) {
            Ok(value) => return Ok(Some(value)),
            Err(error) => {
                if !std::io::stderr().is_terminal() {
                    return Err(error);
                }
                eprintln!("error: {error}");
                if !prompt_retry()? {
                    return Err("aborted".into());
                }
                // tmp file already holds the user's edits; the next iteration
                // reopens them.
            }
        }
    }
}

fn spawn_editor(path: &Path) -> Result<(), String> {
    let editor = resolve_editor();

    #[cfg(unix)]
    let status = std::process::Command::new("sh")
        .arg("-c")
        .arg(format!(r#"{editor} "$1""#))
        .arg("--")
        .arg(path)
        .status();
    #[cfg(windows)]
    let status = std::process::Command::new("cmd")
        .args(["/C", &editor])
        .arg(path)
        .status();

    let status = status.map_err(|error| format!("failed to spawn editor '{editor}': {error}"))?;
    if !status.success() {
        return Err(format!("editor '{editor}' exited with status {status}"));
    }
    Ok(())
}

fn resolve_editor() -> String {
    for var in ["GROVE_EDITOR", "VISUAL", "EDITOR"] {
        if let Ok(value) = std::env::var(var) {
            if !value.trim().is_empty() {
                return value;
            }
        }
    }
    if cfg!(windows) {
        "notepad".into()
    } else {
        "vi".into()
    }
}

fn prompt_retry() -> Result<bool, String> {
    eprint!("retry? [Y/n] ");
    std::io::stderr().flush().ok();
    let mut answer = String::new();
    std::io::stdin()
        .read_line(&mut answer)
        .map_err(|error| format!("failed to read input: {error}"))?;
    let trimmed = answer.trim().to_lowercase();
    Ok(trimmed.is_empty() || trimmed == "y" || trimmed == "yes")
}

/// Install CLI — returns a message string (used by the Tauri GUI command).
pub fn cmd_install_cli_inner() -> Result<String, String> {
    let target = Path::new("/usr/local/bin/grove");
    let source = std::env::current_exe()
        .map_err(|e| format!("cannot determine current executable: {e}"))?;

    if let Ok(existing) = std::fs::read_link(target) {
        if existing == source {
            return Ok(format!("grove CLI is already installed at {}", target.display()));
        }
        std::fs::remove_file(target).map_err(|e| {
            format!(
                "cannot update existing symlink at {}: {e}",
                target.display()
            )
        })?;
    } else if target.exists() {
        return Err(format!(
            "{} already exists and is not a symlink. Remove it first.",
            target.display()
        ));
    }

    let parent = target.parent().unwrap();
    if !parent.exists() {
        std::fs::create_dir_all(parent).map_err(|e| {
            format!("cannot create {}: {e}", parent.display())
        })?;
    }

    #[cfg(unix)]
    {
        std::os::unix::fs::symlink(&source, target).map_err(|e| {
            if e.kind() == std::io::ErrorKind::PermissionDenied {
                format!(
                    "permission denied. Try:\n  sudo ln -sf {} {}",
                    source.display(),
                    target.display()
                )
            } else {
                format!("failed to create symlink: {e}")
            }
        })?;
    }

    #[cfg(windows)]
    {
        std::os::windows::fs::symlink_file(&source, target)
            .map_err(|e| format!("failed to create symlink: {e}"))?;
    }

    Ok(format!(
        "Installed grove CLI at {}\n  {} -> {}",
        target.display(),
        target.display(),
        source.display()
    ))
}

/// Uninstall CLI — returns a message string.
pub fn cmd_uninstall_cli_inner() -> Result<String, String> {
    let target = Path::new("/usr/local/bin/grove");

    if !target.exists() {
        return Ok(format!("grove CLI is not installed at {}", target.display()));
    }

    if std::fs::read_link(target).is_err() {
        return Err(format!(
            "{} is not a symlink — refusing to remove",
            target.display()
        ));
    }

    std::fs::remove_file(target).map_err(|e| {
        if e.kind() == std::io::ErrorKind::PermissionDenied {
            format!(
                "permission denied. Try:\n  sudo rm {}",
                target.display()
            )
        } else {
            format!("failed to remove symlink: {e}")
        }
    })?;

    Ok(format!("Removed grove CLI from {}", target.display()))
}

/// Auto-detect which worktree the cwd belongs to by checking if the cwd
/// matches or is inside any known worktree path.
fn auto_detect_worktree(repo_root: &str, cwd: &str) -> Result<Option<String>, String> {
    let store = store::load_store()?;
    let repo_root_path = Path::new(repo_root);
    let worktrees = git::scan_worktrees(repo_root_path, &store)?;

    let cwd_path = Path::new(cwd);
    for wt in &worktrees {
        let wt_path = Path::new(&wt.path);
        if cwd_path.starts_with(wt_path) {
            return Ok(Some(wt.path.clone()));
        }
    }
    // cwd is inside the repo but not inside a specific worktree — use repo root context
    Ok(None)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::WorktreeRecord;

    fn make_worktree(path: &str, branch: Option<&str>, is_main: bool) -> WorktreeRecord {
        WorktreeRecord {
            id: path.into(),
            path: path.into(),
            branch: branch.map(String::from),
            head_sha: "0".into(),
            is_main,
            locked_reason: None,
            prunable_reason: None,
            dirty: false,
            ahead: 0,
            behind: 0,
            last_opened_at: None,
            head_commit_date: None,
            pr_number: None,
            pr_url: None,
            recent_commits: Vec::new(),
            changed_files: Vec::new(),
        }
    }

    #[test]
    fn resolve_rm_target_matches_branch_exactly() {
        let worktrees = vec![
            make_worktree("/repo", Some("main"), true),
            make_worktree("/repo/.wt/login", Some("feat/login"), false),
            make_worktree("/repo/.wt/oauth", Some("feat/oauth"), false),
        ];
        let target =
            resolve_rm_target(&worktrees, Some("feat/login"), Path::new("/anywhere")).unwrap();
        assert_eq!(target.path, "/repo/.wt/login");
    }

    #[test]
    fn resolve_rm_target_infers_from_cwd_and_skips_main() {
        let worktrees = vec![
            make_worktree("/repo", Some("main"), true),
            make_worktree("/repo/.wt/login", Some("feat/login"), false),
        ];

        let target = resolve_rm_target(
            &worktrees,
            None,
            Path::new("/repo/.wt/login/sub/dir"),
        )
        .unwrap();
        assert_eq!(target.path, "/repo/.wt/login");

        // cwd in main worktree → no inferred target (main is excluded).
        let err = resolve_rm_target(&worktrees, None, Path::new("/repo/src")).unwrap_err();
        assert!(err.contains("not inside a worktree"), "{err}");
    }

    #[test]
    fn resolve_rm_target_reports_unknown_branch() {
        let worktrees = vec![make_worktree("/repo", Some("main"), true)];
        let err = resolve_rm_target(&worktrees, Some("ghost"), Path::new("/repo")).unwrap_err();
        assert!(err.contains("no worktree found for branch 'ghost'"), "{err}");
    }

    fn parsed(path: &str, branch: Option<&str>) -> git::ParsedWorktree {
        git::ParsedWorktree {
            path: path.into(),
            branch: branch.map(String::from),
            head_sha: String::new(),
            locked_reason: None,
            prunable_reason: None,
        }
    }

    fn assert_match_path(outcome: MatchOutcome, expected: &str) {
        match outcome {
            MatchOutcome::Single(path) => assert_eq!(path, expected),
            MatchOutcome::None => panic!("expected single match {expected:?}, got None"),
            MatchOutcome::Multiple(branches) => {
                panic!("expected single match {expected:?}, got many: {branches:?}")
            }
        }
    }

    #[test]
    fn match_branch_prefers_exact_over_substring() {
        let worktrees = vec![
            parsed("/repo", Some("main")),
            parsed("/repo/.wt/login", Some("login")),
            parsed("/repo/.wt/feat-login", Some("feat/login")),
        ];
        // exact "login" wins even though substring would match both
        assert_match_path(match_branch(&worktrees, "login"), "/repo/.wt/login");
    }

    #[test]
    fn match_branch_substring_fallback_when_no_exact() {
        let worktrees = vec![
            parsed("/repo", Some("main")),
            parsed("/repo/.wt/feat-login", Some("feat/login")),
        ];
        assert_match_path(match_branch(&worktrees, "login"), "/repo/.wt/feat-login");
    }

    #[test]
    fn match_branch_multiple_substring_returns_candidates() {
        let worktrees = vec![
            parsed("/repo/.wt/feat-login", Some("feat/login")),
            parsed("/repo/.wt/feat-oauth", Some("feat/oauth")),
        ];
        match match_branch(&worktrees, "feat/") {
            MatchOutcome::Multiple(branches) => {
                assert_eq!(branches, vec!["feat/login", "feat/oauth"]);
            }
            other => panic!("expected Multiple, got {other:?}"),
        }
    }

    #[test]
    fn match_branch_none_when_no_match() {
        let worktrees = vec![parsed("/repo", Some("main"))];
        assert!(matches!(
            match_branch(&worktrees, "ghost"),
            MatchOutcome::None
        ));
    }
}
