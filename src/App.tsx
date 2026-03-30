import { ask, open } from "@tauri-apps/plugin-dialog";
import { getVersion } from "@tauri-apps/api/app";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { openUrl, revealItemInDir } from "@tauri-apps/plugin-opener";
import { useEffect, useRef, useState } from "react";
import { Copy, FishingHook, Folder, FolderTree, GitBranch, HousePlus, Settings } from "lucide-react";
import { Input, Textarea, Select } from "./components/FormControls";
import groveMark from "./assets/grove-mark.svg";
import alacrittyIcon from "./assets/launcher-icons/alacritty.svg";
import claudeIcon from "./assets/launcher-icons/claude.svg";
import codexIcon from "./assets/launcher-icons/codex.svg";
import cursorIcon from "./assets/launcher-icons/cursor.svg";
import geminiIcon from "./assets/launcher-icons/gemini.svg";
import ghosttyIcon from "./assets/launcher-icons/ghostty.svg";
import kittyIcon from "./assets/launcher-icons/kitty.svg";
import opencodeIcon from "./assets/launcher-icons/opencode.svg";
import terminalIcon from "./assets/launcher-icons/terminal.svg";
import warpIcon from "./assets/launcher-icons/warp.svg";
import weztermIcon from "./assets/launcher-icons/wezterm.svg";
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
  openRepoWindow,
  previewRepoPrune,
  pruneRepoMetadata,
  runRepoHookEvent,
  saveCustomLauncher,
  saveRepoConfig,
  saveRepoHooks,
  startRemoveRepoWorktreeSession,
  getDefaultTerminal,
  setDefaultTerminal,
  getDefaultShell,
  setDefaultShell,
  listAvailableShells,
  setWorktreeRoot,
  getShowTrayIcon,
  setShowTrayIcon,
  checkGroveCliInstalled,
  installGroveCli,
  uninstallGroveCli,
} from "./lib/api";
import { useI18n, type Locale, type Translations } from "./lib/i18n";
import {
  checkForUpdate,
  downloadAndInstallUpdate,
  INITIAL_PROGRESS,
  type UpdateInfo,
  type DownloadProgress,
  type Update,
} from "./lib/updater";
import { useTheme, type ThemeMode } from "./lib/theme";
import { HooksModal, type HooksMap } from "./components/HooksModal";
import { CreateWorktreeModal, type CreateFormState } from "./components/CreateWorktreeModal";
import { DeleteExecutionModal, type DeleteExecutionState, type DeleteExecutionPhase } from "./components/DeleteExecutionModal";
import { ModalShell } from "./components/ModalShell";
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
  ShellInfo,
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
  alacritty: alacrittyIcon,
  claude: claudeIcon,
  codex: codexIcon,
  cursor: cursorIcon,
  gemini: geminiIcon,
  ghostty: ghosttyIcon,
  kitty: kittyIcon,
  opencode: opencodeIcon,
  terminal: terminalIcon,
  vscode: vscodeIcon,
  warp: warpIcon,
  wezterm: weztermIcon,
};

const createInitialForm = (repo?: RepoSnapshot): CreateFormState => ({
  mode: "new-branch",
  branch: "",
  baseRef: repo?.mergedConfig.settings.defaultBaseBranch ?? "main",
  remoteRef: "",
  path: "",
  autoStartLaunchers: [],
});

const copySvg = <Copy size={14} />;

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

export default function App({ repoPath }: { repoPath: string }) {
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
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [selectedWorktreeId, setSelectedWorktreeId] = useState<string | null>(null);
  const [deleteExecution, setDeleteExecution] = useState<DeleteExecutionState | null>(null);
  const [pruneModal, setPruneModal] = useState<{ candidates: string[]; loading: boolean } | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [view, setView] = useState<"repository" | "worktrees" | "hooks" | "settings">("worktrees");
  const [showActionLog, setShowActionLog] = useState(false);
  const [defaultTerminalId, setDefaultTerminalId] = useState("terminal");
  const [toast, setToast] = useState<{ message: string; level: "success" | "error" } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [defaultShellPath, setDefaultShellPath] = useState("/bin/bash");
  const [availableShells, setAvailableShells] = useState<ShellInfo[]>([]);
  const [customLauncherModal, setCustomLauncherModal] = useState<{ editing: LauncherProfile | null; repoRoot: string | null } | null>(null);
  const [showTrayIconEnabled, setShowTrayIconEnabled] = useState(true);
  const [appVersion, setAppVersion] = useState("");
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [updateObj, setUpdateObj] = useState<Update | null>(null);
  const [downloadProgress, setDownloadProgress] = useState<DownloadProgress>(INITIAL_PROGRESS);

  // Listen for Settings menu item (Cmd+, handled by native menu)
  useEffect(() => {
    let unlisten: UnlistenFn | null = null;
    void listen("menu-settings", () => {
      setView((v) => (v === "settings" ? "worktrees" : "settings"));
    }).then((fn) => {
      unlisten = fn;
    });
    return () => {
      if (unlisten) unlisten();
    };
  }, []);

  // Fetch app version once
  useEffect(() => {
    getVersion().then(setAppVersion).catch(() => {});
  }, []);

  // Listen for update-available event from Rust background checker
  useEffect(() => {
    let unlisten: UnlistenFn | null = null;
    void listen<UpdateInfo>("update-available", async (event) => {
      setUpdateInfo(event.payload);
      const update = await checkForUpdate();
      if (update) setUpdateObj(update);
    }).then((fn) => {
      unlisten = fn;
    });
    return () => {
      if (unlisten) unlisten();
    };
  }, []);

  // Listen for worktrees-changed event from filesystem watcher
  useEffect(() => {
    let unlisten: UnlistenFn | null = null;
    void listen<string>("worktrees-changed", () => {
      if (repo?.repoRoot) {
        void loadRepoInner(repo.repoRoot);
      }
    }).then((fn) => {
      unlisten = fn;
    });
    return () => {
      if (unlisten) unlisten();
    };
  }); // re-subscribe when repo changes so closure captures latest repo

  // Show toast when update is detected
  useEffect(() => {
    if (updateInfo) {
      showToast(`${t.updateAvailable}: v${updateInfo.version}`, "success");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [updateInfo?.version]);

  const selectedWorktree = repo?.worktrees.find((w) => w.id === selectedWorktreeId) ?? null;

  // Bootstrap
  useEffect(() => {
    void (async () => {
      try {
        const data = await bootstrap();
        setBootstrapState(data);
        getDefaultTerminal().then(setDefaultTerminalId).catch(() => {});
        getDefaultShell().then(setDefaultShellPath).catch(() => {});
        listAvailableShells().then(setAvailableShells).catch(() => {});
        getShowTrayIcon().then(setShowTrayIconEnabled).catch(() => {});
        setRepoInput(repoPath);
        await loadRepoInner(repoPath);
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
      const repoName = snapshot.repoRoot.split("/").pop() ?? snapshot.repoRoot;
      void getCurrentWindow().setTitle(`Grove — ${repoName}`);
      appendLogs([{ level: "success", message: t.logLoaded(snapshot.repoRoot) }], snapshot.repoRoot);
    } catch (reason) {
      setError(String(reason));
    } finally {
      setIsBusy(false);
    }
  }

  async function handleOpenRepoWindow(path: string) {
    const trimmed = path.trim();
    if (!trimmed) return;
    setError(null);
    try {
      await openRepoWindow(trimmed);
    } catch (reason) {
      setError(String(reason));
    }
  }

  async function browseForRepo() {
    const selected = await open({
      directory: true,
      multiple: false,
      title: t.chooseRepo,
    });
    if (typeof selected === "string") {
      setRepoInput(selected);
      await handleOpenRepoWindow(selected);
    }
  }

  function showToast(message: string, level: "success" | "error") {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ message, level });
    toastTimer.current = setTimeout(() => setToast(null), 3000);
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
      const hasError = response.logs.some((l) => l.level === "error");
      if (hasError) {
        showToast(t.executionFailed, "error");
      } else {
        showToast(t.executionCompleted, "success");
      }
    } catch (reason) {
      setError(String(reason));
      appendLogs([{ level: "error", message: String(reason) }]);
      showToast(t.executionFailed, "error");
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

  async function handleSetDefaultTerminal(terminalId: string) {
    setDefaultTerminalId(terminalId);
    await setDefaultTerminal(terminalId);
  }

  async function handleSetDefaultShell(shell: string) {
    setDefaultShellPath(shell);
    await setDefaultShell(shell);
  }

  async function handlePrunePreview() {
    if (!repo) return;
    setPruneModal({ candidates: [], loading: true });
    try {
      const candidates = await previewRepoPrune(repo.repoRoot);
      setPruneModal({ candidates, loading: false });
    } catch {
      setPruneModal(null);
    }
  }

  async function handlePruneConfirm() {
    if (!repo) return;
    setPruneModal(null);
    await runAction(() => pruneRepoMetadata(repo.repoRoot));
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

  return (
    <div className="shell">
      {/* Top Navigation Bar */}
      <nav className="topbar" data-tauri-drag-region>
        <div className="topbar-left">
          <div className="topbar-brand">
            <img className="brand-mark" src={groveMark} alt="" aria-hidden="true" />
            <span>Git Grove</span>
          </div>
        </div>
        {repo && (
          <div className="topbar-path" title={repo.repoRoot}>
            <Folder className="topbar-path-icon" size={11} />
            <span className="topbar-path-text">{repo.repoRoot}</span>
          </div>
        )}
        <div className="topbar-right" />
      </nav>

      <div className="body">
        {/* Sidebar Navigation */}
        <aside className="sidebar">
          <button
            className={`sidebar-tab${view === "repository" ? " active" : ""}`}
            onClick={() => setView("repository")}
            title={t.tabRepository}
          >
            <HousePlus className="sidebar-tab-icon" size={22} strokeWidth={2.25} />
          </button>
          <button
            className={`sidebar-tab${view === "worktrees" ? " active" : ""}`}
            onClick={() => setView("worktrees")}
            disabled={!repo}
            title={t.tabWorktrees}
          >
            <FolderTree className="sidebar-tab-icon" size={22} strokeWidth={2.25} />
          </button>
          <button
            className={`sidebar-tab${view === "hooks" ? " active" : ""}`}
            onClick={() => setView("hooks")}
            disabled={!repo}
            title={t.hooks}
          >
            <FishingHook className="sidebar-tab-icon" size={22} strokeWidth={2.25} />
          </button>
          <button
            className={`sidebar-tab${view === "settings" ? " active" : ""}`}
            onClick={() => setView("settings")}
            title={t.settings}
          >
            <Settings className="sidebar-tab-icon" size={22} strokeWidth={2.25} />
          </button>
        </aside>

        {/* Main Content */}
        <main className="main">
        {error && <div className="error-banner">{error}</div>}

        {view === "repository" && (
          <>
          <h1 className="view-title">{t.tabRepository}</h1>
          <div className="repo-view">
            <section className="hero card">
              <h2>{t.heroTitle}</h2>
              <p>{t.heroDescription}</p>
              <ul className="hero-points">
                <li>{t.heroPoint1}</li>
                <li>{t.heroPoint2}</li>
                <li>{t.heroPoint3}</li>
              </ul>
            </section>
            <section className="card stack">
              <div className="repo-picker">
                <Input
                  value={repoInput}
                  onChange={(e) => setRepoInput(e.target.value)}
                  placeholder={t.repoPlaceholder}
                  onKeyDown={(e) => e.key === "Enter" && void handleOpenRepoWindow(repoInput)}
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
                    onSelect={(item) => void handleOpenRepoWindow(item)}
                  />
                )}
                {repo && (
                  <div className="repo-info-line">
                    {t.worktreeCount(repo.worktrees.length)} · {t.baseBranch}{" "}
                    <code>{repo.mergedConfig.settings.defaultBaseBranch}</code>
                  </div>
                )}
              </div>
            </section>
          </div>
          </>
        )}

        {view === "worktrees" && (
          <>
            {!repo ? (
              <>
                <h1 className="view-title">{t.tabWorktrees}</h1>
                <div className="repo-view">
                  <section className="hero card">
                    <h2>{t.loading}</h2>
                  </section>
                </div>
              </>
            ) : (
              <div className="worktrees-layout">
                <div className="worktrees-title-panel">
                  <h1 className="view-title">{t.tabWorktrees}</h1>
                </div>
                <div className="worktrees-title-spacer" aria-hidden="true" />
                <div className="worktrees-panel">
                  <div className="repo-name-label">{repo.repoRoot.split("/").pop()}</div>
                  <div className="worktree-toolbar">
                    <button
                      className="primary-button btn-sm"
                      onClick={() => {
                        setCreateForm(createInitialForm(repo));
                        setShowCreateModal(true);
                      }}
                      disabled={isBusy}
                    >
                      + {t.newWorktree}
                    </button>
                    <button
                      className="ghost-button btn-sm"
                      onClick={() => void handlePrunePreview()}
                      disabled={isBusy}
                    >
                      {t.prune}
                    </button>
                    <button
                      className="ghost-button btn-sm btn-icon refresh-button"
                      onClick={() => repo && void loadRepoInner(repo.repoRoot)}
                      disabled={isBusy}
                      title={t.refresh}
                    >
                      <svg className={isBusy ? "spin" : ""} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M21.5 2v6h-6" />
                        <path d="M2.5 22v-6h6" />
                        <path d="M2.5 11.5a10 10 0 0 1 18.17-4.5" />
                        <path d="M21.5 12.5a10 10 0 0 1-18.17 4.5" />
                      </svg>
                    </button>
                  </div>
                  <div className="worktree-list">
                    {repo.worktrees.map((wt) => (
                      <WorktreeListItem
                        key={wt.id}
                        worktree={wt}
                        active={wt.id === selectedWorktreeId}
                        t={t}
                        onSelect={() => setSelectedWorktreeId(wt.id)}
                        onDelete={() => {
                          if (wt.isMain) return;
                          handleRemove(wt, wt.dirty || !!wt.lockedReason);
                        }}
                      />
                    ))}
                    {repo.worktrees.length === 0 && (
                      <p className="empty-copy">{t.noWorktrees}</p>
                    )}
                  </div>
                </div>
                <div className="worktrees-detail">
                  {!selectedWorktree ? (
                    <section className="hero card">
                      <h2>{t.noWorktreeSelected}</h2>
                      <p>{t.selectWorktreeHint}</p>
                    </section>
                  ) : (
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
                        void ask(t.confirmDeleteLauncher(launcher.name), { kind: "warning" }).then((yes) => {
                          if (yes) void handleDeleteCustomLauncher(launcher.id, repo.repoRoot);
                        });
                      }}
                    />
                  )}
                </div>
              </div>
            )}
          </>
        )}

        {view === "hooks" && (
          <>
          <h1 className="view-title">{t.hooks}</h1>
          <div className="hooks-view">
            {!repo ? (
              <section className="hero card">
                <h2>{t.hooks}</h2>
                <p>{t.heroDescription}</p>
              </section>
            ) : (
              <HooksModal
                hooks={hooksMap}
                launchers={launchers}
                repoRoot={repo.repoRoot}
                onSave={async (nextHooks) => {
                  const ok = await handleSaveHooks(nextHooks);
                  return ok;
                }}
                onClose={() => setView("worktrees")}
                isBusy={isBusy}
                t={t}
                availableShells={availableShells}
                defaultShell={defaultShellPath}
              />
            )}
          </div>
          </>
        )}

        {view === "settings" && (
          <>
            <h1 className="view-title">{t.settings}</h1>
            <SettingsPage
            toolStatuses={repo?.toolStatuses ?? bootstrapState.toolStatuses}
            logs={logs}
            onClearLogs={() => setLogs([])}
            repo={repo}
            configText={configText}
            onConfigChange={setConfigText}
            onSaveConfig={() => void handleSaveConfig()}
            isBusy={isBusy}
            t={t}
            defaultTerminal={defaultTerminalId}
            onSetDefaultTerminal={(id) => void handleSetDefaultTerminal(id)}
            defaultShell={defaultShellPath}
            availableShells={availableShells}
            onSetDefaultShell={(s) => void handleSetDefaultShell(s)}
            onRepoUpdate={setRepo}
            showTrayIcon={showTrayIconEnabled}
            onSetShowTrayIcon={(enabled) => {
              setShowTrayIconEnabled(enabled);
              setShowTrayIcon(enabled).catch(() => setShowTrayIconEnabled(!enabled));
            }}
            locale={locale}
            setLocale={setLocale}
            appVersion={appVersion}
            updateInfo={updateInfo}
            updateObj={updateObj}
            downloadProgress={downloadProgress}
            onCheckForUpdate={async () => {
              const update = await checkForUpdate();
              if (update) {
                setUpdateObj(update);
                setUpdateInfo({
                  version: update.version,
                  currentVersion: update.currentVersion,
                  body: update.body ?? undefined,
                  date: update.date ?? undefined,
                });
              } else {
                showToast(t.upToDate, "success");
              }
            }}
            onDownloadUpdate={() => {
              if (updateObj) {
                void downloadAndInstallUpdate(updateObj, setDownloadProgress);
              }
            }}
            onRetryDownload={() => setDownloadProgress(INITIAL_PROGRESS)}
          />
          </>
        )}
      </main>
      </div>

      {deleteExecution && (
        <DeleteExecutionModal
          execution={deleteExecution}
          t={t}
          onClose={handleCloseDeleteExecution}
          onConfirm={() => void confirmDeleteExecution()}
        />
      )}

      {/* Prune Confirmation Modal */}
      {pruneModal && (
        <ModalShell
          title={t.pruneConfirmTitle}
          onClose={() => setPruneModal(null)}
          className="prune-confirm-modal"
        >
          <p className="prune-description">{t.pruneDescription}</p>
          {pruneModal.loading ? (
            <p className="subtle">{t.loading}</p>
          ) : pruneModal.candidates.length === 0 ? (
            <div className="prune-preview">
              <p>{t.pruneNoCandidates}</p>
            </div>
          ) : (
            <div className="prune-preview">
              <p>{t.pruneCandidatesFound(pruneModal.candidates.length)}</p>
              <ul>
                {pruneModal.candidates.map((c) => (
                  <li key={c}><code>{c}</code></li>
                ))}
              </ul>
            </div>
          )}
          <div className="modal-actions">
            <button className="ghost-button" onClick={() => setPruneModal(null)}>
              {pruneModal.candidates.length > 0 ? t.cancel : t.close}
            </button>
            {pruneModal.candidates.length > 0 && !pruneModal.loading && (
              <button className="danger-button" onClick={() => void handlePruneConfirm()}>
                {t.pruneConfirmAction}
              </button>
            )}
          </div>
        </ModalShell>
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

      {toast && (
        <div className={`toast toast-${toast.level}`} onClick={() => setToast(null)}>
          {toast.level === "success" ? "✓" : "✗"} {toast.message}
        </div>
      )}
    </div>
  );
}

/* ─── ThemeSwitcherCard ─── */

function ThemeSwitcherCard({ t }: { t: Translations }) {
  const { mode, setMode } = useTheme();
  const options: { value: ThemeMode; label: string }[] = [
    { value: "light", label: t.themeLight },
    { value: "dark", label: t.themeDark },
    { value: "system", label: t.themeSystem },
  ];
  return (
    <section className="card stack">
      <div className="section-heading">
        <span>{t.themeLabel}</span>
        <div className="theme-switcher">
          {options.map((o) => (
            <button
              key={o.value}
              className={mode === o.value ? "active" : ""}
              onClick={() => setMode(o.value)}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>
    </section>
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
      className="ghost-button btn-sm"
      style={{ marginLeft: "auto" }}
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
  const [open, setOpen] = useState(true);
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
          <GitBranch className="worktree-icon" size={14} />
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
            <Select
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
            </Select>
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
              <button className="ghost-button btn-sm" onClick={onClearLogs}>
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
  isBusy,
  t,
  defaultTerminal,
  onSetDefaultTerminal,
  defaultShell,
  availableShells,
  onSetDefaultShell,
  onRepoUpdate,
  showTrayIcon,
  onSetShowTrayIcon,
  locale,
  setLocale,
  appVersion,
  updateInfo,
  updateObj,
  downloadProgress,
  onCheckForUpdate,
  onDownloadUpdate,
  onRetryDownload,
}: {
  toolStatuses: ToolStatus[];
  logs: TaggedLog[];
  onClearLogs: () => void;
  repo: RepoSnapshot | null;
  configText: string;
  onConfigChange: (v: string) => void;
  onSaveConfig: () => void;
  isBusy: boolean;
  t: Translations;
  defaultTerminal: string;
  onSetDefaultTerminal: (id: string) => void;
  defaultShell: string;
  availableShells: ShellInfo[];
  onSetDefaultShell: (shell: string) => void;
  onRepoUpdate: (repo: RepoSnapshot) => void;
  showTrayIcon: boolean;
  onSetShowTrayIcon: (enabled: boolean) => void;
  locale: Locale;
  setLocale: (l: Locale) => void;
  appVersion: string;
  updateInfo: UpdateInfo | null;
  updateObj: Update | null;
  downloadProgress: DownloadProgress;
  onCheckForUpdate: () => void;
  onDownloadUpdate: () => void;
  onRetryDownload: () => void;
}) {
  const [showConfigEditor, setShowConfigEditor] = useState(false);
  const [cliInstalled, setCliInstalled] = useState(false);
  const [cliLoading, setCliLoading] = useState(false);

  useEffect(() => {
    checkGroveCliInstalled().then(setCliInstalled).catch(() => {});
  }, []);

  const handleInstallCli = async () => {
    setCliLoading(true);
    try {
      await installGroveCli();
      setCliInstalled(true);
    } catch {
      // Error shown via toast or ignored
    } finally {
      setCliLoading(false);
    }
  };

  const handleUninstallCli = async () => {
    setCliLoading(true);
    try {
      await uninstallGroveCli();
      setCliInstalled(false);
    } catch {
      // Error shown via toast or ignored
    } finally {
      setCliLoading(false);
    }
  };

  return (
    <div className="settings-view">
      {/* Software Update */}
      <section className="card stack">
        <div className="section-heading">
          <span>{t.softwareUpdate}</span>
          {!updateInfo && (
            <button className="ghost-button" onClick={onCheckForUpdate}>
              {t.checkForUpdates}
            </button>
          )}
        </div>
        {updateInfo ? (
          <div className="update-panel">
            <p>{t.updateAvailableDesc(updateInfo.version)}</p>
            {updateInfo.body && <p className="empty-copy">{updateInfo.body}</p>}

            {downloadProgress.phase === "idle" && updateObj && (
              <button className="primary-button" onClick={onDownloadUpdate}>
                {t.downloadAndInstall}
              </button>
            )}

            {downloadProgress.phase === "downloading" && (
              <div className="update-progress">
                <div className="progress-bar">
                  <div
                    className="progress-fill"
                    style={{
                      width: downloadProgress.total
                        ? `${(downloadProgress.downloaded / downloadProgress.total) * 100}%`
                        : undefined,
                    }}
                  />
                </div>
                <span className="empty-copy">
                  {downloadProgress.total
                    ? `${Math.round((downloadProgress.downloaded / downloadProgress.total) * 100)}%`
                    : `${(downloadProgress.downloaded / 1024 / 1024).toFixed(1)} MB`}
                </span>
              </div>
            )}

            {downloadProgress.phase === "installing" && (
              <p className="empty-copy">{t.installingUpdate}</p>
            )}

            {downloadProgress.phase === "done" && (
              <p className="empty-copy">{t.updateInstalledRestarting}</p>
            )}

            {downloadProgress.phase === "error" && (
              <div className="warning-panel">
                <p>{t.updateFailed}: {downloadProgress.error}</p>
                <button className="ghost-button" onClick={onRetryDownload}>
                  {t.retry}
                </button>
              </div>
            )}
          </div>
        ) : (
          <p className="empty-copy">{t.currentVersion}: v{appVersion}</p>
        )}
      </section>

      {/* Default Terminal */}
      <section className="card stack">
        <div className="section-heading">
          <span>{t.defaultTerminalLabel}</span>
        </div>
        <p className="empty-copy" style={{ marginBottom: 8 }}>{t.defaultTerminalDescription}</p>
        <Select
          className="ghost-button btn-sm"
          style={{ textAlign: "left" }}
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
        </Select>
      </section>

      {/* Default Shell */}
      <section className="card stack">
        <div className="section-heading">
          <span>{t.defaultShellLabel}</span>
        </div>
        <p className="empty-copy" style={{ marginBottom: 8 }}>{t.defaultShellDescription}</p>
        <Select
          className="ghost-button btn-sm"
          style={{ textAlign: "left" }}
          value={defaultShell}
          onChange={(e) => onSetDefaultShell(e.target.value)}
          disabled={isBusy}
        >
          {availableShells.map((s) => (
            <option key={s.path} value={s.path}>
              {s.label} ({s.path})
            </option>
          ))}
        </Select>
      </section>

      {/* Appearance */}
      <ThemeSwitcherCard t={t} />

      {/* Language */}
      <section className="card stack">
        <div className="section-heading">
          <span>{t.language}</span>
          <LanguageSwitcher locale={locale} setLocale={setLocale} />
        </div>
      </section>

      {/* Tray Icon */}
      <section className="card stack">
        <div className="section-heading">
          <span>{t.showTrayIconLabel}</span>
          <label className="toggle-switch" style={{ marginLeft: "auto" }}>
            <input
              type="checkbox"
              checked={showTrayIcon}
              onChange={(e) => onSetShowTrayIcon(e.target.checked)}
            />
            <span className="toggle-slider" />
          </label>
        </div>
        <p className="empty-copy">{t.showTrayIconDescription}</p>
      </section>

      {/* CLI Command */}
      <section className="card stack">
        <div className="section-heading">
          <span>{t.cliCommandLabel}</span>
          {cliInstalled ? (
            <button
              className="ghost-button"
              onClick={() => void handleUninstallCli()}
              disabled={cliLoading}
              style={{ marginLeft: "auto" }}
            >
              {t.cliUninstall}
            </button>
          ) : (
            <button
              className="primary-button"
              onClick={() => void handleInstallCli()}
              disabled={cliLoading}
              style={{ marginLeft: "auto" }}
            >
              {t.cliInstall}
            </button>
          )}
        </div>
        <p className="empty-copy">{t.cliDescription}</p>
      </section>

      {/* Worktree Directory */}
      {repo && (
        <section className="card stack">
          <div className="section-heading">
            <span>{t.worktreeRootLabel}</span>
          </div>
          <Input
            className="ghost-button btn-sm"
            style={{ textAlign: "left" }}
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
            className="ghost-button btn-sm"
            onClick={onClearLogs}
            style={{ marginLeft: "auto" }}
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
              <Textarea
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

      {/* Version */}
      {appVersion && (
        <p className="empty-copy" style={{ textAlign: "center", marginTop: 12, opacity: 0.5 }}>
          Grove v{appVersion}
        </p>
      )}
    </div>
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
            <Input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="My Launcher"
              autoFocus
            />
          </label>

          <label className="form-field">
            <span className="form-label">{t.customLauncherKind}</span>
            <Select value={kind} onChange={(e) => setKind(e.target.value as LauncherKind)}>
              <option value="app">{t.customLauncherKindApp}</option>
              <option value="shell-script">{t.customLauncherKindShellScript}</option>
              <option value="applescript">{t.customLauncherKindAppleScript}</option>
            </Select>
          </label>

          {kind === "app" ? (
            <div className="form-field">
              <span className="form-label">{t.customLauncherCommand}</span>
              <Input
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
              <Textarea
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
              <Input
                type="text"
                value={iconChar}
                onChange={(e) => setIconChar(e.target.value.slice(0, 2))}
                placeholder={name.trim().slice(0, 1).toUpperCase() || "A"}
                maxLength={2}
              />
            </label>

            <label className="form-field" style={{ flex: 1 }}>
              <span className="form-label">{t.customLauncherScope}</span>
              <Select value={scope} onChange={(e) => setScope(e.target.value as "global" | "repo")}>
                <option value="global">{t.customLauncherScopeGlobal}</option>
                {repoRoot && <option value="repo">{t.customLauncherScopeRepo}</option>}
              </Select>
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
