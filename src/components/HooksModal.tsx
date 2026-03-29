import { useEffect, useState } from "react";
import { ChevronRight } from "lucide-react";
import { Textarea, Select } from "./FormControls";
import { ModalShell } from "./ModalShell";
import { Alert } from "./Alert";
import { detectInstallCommand } from "../lib/api";
import type { HookEvent, HookStep, LauncherProfile, ShellInfo } from "../lib/types";
import type { Translations } from "../lib/i18n";

type HooksMap = Partial<Record<HookEvent, HookStep[]>>;

const HOOK_EVENTS: HookEvent[] = [
  "pre-create",
  "post-create",
  "pre-launch",
  "post-launch",
  "pre-remove",
  "post-remove",
];
const HOOK_STEP_TYPES: HookStep["type"][] = ["copy-files", "install", "script", "launch"];

function createStepDraft(type: HookStep["type"], launchers: LauncherProfile[]): HookStep {
  return {
    type,
    run: type === "script" ? "" : undefined,
    launcherId: type === "launch" ? (launchers[0]?.id ?? "vscode") : undefined,
    paths: type === "copy-files" ? [".env.local"] : undefined,
  };
}

function formatHookPaths(paths: string[] | undefined): string {
  return (paths ?? []).join("\n");
}

function parseHookPaths(raw: string): string[] {
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function hookTypeLabel(type: HookStep["type"], t: Translations): string {
  switch (type) {
    case "script":
      return t.hookTypeScript;
    case "launch":
      return t.hookTypeLaunch;
    case "install":
      return t.hookTypeInstall;
    case "copy-files":
      return t.hookTypeCopyFiles;
  }
}

function hookEventDescription(event: HookEvent, t: Translations): string {
  switch (event) {
    case "pre-create":
      return t.hookEventPreCreateHelp;
    case "post-create":
      return t.hookEventPostCreateHelp;
    case "pre-launch":
      return t.hookEventPreLaunchHelp;
    case "post-launch":
      return t.hookEventPostLaunchHelp;
    case "pre-remove":
      return t.hookEventPreRemoveHelp;
    case "post-remove":
      return t.hookEventPostRemoveHelp;
  }
}

export { type HooksMap };

export function HooksModal({
  hooks,
  launchers,
  repoRoot,
  onSave,
  onClose,
  isBusy,
  t,
  availableShells,
  defaultShell,
}: {
  hooks: HooksMap;
  launchers: LauncherProfile[];
  repoRoot: string;
  onSave: (hooks: HooksMap) => Promise<boolean>;
  onClose: () => void;
  isBusy: boolean;
  t: Translations;
  availableShells: ShellInfo[];
  defaultShell: string;
}) {
  const [draft, setDraft] = useState<HooksMap>(() => ({ ...hooks }));
  const [pendingEvent, setPendingEvent] = useState<HookEvent>("post-create");
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<HookEvent>>(() => {
    const active = HOOK_EVENTS.filter((e) => (hooks[e]?.length ?? 0) > 0);
    return new Set(active);
  });
  const [installPlaceholder, setInstallPlaceholder] = useState("");

  useEffect(() => {
    setDraft({ ...hooks });
  }, [hooks]);

  useEffect(() => {
    detectInstallCommand(repoRoot).then((cmd) => {
      setInstallPlaceholder(cmd ?? "");
    });
  }, [repoRoot]);

  function toggleExpand(event: HookEvent) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(event)) next.delete(event);
      else next.add(event);
      return next;
    });
  }

  function patchStep(event: HookEvent, stepIndex: number, patch: Partial<HookStep>) {
    setDraft((prev) => ({
      ...prev,
      [event]: (prev[event] ?? []).map((step, i) =>
        i === stepIndex ? { ...step, ...patch } : step
      ),
    }));
  }

  function updateStepType(event: HookEvent, stepIndex: number, type: HookStep["type"]) {
    setDraft((prev) => ({
      ...prev,
      [event]: (prev[event] ?? []).map((step, i) =>
        i === stepIndex ? createStepDraft(type, launchers) : step
      ),
    }));
  }

  function removeStep(event: HookEvent, stepIndex: number) {
    setDraft((prev) => {
      const steps = (prev[event] ?? []).filter((_, i) => i !== stepIndex);
      const next = { ...prev };
      if (steps.length === 0) {
        delete next[event];
        setExpanded((exp) => { const n = new Set(exp); n.delete(event); return n; });
      } else {
        next[event] = steps;
      }
      return next;
    });
  }

  function removeEvent(event: HookEvent) {
    setDraft((prev) => {
      const next = { ...prev };
      delete next[event];
      return next;
    });
    setExpanded((prev) => { const n = new Set(prev); n.delete(event); return n; });
  }

  function addStep(event: HookEvent) {
    setDraft((prev) => ({
      ...prev,
      [event]: [...(prev[event] ?? []), createStepDraft("copy-files", launchers)],
    }));
  }

  const activeEvents = HOOK_EVENTS.filter((event) => (draft[event]?.length ?? 0) > 0);
  const availableEvents = HOOK_EVENTS.filter((event) => !(draft[event]?.length));

  const effectivePendingEvent = availableEvents.includes(pendingEvent)
    ? pendingEvent
    : availableEvents[0] ?? pendingEvent;

  return (
    <ModalShell title={t.hooks} onClose={onClose} className="hooks-modal-card">
      <Alert message={error} onDismiss={() => setError(null)} />
      <div className="hooks-add-bar">
        <Select
          value={effectivePendingEvent}
          onChange={(e) => setPendingEvent(e.target.value as HookEvent)}
          disabled={isBusy || availableEvents.length === 0}
        >
          {availableEvents.map((event) => (
            <option key={event} value={event}>{event}</option>
          ))}
          {availableEvents.length === 0 && <option disabled>—</option>}
        </Select>
        <button
          className="primary-button"
          disabled={isBusy || availableEvents.length === 0}
          onClick={() => {
            if (draft[effectivePendingEvent]?.length) return;
            setDraft((prev) => ({
              ...prev,
              [effectivePendingEvent]: [createStepDraft("copy-files", launchers)],
            }));
            setExpanded((prev) => new Set(prev).add(effectivePendingEvent));
          }}
        >
          + {t.addHook}
        </button>
      </div>
      <div className="hooks-list">
        {activeEvents.length === 0 && <p className="hooks-empty">{t.noHooksConfigured}</p>}
        {activeEvents.map((event) => {
          const isOpen = expanded.has(event);
          const steps = draft[event] ?? [];
          return (
            <section key={event} className="hook-group">
              <div className="hook-group-header" onClick={() => toggleExpand(event)}>
                <ChevronRight className={`hook-group-chevron${isOpen ? " expanded" : ""}`} size={16} />
                <span className="hook-group-event">{event}</span>
                <span className="hook-group-count">
                  {steps.length} {steps.length === 1 ? "step" : "steps"}
                </span>
                <button
                  className="hook-group-remove"
                  onClick={(e) => { e.stopPropagation(); removeEvent(event); }}
                  disabled={isBusy}
                >
                  {t.removeHook}
                </button>
              </div>
              {isOpen && (
                <div className="hook-group-body">
                  <p className="hook-event-help">{hookEventDescription(event, t)}</p>
                  {steps.map((step, stepIndex) => (
                    <div key={stepIndex} className="hook-step">
                      <span className="hook-step-number">{stepIndex + 1}</span>
                      <div className="hook-step-body">
                        <div className="hook-step-top">
                          <Select
                            value={step.type}
                            onChange={(e) => updateStepType(event, stepIndex, e.target.value as HookStep["type"])}
                            disabled={isBusy}
                          >
                            {HOOK_STEP_TYPES.map((type) => (
                              <option key={type} value={type}>{hookTypeLabel(type, t)}</option>
                            ))}
                          </Select>
                          <button
                            className="hook-step-remove"
                            onClick={() => removeStep(event, stepIndex)}
                            disabled={isBusy}
                            title={t.removeHook}
                          >
                            ×
                          </button>
                        </div>
                        <div className="hook-step-config">
                          {step.type === "script" && (
                            <>
                              <label className="field-label">
                                {t.hookCommand}
                                <Textarea
                                  rows={2}
                                  value={step.run ?? ""}
                                  onChange={(e) => patchStep(event, stepIndex, { run: e.target.value })}
                                  disabled={isBusy}
                                />
                              </label>
                              <label className="field-label">
                                Shell
                                <Select
                                  value={step.shell ?? ""}
                                  onChange={(e) => patchStep(event, stepIndex, { shell: e.target.value || null })}
                                  disabled={isBusy}
                                >
                                  <option value="">{t.defaultShellLabel} ({availableShells.find((s) => s.path === defaultShell)?.label ?? defaultShell})</option>
                                  {availableShells.map((s) => (
                                    <option key={s.path} value={s.path}>{s.label} ({s.path})</option>
                                  ))}
                                </Select>
                              </label>
                            </>
                          )}
                          {step.type === "launch" && (
                            <label className="field-label">
                              {t.hookLauncher}
                              <Select
                                value={step.launcherId ?? launchers[0]?.id ?? ""}
                                onChange={(e) => patchStep(event, stepIndex, { launcherId: e.target.value })}
                                disabled={isBusy}
                              >
                                {launchers.map((launcher) => (
                                  <option key={launcher.id} value={launcher.id}>{launcher.name}</option>
                                ))}
                              </Select>
                            </label>
                          )}
                          {step.type === "install" && (
                            <>
                              <label className="field-label">
                                {t.hookCommand}
                                <Textarea
                                  rows={2}
                                  value={step.run ?? ""}
                                  placeholder={installPlaceholder || t.hookInstallHint}
                                  onChange={(e) => patchStep(event, stepIndex, { run: e.target.value })}
                                  disabled={isBusy}
                                />
                              </label>
                              <label className="field-label">
                                Shell
                                <Select
                                  value={step.shell ?? ""}
                                  onChange={(e) => patchStep(event, stepIndex, { shell: e.target.value || null })}
                                  disabled={isBusy}
                                >
                                  <option value="">{t.defaultShellLabel} ({availableShells.find((s) => s.path === defaultShell)?.label ?? defaultShell})</option>
                                  {availableShells.map((s) => (
                                    <option key={s.path} value={s.path}>{s.label} ({s.path})</option>
                                  ))}
                                </Select>
                              </label>
                            </>
                          )}
                          {step.type === "copy-files" && (
                            <label className="field-label">
                              {t.hookPaths}
                              <Textarea
                                rows={2}
                                value={formatHookPaths(step.paths)}
                                onChange={(e) => patchStep(event, stepIndex, { paths: parseHookPaths(e.target.value) })}
                                disabled={isBusy}
                              />
                            </label>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                  <button
                    className="hook-add-step"
                    disabled={isBusy}
                    onClick={() => addStep(event)}
                  >
                    + {t.addStep}
                  </button>
                </div>
              )}
            </section>
          );
        })}
      </div>
      <div className="modal-actions">
        <button
          className="primary-button"
          onClick={async () => {
            setError(null);
            const ok = await onSave(draft);
            if (!ok) setError(t.saveHooksFailed ?? "Save failed");
          }}
          disabled={isBusy}
        >
          {t.saveHooks}
        </button>
      </div>
    </ModalShell>
  );
}
