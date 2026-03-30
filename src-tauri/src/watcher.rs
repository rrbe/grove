use notify::{Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Instant;
use tauri::{AppHandle, Emitter};

pub struct WatcherState {
    inner: Mutex<Option<WatcherInner>>,
}

struct WatcherInner {
    _watcher: RecommendedWatcher,
    repo_root: String,
}

impl WatcherState {
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(None),
        }
    }

    /// Start watching the given repo's `.git/worktrees/` directory.
    /// If `.git/worktrees/` doesn't exist yet, watches `.git/` to detect its creation.
    /// Skips restart if already watching the same repo (avoids event loops).
    pub fn start(&self, app: &AppHandle, repo_root: &str) {
        let mut guard = self.inner.lock().unwrap();

        // If already watching the same repo, don't restart — avoids triggering
        // initial events that would cause an infinite refresh loop.
        if let Some(ref inner) = *guard {
            if inner.repo_root == repo_root {
                return;
            }
        }

        // Stop existing watcher (dropped automatically)
        *guard = None;

        let git_dir = PathBuf::from(repo_root).join(".git");
        if !git_dir.is_dir() {
            // Bare repo or not a git repo — skip watching
            return;
        }

        let worktrees_dir = git_dir.join("worktrees");
        let app_handle = app.clone();
        let repo_root_owned = repo_root.to_string();

        // Debounce: ignore events within 500ms of the last emitted event
        let last_emit = std::sync::Arc::new(Mutex::new(Instant::now() - std::time::Duration::from_secs(10)));
        let last_emit_clone = last_emit.clone();

        let mut watcher = match notify::recommended_watcher(move |res: Result<Event, notify::Error>| {
            let Ok(event) = res else { return };

            match event.kind {
                EventKind::Create(_) | EventKind::Remove(_) => {}
                _ => return,
            }

            // If .git/worktrees/ was just created, we'll pick it up on next open_repo.
            // For now, just emit the change signal for any create/remove in watched dirs.
            let mut last = last_emit_clone.lock().unwrap();
            if last.elapsed() < std::time::Duration::from_millis(500) {
                return;
            }
            *last = Instant::now();
            drop(last);

            let _ = app_handle.emit("worktrees-changed", &repo_root_owned);
        }) {
            Ok(w) => w,
            Err(e) => {
                eprintln!("[grove] failed to create fs watcher: {e}");
                return;
            }
        };

        // Watch .git/worktrees/ if it exists, otherwise watch .git/ to detect its creation
        let watch_path = if worktrees_dir.is_dir() {
            &worktrees_dir
        } else {
            &git_dir
        };

        if let Err(e) = watcher.watch(watch_path, RecursiveMode::NonRecursive) {
            eprintln!("[grove] failed to watch {}: {e}", watch_path.display());
            return;
        }

        *guard = Some(WatcherInner {
            _watcher: watcher,
            repo_root: repo_root.to_string(),
        });
    }
}
