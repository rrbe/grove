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
    pub repo_configs: BTreeMap<String, ConfigFile>,
    #[serde(default, skip_serializing)]
    pub repo_worktree_roots: BTreeMap<String, String>,
}

pub struct SharedState {
    pub store: Mutex<AppStore>,
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
        })
    }
}

pub fn grove_home() -> Result<PathBuf, String> {
    let home = std::env::var("HOME").map_err(|_| "HOME not set".to_string())?;
    Ok(PathBuf::from(home).join(".grove"))
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
