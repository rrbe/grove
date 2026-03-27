use crate::{
    actions::{self, LogWriter},
    config, git,
    models::{HookEvent, LogLevel, RunLog},
    store,
};
use clap::{Parser, Subcommand};
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
}

#[derive(Subcommand)]
enum WorktreeCommands {
    /// List worktrees for the current repository
    List,
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

const CLI_SUBCOMMANDS: &[&str] = &[
    "open",
    "hook",
    "worktree",
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
        },
        Some(Commands::Worktree { command }) => match command {
            WorktreeCommands::List => cmd_worktree_list(),
        },
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
    let cwd = std::env::current_dir()
        .map_err(|e| format!("cannot determine current directory: {e}"))?;
    let cwd_str = cwd.to_string_lossy().to_string();
    let repo_root = git::resolve_repo_root(&cwd_str)?;

    let app_store = store::load_store()?;
    let repo_root_str = repo_root.to_string_lossy().to_string();
    let stored_config = app_store.repo_configs.get(&repo_root_str).cloned();
    let loaded = config::load(&repo_root, stored_config.as_ref(), &app_store.custom_launchers);

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
    let cwd = std::env::current_dir()
        .map_err(|e| format!("cannot determine current directory: {e}"))?;
    let cwd_str = cwd.to_string_lossy().to_string();
    let repo_root = git::resolve_repo_root(&cwd_str)?;

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
