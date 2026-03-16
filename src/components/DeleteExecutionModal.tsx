import { useEffect, useRef } from "react";
import { ModalShell } from "./ModalShell";
import type { ExecutionSessionSnapshot, ExecutionStatus, WorktreeRecord } from "../lib/types";
import type { Translations } from "../lib/i18n";

type DeleteExecutionPhase = "confirm" | ExecutionStatus;

type DeleteExecutionState = {
  worktree: WorktreeRecord;
  force: boolean;
  phase: DeleteExecutionPhase;
  session: ExecutionSessionSnapshot | null;
  isLoading: boolean;
};

export { type DeleteExecutionState, type DeleteExecutionPhase };

export function DeleteExecutionModal({
  execution,
  t,
  onClose,
  onConfirm,
}: {
  execution: DeleteExecutionState;
  t: Translations;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const logAnchorRef = useRef<HTMLDivElement>(null);
  const session = execution.session;
  const branchLabel = execution.worktree.branch ?? "worktree";
  const canClose =
    execution.phase === "confirm" ||
    execution.phase === "completed" ||
    execution.phase === "failed";

  useEffect(() => {
    logAnchorRef.current?.scrollIntoView({ block: "end" });
  }, [session?.logs.length]);

  let statusLabel = "";
  if (execution.phase === "running") statusLabel = t.executing;
  if (execution.phase === "completed") statusLabel = t.executionCompleted;
  if (execution.phase === "failed") statusLabel = t.executionFailed;

  return (
    <ModalShell
      title={session?.title ?? t.deleteConfirm(branchLabel)}
      onClose={onClose}
      canClose={canClose}
      className="delete-execution-modal"
      data-phase={execution.phase}
    >
      <div className="inline-panel delete-execution-summary">
        <div>
          <strong>{branchLabel}</strong>
          <p className="subtle delete-execution-path-label">{t.deletePathLabel}</p>
          <p className="detail-path delete-execution-path">{execution.worktree.path}</p>
        </div>
      </div>

      {execution.phase === "confirm" ? (
        <div className="modal-actions delete-execution-actions">
          <button className="ghost-button" onClick={onClose} disabled={execution.isLoading}>
            {t.cancel}
          </button>
          <button className="danger-button" onClick={onConfirm} disabled={execution.isLoading}>
            {execution.force ? t.force : t.delete}
          </button>
        </div>
      ) : (
        <>
          <div className="section-heading delete-execution-log-header">
            <span>{statusLabel}</span>
          </div>

          {session?.error && execution.phase === "failed" && (
            <div className="error-banner delete-execution-error">
              {session.error}
            </div>
          )}

          <div className="delete-execution-log-stream">
            {session?.logs.length ? (
              session.logs.map((log, index) => (
                <div
                  key={`${log.message}-${index}`}
                  className={`delete-execution-log-line delete-execution-log-line-${log.level} ${log.message.startsWith("$ ") ? "delete-execution-log-line-command" : ""}`}
                >
                  <span>{log.message}</span>
                </div>
              ))
            ) : (
              <p className="empty-copy">{t.noLogsYet}</p>
            )}
            <div ref={logAnchorRef} />
          </div>

          {canClose && (
            <div className="modal-actions delete-execution-actions">
              <button className="ghost-button" onClick={onClose} disabled={execution.isLoading}>
                {t.close}
              </button>
            </div>
          )}
        </>
      )}
    </ModalShell>
  );
}
