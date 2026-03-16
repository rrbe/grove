import { open } from "@tauri-apps/plugin-dialog";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { openUrl, revealItemInDir } from "@tauri-apps/plugin-opener";
import { useEffect, useRef, useState } from "react";
import groveMark from "./assets/grove-mark.svg";
import claudeIcon from "./assets/launcher-icons/claude.svg";
import codexIcon from "./assets/launcher-icons/codex.svg";
import cursorIcon from "./assets/launcher-icons/cursor.svg";
import geminiIcon from "./assets/launcher-icons/gemini.svg";
import ghosttyIcon from "./assets/launcher-icons/ghostty.svg";
import terminalIcon from "./assets/launcher-icons/terminal.svg";
import warpIcon from "./assets/launcher-icons/warp.svg";
import vscodeIcon from "./assets/launcher-icons/vscode.svg";
import {
  bootstrap,
  createRepoWorktree,
  deleteCustomLauncher,
  listInstalledApps,
  disposeExecutionSession,
  getExecutionSessionSnapshot,
  getFileDiff,
  launchRepoWorktree,
  openRepo,
  previewRepoPrune,
  pruneRepoMetadata,
  runRepoHookEvent,
  saveCustomLauncher,
  saveRepoConfig,
  saveRepoHooks,
  startRemoveRepoWorktreeSession,
  getDefaultTerminal,
  setDefaultTerminal,
  setWorktreeRoot,
} from "./lib/api";
import { useI18n, type Locale, type Translations } from "./lib/i18n";
import { HooksModal, type HooksMap } from "./components/HooksModal";
import { CreateWorktreeModal, type CreateFormState } from "./components/CreateWorktreeModal";
import { DeleteExecutionModal, type DeleteExecutionState, type DeleteExecutionPhase } from "./components/DeleteExecutionModal";
import type {
  ActionResponse,
  BootstrapResponse,
  CommitSummary,
  FileChange,
  CreateWorktreeInput,
  ExecutionEvent,
  ExecutionSessionSnapshot,
  HookEvent,
  LauncherKind,
  LauncherProfile,
  RepoSnapshot,
  RunLog,
  SaveCustomLauncherInput,
  ToolStatus,
  WorktreeRecord,
} from "./lib/types";

type TaggedLog = RunLog & { repoRoot?: string };

const TERMINAL_IDS = ["ghostty", "warp", "iterm2", "terminal"];
const HOOK_EVENTS: HookEvent[] = [
  "pre-create",
  "post-create",
  "pre-launch",
  "post-launch",
  "pre-remove",
  "post-remove",
];
const LAUNCHER_ICONS: Record<string, string> = {
  claude: claudeIcon,
  codex: codexIcon,
  cursor: cursorIcon,
  gemini: geminiIcon,
  ghostty: ghosttyIcon,
  terminal: terminalIcon,
  vscode: vscodeIcon,
  warp: warpIcon,
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

function buildDeleteFailureSession(
  repoRoot: string,
  worktree: WorktreeRecord,
  message: string,
): ExecutionSessionSnapshot {
  return {
    sessionId: "",
    title: `Delete ${worktree.branch ?? "worktree"}`,
    repoRoot,
    status: "failed",
    logs: [{ level: "error", message }],
    repo: null,
    error: message,
  };
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
  const [configText, setConfigText] = useState("");
  const [createForm, setCreateForm] = useState<CreateFormState>(createInitialForm());
  const [logs, setLogs] = useState<TaggedLog[]>([]);
  const [prunePreview, setPrunePreview] = useState<string[]>([]);
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [selectedWorktreeId, setSelectedWorktreeId] = useState<string | null>(null);
  const [deleteExecution, setDeleteExecution] = useState<DeleteExecutionState | null>(null);
  const [showHooksModal, setShowHooksModal] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [view, setView] = useState<"detail" | "settings">("detail");
  const [showActionLog, setShowActionLog] = useState(false);
  const [defaultTerminalId, setDefaultTerminalId] = useState("terminal");
  const [customLauncherModal, setCustomLauncherModal] = useState<{ editing: LauncherProfile | null; repoRoot: string | null } | null>(null);

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
        getDefaultTerminal().then(setDefaultTerminalId).catch(() => {});
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
    setConfigText(repo.configText);
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
  }, [repo]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let active = true;
    let unlisten: UnlistenFn | null = null;

    void listen<ExecutionEvent>("execution-event", (event) => {
      const payload = event.payload;
      setDeleteExecution((current) => {
        if (!current?.session || current.session.sessionId !== payload.sessionId) {
          return current;
        }
        const nextSession: ExecutionSessionSnapshot = {
          ...current.session,
          status: payload.status ?? current.session.status,
          repo: payload.repo ?? current.session.repo,
          error: payload.error ?? current.session.error,
          logs: payload.log ? [...current.session.logs, payload.log] : current.session.logs,
        };
        return {
          ...current,
          phase: nextSession.status,
          session: nextSession,
          isLoading: false,
        };
      });
      if (payload.kind === "completed" && payload.repo) {
        setRepo(payload.repo);
        setRepoInput(payload.repo.repoRoot);
      }
    }).then((fn) => {
      if (!active) {
        fn();
        return;
      }
      unlisten = fn;
    });

    return () => {
      active = false;
      if (unlisten) {
        unlisten();
      }
    };
  }, []);

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

  async function runAction(action: () => Promise<ActionResponse>, selectBranch?: string) {
    setError(null);
    setIsBusy(true);
    try {
      const response = await action();
      appendLogs(response.logs);
      if (response.repo) {
        setRepo(response.repo);
        setRepoInput(response.repo.repoRoot);
        if (selectBranch) {
          const match = response.repo.worktrees.find((w) => w.branch === selectBranch);
          if (match) setSelectedWorktreeId(match.id);
        }
      }
    } catch (reason) {
      setError(String(reason));
      appendLogs([{ level: "error", message: String(reason) }]);
    } finally {
      setIsBusy(false);
    }
  }

  function applyDeleteSessionSnapshot(session: ExecutionSessionSnapshot) {
    setDeleteExecution((current) => {
      if (!current) return current;
      if (current.session && current.session.sessionId !== session.sessionId) {
        return current;
      }
      return {
        ...current,
        phase: session.status,
        session,
        isLoading: false,
      };
    });
    if (session.repo) {
      setRepo(session.repo);
      setRepoInput(session.repo.repoRoot);
    }
  }

  async function refreshDeleteExecutionSession(sessionId: string) {
    try {
      const snapshot = await getExecutionSessionSnapshot(sessionId);
      applyDeleteSessionSnapshot(snapshot);
    } catch {
      // Ignore stale or disposed sessions.
    }
  }

  function appendLogs(nextLogs: RunLog[], repoRoot?: string) {
    if (nextLogs.length === 0) return;
    const root = repoRoot ?? repo?.repoRoot;
    const tagged: TaggedLog[] = nextLogs.map((log) => ({ ...log, repoRoot: root }));
    setLogs((current) => [...tagged, ...current].slice(0, 120));
  }

  async function handleSaveConfig() {
    if (!repo) return;
    setIsBusy(true);
    setError(null);
    try {
      const snapshot = await saveRepoConfig({
        repoRoot: repo.repoRoot,
        configText,
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

  async function handleSaveHooks(nextHooks: HooksMap): Promise<boolean> {
    if (!repo) return false;
    setIsBusy(true);
    setError(null);
    try {
      const snapshot = await saveRepoHooks({
        repoRoot: repo.repoRoot,
        configText,
        hooks: nextHooks,
      });
      setRepo(snapshot);
      appendLogs([{ level: "success", message: t.logSavedHooks }], snapshot.repoRoot);
      return true;
    } catch (reason) {
      setError(String(reason));
      appendLogs([{ level: "error", message: String(reason) }]);
      return false;
    } finally {
      setIsBusy(false);
    }
  }

  function handleOpenHooksModal() {
    if (!repo) return;
    setShowHooksModal(true);
  }

  async function handleCreateWorktree() {
    if (!repo || !createForm.branch.trim()) return;
    const branch = createForm.branch.trim();
    const input: CreateWorktreeInput = {
      repoRoot: repo.repoRoot,
      mode: createForm.mode,
      branch,
      baseRef: createForm.baseRef.trim() || null,
      remoteRef: createForm.remoteRef.trim() || null,
      path: createForm.path.trim() || null,
      autoStartLaunchers: createForm.autoStartLaunchers,
    };
    await runAction(() => createRepoWorktree(input), branch);
    setCreateForm(createInitialForm(repo));
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

  function handleRemove(worktree: WorktreeRecord, force: boolean) {
    setDeleteExecution({
      worktree,
      force,
      phase: "confirm",
      session: null,
      isLoading: false,
    });
  }

  function handleCloseDeleteExecution() {
    const session = deleteExecution?.session;
    if (session?.logs.length) {
      appendLogs(session.logs, session.repoRoot);
    }
    setDeleteExecution(null);
    if (session?.sessionId) {
      void disposeExecutionSession(session.sessionId).catch(() => {});
    }
  }

  async function confirmDeleteExecution() {
    if (!repo || !deleteExecution) return;
    setError(null);
    setDeleteExecution((current) =>
      current
        ? {
            ...current,
            isLoading: true,
          }
        : current,
    );
    try {
      const session = await startRemoveRepoWorktreeSession({
        repoRoot: repo.repoRoot,
        worktreePath: deleteExecution.worktree.path,
        force: deleteExecution.force,
      });
      applyDeleteSessionSnapshot(session);
      if (session.sessionId) {
        void refreshDeleteExecutionSession(session.sessionId);
      }
    } catch (reason) {
      const message = String(reason);
      setDeleteExecution((current) =>
        current
          ? {
              ...current,
              phase: "failed",
              session: buildDeleteFailureSession(repo.repoRoot, current.worktree, message),
              isLoading: false,
            }
          : current,
      );
    }
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

  async function handleSetDefaultTerminal(terminalId: string) {
    setDefaultTerminalId(terminalId);
    await setDefaultTerminal(terminalId);
  }

  async function handlePrune() {
    if (!repo) return;
    await runAction(() => pruneRepoMetadata(repo.repoRoot));
    setPrunePreview([]);
  }

  async function handleSaveCustomLauncher(input: SaveCustomLauncherInput) {
    setIsBusy(true);
    setError(null);
    try {
      const snapshot = await saveCustomLauncher(input);
      setRepo(snapshot);
      setCustomLauncherModal(null);
    } catch (reason) {
      setError(String(reason));
    } finally {
      setIsBusy(false);
    }
  }

  async function handleDeleteCustomLauncher(launcherId: string, repoRoot: string | null) {
    setIsBusy(true);
    setError(null);
    try {
      const snapshot = await deleteCustomLauncher({ launcherId, repoRoot });
      setRepo(snapshot);
    } catch (reason) {
      setError(String(reason));
    } finally {
      setIsBusy(false);
    }
  }

  const launchers = repo?.mergedConfig.launchers ?? [];
  const hooksMap: HooksMap = repo?.mergedConfig.hooks ?? {};
  const hookCount = Object.keys(hooksMap).filter((e) => (hooksMap[e as HookEvent]?.length ?? 0) > 0).length;

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
          {repo?.worktrees.map((wt) => (
            <WorktreeListItem
              key={wt.id}
              worktree={wt}
              active={wt.id === selectedWorktreeId}
              t={t}
              onSelect={() => {
                setSelectedWorktreeId(wt.id);
                setView("detail");
              }}
              onDelete={() => {
                if (wt.isMain) return;
                handleRemove(wt, wt.dirty || !!wt.lockedReason);
              }}
            />
          ))}
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
          {repo && (
            <button className="ghost-button sidebar-bottom-btn" onClick={handleOpenHooksModal}>
              🪝 {t.hooks} {hookCount > 0 ? `(${hookCount})` : ""}
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
            configText={configText}
            onConfigChange={setConfigText}
            onSaveConfig={() => void handleSaveConfig()}
            prunePreview={prunePreview}
            onPreviewPrune={() => void handlePreviewPrune()}
            onPrune={() => void handlePrune()}
            isBusy={isBusy}
            t={t}
            defaultTerminal={defaultTerminalId}
            onSetDefaultTerminal={(id) => void handleSetDefaultTerminal(id)}
            onRepoUpdate={setRepo}
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
                onLaunch={(launcher) => void handleLaunch(selectedWorktree, launcher)}
                onRunHook={(event) => void runAction(() => runRepoHookEvent({ repoRoot: repo.repoRoot, event, worktreePath: selectedWorktree.path }))}
                showActionLog={showActionLog}
                onToggleActionLog={() => setShowActionLog((v) => !v)}
                logs={logs.filter((l) => l.repoRoot === repo.repoRoot)}
                onClearLogs={() => setLogs([])}
                defaultTerminal={defaultTerminalId}
                onSetDefaultTerminal={(id) => void handleSetDefaultTerminal(id)}
                onAddCustomLauncher={() => setCustomLauncherModal({ editing: null, repoRoot: repo.repoRoot })}
                onEditCustomLauncher={(launcher) => setCustomLauncherModal({ editing: launcher, repoRoot: repo.repoRoot })}
                onDeleteCustomLauncher={(launcher) => {
                  if (confirm(t.confirmDeleteLauncher(launcher.name))) {
                    void handleDeleteCustomLauncher(launcher.id, repo.repoRoot);
                  }
                }}
              />
            )}
          </>
        )}
      </main>

      {deleteExecution && (
        <DeleteExecutionModal
          execution={deleteExecution}
          t={t}
          onClose={handleCloseDeleteExecution}
          onConfirm={() => void confirmDeleteExecution()}
        />
      )}

      {/* Hooks Modal */}
      {showHooksModal && (
        <HooksModal
          hooks={hooksMap}
          launchers={launchers}
          repoRoot={repo!.repoRoot}
          onSave={async (nextHooks) => {
            const ok = await handleSaveHooks(nextHooks);
            if (ok) setShowHooksModal(false);
            return ok;
          }}
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
          onGoToSettings={() => { setShowCreateModal(false); setView("settings"); }}
          isBusy={isBusy}
          t={t}
        />
      )}

      {/* Custom Launcher Modal */}
      {customLauncherModal && repo && (
        <CustomLauncherModal
          editing={customLauncherModal.editing}
          repoRoot={customLauncherModal.repoRoot}
          onSave={(input) => void handleSaveCustomLauncher(input)}
          onClose={() => setCustomLauncherModal(null)}
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
  onLaunch,
  onRunHook,
  showActionLog,
  onToggleActionLog,
  logs,
  onClearLogs,
  defaultTerminal,
  onSetDefaultTerminal,
  onAddCustomLauncher,
  onEditCustomLauncher,
  onDeleteCustomLauncher,
}: {
  repo: RepoSnapshot;
  worktree: WorktreeRecord;
  launchers: LauncherProfile[];
  isBusy: boolean;
  t: Translations;
  onLaunch: (launcher: LauncherProfile) => void;
  onRunHook: (event: HookEvent) => void;
  showActionLog: boolean;
  onToggleActionLog: () => void;
  logs: TaggedLog[];
  onClearLogs: () => void;
  defaultTerminal: string;
  onSetDefaultTerminal: (id: string) => void;
  onAddCustomLauncher: () => void;
  onEditCustomLauncher: (launcher: LauncherProfile) => void;
  onDeleteCustomLauncher: (launcher: LauncherProfile) => void;
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

      {/* Changed Files */}
      {worktree.changedFiles.length > 0 && (
        <ChangedFilesSection worktree={worktree} t={t} />
      )}

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
          <label className="terminal-select-inline">
            <span className="terminal-select-label">{t.defaultTerminalLabel}:</span>
            <select
              value={defaultTerminal}
              onChange={(e) => onSetDefaultTerminal(e.target.value)}
            >
              {TERMINAL_IDS.map((tid) => {
                const tool = repo.toolStatuses.find((ts) => ts.id === tid);
                return (
                  <option key={tid} value={tid} disabled={!tool?.available}>
                    {tool?.label ?? tid}{!tool?.available ? ` (${t.notDetected})` : ""}
                  </option>
                );
              })}
            </select>
          </label>
        </div>
        <div className="action-grid">
          {launchers.map((launcher) => {
            const tool = findTool(repo, launcher.id);
            const isCustom = launcher.isCustom;
            const isAvailable = isCustom ? true : tool?.available;
            const isCliLauncher = launcher.kind === "terminal-cli";
            const terminalTool = isCliLauncher
              ? repo.toolStatuses.find((ts) => ts.id === defaultTerminal)
              : null;
            return (
              <div key={launcher.id} className={`launcher-btn-wrapper${isCustom ? " launcher-btn-custom" : ""}`}>
                <button
                  className="ghost-button"
                  onClick={() => onLaunch(launcher)}
                  disabled={isBusy || !isAvailable}
                  title={isAvailable ? launcher.appOrCmd : t.notDetectedSuffix(launcher.name)}
                >
                  <span className="launcher-button-content">
                    <LauncherIcon launcherId={launcher.id} label={launcher.name} iconChar={isCustom ? launcher.iconChar : null} />
                    <span className="launcher-copy">
                      <span>{launcher.name}</span>
                      {isCliLauncher && terminalTool && (
                        <span className="launcher-terminal-hint">({terminalTool.label})</span>
                      )}
                    </span>
                  </span>
                </button>
                {isCustom && (
                  <span className="custom-launcher-actions">
                    <button className="custom-launcher-action-btn" title={t.editLauncher} onClick={() => onEditCustomLauncher(launcher)}>✎</button>
                    <button className="custom-launcher-action-btn" title={t.deleteLauncher} onClick={() => onDeleteCustomLauncher(launcher)}>✕</button>
                  </span>
                )}
              </div>
            );
          })}
          <button
            className="ghost-button add-custom-launcher-btn"
            onClick={onAddCustomLauncher}
            disabled={isBusy}
            title={t.addCustomLauncher}
          >
            <span className="launcher-button-content">
              <span className="launcher-icon-shell launcher-icon-add" aria-hidden="true">
                <span className="launcher-icon-fallback">+</span>
              </span>
              <span className="launcher-copy">
                <span>{t.addCustomLauncher}</span>
              </span>
            </span>
          </button>
        </div>
      </section>

      {/* Re-run Hooks */}
      {(() => {
        const configuredEvents = HOOK_EVENTS.filter((e) => (repo.mergedConfig.hooks[e]?.length ?? 0) > 0);
        if (configuredEvents.length === 0) return null;
        return (
          <section className="card stack">
            <div className="section-heading">
              <span>{t.reRunHooks}</span>
            </div>
            <div className="action-grid">
              {configuredEvents.map((event) => {
                const stepCount = repo.mergedConfig.hooks[event]?.length ?? 0;
                return (
                  <button
                    key={event}
                    className="ghost-button"
                    onClick={() => onRunHook(event)}
                    disabled={isBusy}
                    title={`${event} (${stepCount} ${stepCount === 1 ? "step" : "steps"})`}
                  >
                    <span className="launcher-button-content">
                      <span className="hook-event-icon">&#x21BB;</span>
                      <span className="launcher-copy">
                        <span>{event}</span>
                        <span className="launcher-terminal-hint">{stepCount} {stepCount === 1 ? "step" : "steps"}</span>
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          </section>
        );
      })()}

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
  configText,
  onConfigChange,
  onSaveConfig,
  prunePreview,
  onPreviewPrune,
  onPrune,
  isBusy,
  t,
  defaultTerminal,
  onSetDefaultTerminal,
  onRepoUpdate,
}: {
  toolStatuses: ToolStatus[];
  logs: TaggedLog[];
  onClearLogs: () => void;
  repo: RepoSnapshot | null;
  configText: string;
  onConfigChange: (v: string) => void;
  onSaveConfig: () => void;
  prunePreview: string[];
  onPreviewPrune: () => void;
  onPrune: () => void;
  isBusy: boolean;
  t: Translations;
  defaultTerminal: string;
  onSetDefaultTerminal: (id: string) => void;
  onRepoUpdate: (repo: RepoSnapshot) => void;
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

      {/* Default Terminal */}
      <section className="card stack">
        <div className="section-heading">
          <span>{t.defaultTerminalLabel}</span>
        </div>
        <p className="empty-copy" style={{ marginBottom: 8 }}>{t.defaultTerminalDescription}</p>
        <select
          className="ghost-button"
          style={{ textAlign: "left", padding: "6px 10px" }}
          value={defaultTerminal}
          onChange={(e) => onSetDefaultTerminal(e.target.value)}
          disabled={isBusy}
        >
          {TERMINAL_IDS.map((tid) => {
            const tool = toolStatuses.find((ts) => ts.id === tid);
            return (
              <option key={tid} value={tid} disabled={!tool?.available}>
                {tool?.label ?? tid}{!tool?.available ? ` (${t.notDetected})` : ""}
              </option>
            );
          })}
        </select>
      </section>

      {/* Worktree Directory */}
      {repo && (
        <section className="card stack">
          <div className="section-heading">
            <span>{t.worktreeRootLabel}</span>
          </div>
          <input
            className="ghost-button"
            style={{ textAlign: "left", padding: "6px 10px" }}
            value={repo.mergedConfig.settings.worktreeRoot}
            onChange={(e) => {
              const newRoot = e.target.value;
              onRepoUpdate({ ...repo, mergedConfig: { ...repo.mergedConfig, settings: { ...repo.mergedConfig.settings, worktreeRoot: newRoot } } });
            }}
            onBlur={() => {
              setWorktreeRoot(repo.repoRoot, repo.mergedConfig.settings.worktreeRoot).then(onRepoUpdate).catch(() => {});
            }}
            disabled={isBusy}
          />
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

      {/* Local Repo Config */}
      <section className="card">
        <div className="collapsible-header" onClick={() => setShowConfigEditor((v) => !v)}>
          <span className="section-heading" style={{ flex: 1 }}>
            {t.configFiles}
          </span>
          <span className="subtle">{showConfigEditor ? "▾" : "▸"}</span>
        </div>
        {showConfigEditor && repo && (
          <div className="stack" style={{ marginTop: 8 }}>
            <p className="empty-copy">{t.localConfigDescription}</p>
            <label className="field-label">
              {t.projectConfigToml}
              <textarea
                value={configText}
                onChange={(e) => onConfigChange(e.target.value)}
                rows={14}
              />
            </label>
            <button className="primary-button" onClick={onSaveConfig} disabled={isBusy}>
              {t.saveConfig}
            </button>
          </div>
        )}
      </section>
    </>
  );
}

/* ─── Shared Components ─── */

function ToolRow({ tool, t }: { tool: ToolStatus; t: Translations }) {
  return (
    <div className="tool-row">
      <div className="tool-row-main">
        <LauncherIcon launcherId={tool.id} label={tool.label} />
        <div>
          <strong>{tool.label}</strong>
          <p>{tool.location ?? t.notDetected}</p>
        </div>
      </div>
      <Badge label={tool.available ? t.ready : t.missing} tone={tool.available ? "good" : "warning"} />
    </div>
  );
}

const FILE_STATUS_LETTERS: Record<FileChange["status"], string> = {
  modified: "M",
  added: "A",
  deleted: "D",
  renamed: "R",
  untracked: "?",
};

function ChangedFilesSection({ worktree, t }: { worktree: WorktreeRecord; t: Translations }) {
  const [expandedFile, setExpandedFile] = useState<string | null>(null);
  const [diffContent, setDiffContent] = useState<string | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);

  const handleToggle = async (file: FileChange) => {
    if (expandedFile === file.path) {
      setExpandedFile(null);
      setDiffContent(null);
      return;
    }
    setExpandedFile(file.path);
    setDiffContent(null);
    setDiffLoading(true);
    try {
      const diff = await getFileDiff(worktree.path, file.path, file.status);
      setDiffContent(diff);
    } catch {
      setDiffContent("Failed to load diff");
    } finally {
      setDiffLoading(false);
    }
  };

  return (
    <section className="card stack">
      <div className="section-heading">
        <span>{t.changedFiles}</span>
        <span className="section-heading-count">{worktree.changedFiles.length}</span>
      </div>
      <div className="changed-files-list">
        {worktree.changedFiles.map((file) => (
          <FileChangeRow
            key={file.path}
            file={file}
            t={t}
            expanded={expandedFile === file.path}
            diffContent={expandedFile === file.path ? diffContent : null}
            diffLoading={expandedFile === file.path && diffLoading}
            onToggle={() => void handleToggle(file)}
          />
        ))}
      </div>
    </section>
  );
}

function FileChangeRow({
  file,
  t,
  expanded,
  diffContent,
  diffLoading,
  onToggle,
}: {
  file: FileChange;
  t: Translations;
  expanded: boolean;
  diffContent: string | null;
  diffLoading: boolean;
  onToggle: () => void;
}) {
  const statusLabel: Record<FileChange["status"], string> = {
    modified: t.fileStatusModified,
    added: t.fileStatusAdded,
    deleted: t.fileStatusDeleted,
    renamed: t.fileStatusRenamed,
    untracked: t.fileStatusUntracked,
  };
  return (
    <div className={`file-change-item${expanded ? " expanded" : ""}`}>
      <div className="file-change-row" onClick={onToggle}>
        <code className={`file-status file-status-${file.status}`} title={statusLabel[file.status]}>
          {FILE_STATUS_LETTERS[file.status]}
        </code>
        <span className="file-path" title={file.path}>{file.path}</span>
        <span className="file-expand-indicator">{expanded ? "▾" : "▸"}</span>
      </div>
      {expanded && (
        <div className="file-diff-container">
          {diffLoading ? (
            <div className="file-diff-loading">...</div>
          ) : (
            <DiffView content={diffContent ?? ""} isUntracked={file.status === "untracked"} />
          )}
        </div>
      )}
    </div>
  );
}

function DiffView({ content, isUntracked }: { content: string; isUntracked: boolean }) {
  if (!content) return <div className="file-diff-empty">No changes</div>;

  const lines = content.split("\n");
  // For real diffs, skip the header (lines before first @@ or all-add for untracked)
  let diffLines: { text: string; type: "add" | "del" | "ctx" | "hunk" }[];
  if (isUntracked) {
    diffLines = lines.map((line) => ({
      text: line,
      type: "add" as const,
    }));
  } else {
    diffLines = [];
    let inHunk = false;
    for (const line of lines) {
      if (line.startsWith("@@")) {
        inHunk = true;
        diffLines.push({ text: line, type: "hunk" });
      } else if (inHunk) {
        if (line.startsWith("+")) {
          diffLines.push({ text: line, type: "add" });
        } else if (line.startsWith("-")) {
          diffLines.push({ text: line, type: "del" });
        } else {
          diffLines.push({ text: line, type: "ctx" });
        }
      }
    }
  }

  return (
    <pre className="file-diff-content">
      {diffLines.map((line, i) => (
        <div key={i} className={`diff-line diff-line-${line.type}`}>
          {line.text}
        </div>
      ))}
    </pre>
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

function LauncherIcon({ launcherId, label, iconChar }: { launcherId: string; label: string; iconChar?: string | null }) {
  const src = LAUNCHER_ICONS[launcherId];
  const fallback = iconChar || label
    .split(/\s+/)
    .map((part) => part[0] ?? "")
    .join("")
    .slice(0, 2)
    .toUpperCase();

  if (launcherId === "iterm2") {
    return (
      <span className="launcher-icon-shell" data-launcher-id={launcherId} aria-hidden="true">
        <span className="iterm2-glyph">
          <span className="iterm2-dollar">$</span>
          <span className="iterm2-cursor" />
        </span>
      </span>
    );
  }

  if (launcherId === "claude") {
    return (
      <span className="launcher-icon-shell" data-launcher-id={launcherId} aria-hidden="true">
        <svg className="claude-app-glyph" viewBox="0 0 24 24" fill="currentColor">
          <path d="m4.7144 15.9555 4.7174-2.6471.079-.2307-.079-.1275h-.2307l-.7893-.0486-2.6956-.0729-2.3375-.0971-2.2646-.1214-.5707-.1215-.5343-.7042.0546-.3522.4797-.3218.686.0608 1.5179.1032 2.2767.1578 1.6514.0972 2.4468.255h.3886l.0546-.1579-.1336-.0971-.1032-.0972L6.973 9.8356l-2.55-1.6879-1.3356-.9714-.7225-.4918-.3643-.4614-.1578-1.0078.6557-.7225.8803.0607.2246.0607.8925.686 1.9064 1.4754 2.4893 1.8336.3643.3035.1457-.1032.0182-.0728-.164-.2733-1.3539-2.4467-1.445-2.4893-.6435-1.032-.17-.6194c-.0607-.255-.1032-.4674-.1032-.7285L6.287.1335 6.6997 0l.9957.1336.419.3642.6192 1.4147 1.0018 2.2282 1.5543 3.0296.4553.8985.2429.8318.091.255h.1579v-.1457l.1275-1.706.2368-2.0947.2307-2.6957.0789-.7589.3764-.9107.7468-.4918.5828.2793.4797.686-.0668.4433-.2853 1.8517-.5586 2.9021-.3643 1.9429h.2125l.2429-.2429.9835-1.3053 1.6514-2.0643.7286-.8196.85-.9046.5464-.4311h1.0321l.759 1.1293-.34 1.1657-1.0625 1.3478-.8804 1.1414-1.2628 1.7-.7893 1.36.0729.1093.1882-.0183 2.8535-.607 1.5421-.2794 1.8396-.3157.8318.3886.091.3946-.3278.8075-1.967.4857-2.3072.4614-3.4364.8136-.0425.0304.0486.0607 1.5482.1457.6618.0364h1.621l3.0175.2247.7892.522.4736.6376-.079.4857-1.2142.6193-1.6393-.3886-3.825-.9107-1.3113-.3279h-.1822v.1093l1.0929 1.0686 2.0035 1.8092 2.5075 2.3314.1275.5768-.3218.4554-.34-.0486-2.2039-1.6575-.85-.7468-1.9246-1.621h-.1275v.17l.4432.6496 2.3436 3.5214.1214 1.0807-.17.3521-.6071.2125-.6679-.1214-1.3721-1.9246L14.38 17.959l-1.1414-1.9428-.1397.079-.674 7.2552-.3156.3703-.7286.2793-.6071-.4614-.3218-.7468.3218-1.4753.3886-1.9246.3157-1.53.2853-1.9004.17-.6314-.0121-.0425-.1397.0182-1.4328 1.9672-2.1796 2.9446-1.7243 1.8456-.4128.164-.7164-.3704.0667-.6618.4008-.5889 2.386-3.0357 1.4389-1.882.929-1.0868-.0062-.1579h-.0546l-6.3385 4.1164-1.1293.1457-.4857-.4554.0608-.7467.2307-.2429 1.9064-1.3114Z" />
        </svg>
      </span>
    );
  }

  return (
    <span className="launcher-icon-shell" data-launcher-id={launcherId} aria-hidden="true">
      {src ? <img className="launcher-icon" src={src} alt="" /> : <span className="launcher-icon-fallback">{fallback}</span>}
    </span>
  );
}

/* ─── CustomLauncherModal ─── */

function CustomLauncherModal({
  editing,
  repoRoot,
  onSave,
  onClose,
  isBusy,
  t,
}: {
  editing: LauncherProfile | null;
  repoRoot: string | null;
  onSave: (input: SaveCustomLauncherInput) => void;
  onClose: () => void;
  isBusy: boolean;
  t: Translations;
}) {
  const [name, setName] = useState(editing?.name ?? "");
  const [kind, setKind] = useState<LauncherKind>(editing?.kind ?? "app");
  const [appOrCmd, setAppOrCmd] = useState(editing?.appOrCmd ?? "");
  const [iconChar, setIconChar] = useState(editing?.iconChar ?? "");
  const [scope, setScope] = useState<"global" | "repo">(editing ? "global" : "global");
  const [installedApps, setInstalledApps] = useState<string[]>([]);
  const [appFilter, setAppFilter] = useState(editing?.appOrCmd ?? "");

  useEffect(() => {
    listInstalledApps().then(setInstalledApps).catch(() => {});
  }, []);

  const filteredApps = appFilter.trim()
    ? installedApps.filter((a) => a.toLowerCase().includes(appFilter.toLowerCase()))
    : installedApps;

  const canSave = name.trim() && appOrCmd.trim() && !isBusy;

  function handleSave() {
    const id = editing?.id ?? `custom-${Date.now()}`;
    const launcher: LauncherProfile = {
      id,
      name: name.trim(),
      kind,
      appOrCmd: appOrCmd.trim(),
      argsTemplate: kind === "app" ? ["{worktree_path}"] : [],
      openInTerminal: kind !== "app",
      promptTemplate: null,
      isCustom: true,
      iconChar: iconChar.trim() || name.trim().slice(0, 1).toUpperCase(),
    };
    onSave({
      launcher,
      repoRoot: scope === "repo" ? repoRoot : null,
    });
  }

  return (
    <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal-card custom-launcher-modal" onClick={(e) => e.stopPropagation()}>
        <div className="section-heading">
          <span>{editing ? t.editLauncher : t.addCustomLauncher}</span>
        </div>

        <div className="custom-launcher-form">
          <label className="form-field">
            <span className="form-label">{t.customLauncherName}</span>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="My Launcher"
              autoFocus
            />
          </label>

          <label className="form-field">
            <span className="form-label">{t.customLauncherKind}</span>
            <select value={kind} onChange={(e) => setKind(e.target.value as LauncherKind)}>
              <option value="app">{t.customLauncherKindApp}</option>
              <option value="shell-script">{t.customLauncherKindShellScript}</option>
              <option value="applescript">{t.customLauncherKindAppleScript}</option>
            </select>
          </label>

          {kind === "app" ? (
            <div className="form-field">
              <span className="form-label">{t.customLauncherCommand}</span>
              <input
                type="text"
                value={appFilter}
                onChange={(e) => {
                  setAppFilter(e.target.value);
                  setAppOrCmd(e.target.value);
                }}
                placeholder="Sublime Text"
              />
              {installedApps.length > 0 && (
                <div className="app-picker-list">
                  {filteredApps.slice(0, 80).map((appName) => (
                    <button
                      key={appName}
                      type="button"
                      className={`app-picker-item${appOrCmd === appName ? " app-picker-item-selected" : ""}`}
                      onClick={() => {
                        setAppOrCmd(appName);
                        setAppFilter(appName);
                        if (!name.trim()) setName(appName);
                      }}
                    >
                      {appName}
                    </button>
                  ))}
                  {filteredApps.length === 0 && (
                    <span className="app-picker-empty">{appFilter}</span>
                  )}
                </div>
              )}
            </div>
          ) : (
            <label className="form-field">
              <span className="form-label">{t.customLauncherScript}</span>
              <textarea
                className="custom-launcher-script"
                value={appOrCmd}
                onChange={(e) => setAppOrCmd(e.target.value)}
                placeholder={kind === "shell-script" ? "echo {worktree_path}" : 'display dialog "Hello"'}
                rows={5}
              />
              <span className="form-hint">{t.customLauncherTemplateVars}</span>
            </label>
          )}

          <div className="custom-launcher-row">
            <label className="form-field" style={{ flex: "0 0 80px" }}>
              <span className="form-label">{t.customLauncherIconChar}</span>
              <input
                type="text"
                value={iconChar}
                onChange={(e) => setIconChar(e.target.value.slice(0, 2))}
                placeholder={name.trim().slice(0, 1).toUpperCase() || "A"}
                maxLength={2}
              />
            </label>

            <label className="form-field" style={{ flex: 1 }}>
              <span className="form-label">{t.customLauncherScope}</span>
              <select value={scope} onChange={(e) => setScope(e.target.value as "global" | "repo")}>
                <option value="global">{t.customLauncherScopeGlobal}</option>
                {repoRoot && <option value="repo">{t.customLauncherScopeRepo}</option>}
              </select>
            </label>
          </div>
        </div>

        <div className="modal-actions">
          <button className="ghost-button" onClick={onClose} disabled={isBusy}>
            {t.cancel}
          </button>
          <button className="primary-button" onClick={handleSave} disabled={!canSave}>
            {t.save}
          </button>
        </div>
      </div>
    </div>
  );
}

function findTool(repo: RepoSnapshot, launcherId: string) {
  return repo.toolStatuses.find((tool) => tool.id === launcherId) ?? null;
}
