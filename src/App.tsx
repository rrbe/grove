import { open } from "@tauri-apps/plugin-dialog";
import { openUrl, revealItemInDir } from "@tauri-apps/plugin-opener";
import { useEffect, useRef, useState } from "react";
import groveMark from "./assets/grove-mark.svg";
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
  CommitSummary,
  CreateMode,
  CreateWorktreeInput,
  HookStep,
  LauncherProfile,
  RepoSnapshot,
  RunLog,
  ToolStatus,
  WorktreeRecord,
} from "./lib/types";

type TaggedLog = RunLog & { repoRoot?: string };

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

const copySvg = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  </svg>
);

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
  const [logs, setLogs] = useState<TaggedLog[]>([]);
  const [prunePreview, setPrunePreview] = useState<string[]>([]);
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingApprovals, setPendingApprovals] = useState<ApprovalRequest[]>([]);
  const pendingReplay = useRef<(() => Promise<void>) | null>(null);

  const [selectedWorktreeId, setSelectedWorktreeId] = useState<string | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [showHooksModal, setShowHooksModal] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [view, setView] = useState<"detail" | "settings">("detail");
  const [showActionLog, setShowActionLog] = useState(false);

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

  // Cmd+, toggles settings
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.metaKey && e.key === ",") {
        e.preventDefault();
        setView((v) => (v === "settings" ? "detail" : "settings"));
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
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
      appendLogs([{ level: "success", message: t.logLoaded(snapshot.repoRoot) }], snapshot.repoRoot);
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

  function appendLogs(nextLogs: RunLog[], repoRoot?: string) {
    if (nextLogs.length === 0) return;
    const root = repoRoot ?? repo?.repoRoot;
    const tagged: TaggedLog[] = nextLogs.map((log) => ({ ...log, repoRoot: root }));
    setLogs((current) => [...tagged, ...current].slice(0, 120));
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
          <img className="brand-mark" src={groveMark} alt="" aria-hidden="true" />
          <h1>{t.brandName}</h1>
          <LanguageSwitcher locale={locale} setLocale={setLocale} />
        </div>

        {/* Repo Picker */}
        <div className="repo-picker">
          <input
            value={repoInput}
            onChange={(e) => setRepoInput(e.target.value)}
            placeholder={t.repoPlaceholder}
            onKeyDown={(e) => e.key === "Enter" && void loadRepo(repoInput)}
            className="repo-picker-input"
          />
          <div className="repo-picker-actions">
            <button className="primary-button" onClick={browseForRepo} disabled={isBusy}>
              {t.chooseRepo}
            </button>
          </div>
          {bootstrapState.recentRepos.length > 0 && (
            <RecentRepos
              repos={bootstrapState.recentRepos}
              isBusy={isBusy}
              t={t}
              onSelect={(item) => void loadRepo(item)}
            />
          )}
          {repo && (
            <div className="repo-info-line">
              {t.worktreeCount(repo.worktrees.length)} · {t.baseBranch}{" "}
              <code>{repo.mergedConfig.settings.defaultBaseBranch}</code>
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
                  setView("detail");
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

        {/* Bottom buttons */}
        <div className="sidebar-bottom">
          <button
            className="primary-button sidebar-bottom-btn"
            onClick={() => {
              setCreateForm(createInitialForm(repo ?? undefined));
              setShowCreateModal(true);
            }}
            disabled={!repo || isBusy}
          >
            + {t.newWorktree}
          </button>
          {hooks.length > 0 && (
            <button className="ghost-button sidebar-bottom-btn" onClick={() => setShowHooksModal(true)}>
              🪝 {t.hooks} ({hooks.length})
            </button>
          )}
          <div className="sidebar-bottom-settings">
            <button
              className="settings-icon-button"
              onClick={() => setView((v) => (v === "settings" ? "detail" : "settings"))}
              title={`${t.settings} ⌘,`}
            >
              ⚙
            </button>
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

      {/* Main Panel */}
      <main className="main">
        {error && <div className="error-banner">{error}</div>}

        {view === "settings" ? (
          <SettingsPage
            toolStatuses={repo?.toolStatuses ?? bootstrapState.toolStatuses}
            logs={logs}
            onClearLogs={() => setLogs([])}
            repo={repo}
            projectConfigText={projectConfigText}
            localConfigText={localConfigText}
            onProjectConfigChange={setProjectConfigText}
            onLocalConfigChange={setLocalConfigText}
            onSaveConfigs={() => void handleSaveConfigs()}
            prunePreview={prunePreview}
            onPreviewPrune={() => void handlePreviewPrune()}
            onPrune={() => void handlePrune()}
            onRunPostScan={() => void handleRunPostScan()}
            isBusy={isBusy}
            t={t}
          />
        ) : (
          <>
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
                showActionLog={showActionLog}
                onToggleActionLog={() => setShowActionLog((v) => !v)}
                logs={logs.filter((l) => l.repoRoot === repo.repoRoot)}
                onClearLogs={() => setLogs([])}
              />
            )}
          </>
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

      {/* Create Worktree Modal */}
      {showCreateModal && repo && (
        <CreateWorktreeModal
          repo={repo}
          form={createForm}
          onFormChange={setCreateForm}
          onCreate={() => {
            void handleCreateWorktree();
            setShowCreateModal(false);
          }}
          onClose={() => setShowCreateModal(false)}
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

/* ─── RecentRepos ─── */

function RecentRepos({
  repos,
  isBusy,
  t,
  onSelect,
}: {
  repos: string[];
  isBusy: boolean;
  t: Translations;
  onSelect: (repo: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="recent-repos">
      <button className="recent-repos-toggle" onClick={() => setOpen((v) => !v)}>
        <span>{t.recentRepos}</span>
        <span className="subtle">{open ? "▾" : "▸"}</span>
      </button>
      {open && (
        <div className="pill-list">
          {repos.map((item) => (
            <button
              key={item}
              className="pill"
              onClick={() => onSelect(item)}
              disabled={isBusy}
            >
              {item.split("/").pop()}
            </button>
          ))}
        </div>
      )}
    </div>
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
            <span className="worktree-list-item-time">{relativeTime(worktree.headCommitDate, t)}</span>
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
  showActionLog,
  onToggleActionLog,
  logs,
  onClearLogs,
}: {
  repo: RepoSnapshot;
  worktree: WorktreeRecord;
  launchers: LauncherProfile[];
  isBusy: boolean;
  t: Translations;
  onStart: () => void;
  onLaunch: (launcher: LauncherProfile) => void;
  showActionLog: boolean;
  onToggleActionLog: () => void;
  logs: TaggedLog[];
  onClearLogs: () => void;
}) {
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const copyToClipboard = (text: string, field: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedField(field);
      setTimeout(() => setCopiedField(null), 1500);
    });
  };

  return (
    <>
      {/* Worktree Header */}
      <section className="card detail-card">
        <div className="detail-field">
          <span className="detail-field-label">{t.branchLabel}</span>
          <h2 className="detail-branch">{worktree.branch ?? t.detached}</h2>
          {worktree.branch && (
            <button
              className={`copy-btn${copiedField === "branch" ? " copied" : ""}`}
              onClick={() => copyToClipboard(worktree.branch!, "branch")}
              title={t.branchLabel}
            >
              {copiedField === "branch" ? t.copied : copySvg}
            </button>
          )}
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
        <div className="detail-field">
          <span className="detail-field-label">{t.directoryLabel}</span>
          <span className="detail-field-value mono">{worktree.path}</span>
          <button
            className={`copy-btn${copiedField === "path" ? " copied" : ""}`}
            onClick={() => copyToClipboard(worktree.path, "path")}
            title={t.directoryLabel}
          >
            {copiedField === "path" ? t.copied : copySvg}
          </button>
        </div>

        <div className="detail-meta-grid">
          <div className="detail-meta-cell">
            <span className="detail-meta-label">{t.head}</span>
            <strong>{worktree.headSha.slice(0, 12)}</strong>
          </div>
          <div className="detail-meta-cell">
            <span className="detail-meta-label">{t.sync}</span>
            <strong>↑{worktree.ahead} ↓{worktree.behind}</strong>
          </div>
          {worktree.headCommitDate && (
            <div className="detail-meta-cell">
              <span className="detail-meta-label">{t.lastCommit}</span>
              <strong>{relativeTime(worktree.headCommitDate, t)}</strong>
            </div>
          )}
          {worktree.lastOpenedAt && (
            <div className="detail-meta-cell">
              <span className="detail-meta-label">{t.lastLaunched}</span>
              <strong>{relativeTime(worktree.lastOpenedAt, t)}</strong>
            </div>
          )}
          {worktree.prNumber && worktree.prUrl && (
            <div className="detail-meta-cell">
              <span className="detail-meta-label">{t.pullRequest}</span>
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

      {/* Recent Commits */}
      {worktree.recentCommits.length > 0 && (
        <section className="card stack">
          <div className="section-heading">
            <span>{t.recentCommits}</span>
          </div>
          <div className="commit-list">
            {worktree.recentCommits.map((commit) => (
              <CommitRow key={commit.sha} commit={commit} t={t} />
            ))}
          </div>
        </section>
      )}

      {/* Action Buttons */}
      <section className="card stack">
        <div className="section-heading">
          <span>{t.launchers}</span>
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

      {/* Action Log (collapsible) */}
      <section className="card">
        <div className="collapsible-header" onClick={onToggleActionLog}>
          <span className="section-heading" style={{ flex: 1 }}>
            {t.logs}
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
              {logs.length === 0 && <p className="empty-copy">{t.noLogsYet}</p>}
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

    </>
  );
}

/* ─── SettingsPage ─── */

function SettingsPage({
  toolStatuses,
  logs,
  onClearLogs,
  repo,
  projectConfigText,
  localConfigText,
  onProjectConfigChange,
  onLocalConfigChange,
  onSaveConfigs,
  prunePreview,
  onPreviewPrune,
  onPrune,
  onRunPostScan,
  isBusy,
  t,
}: {
  toolStatuses: ToolStatus[];
  logs: TaggedLog[];
  onClearLogs: () => void;
  repo: RepoSnapshot | null;
  projectConfigText: string;
  localConfigText: string;
  onProjectConfigChange: (v: string) => void;
  onLocalConfigChange: (v: string) => void;
  onSaveConfigs: () => void;
  prunePreview: string[];
  onPreviewPrune: () => void;
  onPrune: () => void;
  onRunPostScan: () => void;
  isBusy: boolean;
  t: Translations;
}) {
  const [showConfigEditor, setShowConfigEditor] = useState(false);

  return (
    <>
      {/* Maintenance */}
      {repo && (
        <section className="card stack">
          <div className="section-heading">
            <span>{t.prune}</span>
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
      )}

      {/* Tooling — always expanded */}
      <section className="card stack">
        <div className="section-heading">
          <span>{t.tooling}</span>
        </div>
        <div className="tool-list">
          {toolStatuses.map((tool) => (
            <ToolRow key={tool.id} tool={tool} t={t} />
          ))}
        </div>
      </section>

      {/* All Logs — always expanded */}
      <section className="card stack">
        <div className="section-heading">
          <span>{t.allLogs}</span>
          {logs.length > 0 && <span className="subtle">{logs.length}</span>}
          <button
            className="ghost-button"
            onClick={onClearLogs}
            style={{ fontSize: "0.78rem", padding: "4px 10px", marginLeft: "auto" }}
          >
            {t.clear}
          </button>
        </div>
        <div className="log-list">
          {logs.length === 0 && <p className="empty-copy">{t.noLogsYet}</p>}
          {logs.map((log, i) => {
            const repoShort = log.repoRoot?.split("/").pop() ?? "";
            return (
              <div key={`${log.message}-${i}`} className={`log-item log-${log.level}`}>
                <strong>
                  {repoShort && `[${repoShort}] `}{log.level}
                </strong>
                <span>{log.message}</span>
              </div>
            );
          })}
        </div>
      </section>

      {/* Config Files — collapsible, disabled */}
      <section className="card" style={{ opacity: 0.6 }}>
        <div className="collapsible-header" onClick={() => setShowConfigEditor((v) => !v)}>
          <span className="section-heading" style={{ flex: 1 }}>
            {t.configFiles} <span className="subtle">({t.comingSoon})</span>
          </span>
          <span className="subtle">{showConfigEditor ? "▾" : "▸"}</span>
        </div>
        {showConfigEditor && repo && (
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
                disabled
              />
            </label>
            <label className="field-label">
              {t.localOverrideToml}
              <textarea
                value={localConfigText}
                onChange={(e) => onLocalConfigChange(e.target.value)}
                rows={8}
                disabled
              />
            </label>
            <button className="primary-button" onClick={onSaveConfigs} disabled>
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

/* ─── CreateWorktreeModal ─── */

function sanitizeBranch(branch: string): string {
  return branch
    .split("")
    .map((ch) => (/[a-zA-Z0-9\-_]/.test(ch) ? ch : "-"))
    .join("");
}

function CreateWorktreeModal({
  repo,
  form,
  onFormChange,
  onCreate,
  onClose,
  isBusy,
  t,
}: {
  repo: RepoSnapshot;
  form: CreateFormState;
  onFormChange: (fn: (prev: CreateFormState) => CreateFormState) => void;
  onCreate: () => void;
  onClose: () => void;
  isBusy: boolean;
  t: Translations;
}) {
  const pathPreview = form.branch.trim()
    ? `${repo.repoRoot}/${repo.mergedConfig.settings.worktreeRoot}/${sanitizeBranch(form.branch.trim())}`
    : null;

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="create-modal-panel" onClick={(e) => e.stopPropagation()}>
        <div className="section-heading">
          <span>{t.createWorktree}</span>
          <button className="ghost-button" onClick={onClose} style={{ fontSize: "0.78rem", padding: "4px 10px" }}>
            {t.close}
          </button>
        </div>

        <div className="stack" style={{ gap: 14, marginTop: 16 }}>
          <label className="field-label">
            {t.branchPlaceholder}
            <input
              autoFocus
              value={form.branch}
              onChange={(e) => onFormChange((c) => ({ ...c, branch: e.target.value }))}
              placeholder={t.branchPlaceholder}
              onKeyDown={(e) => {
                if (e.key === "Enter" && form.branch.trim()) onCreate();
              }}
            />
          </label>

          <label className="field-label">
            {t.mode}
            <select
              value={form.mode}
              onChange={(e) =>
                onFormChange((c) => ({ ...c, mode: e.target.value as CreateMode }))
              }
            >
              <option value="new-branch">{t.modeNewBranch}</option>
              <option value="existing-branch">{t.modeExistingBranch}</option>
              <option value="remote-branch">{t.modeRemoteBranch}</option>
            </select>
          </label>

          {form.mode === "new-branch" && (
            <label className="field-label">
              {t.baseRef}
              <input
                value={form.baseRef}
                onChange={(e) => onFormChange((c) => ({ ...c, baseRef: e.target.value }))}
                placeholder="main"
              />
            </label>
          )}

          {form.mode === "remote-branch" && (
            <label className="field-label">
              {t.remoteRef}
              <input
                value={form.remoteRef}
                onChange={(e) => onFormChange((c) => ({ ...c, remoteRef: e.target.value }))}
                placeholder={t.remoteRefPlaceholder}
              />
            </label>
          )}

          {pathPreview && !form.path.trim() && (
            <div className="field-label">
              {t.pathPreview}
              <div className="path-preview">{pathPreview}</div>
            </div>
          )}

          <label className="field-label">
            {t.customPath}
            <input
              value={form.path}
              onChange={(e) => onFormChange((c) => ({ ...c, path: e.target.value }))}
              placeholder={t.optional}
            />
          </label>
        </div>

        <div className="modal-actions">
          <button className="ghost-button" onClick={onClose}>
            {t.cancel}
          </button>
          <button
            className="primary-button"
            onClick={onCreate}
            disabled={isBusy || !form.branch.trim()}
          >
            {t.createWorktree}
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

function CommitRow({ commit, t }: { commit: CommitSummary; t: Translations }) {
  return (
    <div className="commit-row">
      <code className="commit-sha">{commit.sha.slice(0, 8)}</code>
      <span className="commit-message">{commit.message}</span>
      {commit.author && <span className="commit-author">@{commit.author}</span>}
      <span className="commit-date">{relativeTime(commit.date, t)}</span>
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
