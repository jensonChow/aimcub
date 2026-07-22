import { useEffect, useRef, useState, type ReactNode } from "react";

import type { AimProgressReadModel } from "@core/domain";
import type { Milestone, RunEvent } from "@core/types";
import type { ConfirmMilestoneRequest, GoalDetail, RunPermissionConsent } from "../../../shared/ipc";

import { useI18n } from "../../i18n";
import {
  emptyEvidenceDraft,
  evidenceDraftIsSubmittable,
  evidenceSubmissionPayload,
  type EvidenceSubmissionDraft,
} from "../../workflow/evidenceSubmission";
import { progressRows } from "../../workflow/stageRouting";
import { shortText } from "../../workflow/text";
import { EvidenceSubmissionForm } from "./EvidenceSubmissionForm";
import {
  executeBlockedDetail,
  executeEvidenceLine,
  executePrimaryAction,
  executeRouteLabel,
  executeRowStatus,
  isHumanExecuteRoute,
  type ExecuteMilestoneRow,
  type ExecutePrimaryActionKind,
} from "./executePrimaryAction";
import { LocalAgentExecutionSummary } from "./LocalAgentExecutionSummary";
import { liveRunForMilestone, type LiveRunState } from "./liveRun";
import { RunPermissionControl } from "./RunPermissionControl";
import { RunTimelinePanel } from "./RunTimelinePanel";
import {
  DEFAULT_RUN_PERMISSION_DRAFT,
  isRunPermissionReady,
  runPermissionRequest,
  type RunPermissionDraft,
} from "./runPermissions";

export function ExecutePanel(props: {
  detail: GoalDetail;
  progress: AimProgressReadModel | null;
  /** The aim's persisted run-event stream, for the per-run timeline. */
  runEvents?: readonly RunEvent[];
  disabled: boolean;
  /** The run currently streaming from the main-process worker, if any. */
  liveRun?: LiveRunState | null;
  onCancelRun?: (runId: string) => void;
  /** Open the native folder picker behind a `workspace-write` grant. */
  onPickRunWorkspace?: () => Promise<string | null>;
  onRunAgent: (milestone: Milestone, permission: RunPermissionConsent) => void;
  onConfirm: (milestone: Milestone, submission: Omit<ConfirmMilestoneRequest, "goalId" | "milestoneId">) => Promise<boolean>;
  onPickFiles: () => Promise<string[]>;
  onBreakDown: (milestone: Milestone) => void;
  onReviewEval: () => void;
  onProofDraftActiveChange?: (active: boolean) => void;
}) {
  const { t } = useI18n();
  const rows = progressRows(props.detail, props.progress);
  const openRows = rows.filter((row) => !row.completed);
  const agentAssignments = rows.filter((row) => row.assignment?.actor_kind === "agent").length;
  const humanAssignments = rows.filter((row) => row.assignment?.actor_kind === "human").length;
  const defaultSelectedRow = rows.find((row) => !row.completed && !row.blocked) ?? rows.find((row) => !row.completed) ?? rows[0] ?? null;
  const [selectedMilestoneId, setSelectedMilestoneId] = useState<string | null>(null);
  const [activeProofId, setActiveProofId] = useState<string | null>(null);
  const [proofDrafts, setProofDrafts] = useState<Record<string, EvidenceSubmissionDraft>>({});
  const [pickingFilesFor, setPickingFilesFor] = useState<string | null>(null);
  // Consent is per sub-aim and per session: it is deliberately NOT persisted, so a wider grant
  // never silently outlives the moment the user chose it.
  const [permissionDrafts, setPermissionDrafts] = useState<Record<string, RunPermissionDraft>>({});
  const [pickingWorkspaceFor, setPickingWorkspaceFor] = useState<string | null>(null);
  const proofTriggerRef = useRef<HTMLButtonElement>(null);
  const restoreProofFocusRef = useRef(false);
  const proofDraftActiveChangeRef = useRef(props.onProofDraftActiveChange);
  const selectedRow = rows.find((row) => row.milestone.id === selectedMilestoneId) ?? defaultSelectedRow;

  function proofDraftFor(milestone: Milestone): EvidenceSubmissionDraft {
    return proofDrafts[milestone.id] ?? emptyEvidenceDraft(milestone);
  }

  function updateProofDraft(milestone: Milestone, updater: (draft: EvidenceSubmissionDraft) => EvidenceSubmissionDraft): void {
    setProofDrafts((current) => ({
      ...current,
      [milestone.id]: updater(current[milestone.id] ?? emptyEvidenceDraft(milestone)),
    }));
  }

  function openProof(milestone: Milestone): void {
    setSelectedMilestoneId(milestone.id);
    setActiveProofId(milestone.id);
    setProofDrafts((current) => current[milestone.id] ? current : { ...current, [milestone.id]: emptyEvidenceDraft(milestone) });
    props.onProofDraftActiveChange?.(true);
  }

  function closeProof(restoreFocus: boolean): void {
    restoreProofFocusRef.current = restoreFocus;
    setActiveProofId(null);
    props.onProofDraftActiveChange?.(false);
  }

  async function pickProofFiles(milestone: Milestone): Promise<void> {
    setPickingFilesFor(milestone.id);
    try {
      const paths = await props.onPickFiles();
      if (paths.length === 0) return;
      updateProofDraft(milestone, (draft) => ({
        ...draft,
        filePaths: [...new Set([...draft.filePaths, ...paths.map((path) => path.trim()).filter(Boolean)])],
      }));
    } finally {
      setPickingFilesFor(null);
    }
  }

  async function submitProof(milestone: Milestone): Promise<void> {
    const draft = proofDraftFor(milestone);
    if (!evidenceDraftIsSubmittable(draft)) return;
    const confirmed = await props.onConfirm(milestone, evidenceSubmissionPayload(draft));
    if (!confirmed) return;
    closeProof(false);
    setProofDrafts((current) => {
      const next = { ...current };
      delete next[milestone.id];
      return next;
    });
  }

  function permissionDraftFor(milestone: Milestone): RunPermissionDraft {
    return permissionDrafts[milestone.id] ?? DEFAULT_RUN_PERMISSION_DRAFT;
  }

  function setPermissionDraft(milestone: Milestone, next: RunPermissionDraft): void {
    setPermissionDrafts((current) => ({ ...current, [milestone.id]: next }));
  }

  async function pickRunWorkspace(milestone: Milestone): Promise<void> {
    if (!props.onPickRunWorkspace) return;
    setPickingWorkspaceFor(milestone.id);
    try {
      const path = await props.onPickRunWorkspace();
      if (!path) return;
      setPermissionDraft(milestone, { ...permissionDraftFor(milestone), workspace: path });
    } finally {
      setPickingWorkspaceFor(null);
    }
  }

  /** Never start a run whose grant is incomplete — an unfinished consent is not a consent. */
  function startRun(milestone: Milestone): void {
    const draft = permissionDraftFor(milestone);
    if (!isRunPermissionReady(draft)) return;
    props.onRunAgent(milestone, runPermissionRequest(draft));
  }

  function runPrimaryAction(row: ExecuteMilestoneRow, kind: ExecutePrimaryActionKind): void {
    if (kind === "run_agent") {
      startRun(row.milestone);
      return;
    }
    if (kind === "submit_proof") {
      openProof(row.milestone);
      return;
    }
    if (kind === "review_eval") {
      props.onReviewEval();
    }
  }

  const selectedLiveRun = selectedRow ? liveRunForMilestone(props.liveRun ?? null, selectedRow.milestone.id) : null;
  const primaryAction = selectedRow ? executePrimaryAction(selectedRow, t) : null;
  const selectedHumanRoute = selectedRow ? isHumanExecuteRoute(selectedRow) : false;
  const selectedPermission = selectedRow ? permissionDraftFor(selectedRow.milestone) : DEFAULT_RUN_PERMISSION_DRAFT;
  const permissionReady = isRunPermissionReady(selectedPermission);
  const showSecondaryRun = Boolean(
    selectedRow
    && primaryAction?.kind !== "run_agent"
    && !selectedHumanRoute
    && !selectedRow.completed
    && !selectedRow.blocked,
  );
  const showSecondaryProof = Boolean(
    selectedRow
    && primaryAction?.kind !== "submit_proof"
    && !selectedRow.completed
    && !selectedRow.blocked,
  );
  const proofIsActive = Boolean(selectedRow && activeProofId === selectedRow.milestone.id);

  useEffect(() => {
    if (proofIsActive || !restoreProofFocusRef.current) return;
    restoreProofFocusRef.current = false;
    proofTriggerRef.current?.focus();
  }, [proofIsActive]);

  useEffect(() => {
    proofDraftActiveChangeRef.current = props.onProofDraftActiveChange;
  }, [props.onProofDraftActiveChange]);

  useEffect(() => {
    return () => proofDraftActiveChangeRef.current?.(false);
  }, []);

  return (
    <section className="od-stage-panel">
      <div className="od-stage-panel-head">
        <div>
          <div className="od-stage-kicker">{t("os.stepExecute")}</div>
          <h2>{t("os.executeHeading")}</h2>
          <p>{t("os.executeBody")}</p>
        </div>
      </div>

      <div className="od-stage-metrics" aria-label={t("os.executeHeading")}>
        <StageMetric label={t("os.activeWork")} value={String(openRows.length)} />
        <StageMetric label={t("os.agentAssignments")} value={String(agentAssignments)} />
        <StageMetric label={t("os.humanAssignments")} value={String(humanAssignments)} />
      </div>

      {selectedRow && primaryAction ? (
        <div className="od-execute-layout">
          <div className="od-execute-selector" aria-label={t("execute.subAimSelectorLabel")}>
            {rows.map((row, index) => {
              const status = executeRowStatus(row, t);
              const selected = row.milestone.id === selectedRow.milestone.id;
              return (
                <button
                  key={row.milestone.id}
                  className={`od-execute-selector-row${selected ? " is-selected" : ""}`}
                  type="button"
                  aria-current={selected ? "true" : undefined}
                  disabled={proofIsActive}
                  onClick={() => setSelectedMilestoneId(row.milestone.id)}
                >
                  <span className="od-execute-selector-index">{index + 1}</span>
                  <span className="od-execute-selector-main">
                    <strong>{shortText(row.milestone.title, 84)}</strong>
                    <small>{[executeRouteLabel(row, t), executeEvidenceLine(row, t)].join(" | ")}</small>
                  </span>
                  <span className={`od-pill ${status.tone}`}>{status.label}</span>
                </button>
              );
            })}
          </div>

          <article className="od-execute-detail" aria-label={t("execute.selectedDetailLabel")}>
            <LocalAgentExecutionSummary
              row={selectedRow}
              actors={props.progress?.actors ?? []}
              task={executeTaskContent(proofIsActive ? (
                <EvidenceSubmissionForm
                  milestone={selectedRow.milestone}
                  draft={proofDraftFor(selectedRow.milestone)}
                  disabled={props.disabled}
                  pickingFiles={pickingFilesFor === selectedRow.milestone.id}
                  onChange={(next) => updateProofDraft(selectedRow.milestone, () => next)}
                  onPickFiles={() => void pickProofFiles(selectedRow.milestone)}
                  onCancel={() => closeProof(true)}
                  onSubmit={() => void submitProof(selectedRow.milestone)}
                />
              ) : null, (
                <>
                  {selectedRow.blocked ? (
                    <div className="od-execute-blocker">
                      <strong>{t("execute.blockedTitle")}</strong>
                      <span>{executeBlockedDetail(selectedRow, t)}</span>
                    </div>
                  ) : null}

                  {selectedLiveRun ? (
                    <LiveRunLine
                      live={selectedLiveRun}
                      onCancel={props.onCancelRun}
                      t={t}
                    />
                  ) : null}

                  {!selectedHumanRoute && !selectedRow.completed ? (
                    <RunPermissionControl
                      draft={selectedPermission}
                      disabled={props.disabled}
                      pickingWorkspace={pickingWorkspaceFor === selectedRow.milestone.id}
                      onChange={(next) => setPermissionDraft(selectedRow.milestone, next)}
                      onPickWorkspace={() => void pickRunWorkspace(selectedRow.milestone)}
                    />
                  ) : null}

                  <div className="od-execute-primary-action">
                    <div>
                      <span>{t("execute.primaryActionLabel")}</span>
                      <strong>{primaryAction.detail}</strong>
                    </div>
                    <button
                      className="od-aim-primary od-execute-primary-button"
                      type="button"
                      ref={primaryAction.kind === "submit_proof" ? proofTriggerRef : undefined}
                      disabled={
                        props.disabled
                        || primaryAction.kind === "blocked"
                        || (primaryAction.kind === "run_agent" && !permissionReady)
                      }
                      onClick={() => runPrimaryAction(selectedRow, primaryAction.kind)}
                    >
                      {primaryAction.label}
                    </button>
                  </div>

                  <div className="od-execute-secondary-actions" aria-label={t("execute.secondaryActionsLabel")}>
                    {showSecondaryRun ? (
                      <button
                        className="od-aim-secondary"
                        type="button"
                        disabled={props.disabled || !permissionReady}
                        onClick={() => startRun(selectedRow.milestone)}
                      >
                        {t("os.runAgent")}
                      </button>
                    ) : null}
                    {showSecondaryProof ? (
                      <button
                        ref={proofTriggerRef}
                        className="od-aim-secondary"
                        type="button"
                        disabled={props.disabled}
                        onClick={() => openProof(selectedRow.milestone)}
                      >
                        {t("os.submitProof")}
                      </button>
                    ) : null}
                    {!selectedRow.completed ? (
                      <button className="od-aim-secondary" type="button" disabled={props.disabled} onClick={() => props.onBreakDown(selectedRow.milestone)}>
                        {t("os.breakDown")}
                      </button>
                    ) : null}
                  </div>

                  {selectedRow.assignment?.reason ? <div className="od-work-note">{shortText(selectedRow.assignment.reason, 220)}</div> : null}

                  {selectedRow.child_relations.length ? (
                    <div className="od-work-note">
                      <strong>{t("os.childBreakdown", { n: selectedRow.child_relations.length })}</strong>
                      <span>{selectedRow.child_relations.map((item) => item.status).join(", ")}</span>
                    </div>
                  ) : null}

                  <RunTimelinePanel
                    milestoneId={selectedRow.milestone.id}
                    runEvents={props.runEvents ?? []}
                    runs={props.progress?.runs ?? []}
                    liveEvents={selectedLiveRun?.events ?? []}
                    liveRunId={selectedLiveRun?.runId ?? null}
                    liveEventsDropped={
                      selectedLiveRun ? selectedLiveRun.eventCount - selectedLiveRun.events.length : 0
                    }
                  />
                </>
              ))}
            />
          </article>
        </div>
      ) : (
        <div className="od-empty-inline">{t("execute.emptySubAims")}</div>
      )}
    </section>
  );
}

export function executeTaskContent(proofTask: ReactNode | null, normalTask: ReactNode): ReactNode {
  return proofTask ?? normalTask;
}

/**
 * The live face of a queued run: what the agent is doing right now, and the way to stop it. The
 * durable record is the run timeline below it — this is the part that is only true while it is
 * happening, so it gets its own Glass row (a running dot, the status line, Stop) rather than
 * borrowing the generic work-note style.
 */
function LiveRunLine(props: {
  live: LiveRunState;
  onCancel?: (runId: string) => void;
  t: ReturnType<typeof useI18n>["t"];
}) {
  const { live, t } = props;
  const running = live.status === "running";
  const detail = live.toolName
    ? t("execute.liveRunTool", { tool: live.toolName })
    : shortText(live.summary, 160) || t("execute.liveRunWaiting");
  return (
    <div className="od-live-run" data-running={running ? "true" : "false"} role="status" aria-live="polite">
      <i className="od-live-run-dot" aria-hidden="true" />
      <div className="od-live-run-copy">
        <strong>{running ? t("execute.liveRunTitle") : t("execute.liveRunFinished")}</strong>
        <span>{detail}</span>
      </div>
      {running && props.onCancel ? (
        <button className="od-aim-secondary od-live-run-stop" type="button" onClick={() => props.onCancel?.(live.runId)}>
          {t("execute.cancelRun")}
        </button>
      ) : null}
    </div>
  );
}

function StageMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="od-stage-metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
