import { open } from "@tauri-apps/plugin-dialog";
import { useEffect, useRef, useState } from "react";
import {
  approveRepoCommands,
  bootstrap,
  createRepoWorktree,
  launchRepoWorktree,
  openRepo,
  previewRepoPrune,
  pruneRepoMetadata,
  removeRepoWorktree,
  runRepoHookEvent,
  saveRepoConfigs,
  startRepoWorktree,
} from "./lib/api";
import type {
  ActionResponse,
  ApprovalRequest,
  BootstrapResponse,
  CreateMode,
  CreateWorktreeInput,
  HookStep,
  LauncherProfile,
  LogLevel,
  RepoSnapshot,
  RunLog,
  ToolStatus,
  WorktreeRecord,
} from "./lib/types";

type CreateFormState = {
  mode: CreateMode;
  branch: string;
  baseRef: string;
  remoteRef: string;
  path: string;
  autoStartLaunchers: string[];
};

const createInitialForm = (repo?: RepoSnapshot): CreateFormState => ({
  mode: "new-branch",
  branch: "",
  baseRef: repo?.mergedConfig.settings.defaultBaseBranch ?? "main",
  remoteRef: "",
  path: "",
  autoStartLaunchers: [],
});

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

export default function App() {
  const [bootstrapState, setBootstrapState] = useState<BootstrapResponse>({
    recentRepos: [],
    toolStatuses: [],
    lastActiveRepo: null,
  });
  const [repoInput, setRepoInput] = useState("");
  const [repo, setRepo] = useState<RepoSnapshot | null>(null);
  const [projectConfigText, setProjectConfigText] = useState("");
  const [localConfigText, setLocalConfigText] = useState("");
  const [createForm, setCreateForm] = useState<CreateFormState>(createInitialForm());
  const [logs, setLogs] = useState<RunLog[]>([]);
  const [prunePreview, setPrunePreview] = useState<string[]>([]);
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingApprovals, setPendingApprovals] = useState<ApprovalRequest[]>([]);
  const pendingReplay = useRef<(() => Promise<void>) | null>(null);

  const [selectedWorktreeId, setSelectedWorktreeId] = useState<string | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [showHooksModal, setShowHooksModal] = useState(false);
  const [showAdvancedCreate, setShowAdvancedCreate] = useState(false);
  const [showTooling, setShowTooling] = useState(false);
  const [showActionLog, setShowActionLog] = useState(false);
  const [showConfigEditor, setShowConfigEditor] = useState(false);

  const selectedWorktree = repo?.worktrees.find((w) => w.id === selectedWorktreeId) ?? null;

  // Bootstrap
  useEffect(() => {
    void (async () => {
      try {
        const data = await bootstrap();
        setBootstrapState(data);
        if (data.lastActiveRepo) {
          setRepoInput(data.lastActiveRepo);
          await loadRepoInner(data.lastActiveRepo);
        } else if (data.recentRepos[0]) {
          setRepoInput(data.recentRepos[0]);
        }
      } catch (reason) {
        setError(String(reason));
      }
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Sync config text when repo changes
  useEffect(() => {
    if (!repo) return;
    setProjectConfigText(repo.projectConfigText);
    setLocalConfigText(repo.localConfigText);
    setCreateForm((current) => {
      if (current.branch || current.path || current.remoteRef) return current;
      return createInitialForm(repo);
    });
    setBootstrapState((current) => ({
      ...current,
      recentRepos: repo.recentRepos,
      toolStatuses: repo.toolStatuses,
    }));
  }, [repo]);

  // Auto-select worktree when repo changes
  useEffect(() => {
    if (!repo) return;
    if (selectedWorktreeId && repo.worktrees.some((w) => w.id === selectedWorktreeId)) return;
    const nonMain = repo.worktrees.find((w) => !w.isMain);
    setSelectedWorktreeId(nonMain?.id ?? repo.worktrees[0]?.id ?? null);
    setDeleteConfirmId(null);
  }, [repo]); // eslint-disable-line react-hooks/exhaustive-deps

  async function loadRepoInner(candidate: string) {
    const trimmed = candidate.trim();
    if (!trimmed) return;
    setError(null);
    setIsBusy(true);
    try {
      const snapshot = await openRepo(trimmed);
      setRepo(snapshot);
      setRepoInput(snapshot.repoRoot);
      appendLogs([{ level: "success", message: `Loaded ${snapshot.repoRoot}` }]);
    } catch (reason) {
      setError(String(reason));
    } finally {
      setIsBusy(false);
    }
  }

  async function loadRepo(candidate: string) {
    await loadRepoInner(candidate);
  }

  async function browseForRepo() {
    const selected = await open({
      directory: true,
      multiple: false,
      title: "Choose a Git repository",
    });
    if (typeof selected === "string") {
      setRepoInput(selected);
      await loadRepo(selected);
    }
  }

  async function runAction(action: () => Promise<ActionResponse>) {
    setError(null);
    setIsBusy(true);
    try {
      const response = await action();
      appendLogs(response.logs);
      if (response.status === "approval-required") {
        setPendingApprovals(response.approvals);
        pendingReplay.current = () => runAction(action);
        return;
      }
      setPendingApprovals([]);
      pendingReplay.current = null;
      if (response.repo) {
        setRepo(response.repo);
        setRepoInput(response.repo.repoRoot);
      }
    } catch (reason) {
      setError(String(reason));
      appendLogs([{ level: "error", message: String(reason) }]);
    } finally {
      setIsBusy(false);
    }
  }

  async function approveAndRetry() {
    if (!repo || pendingApprovals.length === 0) return;
    setIsBusy(true);
    setError(null);
    try {
      await approveRepoCommands({
        repoRoot: repo.repoRoot,
        fingerprints: pendingApprovals.map((item) => item.fingerprint),
      });
      const replay = pendingReplay.current;
      setPendingApprovals([]);
      pendingReplay.current = null;
      if (replay) await replay();
    } catch (reason) {
      setError(String(reason));
    } finally {
      setIsBusy(false);
    }
  }

  function appendLogs(nextLogs: RunLog[]) {
    if (nextLogs.length === 0) return;
    setLogs((current) => [...nextLogs, ...current].slice(0, 120));
  }

  async function handleSaveConfigs() {
    if (!repo) return;
    setIsBusy(true);
    setError(null);
    try {
      const snapshot = await saveRepoConfigs({
        repoRoot: repo.repoRoot,
        projectConfigText,
        localConfigText,
      });
      setRepo(snapshot);
      appendLogs([{ level: "success", message: "Saved repo config files." }]);
    } catch (reason) {
      setError(String(reason));
      appendLogs([{ level: "error", message: String(reason) }]);
    } finally {
      setIsBusy(false);
    }
  }

  async function handleCreateWorktree() {
    if (!repo || !createForm.branch.trim()) return;
    const input: CreateWorktreeInput = {
      repoRoot: repo.repoRoot,
      mode: createForm.mode,
      branch: createForm.branch.trim(),
      baseRef: createForm.baseRef.trim() || null,
      remoteRef: createForm.remoteRef.trim() || null,
      path: createForm.path.trim() || null,
      autoStartLaunchers: createForm.autoStartLaunchers,
    };
    await runAction(() => createRepoWorktree(input));
    setCreateForm(createInitialForm(repo));
  }

  async function handleStart(worktree: WorktreeRecord) {
    if (!repo) return;
    await runAction(() =>
      startRepoWorktree({ repoRoot: repo.repoRoot, worktreePath: worktree.path }),
    );
  }

  async function handleLaunch(worktree: WorktreeRecord, launcher: LauncherProfile) {
    if (!repo) return;
    await runAction(() =>
      launchRepoWorktree({
        repoRoot: repo.repoRoot,
        worktreePath: worktree.path,
        launcherId: launcher.id,
        promptOverride: null,
      }),
    );
  }

  async function handleRemove(worktree: WorktreeRecord, force: boolean) {
    if (!repo) return;
    await runAction(() =>
      removeRepoWorktree({ repoRoot: repo.repoRoot, worktreePath: worktree.path, force }),
    );
    setDeleteConfirmId(null);
  }

  async function handleRunPostScan() {
    if (!repo) return;
    await runAction(() =>
      runRepoHookEvent({ repoRoot: repo.repoRoot, event: "post-scan", worktreePath: null }),
    );
  }

  async function handlePreviewPrune() {
    if (!repo) return;
    setIsBusy(true);
    setError(null);
    try {
      const preview = await previewRepoPrune(repo.repoRoot);
      setPrunePreview(preview);
      appendLogs([
        {
          level: preview.length > 0 ? "info" : "success",
          message:
            preview.length > 0
              ? `Found ${preview.length} prune candidate(s).`
              : "No prune candidates detected.",
        },
      ]);
    } catch (reason) {
      setError(String(reason));
    } finally {
      setIsBusy(false);
    }
  }

  async function handlePrune() {
    if (!repo) return;
    await runAction(() => pruneRepoMetadata(repo.repoRoot));
    setPrunePreview([]);
  }

  const launchers = repo?.mergedConfig.launchers ?? [];
  const hooks = repo?.mergedConfig.hooks ?? [];

  return (
    <div className="shell">
      {/* ─── Sidebar ─── */}
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-badge">WT</div>
          <h1>Worktree Switcher</h1>
        </div>

        {/* Repo Picker */}
        <div className="repo-picker">
          <div className="repo-picker-row">
            <input
              value={repoInput}
              onChange={(e) => setRepoInput(e.target.value)}
              placeholder="/path/to/repo"
              onKeyDown={(e) => e.key === "Enter" && void loadRepo(repoInput)}
            />
            <button className="ghost-button" onClick={browseForRepo} disabled={isBusy}>
              ...
            </button>
            <button className="primary-button" onClick={() => void loadRepo(repoInput)} disabled={isBusy}>
              {isBusy ? "..." : "Load"}
            </button>
          </div>
          {bootstrapState.recentRepos.length > 0 && (
            <div className="pill-list">
              {bootstrapState.recentRepos.map((item) => (
                <button
                  key={item}
                  className="pill"
                  onClick={() => void loadRepo(item)}
                  disabled={isBusy}
                >
                  {item.split("/").pop()}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="sidebar-divider" />

        {/* Worktree List */}
        <div className="worktree-list">
          {repo?.worktrees.map((wt) =>
            deleteConfirmId === wt.id ? (
              <div key={wt.id} className="delete-confirm">
                <span>Delete {wt.branch ?? "worktree"}?</span>
                <button className="ghost-button" onClick={() => setDeleteConfirmId(null)}>
                  Cancel
                </button>
                <button
                  className="danger-button"
                  onClick={() => void handleRemove(wt, wt.dirty || !!wt.lockedReason)}
                >
                  {wt.dirty || wt.lockedReason ? "Force" : "Delete"}
                </button>
              </div>
            ) : (
              <WorktreeListItem
                key={wt.id}
                worktree={wt}
                active={wt.id === selectedWorktreeId}
                onSelect={() => {
                  setSelectedWorktreeId(wt.id);
                  setDeleteConfirmId(null);
                }}
                onDelete={() => {
                  if (wt.isMain) return;
                  setDeleteConfirmId(wt.id);
                }}
              />
            ),
          )}
          {repo && repo.worktrees.length === 0 && (
            <p className="empty-copy">No worktrees found.</p>
          )}
        </div>

        <div className="sidebar-divider" />

        {/* Create Worktree */}
        <div className="sidebar-create">
          <div className="sidebar-create-row">
            <input
              value={createForm.branch}
              onChange={(e) => setCreateForm((c) => ({ ...c, branch: e.target.value }))}
              placeholder="branch name"
              onKeyDown={(e) => e.key === "Enter" && void handleCreateWorktree()}
            />
            <button
              className="primary-button"
              onClick={() => void handleCreateWorktree()}
              disabled={isBusy || !repo || !createForm.branch.trim()}
            >
              Create
            </button>
          </div>
          <button className="advanced-toggle" onClick={() => setShowAdvancedCreate((v) => !v)}>
            {showAdvancedCreate ? "Hide advanced" : "Advanced..."}
          </button>
          {showAdvancedCreate && (
            <div className="stack" style={{ gap: 8 }}>
              <label className="field-label">
                Mode
                <select
                  value={createForm.mode}
                  onChange={(e) =>
                    setCreateForm((c) => ({ ...c, mode: e.target.value as CreateMode }))
                  }
                >
                  <option value="new-branch">New branch</option>
                  <option value="existing-branch">Existing branch</option>
                  <option value="remote-branch">Remote branch</option>
                </select>
              </label>
              <label className="field-label">
                Base ref
                <input
                  value={createForm.baseRef}
                  onChange={(e) => setCreateForm((c) => ({ ...c, baseRef: e.target.value }))}
                  placeholder="main"
                />
              </label>
              {createForm.mode === "remote-branch" && (
                <label className="field-label">
                  Remote ref
                  <input
                    value={createForm.remoteRef}
                    onChange={(e) => setCreateForm((c) => ({ ...c, remoteRef: e.target.value }))}
                    placeholder="origin/branch"
                  />
                </label>
              )}
              <label className="field-label">
                Custom path
                <input
                  value={createForm.path}
                  onChange={(e) => setCreateForm((c) => ({ ...c, path: e.target.value }))}
                  placeholder="optional"
                />
              </label>
            </div>
          )}
        </div>

        {/* Bottom buttons */}
        <div className="sidebar-bottom">
          <div className="sidebar-bottom-row">
            {hooks.length > 0 && (
              <button className="ghost-button" onClick={() => setShowHooksModal(true)} style={{ flex: 1 }}>
                Hooks ({hooks.length})
              </button>
            )}
          </div>
        </div>
      </aside>

      {/* ─── Detail Panel ─── */}
      <main className="main">
        {error && <div className="error-banner">{error}</div>}

        {!repo && (
          <section className="hero card">
            <h2>Start with a local Git repository</h2>
            <p>
              Pick any repo to scan worktrees, manage launchers, and run hooks from one place.
            </p>
            <ul className="hero-points">
              <li>Uses native <code>git worktree</code> porcelain output.</li>
              <li>Project-defined commands require one-time approval.</li>
              <li>Warmup helpers copy files and generate deterministic ports.</li>
            </ul>
          </section>
        )}

        {repo && !selectedWorktree && (
          <section className="hero card">
            <h2>No worktree selected</h2>
            <p>Select a worktree from the sidebar, or create a new one.</p>
          </section>
        )}

        {repo && selectedWorktree && (
          <WorktreeDetail
            repo={repo}
            worktree={selectedWorktree}
            launchers={launchers}
            isBusy={isBusy}
            onStart={() => void handleStart(selectedWorktree)}
            onLaunch={(launcher) => void handleLaunch(selectedWorktree, launcher)}
            prunePreview={prunePreview}
            onPreviewPrune={() => void handlePreviewPrune()}
            onPrune={() => void handlePrune()}
            onRunPostScan={() => void handleRunPostScan()}
            showTooling={showTooling}
            onToggleTooling={() => setShowTooling((v) => !v)}
            toolStatuses={repo.toolStatuses ?? bootstrapState.toolStatuses}
            showActionLog={showActionLog}
            onToggleActionLog={() => setShowActionLog((v) => !v)}
            logs={logs}
            onClearLogs={() => setLogs([])}
            showConfigEditor={showConfigEditor}
            onToggleConfigEditor={() => setShowConfigEditor((v) => !v)}
            projectConfigText={projectConfigText}
            localConfigText={localConfigText}
            onProjectConfigChange={setProjectConfigText}
            onLocalConfigChange={setLocalConfigText}
            onSaveConfigs={() => void handleSaveConfigs()}
          />
        )}
      </main>

      {/* Approval Modal */}
      {pendingApprovals.length > 0 && (
        <ApprovalModal
          approvals={pendingApprovals}
          onApprove={() => void approveAndRetry()}
          onCancel={() => {
            setPendingApprovals([]);
            pendingReplay.current = null;
          }}
          isBusy={isBusy}
        />
      )}

      {/* Hooks Modal */}
      {showHooksModal && (
        <HooksModal
          hooks={hooks}
          onRunPostScan={() => void handleRunPostScan()}
          onClose={() => setShowHooksModal(false)}
          isBusy={isBusy}
        />
      )}
    </div>
  );
}

/* ─── WorktreeListItem ─── */

function WorktreeListItem({
  worktree,
  active,
  onSelect,
  onDelete,
}: {
  worktree: WorktreeRecord;
  active: boolean;
  onSelect: () => void;
  onDelete: () => void;
}) {
  const dirName = worktree.path.split("/").pop() ?? worktree.path;
  return (
    <div
      className={`worktree-list-item ${active ? "active" : ""}`}
      onClick={onSelect}
    >
      <div className="worktree-list-item-info">
        <div className="worktree-list-item-branch">
          {worktree.branch ?? "(detached)"}
        </div>
        <div className="worktree-list-item-meta">
          <span className="worktree-list-item-dir">{dirName}</span>
          {worktree.prNumber && (
            <span className="pr-badge">#{worktree.prNumber}</span>
          )}
          {worktree.lastOpenedAt && (
            <span>{relativeTime(worktree.lastOpenedAt)}</span>
          )}
          {worktree.dirty && <Badge label="dirty" tone="danger" />}
        </div>
      </div>
      {!worktree.isMain && (
        <button
          className="worktree-list-item-delete"
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
        >
          &times;
        </button>
      )}
    </div>
  );
}

/* ─── WorktreeDetail ─── */

function WorktreeDetail({
  repo,
  worktree,
  launchers,
  isBusy,
  onStart,
  onLaunch,
  prunePreview,
  onPreviewPrune,
  onPrune,
  onRunPostScan,
  showTooling,
  onToggleTooling,
  toolStatuses,
  showActionLog,
  onToggleActionLog,
  logs,
  onClearLogs,
  showConfigEditor,
  onToggleConfigEditor,
  projectConfigText,
  localConfigText,
  onProjectConfigChange,
  onLocalConfigChange,
  onSaveConfigs,
}: {
  repo: RepoSnapshot;
  worktree: WorktreeRecord;
  launchers: LauncherProfile[];
  isBusy: boolean;
  onStart: () => void;
  onLaunch: (launcher: LauncherProfile) => void;
  prunePreview: string[];
  onPreviewPrune: () => void;
  onPrune: () => void;
  onRunPostScan: () => void;
  showTooling: boolean;
  onToggleTooling: () => void;
  toolStatuses: ToolStatus[];
  showActionLog: boolean;
  onToggleActionLog: () => void;
  logs: RunLog[];
  onClearLogs: () => void;
  showConfigEditor: boolean;
  onToggleConfigEditor: () => void;
  projectConfigText: string;
  localConfigText: string;
  onProjectConfigChange: (v: string) => void;
  onLocalConfigChange: (v: string) => void;
  onSaveConfigs: () => void;
}) {
  return (
    <>
      {/* Worktree Header */}
      <section className="card stack">
        <div className="detail-header">
          <h2>{worktree.branch ?? "(detached HEAD)"}</h2>
          <p className="detail-path">{worktree.path}</p>
          <div className="status-strip">
            <Badge label={worktree.isMain ? "main" : "linked"} tone="neutral" />
            <Badge
              label={worktree.dirty ? "dirty" : "clean"}
              tone={worktree.dirty ? "danger" : "good"}
            />
            {worktree.lockedReason && <Badge label="locked" tone="warning" />}
            {worktree.prunableReason && <Badge label="prunable" tone="warning" />}
          </div>
        </div>

        <div className="detail-meta">
          <div className="detail-meta-item">
            <span>HEAD</span>
            <strong>{worktree.headSha.slice(0, 12)}</strong>
          </div>
          <div className="detail-meta-item">
            <span>Sync</span>
            <strong>
              ↑{worktree.ahead} ↓{worktree.behind}
            </strong>
          </div>
          {worktree.lastOpenedAt && (
            <div className="detail-meta-item">
              <span>Last launched</span>
              <strong>{relativeTime(worktree.lastOpenedAt)}</strong>
            </div>
          )}
          {worktree.prNumber && worktree.prUrl && (
            <div className="detail-meta-item">
              <span>Pull Request</span>
              <a
                className="pr-link"
                href={worktree.prUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                #{worktree.prNumber}
              </a>
            </div>
          )}
        </div>
      </section>

      {/* Action Buttons */}
      <section className="card stack">
        <div className="section-heading">
          <span>Actions</span>
        </div>
        <div className="action-grid">
          {launchers.map((launcher) => {
            const tool = findTool(repo, launcher.id);
            return (
              <button
                key={launcher.id}
                className="ghost-button"
                onClick={() => onLaunch(launcher)}
                disabled={isBusy || !tool?.available}
                title={tool?.available ? launcher.appOrCmd : `${launcher.name} not detected`}
              >
                {launcher.name}
              </button>
            );
          })}
          <button className="ghost-button" onClick={onStart} disabled={isBusy}>
            Run post-start
          </button>
        </div>
      </section>

      {/* Warmup Info */}
      {(worktree.warmupPreview.copyCandidates.length > 0 ||
        worktree.warmupPreview.ports.length > 0) && (
        <section className="card stack">
          <div className="section-heading">
            <span>Warmup</span>
          </div>
          {worktree.warmupPreview.copyCandidates.length > 0 && (
            <div className="inline-panel">
              <strong>Copy candidates</strong>
              <p>{worktree.warmupPreview.copyCandidates.join(", ")}</p>
            </div>
          )}
          {worktree.warmupPreview.ports.length > 0 && (
            <div className="port-list">
              {worktree.warmupPreview.ports.map((port) => (
                <div key={port.name} className="port-chip">
                  <span>{port.name}</span>
                  <code>{port.port}</code>
                  {port.url && <small>{port.url}</small>}
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* Repo Overview */}
      <section className="card stack">
        <div className="overview-heading">
          <div>
            <h2 style={{ fontSize: "1rem" }}>{repo.repoRoot}</h2>
            <p style={{ fontSize: "0.85rem" }}>
              {repo.worktrees.length} worktrees, base{" "}
              <code>{repo.mergedConfig.settings.defaultBaseBranch}</code>
            </p>
          </div>
          <div className="overview-actions">
            <button className="ghost-button" onClick={onPreviewPrune} disabled={isBusy}>
              Preview Prune
            </button>
            <button className="ghost-button" onClick={onRunPostScan} disabled={isBusy}>
              Post-scan hooks
            </button>
            <button className="primary-button" onClick={onPrune} disabled={isBusy}>
              Prune
            </button>
          </div>
        </div>
        {repo.configErrors.length > 0 && (
          <div className="warning-panel">
            {repo.configErrors.map((msg) => (
              <p key={msg}>{msg}</p>
            ))}
          </div>
        )}
        {prunePreview.length > 0 && (
          <div className="prune-preview">
            <h3>Prune preview</h3>
            <ul>
              {prunePreview.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </div>
        )}
      </section>

      {/* Tooling (collapsible) */}
      <section className="card">
        <div className="collapsible-header" onClick={onToggleTooling}>
          <span className="section-heading" style={{ flex: 1 }}>
            Tooling
          </span>
          <span className="subtle">{showTooling ? "▾" : "▸"}</span>
        </div>
        {showTooling && (
          <div className="tool-list" style={{ marginTop: 8 }}>
            {toolStatuses.map((tool) => (
              <ToolRow key={tool.id} tool={tool} />
            ))}
          </div>
        )}
      </section>

      {/* Action Log (collapsible) */}
      <section className="card">
        <div className="collapsible-header" onClick={onToggleActionLog}>
          <span className="section-heading" style={{ flex: 1 }}>
            Action Log
            {logs.length > 0 && <span className="subtle" style={{ marginLeft: 8 }}>{logs.length}</span>}
          </span>
          <span className="subtle">{showActionLog ? "▾" : "▸"}</span>
        </div>
        {showActionLog && (
          <div style={{ marginTop: 8 }}>
            <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8 }}>
              <button className="ghost-button" onClick={onClearLogs} style={{ fontSize: "0.78rem", padding: "4px 10px" }}>
                Clear
              </button>
            </div>
            <div className="log-list">
              {logs.length === 0 && <p className="empty-copy">No actions yet.</p>}
              {logs.map((log, i) => (
                <div key={`${log.message}-${i}`} className={`log-item log-${log.level}`}>
                  <strong>{log.level}</strong>
                  <span>{log.message}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* Config Editor (collapsible) */}
      <section className="card">
        <div className="collapsible-header" onClick={onToggleConfigEditor}>
          <span className="section-heading" style={{ flex: 1 }}>
            Config Files
          </span>
          <span className="subtle">{showConfigEditor ? "▾" : "▸"}</span>
        </div>
        {showConfigEditor && (
          <div className="stack" style={{ marginTop: 8 }}>
            <div className="path-grid">
              <div>
                <strong>Project</strong>
                <p>{repo.configPaths.projectPath}</p>
              </div>
              <div>
                <strong>Local</strong>
                <p>{repo.configPaths.localPath}</p>
              </div>
            </div>
            <label className="field-label">
              Project config TOML
              <textarea
                value={projectConfigText}
                onChange={(e) => onProjectConfigChange(e.target.value)}
                rows={14}
              />
            </label>
            <label className="field-label">
              Local override TOML
              <textarea
                value={localConfigText}
                onChange={(e) => onLocalConfigChange(e.target.value)}
                rows={8}
              />
            </label>
            <button className="primary-button" onClick={onSaveConfigs} disabled={isBusy}>
              Save Config
            </button>
          </div>
        )}
      </section>
    </>
  );
}

/* ─── HooksModal ─── */

function HooksModal({
  hooks,
  onRunPostScan,
  onClose,
  isBusy,
}: {
  hooks: HookStep[];
  onRunPostScan: () => void;
  onClose: () => void;
  isBusy: boolean;
}) {
  const grouped = new Map<string, HookStep[]>();
  for (const hook of hooks) {
    const list = grouped.get(hook.event) ?? [];
    list.push(hook);
    grouped.set(hook.event, list);
  }

  return (
    <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal-card">
        <div className="section-heading">
          <span>Hooks</span>
          <button className="ghost-button" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="hooks-list" style={{ marginTop: 12 }}>
          {Array.from(grouped.entries()).map(([event, items]) => (
            <div key={event}>
              <div className="section-heading" style={{ fontSize: "0.78rem", marginBottom: 6 }}>
                <span>{event}</span>
              </div>
              {items.map((hook) => (
                <div key={hook.id} className="hook-item">
                  <div className="hook-item-header">
                    <strong>{hook.id}</strong>
                    <Badge
                      label={hook.enabled ? "enabled" : "disabled"}
                      tone={hook.enabled ? "good" : "neutral"}
                    />
                  </div>
                  <div className="hook-item-detail">
                    {hook.type} {hook.run && `— ${hook.run}`}
                    {hook.launcherId && `— launcher: ${hook.launcherId}`}
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
        <div className="modal-actions">
          <button className="ghost-button" onClick={onRunPostScan} disabled={isBusy}>
            Run post-scan
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─── Shared Components ─── */

function ToolRow({ tool }: { tool: ToolStatus }) {
  return (
    <div className="tool-row">
      <div>
        <strong>{tool.label}</strong>
        <p>{tool.location ?? "Not detected"}</p>
      </div>
      <Badge label={tool.available ? "ready" : "missing"} tone={tool.available ? "good" : "warning"} />
    </div>
  );
}

function Badge({ label, tone }: { label: string; tone: "neutral" | "warning" | "danger" | "good" }) {
  return <span className={`badge badge-${tone}`}>{label}</span>;
}

function ApprovalModal({
  approvals,
  onApprove,
  onCancel,
  isBusy,
}: {
  approvals: ApprovalRequest[];
  onApprove: () => void;
  onCancel: () => void;
  isBusy: boolean;
}) {
  return (
    <div className="modal-backdrop">
      <div className="modal-card">
        <div className="section-heading">
          <span>Approve Project Commands</span>
          <span className="subtle">{approvals.length} command(s)</span>
        </div>
        <p className="modal-copy">
          These commands came from project-level hooks or terminal launchers. They will be remembered
          for this repository until the command content changes.
        </p>
        <div className="approval-list">
          {approvals.map((approval) => (
            <div key={approval.fingerprint} className="approval-item">
              <strong>{approval.label}</strong>
              <p>{approval.cwd}</p>
              <pre>{approval.command}</pre>
            </div>
          ))}
        </div>
        <div className="modal-actions">
          <button className="ghost-button" onClick={onCancel} disabled={isBusy}>
            Cancel
          </button>
          <button className="primary-button" onClick={onApprove} disabled={isBusy}>
            Approve And Retry
          </button>
        </div>
      </div>
    </div>
  );
}

function findTool(repo: RepoSnapshot, launcherId: string) {
  return repo.toolStatuses.find((tool) => tool.id === launcherId) ?? null;
}
