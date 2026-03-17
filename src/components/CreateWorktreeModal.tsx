import { useEffect, useRef, useState } from "react";
import { Input, Select } from "./FormControls";
import { ModalShell } from "./ModalShell";
import { fetchRemote, listBranches, listRemoteBranches } from "../lib/api";
import { generateBranchName } from "../lib/branch-name-gen";
import type { CreateMode, RepoSnapshot } from "../lib/types";
import type { Translations } from "../lib/i18n";

type CreateFormState = {
  mode: CreateMode;
  branch: string;
  baseRef: string;
  remoteRef: string;
  path: string;
  autoStartLaunchers: string[];
};

export { type CreateFormState };

function sanitizeBranch(branch: string): string {
  return branch
    .split("")
    .map((ch) => (/[a-zA-Z0-9\-_]/.test(ch) ? ch : "-"))
    .join("");
}

export function CreateWorktreeModal({
  repo,
  form,
  onFormChange,
  onCreate,
  onClose,
  onGoToSettings,
  isBusy,
  t,
}: {
  repo: RepoSnapshot;
  form: CreateFormState;
  onFormChange: (fn: (prev: CreateFormState) => CreateFormState) => void;
  onCreate: () => void;
  onClose: () => void;
  onGoToSettings: () => void;
  isBusy: boolean;
  t: Translations;
}) {
  const [localBranches, setLocalBranches] = useState<string[]>([]);
  const [remoteBranches, setRemoteBranches] = useState<string[]>([]);
  const [isFetching, setIsFetching] = useState(false);

  const pathPreview = form.branch.trim()
    ? `${repo.repoRoot}/${repo.mergedConfig.settings.worktreeRoot}/${sanitizeBranch(form.branch.trim())}`
    : null;

  // Load branches when mode changes
  useEffect(() => {
    if (form.mode === "new-branch" || form.mode === "existing-branch") {
      listBranches(repo.repoRoot).then(setLocalBranches).catch(() => {});
    } else if (form.mode === "remote-branch") {
      listRemoteBranches(repo.repoRoot).then(setRemoteBranches).catch(() => {});
    }
  }, [form.mode, repo.repoRoot]);

  const fetchingRef = useRef(false);
  async function handleFetchRemote() {
    if (fetchingRef.current) return;
    fetchingRef.current = true;
    setIsFetching(true);
    try {
      await fetchRemote(repo.repoRoot);
      const branches = await listRemoteBranches(repo.repoRoot);
      setRemoteBranches(branches);
    } catch {
      // ignore
    } finally {
      fetchingRef.current = false;
      setIsFetching(false);
    }
  }

  return (
    <ModalShell title={t.createWorktree} onClose={onClose} className="create-modal-panel">
      <div className="stack" style={{ gap: 14, marginTop: 16 }}>
        {/* Mode selector at the top */}
        <label className="field-label">
          {t.mode}
          <Select
            value={form.mode}
            onChange={(e) =>
              onFormChange((c) => ({ ...c, mode: e.target.value as CreateMode, branch: "" }))
            }
          >
            <option value="new-branch">{t.modeNewBranch}</option>
            <option value="existing-branch">{t.modeExistingBranch}</option>
            <option value="remote-branch">{t.modeRemoteBranch}</option>
          </Select>
        </label>

        {/* New branch: base branch on top, dashed line, then new branch name */}
        {form.mode === "new-branch" && (
          <>
            <label className="field-label">
              {t.baseRef}
              <Select
                value={form.baseRef}
                onChange={(e) => onFormChange((c) => ({ ...c, baseRef: e.target.value }))}
              >
                {localBranches.map((b) => (
                  <option key={b} value={b}>{b}</option>
                ))}
              </Select>
            </label>
            <div className="field-label">
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span>{t.newBranchName}</span>
                <button
                  className="ghost-button"
                  onClick={() => onFormChange((c) => ({ ...c, branch: generateBranchName() }))}
                  style={{ fontSize: "0.72rem", padding: "2px 8px" }}
                >
                  ✦ {t.suggestBranchName}
                </button>
              </div>
              <Input
                autoFocus
                value={form.branch}
                onChange={(e) => onFormChange((c) => ({ ...c, branch: e.target.value }))}
                placeholder={t.branchPlaceholder}
              />
            </div>
          </>
        )}

        {/* Existing branch: select from local branches */}
        {form.mode === "existing-branch" && (() => {
          const usedBranches = new Set(
            repo.worktrees.map((w) => w.branch).filter(Boolean) as string[]
          );
          return (
            <label className="field-label">
              {t.branchPlaceholder}
              <Select
                autoFocus
                value={form.branch}
                onChange={(e) => onFormChange((c) => ({ ...c, branch: e.target.value }))}
              >
                <option value="">{t.selectBranch}</option>
                {localBranches.map((b) => {
                  const inUse = usedBranches.has(b);
                  return (
                    <option key={b} value={b} disabled={inUse}>
                      {b}{inUse ? ` (${t.inUse})` : ""}
                    </option>
                  );
                })}
              </Select>
            </label>
          );
        })()}

        {/* Remote branch: select from remote branches + fetch button */}
        {form.mode === "remote-branch" && (
          <label className="field-label">
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span>{t.remoteRef}</span>
              <button
                className="ghost-button"
                onClick={handleFetchRemote}
                disabled={isFetching}
                style={{ fontSize: "0.72rem", padding: "2px 8px", display: "inline-flex", alignItems: "center", gap: 4 }}
              >
                {isFetching && <span className="mini-spinner" />}
                {t.fetchRemote}
              </button>
            </div>
            <Select
              autoFocus
              value={form.remoteRef}
              onChange={(e) => {
                const ref = e.target.value;
                const localName = ref.includes("/") ? ref.substring(ref.indexOf("/") + 1) : ref;
                onFormChange((c) => ({ ...c, remoteRef: ref, branch: localName }));
              }}
            >
              <option value="">{t.selectBranch}</option>
              {remoteBranches.map((b) => (
                <option key={b} value={b}>{b}</option>
              ))}
            </Select>
          </label>
        )}

        <div className="field-label">
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span>{t.pathPreview}</span>
            <button
              className="ghost-button"
              onClick={onGoToSettings}
              style={{ fontSize: "0.72rem", padding: "2px 8px" }}
            >
              {t.setDefaultDirectory}
            </button>
          </div>
          <Input
            value={form.path || pathPreview || ""}
            onChange={(e) => onFormChange((c) => ({ ...c, path: e.target.value }))}
          />
        </div>
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
    </ModalShell>
  );
}
