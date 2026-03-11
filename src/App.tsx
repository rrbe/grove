import { open } from "@tauri-apps/plugin-dialog";
import { openUrl, revealItemInDir } from "@tauri-apps/plugin-opener";
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
import { useI18n, type Locale, type Translations } from "./lib/i18n";
import type {
  ActionResponse,
  ApprovalRequest,
  BootstrapResponse,
  CreateMode,
  CreateWorktreeInput,
  HookStep,
  LauncherProfile,
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

function relativeTime(iso: string, t: Translations): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return t.justNow;
  if (mins < 60) return t.minutesAgo(mins);
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return t.hoursAgo(hrs);
  const days = Math.floor(hrs / 24);
  return t.daysAgo(days);
}

export default function App() {
  const { t, locale, setLocale } = useI18n();

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

  const [sidebarWidth, setSidebarWidth] = useState(320);
  const isDragging = useRef(false);

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!isDragging.current) return;
      const clamped = Math.min(500, Math.max(220, e.clientX));
      setSidebarWidth(clamped);
    };
    const onMouseUp = () => {
      isDragging.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, []);

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
      appendLogs([{ level: "success", message: t.logLoaded(snapshot.repoRoot) }]);
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
      title: t.chooseRepo,
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
      appendLogs([{ level: "success", message: t.logSavedConfig }]);
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
              ? t.logPruneCandidates(preview.length)
              : t.logNoPruneCandidates,
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
    <div className="shell" style={{ gridTemplateColumns: `${sidebarWidth}px minmax(0, 1fr)` }}>
      {/* Sidebar */}
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-badge">G</div>
          <h1>{t.brandName}</h1>
          <LanguageSwitcher locale={locale} setLocale={setLocale} />
        </div>

        {/* Repo Picker */}
        <div className="repo-picker">
          <div className="repo-picker-row">
            <input
              value={repoInput}
              onChange={(e) => setRepoInput(e.target.value)}
              placeholder={t.repoPlaceholder}
              onKeyDown={(e) => e.key === "Enter" && void loadRepo(repoInput)}
            />
            <button className="ghost-button" onClick={browseForRepo} disabled={isBusy}>
              {t.browse}
            </button>
            <button className="primary-button" onClick={() => void loadRepo(repoInput)} disabled={isBusy}>
              {isBusy ? t.loading : t.load}
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
                <span>{t.deleteConfirm(wt.branch ?? "worktree")}</span>
                <button className="ghost-button" onClick={() => setDeleteConfirmId(null)}>
                  {t.cancel}
                </button>
                <button
                  className="danger-button"
                  onClick={() => void handleRemove(wt, wt.dirty || !!wt.lockedReason)}
                >
                  {wt.dirty || wt.lockedReason ? t.force : t.delete}
                </button>
              </div>
            ) : (
              <WorktreeListItem
                key={wt.id}
                worktree={wt}
                active={wt.id === selectedWorktreeId}
                t={t}
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
            <p className="empty-copy">{t.noWorktrees}</p>
          )}
        </div>

        <div className="sidebar-divider" />

        {/* Create Worktree */}
        <div className="sidebar-create">
          <div className="sidebar-create-row">
            <input
              value={createForm.branch}
              onChange={(e) => setCreateForm((c) => ({ ...c, branch: e.target.value }))}
              placeholder={t.branchPlaceholder}
              onKeyDown={(e) => e.key === "Enter" && void handleCreateWorktree()}
            />
            <button
              className="primary-button"
              onClick={() => void handleCreateWorktree()}
              disabled={isBusy || !repo || !createForm.branch.trim()}
            >
              {t.create}
            </button>
          </div>
          <button className="advanced-toggle" onClick={() => setShowAdvancedCreate((v) => !v)}>
            {showAdvancedCreate ? t.hideAdvanced : t.showAdvanced}
          </button>
          {showAdvancedCreate && (
            <div className="stack" style={{ gap: 8 }}>
              <label className="field-label">
                {t.mode}
                <select
                  value={createForm.mode}
                  onChange={(e) =>
                    setCreateForm((c) => ({ ...c, mode: e.target.value as CreateMode }))
                  }
                >
                  <option value="new-branch">{t.modeNewBranch}</option>
                  <option value="existing-branch">{t.modeExistingBranch}</option>
                  <option value="remote-branch">{t.modeRemoteBranch}</option>
                </select>
              </label>
              <label className="field-label">
                {t.baseRef}
                <input
                  value={createForm.baseRef}
                  onChange={(e) => setCreateForm((c) => ({ ...c, baseRef: e.target.value }))}
                  placeholder="main"
                />
              </label>
              {createForm.mode === "remote-branch" && (
                <label className="field-label">
                  {t.remoteRef}
                  <input
                    value={createForm.remoteRef}
                    onChange={(e) => setCreateForm((c) => ({ ...c, remoteRef: e.target.value }))}
                    placeholder={t.remoteRefPlaceholder}
                  />
                </label>
              )}
              <label className="field-label">
                {t.customPath}
                <input
                  value={createForm.path}
                  onChange={(e) => setCreateForm((c) => ({ ...c, path: e.target.value }))}
                  placeholder={t.optional}
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
                {t.hooks} ({hooks.length})
              </button>
            )}
          </div>
        </div>
        <div
          className="sidebar-resize-handle"
          onMouseDown={() => {
            isDragging.current = true;
            document.body.style.cursor = "col-resize";
            document.body.style.userSelect = "none";
          }}
        />
      </aside>

      {/* Detail Panel */}
      <main className="main">
        {error && <div className="error-banner">{error}</div>}

        {!repo && (
          <section className="hero card">
            <h2>{t.heroTitle}</h2>
            <p>{t.heroDescription}</p>
            <ul className="hero-points">
              <li>{t.heroPoint1}</li>
              <li>{t.heroPoint2}</li>
              <li>{t.heroPoint3}</li>
            </ul>
          </section>
        )}

        {repo && !selectedWorktree && (
          <section className="hero card">
            <h2>{t.noWorktreeSelected}</h2>
            <p>{t.selectWorktreeHint}</p>
          </section>
        )}

        {repo && selectedWorktree && (
          <WorktreeDetail
            repo={repo}
            worktree={selectedWorktree}
            launchers={launchers}
            isBusy={isBusy}
            t={t}
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
          t={t}
        />
      )}

      {/* Hooks Modal */}
      {showHooksModal && (
        <HooksModal
          hooks={hooks}
          onRunPostScan={() => void handleRunPostScan()}
          onClose={() => setShowHooksModal(false)}
          isBusy={isBusy}
          t={t}
        />
      )}
    </div>
  );
}

/* ─── LanguageSwitcher ─── */

function LanguageSwitcher({
  locale,
  setLocale,
}: {
  locale: Locale;
  setLocale: (l: Locale) => void;
}) {
  return (
    <button
      className="ghost-button"
      style={{ marginLeft: "auto", fontSize: "0.75rem", padding: "4px 10px" }}
      onClick={() => setLocale(locale === "zh-CN" ? "en" : "zh-CN")}
    >
      {locale === "zh-CN" ? "EN" : "中文"}
    </button>
  );
}

/* ─── WorktreeListItem ─── */

function WorktreeListItem({
  worktree,
  active,
  t,
  onSelect,
  onDelete,
}: {
  worktree: WorktreeRecord;
  active: boolean;
  t: Translations;
  onSelect: () => void;
  onDelete: () => void;
}) {
  const dirName = worktree.path.split("/").pop() ?? worktree.path;
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [menuOpen]);

  return (
    <div
      className={`worktree-list-item ${active ? "active" : ""}`}
      onClick={onSelect}
    >
      <div className="worktree-list-item-info">
        <div className="worktree-list-item-branch" title={worktree.branch ?? t.detachedShort}>
          <span className="worktree-icon">{worktree.isMain ? "🪵" : "🌿"}</span>
          {worktree.branch ?? t.detachedShort}
        </div>
        <div
          className="worktree-list-item-path"
          onClick={(e) => {
            e.stopPropagation();
            void revealItemInDir(worktree.path);
          }}
        >
          <span className="worktree-list-item-path-icon">📂</span>
          <span className="worktree-list-item-path-text">{dirName}</span>
        </div>
        <div className="worktree-list-item-meta">
          {worktree.prNumber && (
            <span
              className={`pr-badge ${worktree.prUrl ? "pr-badge-link" : ""}`}
              onClick={(e) => {
                if (!worktree.prUrl) return;
                e.stopPropagation();
                void openUrl(worktree.prUrl);
              }}
            >
              #{worktree.prNumber}
            </span>
          )}
          {worktree.headCommitDate && (
            <span className="worktree-list-item-time">{t.lastCommit}: {relativeTime(worktree.headCommitDate, t)}</span>
          )}
          {worktree.dirty && <Badge label={t.dirty} tone="danger" />}
        </div>
      </div>
      <div className="worktree-list-item-menu" ref={menuRef}>
        <button
          className="worktree-menu-trigger"
          onClick={(e) => {
            e.stopPropagation();
            setMenuOpen((v) => !v);
          }}
        >
          ⋮
        </button>
        {menuOpen && (
          <div className="worktree-menu-popup">
            <button
              className="worktree-menu-item"
              onClick={(e) => {
                e.stopPropagation();
                void revealItemInDir(worktree.path);
                setMenuOpen(false);
              }}
            >
              {t.openInFinder}
            </button>
            {!worktree.isMain && (
              <button
                className="worktree-menu-item worktree-menu-item-danger"
                onClick={(e) => {
                  e.stopPropagation();
                  setMenuOpen(false);
                  onDelete();
                }}
              >
                {t.delete}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/* ─── WorktreeDetail ─── */

function WorktreeDetail({
  repo,
  worktree,
  launchers,
  isBusy,
  t,
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
  t: Translations;
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
          <h2>{worktree.branch ?? t.detached}</h2>
          <p className="detail-path">{worktree.path}</p>
          <div className="status-strip">
            <Badge label={worktree.isMain ? t.main : t.linked} tone="neutral" />
            <Badge
              label={worktree.dirty ? t.dirty : t.clean}
              tone={worktree.dirty ? "danger" : "good"}
            />
            {worktree.lockedReason && <Badge label={t.locked} tone="warning" />}
            {worktree.prunableReason && <Badge label={t.prunable} tone="warning" />}
          </div>
        </div>

        <div className="detail-meta">
          <div className="detail-meta-item">
            <span>{t.head}</span>
            <strong>{worktree.headSha.slice(0, 12)}</strong>
          </div>
          <div className="detail-meta-item">
            <span>{t.sync}</span>
            <strong>
              ↑{worktree.ahead} ↓{worktree.behind}
            </strong>
          </div>
          {worktree.headCommitDate && (
            <div className="detail-meta-item">
              <span>{t.lastCommit}</span>
              <strong>{relativeTime(worktree.headCommitDate, t)}</strong>
            </div>
          )}
          {worktree.lastOpenedAt && (
            <div className="detail-meta-item">
              <span>{t.lastLaunched}</span>
              <strong>{relativeTime(worktree.lastOpenedAt, t)}</strong>
            </div>
          )}
          {worktree.prNumber && worktree.prUrl && (
            <div className="detail-meta-item">
              <span>{t.pullRequest}</span>
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
          <span>{t.actions}</span>
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
                title={tool?.available ? launcher.appOrCmd : t.notDetectedSuffix(launcher.name)}
              >
                {launcher.name}
              </button>
            );
          })}
          <button className="ghost-button" onClick={onStart} disabled={isBusy}>
            {t.runPostStart}
          </button>
        </div>
      </section>

      {/* Warmup Info */}
      {(worktree.warmupPreview.copyCandidates.length > 0 ||
        worktree.warmupPreview.ports.length > 0) && (
        <section className="card stack">
          <div className="section-heading">
            <span>{t.warmup}</span>
          </div>
          {worktree.warmupPreview.copyCandidates.length > 0 && (
            <div className="inline-panel">
              <strong>{t.copyCandidates}</strong>
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
              {t.worktreeCount(repo.worktrees.length)}, {t.baseBranch}{" "}
              <code>{repo.mergedConfig.settings.defaultBaseBranch}</code>
            </p>
          </div>
          <div className="overview-actions">
            <button className="ghost-button" onClick={onPreviewPrune} disabled={isBusy}>
              {t.previewPrune}
            </button>
            <button className="ghost-button" onClick={onRunPostScan} disabled={isBusy}>
              {t.postScanHooks}
            </button>
            <button className="primary-button" onClick={onPrune} disabled={isBusy}>
              {t.prune}
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
            <h3>{t.prunePreview}</h3>
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
            {t.tooling}
          </span>
          <span className="subtle">{showTooling ? "▾" : "▸"}</span>
        </div>
        {showTooling && (
          <div className="tool-list" style={{ marginTop: 8 }}>
            {toolStatuses.map((tool) => (
              <ToolRow key={tool.id} tool={tool} t={t} />
            ))}
          </div>
        )}
      </section>

      {/* Action Log (collapsible) */}
      <section className="card">
        <div className="collapsible-header" onClick={onToggleActionLog}>
          <span className="section-heading" style={{ flex: 1 }}>
            {t.actionLog}
            {logs.length > 0 && <span className="subtle" style={{ marginLeft: 8 }}>{logs.length}</span>}
          </span>
          <span className="subtle">{showActionLog ? "▾" : "▸"}</span>
        </div>
        {showActionLog && (
          <div style={{ marginTop: 8 }}>
            <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8 }}>
              <button className="ghost-button" onClick={onClearLogs} style={{ fontSize: "0.78rem", padding: "4px 10px" }}>
                {t.clear}
              </button>
            </div>
            <div className="log-list">
              {logs.length === 0 && <p className="empty-copy">{t.noActionsYet}</p>}
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
            {t.configFiles}
          </span>
          <span className="subtle">{showConfigEditor ? "▾" : "▸"}</span>
        </div>
        {showConfigEditor && (
          <div className="stack" style={{ marginTop: 8 }}>
            <div className="path-grid">
              <div>
                <strong>{t.project}</strong>
                <p>{repo.configPaths.projectPath}</p>
              </div>
              <div>
                <strong>{t.local}</strong>
                <p>{repo.configPaths.localPath}</p>
              </div>
            </div>
            <label className="field-label">
              {t.projectConfigToml}
              <textarea
                value={projectConfigText}
                onChange={(e) => onProjectConfigChange(e.target.value)}
                rows={14}
              />
            </label>
            <label className="field-label">
              {t.localOverrideToml}
              <textarea
                value={localConfigText}
                onChange={(e) => onLocalConfigChange(e.target.value)}
                rows={8}
              />
            </label>
            <button className="primary-button" onClick={onSaveConfigs} disabled={isBusy}>
              {t.saveConfig}
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
  t,
}: {
  hooks: HookStep[];
  onRunPostScan: () => void;
  onClose: () => void;
  isBusy: boolean;
  t: Translations;
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
          <span>{t.hooks}</span>
          <button className="ghost-button" onClick={onClose}>
            {t.close}
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
                      label={hook.enabled ? t.enabled : t.disabled}
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
            {t.runPostScan}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─── Shared Components ─── */

function ToolRow({ tool, t }: { tool: ToolStatus; t: Translations }) {
  return (
    <div className="tool-row">
      <div>
        <strong>{tool.label}</strong>
        <p>{tool.location ?? t.notDetected}</p>
      </div>
      <Badge label={tool.available ? t.ready : t.missing} tone={tool.available ? "good" : "warning"} />
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
  t,
}: {
  approvals: ApprovalRequest[];
  onApprove: () => void;
  onCancel: () => void;
  isBusy: boolean;
  t: Translations;
}) {
  return (
    <div className="modal-backdrop">
      <div className="modal-card">
        <div className="section-heading">
          <span>{t.approveProjectCommands}</span>
          <span className="subtle">{t.commandCount(approvals.length)}</span>
        </div>
        <p className="modal-copy">{t.approvalCopy}</p>
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
            {t.cancel}
          </button>
          <button className="primary-button" onClick={onApprove} disabled={isBusy}>
            {t.approveAndRetry}
          </button>
        </div>
      </div>
    </div>
  );
}

function findTool(repo: RepoSnapshot, launcherId: string) {
  return repo.toolStatuses.find((tool) => tool.id === launcherId) ?? null;
}
