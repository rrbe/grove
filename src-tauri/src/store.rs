use crate::models::ApprovalRecord;
use serde::{Deserialize, Serialize};
use std::{
    collections::BTreeMap,
    fs,
    path::{Path, PathBuf},
    sync::Mutex,
};
use tauri::{AppHandle, Manager};

#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppStore {
    #[serde(default)]
    pub recent_repos: Vec<String>,
    #[serde(default)]
    pub approvals: Vec<ApprovalRecord>,
    #[serde(default)]
    pub last_opened: BTreeMap<String, String>,
}

pub struct SharedState {
    pub store: Mutex<AppStore>,
}

impl SharedState {
    pub fn load(app: &AppHandle) -> Result<Self, String> {
        let path = store_path(app)?;
        let store = if path.exists() {
            let raw = fs::read_to_string(&path).map_err(|error| {
                format!("failed to read app store at {}: {error}", path.display())
            })?;
            serde_json::from_str::<AppStore>(&raw).unwrap_or_default()
        } else {
            AppStore::default()
        };
        Ok(Self {
            store: Mutex::new(store),
        })
    }
}

pub fn store_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("failed to resolve app data directory: {error}"))?;
    Ok(dir.join("store.json"))
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

pub fn is_approved(store: &AppStore, repo_root: &str, fingerprint: &str) -> bool {
    store
        .approvals
        .iter()
        .any(|record| record.repo_root == repo_root && record.fingerprint == fingerprint)
}

pub fn approve(store: &mut AppStore, repo_root: &str, fingerprints: &[String], approved_at: &str) {
    for fingerprint in fingerprints {
        if is_approved(store, repo_root, fingerprint) {
            continue;
        }
        store.approvals.push(ApprovalRecord {
            repo_root: repo_root.to_string(),
            fingerprint: fingerprint.clone(),
            approved_at: approved_at.to_string(),
        });
    }
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
