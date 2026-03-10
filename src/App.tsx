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

export default function App() {
  const [bootstrapState, setBootstrapState] = useState<BootstrapResponse>({
    recentRepos: [],
    toolStatuses: [],
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

  useEffect(() => {
    void (async () => {
      try {
        const data = await bootstrap();
        setBootstrapState(data);
        if (data.recentRepos[0]) {
          setRepoInput(data.recentRepos[0]);
        }
      } catch (reason) {
        setError(String(reason));
      }
    })();
  }, []);

  useEffect(() => {
    if (!repo) {
      return;
    }
    setProjectConfigText(repo.projectConfigText);
    setLocalConfigText(repo.localConfigText);
    setCreateForm((current) => {
      if (current.branch || current.path || current.remoteRef) {
        return current;
      }
      return createInitialForm(repo);
    });
    setBootstrapState((current) => ({
      ...current,
      recentRepos: repo.recentRepos,
      toolStatuses: repo.toolStatuses,
    }));
  }, [repo]);

  async function loadRepo(candidate: string) {
    const trimmed = candidate.trim();
    if (!trimmed) {
      return;
    }
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
    if (!repo || pendingApprovals.length === 0) {
      return;
    }
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
      if (replay) {
        await replay();
      }
    } catch (reason) {
      setError(String(reason));
    } finally {
      setIsBusy(false);
    }
  }

  function appendLogs(nextLogs: RunLog[]) {
    if (nextLogs.length === 0) {
      return;
    }
    setLogs((current) => [...nextLogs, ...current].slice(0, 120));
  }

  async function handleSaveConfigs() {
    if (!repo) {
      return;
    }
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
    if (!repo || !createForm.branch.trim()) {
      return;
    }
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
    if (!repo) {
      return;
    }
    await runAction(() =>
      startRepoWorktree({
        repoRoot: repo.repoRoot,
        worktreePath: worktree.path,
      }),
    );
  }

  async function handleLaunch(worktree: WorktreeRecord, launcher: LauncherProfile) {
    if (!repo) {
      return;
    }
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
    if (!repo) {
      return;
    }
    await runAction(() =>
      removeRepoWorktree({
        repoRoot: repo.repoRoot,
        worktreePath: worktree.path,
        force,
      }),
    );
  }

  async function handleRunPostScan() {
    if (!repo) {
      return;
    }
    await runAction(() =>
      runRepoHookEvent({
        repoRoot: repo.repoRoot,
        event: "post-scan",
        worktreePath: null,
      }),
    );
  }

  async function handlePreviewPrune() {
    if (!repo) {
      return;
    }
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
    if (!repo) {
      return;
    }
    await runAction(() => pruneRepoMetadata(repo.repoRoot));
    setPrunePreview([]);
  }

  const launchers = repo?.mergedConfig.launchers ?? [];

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-badge">WT</div>
          <div>
            <h1>Worktree Switcher</h1>
            <p>scan, warmup, hook, and launch Git worktrees from one place</p>
          </div>
        </div>

        <section className="card stack">
          <div className="section-heading">
            <span>Repo Picker</span>
            <button className="ghost-button" onClick={browseForRepo} disabled={isBusy}>
              Browse
            </button>
          </div>
          <label className="field-label">
            Repository path
            <input
              value={repoInput}
              onChange={(event) => setRepoInput(event.target.value)}
              placeholder="/Users/you/code/repo"
            />
          </label>
          <button className="primary-button" onClick={() => void loadRepo(repoInput)} disabled={isBusy}>
            {isBusy ? "Working…" : "Load Repository"}
          </button>
          {bootstrapState.recentRepos.length > 0 && (
            <div className="pill-list">
              {bootstrapState.recentRepos.map((item) => (
                <button
                  key={item}
                  className="pill"
                  onClick={() => void loadRepo(item)}
                  disabled={isBusy}
                >
                  {item}
                </button>
              ))}
            </div>
          )}
        </section>

        <section className="card stack">
          <div className="section-heading">
            <span>Tooling</span>
            <span className="subtle">{bootstrapState.toolStatuses.filter((item) => item.available).length} ready</span>
          </div>
          <div className="tool-list">
            {(repo?.toolStatuses ?? bootstrapState.toolStatuses).map((tool) => (
              <ToolRow key={tool.id} tool={tool} />
            ))}
          </div>
        </section>

        <section className="card stack">
          <div className="section-heading">
            <span>Action Log</span>
            <button className="ghost-button" onClick={() => setLogs([])}>
              Clear
            </button>
          </div>
          <div className="log-list">
            {logs.length === 0 && <p className="empty-copy">No actions yet.</p>}
            {logs.map((log, index) => (
              <div key={`${log.message}-${index}`} className={`log-item log-${log.level}`}>
                <strong>{log.level}</strong>
                <span>{log.message}</span>
              </div>
            ))}
          </div>
        </section>
      </aside>

      <main className="main">
        {error && <div className="error-banner">{error}</div>}

        {!repo && (
          <section className="hero card">
            <h2>Start with a local Git repository</h2>
            <p>
              Pick any repo, and the app will scan existing worktrees, expose create/remove flows,
              render project hooks from <code>.worktree-switcher/config.toml</code>, and offer one-click
              launchers for Terminal, editors, and AI CLIs.
            </p>
            <ul className="hero-points">
              <li>Uses native <code>git worktree</code> porcelain output.</li>
              <li>Project-defined commands require one-time approval.</li>
              <li>Warmup helpers can copy ignored files and generate deterministic ports.</li>
            </ul>
          </section>
        )}

        {repo && (
          <>
            <section className="card overview">
              <div className="overview-heading">
                <div>
                  <h2>{repo.repoRoot}</h2>
                  <p>
                    {repo.worktrees.length} worktrees, base branch{" "}
                    <code>{repo.mergedConfig.settings.defaultBaseBranch}</code>, worktree root{" "}
                    <code>{repo.mergedConfig.settings.worktreeRoot}</code>
                  </p>
                </div>
                <div className="overview-actions">
                  <button className="ghost-button" onClick={handlePreviewPrune} disabled={isBusy}>
                    Preview Prune
                  </button>
                  <button className="ghost-button" onClick={handleRunPostScan} disabled={isBusy}>
                    Run post-scan hooks
                  </button>
                  <button className="primary-button" onClick={handlePrune} disabled={isBusy}>
                    Prune Metadata
                  </button>
                </div>
              </div>
              {repo.configErrors.length > 0 && (
                <div className="warning-panel">
                  {repo.configErrors.map((message) => (
                    <p key={message}>{message}</p>
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

            <section className="grid-two">
              <section className="card stack">
                <div className="section-heading">
                  <span>Create Worktree</span>
                  <span className="subtle">macOS-first, common flows only</span>
                </div>
                <div className="form-grid">
                  <label className="field-label">
                    Create mode
                    <select
                      value={createForm.mode}
                      onChange={(event) =>
                        setCreateForm((current) => ({
                          ...current,
                          mode: event.target.value as CreateMode,
                        }))
                      }
                    >
                      <option value="new-branch">New branch from base</option>
                      <option value="existing-branch">Existing local branch</option>
                      <option value="remote-branch">Remote branch to tracking branch</option>
                    </select>
                  </label>
                  <label className="field-label">
                    Branch name
                    <input
                      value={createForm.branch}
                      onChange={(event) =>
                        setCreateForm((current) => ({ ...current, branch: event.target.value }))
                      }
                      placeholder="feature/worktree-dashboard"
                    />
                  </label>
                  <label className="field-label">
                    Base ref
                    <input
                      value={createForm.baseRef}
                      onChange={(event) =>
                        setCreateForm((current) => ({ ...current, baseRef: event.target.value }))
                      }
                      placeholder="main"
                    />
                  </label>
                  <label className="field-label">
                    Remote ref
                    <input
                      value={createForm.remoteRef}
                      onChange={(event) =>
                        setCreateForm((current) => ({ ...current, remoteRef: event.target.value }))
                      }
                      placeholder="origin/feature/worktree-dashboard"
                      disabled={createForm.mode !== "remote-branch"}
                    />
                  </label>
                  <label className="field-label full-span">
                    Custom path
                    <input
                      value={createForm.path}
                      onChange={(event) =>
                        setCreateForm((current) => ({ ...current, path: event.target.value }))
                      }
                      placeholder={`${repo.repoRoot}/${repo.mergedConfig.settings.worktreeRoot}/feature-worktree-dashboard`}
                    />
                  </label>
                </div>
                <div className="stack">
                  <span className="field-label">Auto-start launchers after creation</span>
                  <div className="checkbox-grid">
                    {launchers.map((launcher) => (
                      <label key={launcher.id} className="checkbox-row">
                        <input
                          type="checkbox"
                          checked={createForm.autoStartLaunchers.includes(launcher.id)}
                          onChange={(event) =>
                            setCreateForm((current) => ({
                              ...current,
                              autoStartLaunchers: event.target.checked
                                ? [...current.autoStartLaunchers, launcher.id]
                                : current.autoStartLaunchers.filter((item) => item !== launcher.id),
                            }))
                          }
                        />
                        <span>{launcher.name}</span>
                      </label>
                    ))}
                  </div>
                </div>
                <button className="primary-button" onClick={handleCreateWorktree} disabled={isBusy}>
                  Create Worktree
                </button>
              </section>

              <section className="card stack">
                <div className="section-heading">
                  <span>Config Files</span>
                  <button className="primary-button" onClick={handleSaveConfigs} disabled={isBusy}>
                    Save Config
                  </button>
                </div>
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
                    onChange={(event) => setProjectConfigText(event.target.value)}
                    rows={16}
                  />
                </label>
                <label className="field-label">
                  Local override TOML
                  <textarea
                    value={localConfigText}
                    onChange={(event) => setLocalConfigText(event.target.value)}
                    rows={10}
                  />
                </label>
              </section>
            </section>

            <section className="card stack">
              <div className="section-heading">
                <span>Worktrees</span>
                <span className="subtle">{repo.worktrees.length} scanned</span>
              </div>
              <div className="worktree-grid">
                {repo.worktrees.map((worktree) => (
                  <article key={worktree.id} className="worktree-card">
                    <div className="worktree-header">
                      <div>
                        <h3>{worktree.branch ?? "(detached)"}</h3>
                        <p>{worktree.path}</p>
                      </div>
                      <div className="status-strip">
                        <Badge label={worktree.isMain ? "main" : "linked"} tone="neutral" />
                        <Badge label={worktree.dirty ? "dirty" : "clean"} tone={worktree.dirty ? "danger" : "good"} />
                        {worktree.lockedReason && <Badge label="locked" tone="warning" />}
                        {worktree.prunableReason && <Badge label="prunable" tone="warning" />}
                      </div>
                    </div>

                    <div className="meta-grid">
                      <div>
                        <span>HEAD</span>
                        <strong>{worktree.headSha.slice(0, 12)}</strong>
                      </div>
                      <div>
                        <span>Sync</span>
                        <strong>
                          ↑ {worktree.ahead} / ↓ {worktree.behind}
                        </strong>
                      </div>
                      <div>
                        <span>Last launched</span>
                        <strong>{worktree.lastOpenedAt ?? "Never"}</strong>
                      </div>
                    </div>

                    {worktree.warmupPreview.copyCandidates.length > 0 && (
                      <div className="inline-panel">
                        <strong>Warmup copy</strong>
                        <p>{worktree.warmupPreview.copyCandidates.join(", ")}</p>
                      </div>
                    )}

                    {worktree.warmupPreview.ports.length > 0 && (
                      <div className="inline-panel">
                        <strong>Ports</strong>
                        <div className="port-list">
                          {worktree.warmupPreview.ports.map((port) => (
                            <div key={`${worktree.id}-${port.name}`} className="port-chip">
                              <span>{port.name}</span>
                              <code>{port.port}</code>
                              {port.url && <small>{port.url}</small>}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    <div className="launcher-row">
                      <button className="ghost-button" onClick={() => void handleStart(worktree)} disabled={isBusy}>
                        Run post-start
                      </button>
                      {launchers.map((launcher) => {
                        const tool = findTool(repo, launcher.id);
                        return (
                          <button
                            key={`${worktree.id}-${launcher.id}`}
                            className="ghost-button"
                            onClick={() => void handleLaunch(worktree, launcher)}
                            disabled={isBusy || !tool?.available}
                            title={tool?.available ? launcher.appOrCmd : `${launcher.name} not detected`}
                          >
                            {launcher.name}
                          </button>
                        );
                      })}
                    </div>

                    <div className="danger-row">
                      <button
                        className="ghost-button"
                        onClick={() => void handleRemove(worktree, false)}
                        disabled={isBusy || worktree.isMain}
                      >
                        Remove
                      </button>
                      <button
                        className="danger-button"
                        onClick={() => void handleRemove(worktree, true)}
                        disabled={isBusy || worktree.isMain}
                      >
                        Force Remove
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          </>
        )}
      </main>

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
    </div>
  );
}

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
