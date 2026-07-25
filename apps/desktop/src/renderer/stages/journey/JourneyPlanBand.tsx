/**
 * Aimcub Glass — the Journey's "plan as the object" band.
 *
 * One row per sub-aim (owner, state, evidence, eval verdict) rendered straight off the
 * `AimProgressReadModel`. A row expands in place to the full work detail that used to live in
 * the Execute stage — blocker, live run, permission consent, primary action, proof form — plus
 * the eval receipts (evidence review + evaluator matches) that used to live in the Eval stage.
 *
 * Selection (which row is open) and the active proof form are owned by the parent JourneyView so
 * the "Your move" card can drive them; the volatile drafts (proof text/files, permission consent)
 * live here. Consent is per sub-aim and per session, deliberately not persisted. An open proof
 * form disables switching rows and — via the parent — blocks normal navigation until submit or
 * cancel, exactly like the old Execute stage.
 */
import type { AimProgressReadModel, Milestone, RunEvent } from "@aimcub/core";
import { useEffect, useRef, useState, type RefObject } from "react";

import type { ConfirmMilestoneRequest, RunPermissionConsent } from "../../../shared/ipc";
import { useI18n } from "../../i18n";
import {
  emptyEvidenceDraft,
  evidenceDraftIsSubmittable,
  evidenceSubmissionPayload,
  type EvidenceSubmissionDraft,
} from "../../workflow/evidenceSubmission";
import { shortText } from "../../workflow/text";
import { EvaluatorMatchList, EvidenceReviewList } from "../eval/EvalStage";
import { EvidenceSubmissionForm } from "../execute/EvidenceSubmissionForm";
import {
  executeBlockedDetail,
  executeEvidenceLine,
  executePrimaryAction,
  executeRouteLabel,
  executeRowStatus,
  isHumanExecuteRoute,
  type ExecuteMilestoneRow,
  type ExecutePrimaryActionKind,
} from "../execute/executePrimaryAction";
import { LocalAgentExecutionSummary } from "../execute/LocalAgentExecutionSummary";
import { liveRunForMilestone, type LiveRunState } from "../execute/liveRun";
import { RunPermissionControl } from "../execute/RunPermissionControl";
import { RunTimelinePanel } from "../execute/RunTimelinePanel";
import {
  DEFAULT_RUN_PERMISSION_DRAFT,
  isRunPermissionReady,
  runPermissionRequest,
  type RunPermissionDraft,
} from "../execute/runPermissions";
import { StrandedRunNotice } from "../execute/StrandedRunNotice";
import { strandedRunFor } from "../execute/strandedRun";

/**
 * Whether a row's work is in flight right now — the only state that earns the pulsing dot.
 * Everything else stays dot-free; the trailing status pill carries state as text (never
 * color-only, matching the station glyph policy).
 */
export function planRowIsLive(row: ExecuteMilestoneRow, live: LiveRunState | null): boolean {
  const runStatus = live ? live.status : row.latest_run?.status;
  return !row.completed && (runStatus === "running" || runStatus === "queued");
}

export interface JourneyPlanBandProps {
  progress: AimProgressReadModel;
  runEvents?: readonly RunEvent[];
  disabled: boolean;
  /** The run currently streaming from the main-process worker, if it belongs to this aim. */
  liveRun?: LiveRunState | null;
  /** Run ids this session enqueued — distinguishes fresh queues from stranded ones. */
  sessionRunIds?: ReadonlySet<string>;
  /** Which sub-aim row is expanded (parent-owned so "Your move" can drive it). */
  selectedMilestoneId: string | null;
  onSelectMilestone: (milestoneId: string | null) => void;
  /** Which sub-aim's proof form is open (parent-owned; parent also holds the nav lock). */
  activeProofId: string | null;
  onProofActiveChange: (milestoneId: string | null) => void;
  onCancelRun?: (runId: string) => void;
  onRegrantRun?: (runId: string) => void;
  onPickRunWorkspace?: () => Promise<string | null>;
  onRunAgent: (milestone: Milestone, permission?: RunPermissionConsent) => void;
  onConfirmMilestone?: (
    milestone: Milestone,
    submission: Omit<ConfirmMilestoneRequest, "goalId" | "milestoneId">,
  ) => Promise<boolean>;
  onPickEvidenceFiles?: () => Promise<string[]>;
  onBreakDown?: (milestone: Milestone) => void;
}

export function JourneyPlanBand(props: JourneyPlanBandProps) {
  const { t } = useI18n();
  const rows = props.progress.milestones;
  const [proofDrafts, setProofDrafts] = useState<Record<string, EvidenceSubmissionDraft>>({});
  const [permissionDrafts, setPermissionDrafts] = useState<Record<string, RunPermissionDraft>>({});
  const [pickingFilesFor, setPickingFilesFor] = useState<string | null>(null);
  const [pickingWorkspaceFor, setPickingWorkspaceFor] = useState<string | null>(null);
  const proofTriggerRef = useRef<HTMLButtonElement>(null);
  const restoreProofFocusRef = useRef(false);
  const proofIsActive = props.activeProofId !== null;

  useEffect(() => {
    if (proofIsActive || !restoreProofFocusRef.current) return;
    restoreProofFocusRef.current = false;
    proofTriggerRef.current?.focus();
  }, [proofIsActive]);

  function proofDraftFor(milestone: Milestone): EvidenceSubmissionDraft {
    return proofDrafts[milestone.id] ?? emptyEvidenceDraft(milestone);
  }

  function permissionDraftFor(milestone: Milestone): RunPermissionDraft {
    return permissionDrafts[milestone.id] ?? DEFAULT_RUN_PERMISSION_DRAFT;
  }

  function openProof(milestone: Milestone): void {
    props.onSelectMilestone(milestone.id);
    props.onProofActiveChange(milestone.id);
  }

  function closeProof(restoreFocus: boolean): void {
    restoreProofFocusRef.current = restoreFocus;
    props.onProofActiveChange(null);
  }

  async function pickProofFiles(milestone: Milestone): Promise<void> {
    if (!props.onPickEvidenceFiles) return;
    setPickingFilesFor(milestone.id);
    try {
      const paths = await props.onPickEvidenceFiles();
      if (paths.length === 0) return;
      setProofDrafts((current) => {
        const base = current[milestone.id] ?? emptyEvidenceDraft(milestone);
        return {
          ...current,
          [milestone.id]: {
            ...base,
            filePaths: [...new Set([...base.filePaths, ...paths.map((path) => path.trim()).filter(Boolean)])],
          },
        };
      });
    } finally {
      setPickingFilesFor(null);
    }
  }

  async function submitProof(milestone: Milestone): Promise<void> {
    if (!props.onConfirmMilestone) return;
    const draft = proofDraftFor(milestone);
    if (!evidenceDraftIsSubmittable(draft)) return;
    const confirmed = await props.onConfirmMilestone(milestone, evidenceSubmissionPayload(draft));
    // On failure the form and draft stay open — App surfaces the error banner.
    if (!confirmed) return;
    closeProof(false);
    setProofDrafts((current) => {
      const next = { ...current };
      delete next[milestone.id];
      return next;
    });
  }

  async function pickRunWorkspace(milestone: Milestone): Promise<void> {
    if (!props.onPickRunWorkspace) return;
    setPickingWorkspaceFor(milestone.id);
    try {
      const path = await props.onPickRunWorkspace();
      if (!path) return;
      setPermissionDrafts((current) => ({
        ...current,
        [milestone.id]: { ...(current[milestone.id] ?? DEFAULT_RUN_PERMISSION_DRAFT), workspace: path },
      }));
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

  function runPrimary(row: ExecuteMilestoneRow, kind: ExecutePrimaryActionKind): void {
    if (kind === "run_agent") startRun(row.milestone);
    else if (kind === "submit_proof") openProof(row.milestone);
    // review_eval: the receipts are already inline below — nothing to navigate to.
  }

  if (rows.length === 0) return null;

  return (
    <div className="od-journey-plan-band" data-od-id="journey-plan-band">
      <div className="od-journey-journal-head">
        <span className="od-journey-eyebrow">{t("glass.station.plan")}</span>
        <span
          className="od-journey-journal-hint"
          aria-label={t("shell.progressValue", {
            done: props.progress.completed_milestones,
            total: props.progress.total_milestones,
          })}
        >
          {t("shell.progressValue", {
            done: props.progress.completed_milestones,
            total: props.progress.total_milestones,
          })}
        </span>
      </div>

      <div className="od-journey-planrows">
        {rows.map((row) => {
          const expanded = row.milestone.id === props.selectedMilestoneId;
          const live = liveRunForMilestone(props.liveRun ?? null, row.milestone.id);
          const status = executeRowStatus(row, t);
          const ownerChip: "you" | "agent" = isHumanExecuteRoute(row) ? "you" : "agent";
          return (
            <div className={`od-journey-planrow${expanded ? " is-open" : ""}`} key={row.milestone.id}>
              <button
                type="button"
                className="od-journey-planrow-head"
                aria-expanded={expanded}
                disabled={proofIsActive && !expanded}
                onClick={() => props.onSelectMilestone(expanded ? null : row.milestone.id)}
              >
                {planRowIsLive(row, live) ? (
                  <i className="od-journey-dot od-journey-dot-active" aria-hidden="true" />
                ) : null}
                <span className="od-journey-planrow-main">
                  <span className="od-journey-planrow-title">{shortText(row.milestone.title, 96)}</span>
                  <span className="od-journey-planrow-meta">
                    {[executeRouteLabel(row, t), executeEvidenceLine(row, t)].filter(Boolean).join(" · ")}
                  </span>
                </span>
                <span className={`od-journey-chip od-journey-chip-${ownerChip}`}>
                  {t(ownerChip === "you" ? "glass.actor.you" : "glass.actor.agent")}
                </span>
                <span className={`od-pill ${status.tone}`}>{status.label}</span>
              </button>
              {expanded ? (
                <PlanRowDetail
                  {...props}
                  row={row}
                  live={live}
                  proofOpen={props.activeProofId === row.milestone.id}
                  proofDraft={proofDraftFor(row.milestone)}
                  permissionDraft={permissionDraftFor(row.milestone)}
                  pickingFiles={pickingFilesFor === row.milestone.id}
                  pickingWorkspace={pickingWorkspaceFor === row.milestone.id}
                  proofTriggerRef={proofTriggerRef}
                  onOpenProof={() => openProof(row.milestone)}
                  onCloseProof={() => closeProof(true)}
                  onSubmitProof={() => void submitProof(row.milestone)}
                  onProofDraft={(draft) =>
                    setProofDrafts((current) => ({ ...current, [row.milestone.id]: draft }))}
                  onPermissionDraft={(draft) =>
                    setPermissionDrafts((current) => ({ ...current, [row.milestone.id]: draft }))}
                  onPickProofFiles={() => void pickProofFiles(row.milestone)}
                  onPickWorkspace={() => void pickRunWorkspace(row.milestone)}
                  onStartRun={() => startRun(row.milestone)}
                  onPrimary={(kind) => runPrimary(row, kind)}
                />
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function PlanRowDetail(props: JourneyPlanBandProps & {
  row: ExecuteMilestoneRow;
  live: LiveRunState | null;
  proofOpen: boolean;
  proofDraft: EvidenceSubmissionDraft;
  permissionDraft: RunPermissionDraft;
  pickingFiles: boolean;
  pickingWorkspace: boolean;
  proofTriggerRef: RefObject<HTMLButtonElement | null>;
  onOpenProof: () => void;
  onCloseProof: () => void;
  onSubmitProof: () => void;
  onProofDraft: (draft: EvidenceSubmissionDraft) => void;
  onPermissionDraft: (draft: RunPermissionDraft) => void;
  onPickProofFiles: () => void;
  onPickWorkspace: () => void;
  onStartRun: () => void;
  onPrimary: (kind: ExecutePrimaryActionKind) => void;
}) {
  const { t } = useI18n();
  const { row, live } = props;
  const primaryAction = executePrimaryAction(row, t);
  const humanRoute = isHumanExecuteRoute(row);
  const permissionReady = isRunPermissionReady(props.permissionDraft);
  const stranded = strandedRunFor({
    runs: props.progress.runs,
    milestoneId: row.milestone.id,
    sessionRunIds: props.sessionRunIds ?? new Set(),
  });
  const hasReceipts = row.evidence_count > 0 || row.evaluator_results.length > 0;
  const showSecondaryRun = primaryAction.kind !== "run_agent" && !humanRoute && !row.completed && !row.blocked;
  const showSecondaryProof = primaryAction.kind !== "submit_proof" && !row.completed && !row.blocked;
  // Nothing to press on a completed row whose receipts are already inline.
  const showPrimary = primaryAction.kind !== "review_eval";

  return (
    <div className="od-journey-planrow-detail" data-od-id="journey-planrow-detail">
      <LocalAgentExecutionSummary
        row={row}
        actors={props.progress.actors}
        task={props.proofOpen ? (
          <EvidenceSubmissionForm
            milestone={row.milestone}
            draft={props.proofDraft}
            disabled={props.disabled}
            pickingFiles={props.pickingFiles}
            onChange={props.onProofDraft}
            onPickFiles={props.onPickProofFiles}
            onCancel={props.onCloseProof}
            onSubmit={props.onSubmitProof}
          />
        ) : (
          <>
            {row.blocked ? (
              <div className="od-execute-blocker">
                <strong>{t("execute.blockedTitle")}</strong>
                <span>{executeBlockedDetail(row, t)}</span>
              </div>
            ) : null}

            {live ? (
              <div className="od-live-run" data-running={live.status === "running" ? "true" : "false"} role="status" aria-live="polite">
                <i className="od-live-run-dot" aria-hidden="true" />
                <div className="od-live-run-copy">
                  <strong>{live.status === "running" ? t("execute.liveRunTitle") : t("execute.liveRunFinished")}</strong>
                  <span>
                    {live.toolName
                      ? t("execute.liveRunTool", { tool: live.toolName })
                      : shortText(live.summary, 160) || t("execute.liveRunWaiting")}
                  </span>
                </div>
                {live.status === "running" && props.onCancelRun ? (
                  <button
                    className="od-aim-secondary od-live-run-stop"
                    type="button"
                    onClick={() => props.onCancelRun?.(live.runId)}
                  >
                    {t("execute.cancelRun")}
                  </button>
                ) : null}
              </div>
            ) : null}

            {stranded ? (
              <StrandedRunNotice
                run={stranded}
                disabled={props.disabled}
                onRegrant={() => props.onRegrantRun?.(stranded.runId)}
                onCancel={() => props.onCancelRun?.(stranded.runId)}
              />
            ) : null}

            {!humanRoute && !row.completed ? (
              <RunPermissionControl
                draft={props.permissionDraft}
                disabled={props.disabled}
                pickingWorkspace={props.pickingWorkspace}
                onChange={props.onPermissionDraft}
                onPickWorkspace={props.onPickWorkspace}
              />
            ) : null}

            {showPrimary ? (
              <div className="od-execute-primary-action">
                <div>
                  <span>{t("execute.primaryActionLabel")}</span>
                  <strong>{primaryAction.detail}</strong>
                </div>
                <button
                  className="od-aim-primary od-execute-primary-button"
                  type="button"
                  ref={primaryAction.kind === "submit_proof" ? props.proofTriggerRef : undefined}
                  disabled={
                    props.disabled
                    || primaryAction.kind === "blocked"
                    || (primaryAction.kind === "run_agent" && !permissionReady)
                  }
                  onClick={() => props.onPrimary(primaryAction.kind)}
                >
                  {primaryAction.label}
                </button>
              </div>
            ) : null}

            <div className="od-execute-secondary-actions" aria-label={t("execute.secondaryActionsLabel")}>
              {showSecondaryRun ? (
                <button
                  className="od-aim-secondary"
                  type="button"
                  disabled={props.disabled || !permissionReady}
                  onClick={props.onStartRun}
                >
                  {t("os.runAgent")}
                </button>
              ) : null}
              {showSecondaryProof ? (
                <button
                  ref={props.proofTriggerRef}
                  className="od-aim-secondary"
                  type="button"
                  disabled={props.disabled}
                  onClick={props.onOpenProof}
                >
                  {t("os.submitProof")}
                </button>
              ) : null}
              {!row.completed && props.onBreakDown ? (
                <button
                  className="od-aim-secondary"
                  type="button"
                  disabled={props.disabled}
                  onClick={() => props.onBreakDown?.(row.milestone)}
                >
                  {t("os.breakDown")}
                </button>
              ) : null}
            </div>

            {row.assignment?.reason ? <div className="od-work-note">{shortText(row.assignment.reason, 220)}</div> : null}

            {row.child_relations.length ? (
              <div className="od-work-note">
                <strong>{t("os.childBreakdown", { n: row.child_relations.length })}</strong>
                <span>{row.child_relations.map((item) => item.status).join(", ")}</span>
              </div>
            ) : null}

            {hasReceipts ? (
              <div className="od-eval-detail-list">
                <details className="od-eval-detail-section" open={primaryAction.kind === "review_eval" || undefined}>
                  <summary>
                    <span>{t("os.evalEvidenceReview")}</span>
                    <span className="od-pill">{t("os.evidenceCount", { n: row.evidence_count })}</span>
                  </summary>
                  <EvidenceReviewList row={row} />
                </details>
                <details className="od-eval-detail-section">
                  <summary>
                    <span>{t("os.evalEvaluatorMatches")}</span>
                    <span className="od-pill">{String(row.evaluator_results.length)}</span>
                  </summary>
                  <EvaluatorMatchList row={row} />
                </details>
              </div>
            ) : null}

            <RunTimelinePanel
              milestoneId={row.milestone.id}
              runEvents={props.runEvents ?? []}
              runs={props.progress.runs}
              liveEvents={live?.events ?? []}
              liveRunId={live?.runId ?? null}
              liveEventsDropped={live ? live.eventCount - live.events.length : 0}
            />
          </>
        )}
      />
    </div>
  );
}
