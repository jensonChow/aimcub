/**
 * Aimcub Glass — the Journey work surface (post-collapse).
 *
 * One aim, four things: the header (title, rename, completion), exactly one live lane
 * (planning session / build-plan / "Your move" / ambient), the plan as the object
 * (JourneyPlanBand — sub-aim rows that expand in place to the full work detail), and a
 * quiet journal disclosure of receipts. Pending context candidates surface as an inline
 * review band only when they exist.
 *
 * The old 6-station strip, the station drill-in sheets, and the Turns roster are gone
 * (Collapse Stage 2): stations presented the machine, and everything they opened now
 * lives on the plan rows or in the journal. All derivations still come from the pure
 * helpers under ../../workflow/journey off the existing AimProgressReadModel.
 */
import type { AimProgressReadModel, DecompositionOutput, Goal, Memory, Milestone, RunEvent } from "@aimcub/core";
import { useEffect, useRef, useState, type ReactNode } from "react";

import type { ConfirmMilestoneRequest, RunPermissionConsent } from "../../../shared/ipc";
import { ContextInbox, type ContextInboxScope } from "../../ContextInbox";
import { useI18n, type StringKey } from "../../i18n";
import { pendingContextCandidates } from "../../labels";
import {
  buildJourneyAmbient,
  buildJourneyJournal,
  buildJourneyYourMove,
  type JourneyActorKind,
  type JourneyJournalEntry,
} from "../../workflow/journey";
import type { CockpitStage } from "../../workflow/workspaceNavigation";
import { CompletionRecapPanel } from "../eval/EvalStage";
import type { LiveRunState } from "../execute/liveRun";
import { PlanPanel, type PlanPanelProps } from "../plan/PlanPanel";
import { JourneyPlanBand } from "./JourneyPlanBand";

const ACTOR_KEY: Record<JourneyActorKind, StringKey> = {
  you: "glass.actor.you",
  agent: "glass.actor.agent",
  cub: "glass.actor.cub",
};

function formatClock(iso: string): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return "";
  try {
    return new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}

/**
 * The plan-review interior: `PlanPanel` for a saved goal — the node selector + one contract
 * card (why / done-when / evidence / eval-signal / routing / acceptance-rule) + metrics +
 * validation.
 *
 * Read-only by default (no `onCommitPlan`): `saved` + `onChange={undefined}`. When
 * `onCommitPlan` is supplied, it becomes editable in place: edits buffer into a
 * component-local `editedPlan` (never persisted per-keystroke — `planMerge` matches
 * milestones by title, so a per-keystroke merge would churn ids), and an explicit
 * "Save plan changes" commits the whole buffered plan through the App handler
 * (→ `updateGoalPlan`). The buffer is dropped whenever the underlying saved plan changes
 * (commit / refresh / re-plan), so a background update never fights a stale local edit.
 */
export type JourneyPlanReviewProps = Pick<
  PlanPanelProps,
  "plan" | "quality" | "review" | "validationErrors" | "routingAgents" | "routingValidation"
> & {
  disabled: boolean;
  /** When present, the plan review is editable in place; commit persists the buffered plan. */
  onCommitPlan?: (plan: DecompositionOutput) => void;
};

const NOOP_SAVE = () => {};

export function JourneyPlanReview(props: JourneyPlanReviewProps) {
  const { t } = useI18n();
  const editable = Boolean(props.onCommitPlan);
  const [editedPlan, setEditedPlan] = useState<DecompositionOutput | null>(null);
  // Drop the local edit buffer whenever the underlying saved plan changes (commit / refresh / re-plan).
  useEffect(() => {
    setEditedPlan(null);
  }, [props.plan]);
  const plan = editedPlan ?? props.plan;
  const dirty = editedPlan !== null && editedPlan !== props.plan;
  return (
    <div className="od-journey-plan">
      <PlanPanel
        plan={plan}
        quality={props.quality}
        review={props.review}
        saved
        editableWhenSaved={editable}
        disabled={props.disabled}
        validationErrors={props.validationErrors}
        routingAgents={props.routingAgents}
        routingValidation={props.routingValidation}
        onChange={editable ? setEditedPlan : undefined}
        onSave={NOOP_SAVE}
      />
      {editable ? (
        <div className="od-journey-plan-actions">
          <button
            className="od-journey-primary"
            type="button"
            disabled={props.disabled || !dirty}
            onClick={() => {
              if (dirty) props.onCommitPlan?.(plan);
            }}
          >
            {t("glass.journey.savePlanChanges")}
          </button>
          {dirty ? (
            <button className="od-journey-secondary" type="button" onClick={() => setEditedPlan(null)}>
              {t("glass.journey.discardPlanChanges")}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export interface JourneyViewProps {
  goal: Goal;
  progress: AimProgressReadModel | null;
  /** The aim's run-lifecycle event stream (loaded separately from progress). */
  runEvents?: RunEvent[];
  onAcceptContextCandidate?: (candidate: Memory, content: string, scope: ContextInboxScope) => void;
  onRejectContextCandidate?: (candidate: Memory) => void;
  /**
   * Pure Plan view-model for the in-place plan review (the plan-ready landing while planning,
   * and the buffered plan editor for a saved goal). `onCommitPlan` makes it editable in place;
   * omit it for a read-only review.
   */
  planReview?: Pick<
    PlanPanelProps,
    "plan" | "quality" | "review" | "validationErrors" | "routingAgents" | "routingValidation"
  > & { onCommitPlan?: (plan: DecompositionOutput) => void };
  /** Re-plan the SAME aim with a fresh planning run (merges, freezing completed work). */
  onReplan?: () => void;
  /**
   * Rename the aim's title/description in place (works on a shell or a planned goal — no
   * plan change). When present, the Journey header shows an inline "Rename" editor.
   */
  onRenameAim?: (input: { title: string; description: string }) => void;
  disabled?: boolean;
  /** Count of OTHER aims with a turn waiting on the user, for the header jump chip. */
  elsewhereCount?: number;
  onOpenStage: (stage: CockpitStage) => void;
  /** Dispatch an agent run. Without consent the App defaults to a read-only, no-network grant. */
  onRunAgent: (milestone: Milestone, permission?: RunPermissionConsent) => void;
  /**
   * The plan band's work-detail wiring (the Execute stage's surface moving home, Collapse
   * Stage 1). All optional: a Journey without them renders read-only rows.
   */
  liveRun?: LiveRunState | null;
  sessionRunIds?: ReadonlySet<string>;
  onCancelRun?: (runId: string) => void;
  onRegrantRun?: (runId: string) => void;
  onPickRunWorkspace?: () => Promise<string | null>;
  onBreakDown?: (milestone: Milestone) => void;
  /** Nav lock while an in-Journey proof draft is open (same contract as the Execute stage). */
  onProofDraftActiveChange?: (active: boolean) => void;
  /**
   * Submit human evidence for a milestone from a plan row's in-place evidence form (the live
   * `confirmMilestone` App handler). Returns whether the confirm persisted.
   */
  onConfirmMilestone?: (
    milestone: Milestone,
    submission: Omit<ConfirmMilestoneRequest, "goalId" | "milestoneId">,
  ) => Promise<boolean>;
  /** Pick local files to attach to an in-place evidence draft (the App file picker). */
  onPickEvidenceFiles?: () => Promise<string[]>;
  onNewAim: () => void;
  /** Jump to the next aim with a turn waiting elsewhere (header chip). */
  onJumpElsewhere?: () => void;
  /**
   * Secondary "Your move" / ambient affordances. Each renders only when its handler is
   * provided; the routing/scheduling backends have not landed, so App passes none today
   * and these stay hidden (the markup + CSS ship as forward-ready infrastructure).
   */
  onHandToAgent?: () => void;
  onSchedule?: () => void;
  onLater?: () => void;
  onTakeBack?: () => void;
  /**
   * Goal-first. Whether a planning runtime is configured — gates the plan-less shell's
   * "build the plan" action (a not-ready shell links to Settings instead of dead-ending).
   */
  planningRuntimeReady?: boolean;
  /** Model chip for the planning brain, rendered beside the Build-the-plan action. */
  modelChip?: ReactNode;
  /** Start the first-plan research run for a plan-less shell goal. */
  onStartResearch?: () => void;
  /**
   * The aim's STOPPED planning pass, when it left a checkpoint worth showing (`PlanningPassPanel`).
   * Takes the live lane ahead of the build-plan card: an aim Aimcub was already planning must never
   * ask its owner to start planning as though nothing had happened (founder, 2026-07-26). Only
   * consulted for a plan-less aim with no live session — a live session always outranks a
   * checkpoint, and a planned aim shows its plan.
   */
  pausedPlanning?: ReactNode;
  /**
   * Receipts from the aim's planning pass, merged into the Journal. Supplied for a PLANNED aim too
   * (not just a paused one): the pass that produced the plan is exactly the receipt the Journal was
   * missing.
   */
  planningJournal?: JourneyJournalEntry[];
  /**
   * The in-Journey first-plan surface for a shell goal. When present, the Journey hosts the
   * research/clarify/plan-review interaction in place of the Your-move card (never leaving the
   * Journey): the clarify Q&A element while a clarify phase is active, then the generated plan
   * review with an Accept action, else a working indicator.
   */
  planning?: {
    busy: boolean;
    clarifyPanel: ReactNode;
    planReady: boolean;
    onCommitPlan: () => void;
  };
}

export function JourneyView(props: JourneyViewProps) {
  const { t } = useI18n();
  const tk = (key: string, vars?: Record<string, string | number>) => t(key as StringKey, vars);
  // Plan-band selection: which sub-aim row is expanded, and which one's proof form is open.
  // Owned here (not in the band) so the "Your move" CTA can land on a row. Keyed by goal.id at
  // the App mount, so switching aims resets both. The proof form carries the same navigation
  // lock the Execute stage had, released on unmount so a stale lock can never outlive the view.
  const [planSelectedId, setPlanSelectedId] = useState<string | null>(null);
  const [planProofId, setPlanProofId] = useState<string | null>(null);
  const proofLockRef = useRef(props.onProofDraftActiveChange);
  useEffect(() => {
    proofLockRef.current = props.onProofDraftActiveChange;
  }, [props.onProofDraftActiveChange]);
  useEffect(() => {
    return () => proofLockRef.current?.(false);
  }, []);

  function setProofActive(milestoneId: string | null): void {
    setPlanProofId(milestoneId);
    props.onProofDraftActiveChange?.(milestoneId !== null);
  }

  // In-Journey aim rename: a component-local buffer seeded on open, committed via the
  // epoch-safe App `onRenameAim` handler. JourneyView is keyed by goal.id in App, so switching
  // aims remounts and resets this — no reset effect needed.
  const [renaming, setRenaming] = useState(false);
  const [renameTitle, setRenameTitle] = useState("");
  const [renameDescription, setRenameDescription] = useState("");
  const { progress, goal } = props;

  function openRename(): void {
    setRenameTitle(goal.title);
    setRenameDescription(goal.description ?? "");
    setRenaming(true);
  }

  function saveRename(): void {
    if (!renameTitle.trim()) return;
    props.onRenameAim?.({ title: renameTitle, description: renameDescription });
    setRenaming(false);
  }

  // The Journey header's aim block: the title + sub line, plus (when App supplies `onRenameAim`) an
  // inline rename editor. Rendered at BOTH header sites (the plan-less shell branch + the main branch).
  function renderAimHead(sub: string): ReactNode {
    if (renaming && props.onRenameAim) {
      return (
        <div className="od-journey-head-main od-journey-aim-edit" data-od-id="journey-aim-edit">
          <input
            className="od-journey-aim-edit-title"
            type="text"
            value={renameTitle}
            aria-label={t("glass.journey.rename.titleLabel")}
            disabled={props.disabled}
            onChange={(event) => setRenameTitle(event.target.value)}
            autoFocus
          />
          <textarea
            className="od-journey-aim-edit-desc"
            value={renameDescription}
            rows={2}
            placeholder={t("glass.journey.rename.descPlaceholder")}
            aria-label={t("glass.journey.rename.descLabel")}
            disabled={props.disabled}
            onChange={(event) => setRenameDescription(event.target.value)}
          />
          <div className="od-journey-aim-edit-actions">
            <button
              className="od-journey-primary"
              type="button"
              disabled={props.disabled || !renameTitle.trim()}
              onClick={saveRename}
            >
              {t("glass.journey.rename.save")}
            </button>
            <button className="od-journey-secondary" type="button" onClick={() => setRenaming(false)}>
              {t("glass.journey.rename.cancel")}
            </button>
          </div>
        </div>
      );
    }
    return (
      <div className="od-journey-head-main">
        <h1 className="od-journey-title">{goal.title}</h1>
        <p className="od-journey-sub">{sub}</p>
        {props.onRenameAim ? (
          <button className="od-journey-aim-rename" type="button" disabled={props.disabled} onClick={openRename}>
            {t("glass.journey.rename")}
          </button>
        ) : null}
      </div>
    );
  }

  if (!progress) {
    return (
      <section className="od-journey" data-od-id="journey-view">
        <header className="od-journey-head">
          {renderAimHead(t("glass.journey.noPlan"))}
        </header>
      </section>
    );
  }

  const move = buildJourneyYourMove(progress, t);
  const ambient = buildJourneyAmbient(progress);
  const journal = buildJourneyJournal(progress, props.runEvents ?? [], props.planningJournal ?? []);
  // The header meta reads as the design's completion percent; the exact fraction stays
  // on the accessible name/tooltip.
  const headMeta = progress.total_milestones > 0
    ? `${Math.round((progress.completed_milestones / progress.total_milestones) * 100)}%`
    : "";
  const pendingCandidates = pendingContextCandidates(progress.context_candidates);
  const acceptCandidate = props.onAcceptContextCandidate;
  const rejectCandidate = props.onRejectContextCandidate;
  const elsewhereCount = props.elsewhereCount ?? 0;
  const showElsewhere = elsewhereCount > 0 && Boolean(props.onJumpElsewhere);
  const hasMoveSecondary = Boolean(props.onHandToAgent || props.onSchedule || props.onLater);

  const moveMilestone = move
    ? progress.milestones.find((row) => row.milestone.id === move.milestoneId)?.milestone ?? null
    : null;

  function runMove(): void {
    if (!move) return;
    if (move.kind === "run_agent" && moveMilestone) {
      props.onRunAgent(moveMilestone);
      return;
    }
    // The move resolves on its own plan row: proof opens the row's evidence form in place,
    // review/blocked expand the row (receipts and blocker detail are inline). A move whose
    // milestone left the model between refreshes is stale — expanding nothing is honest.
    setPlanSelectedId(move.milestoneId);
    if (move.kind === "submit_proof" && moveMilestone) setProofActive(moveMilestone.id);
  }

  const headerEl = (
    <header className="od-journey-head">
      {renderAimHead(props.planning
        ? t("glass.journey.planningSub")
        : t("glass.journey.headerSub"))}
      <div className="od-journey-head-meta">
        {showElsewhere ? (
          <button
            className="od-journey-elsewhere"
            type="button"
            onClick={props.onJumpElsewhere}
            title={t("glass.journey.headerSub")}
          >
            {elsewhereCount === 1
              ? t("glass.journey.turnsElsewhereOne")
              : tk("glass.journey.turnsElsewhereMany", { n: elsewhereCount })}
          </button>
        ) : null}
        {headMeta ? (
          <span
            className="od-journey-meta"
            aria-label={tk("shell.progressValue", { done: progress.completed_milestones, total: progress.total_milestones })}
            title={tk("shell.progressValue", { done: progress.completed_milestones, total: progress.total_milestones })}
          >
            {headMeta}
          </span>
        ) : null}
      </div>
    </header>
  );

  const inboxEl = pendingCandidates.length > 0 && acceptCandidate && rejectCandidate ? (
    <div className="od-journey-inbox" data-od-id="journey-inbox">
      <ContextInbox
        candidates={pendingCandidates}
        currentAimTitle={goal.title}
        disabled={Boolean(props.disabled)}
        onAccept={acceptCandidate}
        onReject={rejectCandidate}
      />
    </div>
  ) : null;

  const journalEl = (
    <details className="od-journey-journal">
      <summary className="od-journey-journal-head">
        <span className="od-journey-eyebrow">{t("glass.journey.journalTitle")}</span>
        <span className="od-journey-journal-hint">{t("glass.journey.journalHint")}</span>
      </summary>
      {journal.length === 0 ? (
        <div className="od-journey-journal-empty">{t("glass.journal.empty")}</div>
      ) : (
        journal.map((entry) => (
          <div className="od-journey-journal-row" key={entry.id}>
            <span className="od-journey-journal-time">{formatClock(entry.at)}</span>
            <span className={`od-journey-chip od-journey-chip-${entry.who}`}>{tk(ACTOR_KEY[entry.who])}</span>
            <span className="od-journey-journal-what">
              {entry.what || (entry.detailKey ? tk(`glass.journal.event.${entry.detailKey}`, entry.detailVars) : "")}
            </span>
          </div>
        ))
      )}
    </details>
  );

  // A completed aim leads with its factual recap (final outcome, sub-aims, evidence, eval,
  // learned context) — the live lane and plan rows would only restate it. Candidate triage
  // and the journal stay: they are the recap's decision moment and its receipts.
  if (progress.completion_recap?.complete) {
    return (
      <section className="od-journey" data-od-id="journey-view">
        {headerEl}
        <CompletionRecapPanel progress={progress} />
        {inboxEl}
        {journalEl}
      </section>
    );
  }

  return (
    <section className="od-journey" data-od-id="journey-view">
      {headerEl}

      {props.planning ? (
        <div className="od-journey-planning" data-od-id="journey-planning">
          {props.planning.clarifyPanel ? (
            props.planning.clarifyPanel
          ) : props.planning.planReady && props.planReview ? (
            <div className="od-journey-planning-review">
              <div className="od-journey-eyebrow">{t("glass.journey.planReviewTitle")}</div>
              <JourneyPlanReview {...props.planReview} onCommitPlan={undefined} disabled={props.planning.busy} />
              <div className="od-journey-move-actions">
                <button
                  className="od-journey-primary"
                  type="button"
                  disabled={props.planning.busy}
                  onClick={props.planning.onCommitPlan}
                >
                  {t("glass.journey.savePlanCta")}
                </button>
              </div>
            </div>
          ) : (
            <div className="od-journey-planning-working">
              <i className="od-journey-dot od-journey-dot-active" aria-hidden="true" />
              <div className="od-journey-ambient-title">{t("glass.journey.planningWorking")}</div>
            </div>
          )}
        </div>
      ) : progress.total_milestones === 0 && props.pausedPlanning ? (
        <div className="od-journey-planning" data-od-id="journey-paused-planning">
          {props.pausedPlanning}
        </div>
      ) : progress.total_milestones === 0 ? (
        <div className="od-journey-move" data-od-id="journey-build-plan">
          <div className="od-journey-move-head">
            <span className="od-journey-move-tag">{t("glass.journey.buildPlanTag")}</span>
            <span className="od-journey-chip od-journey-chip-you">{t("glass.actor.you")}</span>
          </div>
          <div className="od-journey-move-title">{t("glass.journey.buildPlanTitle")}</div>
          <p className="od-journey-move-body">{t("glass.journey.buildPlanBody")}</p>
          <div className="od-journey-move-actions">
            {props.planningRuntimeReady === false ? (
              <button className="od-journey-secondary" type="button" onClick={() => props.onOpenStage("settings")}>
                {t("glass.journey.buildPlanNoRuntime")}
              </button>
            ) : (
              <>
                <button
                  className="od-journey-primary"
                  type="button"
                  disabled={props.disabled || !props.onStartResearch}
                  onClick={props.onStartResearch}
                >
                  {t("glass.journey.buildPlanCta")}
                </button>
                {props.modelChip}
              </>
            )}
          </div>
        </div>
      ) : move ? (
        <div className="od-journey-move" data-od-id="journey-move">
          <div className="od-journey-move-head">
            <span className="od-journey-move-tag">{tk(move.tagKey)}</span>
            <span className="od-journey-chip od-journey-chip-you">{t("glass.actor.you")}</span>
          </div>
          <div className="od-journey-move-title">{move.title}</div>
          {move.body ? <p className="od-journey-move-body">{move.body}</p> : null}
          <div className="od-journey-move-actions">
            <button className="od-journey-primary" type="button" disabled={props.disabled} onClick={runMove}>
              {move.primaryLabel}
            </button>
          </div>
          {hasMoveSecondary ? (
            <div className="od-journey-move-secondary">
              {props.onHandToAgent ? (
                <button className="od-journey-secondary" type="button" onClick={props.onHandToAgent}>
                  {t("glass.journey.handToAgent")}
                </button>
              ) : null}
              {props.onSchedule ? (
                <button className="od-journey-secondary" type="button" onClick={props.onSchedule}>
                  {t("glass.journey.schedule")}
                </button>
              ) : null}
              {props.onLater ? (
                <button className="od-journey-later" type="button" onClick={props.onLater}>
                  {t("glass.journey.later")}
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : (
        <div className="od-journey-ambient" data-od-id="journey-ambient">
          <i className="od-journey-dot od-journey-dot-active" aria-hidden="true" />
          <div className="od-journey-ambient-main">
            <div className="od-journey-ambient-title">{tk(ambient.titleKey)}</div>
            {ambient.body ? <div className="od-journey-ambient-body">{ambient.body}</div> : null}
          </div>
          {props.onTakeBack ? (
            <button className="od-journey-ambient-btn" type="button" onClick={props.onTakeBack}>
              {t("glass.journey.takeBack")}
            </button>
          ) : null}
        </div>
      )}

      {progress.total_milestones > 0 ? (
        <JourneyPlanBand
          progress={progress}
          runEvents={props.runEvents}
          disabled={Boolean(props.disabled)}
          liveRun={props.liveRun}
          sessionRunIds={props.sessionRunIds}
          selectedMilestoneId={planSelectedId}
          onSelectMilestone={setPlanSelectedId}
          activeProofId={planProofId}
          onProofActiveChange={setProofActive}
          onCancelRun={props.onCancelRun}
          onRegrantRun={props.onRegrantRun}
          onPickRunWorkspace={props.onPickRunWorkspace}
          onRunAgent={props.onRunAgent}
          onConfirmMilestone={props.onConfirmMilestone}
          onPickEvidenceFiles={props.onPickEvidenceFiles}
          onBreakDown={props.onBreakDown}
          onReplan={props.onReplan}
        />
      ) : null}

      {inboxEl}

      {journalEl}
    </section>
  );
}
