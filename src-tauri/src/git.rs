use crate::models::{ColdStartConfig, CommitSummary, FileChange, FileStatus, PortAssignment, WarmupPreview, WorktreeRecord};
use crate::store::AppStore;
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeMap,
    fs,
    path::{Path, PathBuf},
    process::Command,
};

#[derive(Debug, Clone)]
pub struct ParsedWorktree {
    pub path: PathBuf,
    pub branch: Option<String>,
    pub head_sha: String,
    pub locked_reason: Option<String>,
    pub prunable_reason: Option<String>,
}

pub fn resolve_repo_root(candidate: &str) -> Result<PathBuf, String> {
    let output = Command::new("git")
        .arg("-C")
        .arg(candidate)
        .args(["rev-parse", "--show-toplevel"])
        .output()
        .map_err(|error| format!("failed to run git rev-parse: {error}"))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("not a git repository: {}", stderr.trim()));
    }
    let root = String::from_utf8_lossy(&output.stdout).trim().to_string();
    canonicalize(Path::new(&root))
}

pub fn scan_worktrees(
    repo_root: &Path,
    cold_start: &ColdStartConfig,
    store: &AppStore,
) -> Result<Vec<WorktreeRecord>, String> {
    let output = run_git_bytes(repo_root, ["worktree", "list", "--porcelain", "-z"])?;
    let parsed = parse_worktree_porcelain(&output)?;
    let main_root = canonicalize(repo_root)?;

    let branches: Vec<String> = parsed
        .iter()
        .filter_map(|entry| entry.branch.clone())
        .collect();
    let pr_map = lookup_prs_batch(repo_root, &branches, store);

    parsed
        .into_iter()
        .map(|entry| {
            let canonical = canonicalize(&entry.path).unwrap_or(entry.path.clone());
            let (dirty, ahead, behind, files) = git_status_details(&canonical)?;
            let warmup_preview =
                build_warmup_preview(repo_root, &canonical, entry.branch.as_deref(), cold_start);
            let (pr_number, pr_url) = entry
                .branch
                .as_deref()
                .and_then(|b| pr_map.get(b))
                .map(|(n, u)| (Some(*n), Some(u.clone())))
                .unwrap_or((None, None));
            let commit_date = head_commit_date(&canonical);
            let commits = recent_commits(&canonical, 3);
            Ok(WorktreeRecord {
                id: canonical.to_string_lossy().to_string(),
                path: canonical.to_string_lossy().to_string(),
                branch: entry.branch,
                head_sha: entry.head_sha,
                is_main: canonical == main_root,
                locked_reason: entry.locked_reason,
                prunable_reason: entry.prunable_reason,
                dirty,
                ahead,
                behind,
                last_opened_at: crate::store::last_opened(store, &canonical),
                head_commit_date: commit_date,
                warmup_preview,
                pr_number,
                pr_url,
                recent_commits: commits,
                changed_files: files,
            })
        })
        .collect()
}

pub fn lookup_prs_batch(
    repo_root: &Path,
    branches: &[String],
    store: &AppStore,
) -> BTreeMap<String, (u32, String)> {
    let mut result = BTreeMap::new();
    if branches.is_empty() {
        return result;
    }

    // Check cache first
    let mut uncached: Vec<&String> = Vec::new();
    for branch in branches {
        if let Some(entry) = store.pr_cache.get(branch) {
            result.insert(branch.clone(), (entry.pr_number, entry.pr_url.clone()));
        } else {
            uncached.push(branch);
        }
    }

    // If all branches are cached, return early
    if uncached.is_empty() {
        return result;
    }

    // Try to fetch from gh CLI
    let output = Command::new("gh")
        .arg("pr")
        .arg("list")
        .arg("--state")
        .arg("open")
        .arg("--json")
        .arg("number,url,headRefName")
        .arg("--limit")
        .arg("100")
        .current_dir(repo_root)
        .output();

    let output = match output {
        Ok(o) if o.status.success() => o,
        _ => return result, // gh not installed or not a GitHub repo
    };

    let json_str = String::from_utf8_lossy(&output.stdout);
    let prs: Vec<serde_json::Value> = match serde_json::from_str(&json_str) {
        Ok(v) => v,
        Err(_) => return result,
    };

    for pr in prs {
        let branch = pr["headRefName"].as_str().unwrap_or_default().to_string();
        let number = pr["number"].as_u64().unwrap_or(0) as u32;
        let url = pr["url"].as_str().unwrap_or_default().to_string();
        if number > 0 && branches.contains(&branch) {
            result.insert(branch, (number, url));
        }
    }

    result
}

pub fn detect_default_remote(repo_root: &Path) -> Option<String> {
    let config = run_git_text(repo_root, ["config", "--get", "checkout.defaultRemote"]).ok();
    if let Some(default_remote) = config.filter(|value| !value.trim().is_empty()) {
        return Some(default_remote.trim().to_string());
    }
    let remotes = run_git_text(repo_root, ["remote"]).ok()?;
    if remotes.lines().any(|line| line.trim() == "origin") {
        return Some("origin".into());
    }
    remotes
        .lines()
        .find(|line| !line.trim().is_empty())
        .map(|line| line.trim().to_string())
}

/// Detect the default branch by checking `origin/HEAD` symref, falling back to "main".
pub fn detect_default_branch(repo_root: &Path) -> String {
    // Try symbolic-ref of origin/HEAD → "refs/remotes/origin/main"
    if let Ok(symref) = run_git_text(repo_root, ["symbolic-ref", "refs/remotes/origin/HEAD"]) {
        let trimmed = symref.trim();
        if let Some(branch) = trimmed.strip_prefix("refs/remotes/origin/") {
            if !branch.is_empty() {
                return branch.to_string();
            }
        }
    }
    // Fallback: check if "main" or "master" exists as a local branch
    if run_git_text(repo_root, ["rev-parse", "--verify", "refs/heads/main"]).is_ok() {
        return "main".into();
    }
    if run_git_text(repo_root, ["rev-parse", "--verify", "refs/heads/master"]).is_ok() {
        return "master".into();
    }
    "main".into()
}

pub fn resolve_head_sha(repo_root: &Path, reference: &str) -> Result<String, String> {
    run_git_text(repo_root, ["rev-parse", reference]).map(|sha| sha.trim().to_string())
}

pub fn head_commit_date(worktree_path: &Path) -> Option<String> {
    run_git_text(worktree_path, ["log", "-1", "--format=%aI", "HEAD"])
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

pub fn recent_commits(worktree_path: &Path, count: usize) -> Vec<CommitSummary> {
    let args = vec![
        "log".to_string(),
        format!("-{count}"),
        "--format=%H\t%s\t%aI\t%an".to_string(),
        "HEAD".to_string(),
    ];
    match run_git_owned(worktree_path, &args) {
        Ok(output) => output
            .lines()
            .filter(|l| !l.is_empty())
            .filter_map(|line| {
                let mut parts = line.splitn(4, '\t');
                let sha = parts.next()?.to_string();
                let message = parts.next()?.to_string();
                let date = parts.next()?.to_string();
                let author = parts.next().unwrap_or("").to_string();
                Some(CommitSummary { sha, message, date, author })
            })
            .collect(),
        Err(_) => Vec::new(),
    }
}

pub fn list_local_branches(repo_root: &Path) -> Result<Vec<String>, String> {
    let output = run_git_text(repo_root, ["branch", "--format=%(refname:short)"])?;
    Ok(output
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .map(ToString::to_string)
        .collect())
}

pub fn list_remote_branches(repo_root: &Path) -> Result<Vec<String>, String> {
    let output = run_git_text(repo_root, ["branch", "-r", "--format=%(refname:short)"])?;
    Ok(output
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .filter(|line| !line.ends_with("/HEAD"))
        .map(ToString::to_string)
        .collect())
}

pub fn fetch_remote(repo_root: &Path) -> Result<String, String> {
    let remote = detect_default_remote(repo_root).unwrap_or_else(|| "origin".into());
    let args = vec!["fetch".to_string(), remote.clone(), "--prune".to_string()];
    run_git_owned(repo_root, &args).map(|_| format!("Fetched from {remote}"))
}

pub fn list_prune_candidates(repo_root: &Path) -> Result<Vec<String>, String> {
    let output = run_git_text(repo_root, ["worktree", "prune", "--dry-run", "--verbose"])?;
    Ok(output
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .map(ToString::to_string)
        .collect())
}

pub fn canonicalize(path: &Path) -> Result<PathBuf, String> {
    fs::canonicalize(path).map_err(|error| format!("failed to resolve {}: {error}", path.display()))
}

pub fn run_git_text<const N: usize>(repo_root: &Path, args: [&str; N]) -> Result<String, String> {
    let output = Command::new("git")
        .arg("-C")
        .arg(repo_root)
        .args(args)
        .output()
        .map_err(|error| format!("failed to run git: {error}"))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(stderr.trim().to_string());
    }
    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

pub fn run_git_owned(repo_root: &Path, args: &[String]) -> Result<String, String> {
    let output = Command::new("git")
        .arg("-C")
        .arg(repo_root)
        .args(args)
        .output()
        .map_err(|error| format!("failed to run git: {error}"))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(stderr.trim().to_string());
    }
    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

fn run_git_bytes<const N: usize>(repo_root: &Path, args: [&str; N]) -> Result<Vec<u8>, String> {
    let output = Command::new("git")
        .arg("-C")
        .arg(repo_root)
        .args(args)
        .output()
        .map_err(|error| format!("failed to run git: {error}"))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(stderr.trim().to_string());
    }
    Ok(output.stdout)
}

pub fn git_status_details(worktree_path: &Path) -> Result<(bool, u32, u32, Vec<FileChange>), String> {
    let status_output = run_git_text(worktree_path, ["-c", "core.quotePath=false", "status", "--porcelain=v1"])?;
    let trimmed = status_output.trim_end();
    let dirty = !trimmed.is_empty();
    let files = parse_porcelain_status(trimmed);
    let upstream = run_git_text(
        worktree_path,
        ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"],
    );
    if let Ok(upstream) = upstream {
        let upstream = upstream.trim().to_string();
        if !upstream.is_empty() {
            let counts = run_git_text(
                worktree_path,
                ["rev-list", "--left-right", "--count", "HEAD...@{u}"],
            )?;
            let mut parts = counts.split_whitespace();
            let ahead = parts.next().unwrap_or("0").parse::<u32>().unwrap_or(0);
            let behind = parts.next().unwrap_or("0").parse::<u32>().unwrap_or(0);
            return Ok((dirty, ahead, behind, files));
        }
    }
    Ok((dirty, 0, 0, files))
}

pub fn file_diff(worktree_path: &Path, file_path: &str, status: &str) -> Result<String, String> {
    match status {
        "untracked" => {
            // For untracked files, show the full file content as an "add" diff
            let full_path = worktree_path.join(file_path);
            std::fs::read_to_string(&full_path)
                .map(|content| {
                    content
                        .lines()
                        .map(|line| format!("+{line}"))
                        .collect::<Vec<_>>()
                        .join("\n")
                })
                .map_err(|e| format!("failed to read file: {e}"))
        }
        _ => {
            // For tracked files, use git diff (includes both staged and unstaged)
            let output = run_git_text(worktree_path, ["diff", "HEAD", "--", file_path])?;
            if output.trim().is_empty() {
                // Might be a newly staged file
                run_git_text(worktree_path, ["diff", "--cached", "--", file_path])
            } else {
                Ok(output)
            }
        }
    }
}

fn parse_porcelain_status(output: &str) -> Vec<FileChange> {
    if output.is_empty() {
        return Vec::new();
    }
    output
        .lines()
        .filter_map(|line| {
            if line.len() < 4 {
                return None;
            }
            let xy = &line[..2];
            let path = line[3..].to_string();
            // For renames "R  old -> new", show the new path
            let display_path = if let Some(pos) = path.find(" -> ") {
                path[pos + 4..].to_string()
            } else {
                path
            };
            let status = match xy {
                "??" => FileStatus::Untracked,
                _ => {
                    let x = xy.as_bytes()[0];
                    let y = xy.as_bytes()[1];
                    // Prefer worktree status (y), fall back to index status (x)
                    match if y != b' ' { y } else { x } {
                        b'M' => FileStatus::Modified,
                        b'A' => FileStatus::Added,
                        b'D' => FileStatus::Deleted,
                        b'R' => FileStatus::Renamed,
                        b'C' => FileStatus::Added,
                        _ => FileStatus::Modified,
                    }
                }
            };
            Some(FileChange {
                status,
                path: display_path,
            })
        })
        .collect()
}

pub fn parse_worktree_porcelain(stdout: &[u8]) -> Result<Vec<ParsedWorktree>, String> {
    let mut records = Vec::new();
    let mut current: Option<ParsedWorktree> = None;
    for field in stdout.split(|byte| *byte == 0) {
        if field.is_empty() {
            if let Some(record) = current.take() {
                records.push(record);
            }
            continue;
        }
        let line = String::from_utf8_lossy(field);
        if let Some(rest) = line.strip_prefix("worktree ") {
            if let Some(record) = current.take() {
                records.push(record);
            }
            current = Some(ParsedWorktree {
                path: PathBuf::from(rest),
                branch: None,
                head_sha: String::new(),
                locked_reason: None,
                prunable_reason: None,
            });
            continue;
        }
        let record = current.as_mut().ok_or_else(|| {
            "malformed git worktree output: field before worktree header".to_string()
        })?;
        if let Some(rest) = line.strip_prefix("HEAD ") {
            record.head_sha = rest.to_string();
        } else if let Some(rest) = line.strip_prefix("branch ") {
            record.branch = Some(rest.trim_start_matches("refs/heads/").to_string());
        } else if let Some(rest) = line.strip_prefix("locked") {
            record.locked_reason = parse_reason(rest);
        } else if let Some(rest) = line.strip_prefix("prunable") {
            record.prunable_reason = parse_reason(rest);
        }
    }
    if let Some(record) = current.take() {
        records.push(record);
    }
    Ok(records)
}

fn parse_reason(value: &str) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

pub fn build_warmup_preview(
    repo_root: &Path,
    worktree_path: &Path,
    branch: Option<&str>,
    cold_start: &ColdStartConfig,
) -> WarmupPreview {
    let copy_candidates = cold_start
        .copy_files
        .iter()
        .filter(|relative| repo_root.join(relative).exists())
        .cloned()
        .collect();

    let branch_seed = branch
        .map(ToOwned::to_owned)
        .unwrap_or_else(|| worktree_path.to_string_lossy().to_string());
    let ports = cold_start
        .ports
        .iter()
        .map(|template| {
            let port = hash_port(&branch_seed, template.base, &template.name);
            PortAssignment {
                name: template.name.clone(),
                env_var: template.env_var.clone(),
                port,
                url: template
                    .url_template
                    .as_ref()
                    .map(|template| template.replace("{port}", &port.to_string())),
            }
        })
        .collect();

    WarmupPreview {
        copy_candidates,
        ports,
    }
}

pub fn hash_port(seed: &str, base: u16, name: &str) -> u16 {
    let mut hasher = Sha256::new();
    hasher.update(seed.as_bytes());
    hasher.update(name.as_bytes());
    let digest = hasher.finalize();
    let offset = u16::from_be_bytes([digest[0], digest[1]]) % 200;
    base.saturating_add(offset)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_porcelain_records() {
        let stdout = b"worktree /tmp/main\0HEAD abc123\0branch refs/heads/main\0\0worktree /tmp/feature\0HEAD def456\0branch refs/heads/feat/test\0locked in-use\0prunable gitdir file points to non-existent location\0\0";
        let parsed = parse_worktree_porcelain(stdout).expect("parse");
        assert_eq!(parsed.len(), 2);
        assert_eq!(parsed[0].branch.as_deref(), Some("main"));
        assert_eq!(parsed[1].branch.as_deref(), Some("feat/test"));
        assert_eq!(parsed[1].locked_reason.as_deref(), Some("in-use"));
        assert_eq!(
            parsed[1].prunable_reason.as_deref(),
            Some("gitdir file points to non-existent location")
        );
    }

    #[test]
    fn hash_port_is_stable() {
        assert_eq!(
            hash_port("feature/demo", 3000, "web"),
            hash_port("feature/demo", 3000, "web")
        );
        assert_ne!(
            hash_port("feature/demo", 3000, "web"),
            hash_port("feature/demo", 3000, "vite")
        );
    }
}
