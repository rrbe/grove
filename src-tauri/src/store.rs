use crate::models::ConfigFile;
use serde::{Deserialize, Serialize};
use std::{
    collections::BTreeMap,
    fs,
    path::{Path, PathBuf},
    sync::Mutex,
};
use tauri::AppHandle;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrCacheEntry {
    pub pr_number: u32,
    pub pr_url: String,
    pub fetched_at: String,
}

#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppStore {
    #[serde(default)]
    pub recent_repos: Vec<String>,
    #[serde(default)]
    pub last_opened: BTreeMap<String, String>,
    #[serde(default)]
    pub last_active_repo: Option<String>,
    #[serde(default)]
    pub pr_cache: BTreeMap<String, PrCacheEntry>,
    #[serde(default)]
    pub default_terminal: Option<String>,
    #[serde(default)]
    pub default_shell: Option<String>,
    #[serde(default)]
    pub repo_configs: BTreeMap<String, ConfigFile>,
    #[serde(default)]
    pub custom_launchers: Vec<crate::models::LauncherProfile>,
    #[serde(default)]
    pub show_tray_icon: Option<bool>,
    #[serde(default)]
    pub theme_mode: Option<String>,
    #[serde(default, skip_serializing)]
    pub repo_worktree_roots: BTreeMap<String, String>,
}

pub struct SharedState {
    pub store: Mutex<AppStore>,
    pub window_registry: Mutex<BTreeMap<String, String>>,
}

impl SharedState {
    pub fn load(app: &AppHandle) -> Result<Self, String> {
        let path = store_path(app)?;
        let mut store = if path.exists() {
            let raw = fs::read_to_string(&path).map_err(|error| {
                format!("failed to read app store at {}: {error}", path.display())
            })?;
            serde_json::from_str::<AppStore>(&raw).unwrap_or_default()
        } else {
            AppStore::default()
        };
        if !store.repo_worktree_roots.is_empty() {
            for (repo_root, worktree_root) in std::mem::take(&mut store.repo_worktree_roots) {
                store
                    .repo_configs
                    .entry(repo_root)
                    .or_default()
                    .settings
                    .worktree_root = Some(worktree_root);
            }
        }
        Ok(Self {
            store: Mutex::new(store),
            window_registry: Mutex::new(BTreeMap::new()),
        })
    }
}

pub fn grove_home() -> Result<PathBuf, String> {
    let home = crate::platform::home_dir()?;
    Ok(home.join(".grove"))
}

pub fn store_path(_app: &AppHandle) -> Result<PathBuf, String> {
    Ok(grove_home()?.join("store.json"))
}

pub fn persist(app: &AppHandle, store: &AppStore) -> Result<(), String> {
    let path = store_path(app)?;
    let dir = path
        .parent()
        .ok_or_else(|| "failed to resolve parent directory for app store".to_string())?;
    fs::create_dir_all(dir).map_err(|error| {
        format!(
            "failed to create app data directory {}: {error}",
            dir.display()
        )
    })?;
    let raw = serde_json::to_string_pretty(store)
        .map_err(|error| format!("failed to serialize app store: {error}"))?;
    fs::write(&path, raw)
        .map_err(|error| format!("failed to write {}: {error}", path.display()))?;
    Ok(())
}

pub fn push_recent(store: &mut AppStore, repo_root: &str) {
    store.recent_repos.retain(|item| item != repo_root);
    store.recent_repos.insert(0, repo_root.to_string());
    store.recent_repos.truncate(8);
}

pub fn touch_worktree(store: &mut AppStore, worktree_path: &str, opened_at: &str) {
    store
        .last_opened
        .insert(worktree_path.to_string(), opened_at.to_string());
}

pub fn last_opened(store: &AppStore, worktree_path: &Path) -> Option<String> {
    let path = worktree_path.to_string_lossy().to_string();
    store.last_opened.get(&path).cloned()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn push_recent_adds_to_front() {
        let mut store = AppStore::default();
        push_recent(&mut store, "/repo/a");
        push_recent(&mut store, "/repo/b");
        assert_eq!(store.recent_repos, vec!["/repo/b", "/repo/a"]);
    }

    #[test]
    fn push_recent_deduplicates() {
        let mut store = AppStore::default();
        push_recent(&mut store, "/repo/a");
        push_recent(&mut store, "/repo/b");
        push_recent(&mut store, "/repo/a");
        assert_eq!(store.recent_repos, vec!["/repo/a", "/repo/b"]);
    }

    #[test]
    fn push_recent_truncates_to_eight() {
        let mut store = AppStore::default();
        for i in 0..10 {
            push_recent(&mut store, &format!("/repo/{i}"));
        }
        assert_eq!(store.recent_repos.len(), 8);
        assert_eq!(store.recent_repos[0], "/repo/9");
    }

    #[test]
    fn touch_and_last_opened() {
        let mut store = AppStore::default();
        let path = Path::new("/tmp/wt");
        assert!(last_opened(&store, path).is_none());
        touch_worktree(&mut store, "/tmp/wt", "2025-01-01T00:00:00Z");
        assert_eq!(
            last_opened(&store, path),
            Some("2025-01-01T00:00:00Z".into())
        );
    }

    #[test]
    fn app_store_serde_roundtrip() {
        let mut store = AppStore::default();
        push_recent(&mut store, "/repo/test");
        store.default_terminal = Some("iterm".into());
        let json = serde_json::to_string(&store).unwrap();
        let restored: AppStore = serde_json::from_str(&json).unwrap();
        assert_eq!(restored.recent_repos, vec!["/repo/test"]);
        assert_eq!(restored.default_terminal.as_deref(), Some("iterm"));
    }

    #[test]
    fn app_store_deserializes_with_missing_fields() {
        let json = r#"{"recentRepos": ["/repo/x"]}"#;
        let store: AppStore = serde_json::from_str(json).unwrap();
        assert_eq!(store.recent_repos, vec!["/repo/x"]);
        assert!(store.default_terminal.is_none());
        assert!(store.pr_cache.is_empty());
    }
}
