/**
 * Aimcub Glass — the "Journey" work surface.
 *
 * Replaces the goal landing panel (AimOverviewPanel). It renders the 6-station strip,
 * a single "Your move" card (or an "Ambient" card when nothing is waiting on the user),
 * a "Turns" roster, and a "Journal" receipt timeline — all derived from the existing
 * AimProgressReadModel via the pure helpers in ../../workflow/journey.
 *
 * The station "sheet" is component-local overlay state, keyed by goal id at the mount
 * site, so it never touches the App's workspace/surface navigation epochs and is cleared
 * automatically on any real navigation (stage change unmounts this view; goal change
 * remounts it). Actual mutations route through the existing epoch-safe App handlers.
 *
 * A station sheet can also be *interactive*: the Run station lists the aim's dispatchable
 * agent work as selectable options gated behind a confirm that calls the existing `runAgent`
 * handler in place (see `JourneyRunSheetBody`). Selection is component-local and reset on
 * every station change; the confirm is membership-gated so a background progress refresh
 * can't dispatch a milestone that dropped out of the option set.
 */
import type { AimProgressReadModel, DecompositionOutput, Goal, Memory, Milestone, RunEvent } from "@core/domain";
import { useEffect, useRef, useState, type ReactNode } from "react";

import type { ConfirmMilestoneRequest } from "../../../shared/ipc";
import { ContextInbox, type ContextInboxScope } from "../../ContextInbox";
import type { ContextBundleReview } from "../../contextReview";
import { useI18n, type StringKey } from "../../i18n";
import { pendingContextCandidates } from "../../labels";
import {
  emptyEvidenceDraft,
  evidenceDraftIsSubmittable,
  evidenceSubmissionPayload,
  type EvidenceSubmissionDraft,
} from "../../workflow/evidenceSubmission";
import type { CockpitStage } from "../../workflow/workspaceNavigation";
import {
  buildJourneyAmbient,
  buildJourneyJournal,
  buildJourneyStationSheet,
  buildJourneyStations,
  buildJourneyTurns,
  buildJourneyYourMove,
  canConfirmInteraction,
  resolveSelectedOption,
  type JourneyActorKind,
  type JourneyChip,
  type JourneyStationId,
  type JourneyStationInteraction,
  type JourneyStationKind,
  type JourneyStationSheetRow,
} from "../../workflow/journey";
import { ContextActivityPanel } from "../context/ContextActivityPanel";
import type { ContextLoopModel } from "../context/contextLoop";
import { ContextReviewPanel } from "../context/ContextReviewPanel";
import { CompletionRecapPanel, EvidenceReviewList } from "../eval/EvalStage";
import { EvidenceSubmissionForm } from "../execute/EvidenceSubmissionForm";
import { PlanPanel, type PlanPanelProps } from "../plan/PlanPanel";

const STATION_NAME_KEY: Record<JourneyStationId, StringKey> = {
  aim: "glass.station.aim",
  research: "glass.station.research",
  context: "glass.station.context",
  plan: "glass.station.plan",
  run: "glass.station.run",
  eval: "glass.station.eval",
};

/** Static, data-free descriptor shown under each station-sheet title (mirrors the reference sub). */
const SHEET_SUB_KEY: Record<JourneyStationId, StringKey> = {
  aim: "glass.journey.sheetSub.aim",
  research: "glass.journey.sheetSub.research",
  context: "glass.journey.sheetSub.context",
  plan: "glass.journey.sheetSub.plan",
  run: "glass.journey.sheetSub.run",
  eval: "glass.journey.sheetSub.eval",
};

const CHIP_KEY: Record<JourneyChip, StringKey> = {
  "aim": "glass.chip.aim",
  "owner.you": "glass.chip.you",
  "owner.agent": "glass.chip.agent",
  "status.done": "glass.chip.met",
  "status.open": "glass.chip.open",
  "status.blocked": "glass.chip.blocked",
  "eval.met": "glass.chip.met",
  "eval.open": "glass.chip.open",
  "context": "glass.chip.context",
};

const ACTOR_KEY: Record<JourneyActorKind, StringKey> = {
  you: "glass.actor.you",
  agent: "glass.actor.agent",
  cub: "glass.actor.cub",
};

/** Localized labels for the memory-category `meta` shown on context/research sheet rows. */
const MEMORY_CAT_KEY: Record<string, StringKey> = {
  preference: "glass.memory.cat.preference",
  constraint: "glass.memory.cat.constraint",
  capability: "glass.memory.cat.capability",
  eval_signal: "glass.memory.cat.eval_signal",
  project_fact: "glass.memory.cat.project_fact",
  procedure: "glass.memory.cat.procedure",
};

/**
 * Localized labels for the status-token `meta` on plan/run/eval sheet rows (the milestone/run
 * status literals). Free-text metas — e.g. an eval row's `next_action` — are not in this map and
 * pass through verbatim, so `translate()` is never called with an unknown key.
 */
const STATION_META_KEY: Record<string, StringKey> = {
  done: "glass.station.meta.done",
  blocked: "glass.station.meta.blocked",
  met: "glass.station.meta.met",
  pending: "glass.station.meta.pending",
  in_progress: "glass.station.meta.inProgress",
  completed: "glass.station.meta.completed",
  skipped: "glass.station.meta.skipped",
  queued: "glass.station.meta.queued",
  running: "glass.station.meta.running",
  failed: "glass.station.meta.failed",
  cancelled: "glass.station.meta.cancelled",
};

/** Localizes a status-literal meta (run/milestone status) via `STATION_META_KEY`, else passes it through. */
function statusMetaLabel(meta: string | undefined, tk: (key: string) => string): string {
  if (!meta) return "";
  const key = STATION_META_KEY[meta];
  return key ? tk(key) : meta;
}

function stationGlyphClass(kind: JourneyStationKind): string {
  return `od-journey-dot od-journey-dot-${kind}`;
}

function chipClass(chip: JourneyChip): string {
  return `od-journey-chip od-journey-chip-${chip.split(".")[0]}`;
}

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
 * The interactive body of the Run station sheet: agent-dispatchable milestones as a single-select
 * radiogroup with an enable-gated confirm; human milestones ready for proof as a second, actionable
 * group (each opens the in-sheet evidence form via `onPickEvidence`); and the non-dispatchable
 * remainder read-only below. Stateless and prop-driven so it renders (and is asserted) under
 * `renderToStaticMarkup` — the parent owns the selection/draft state. The evidence group renders as
 * plain read-only rows when `onPickEvidence` is absent (honest: no actionable affordance without a
 * handler).
 */
export interface JourneyRunSheetBodyProps {
  interaction: JourneyStationInteraction;
  selectedOptionId: string | null;
  disabled: boolean;
  onSelect: (milestoneId: string) => void;
  onConfirm: () => void;
  onPickEvidence?: (milestoneId: string) => void;
}

export function JourneyRunSheetBody(props: JourneyRunSheetBodyProps) {
  const { interaction, selectedOptionId, disabled, onSelect, onConfirm, onPickEvidence } = props;
  const { t } = useI18n();
  const tk = (key: string, vars?: Record<string, string | number>) => t(key as StringKey, vars);
  const hasSelection = resolveSelectedOption(interaction.options, selectedOptionId) !== null;
  const canConfirm = canConfirmInteraction(selectedOptionId, interaction.options, disabled);
  const hasAgentWork = interaction.options.length > 0;

  return (
    <div className="od-journey-interactive">
      {hasAgentWork ? (
        <div className="od-journey-options" role="radiogroup" aria-label={t("glass.station.run")}>
          {interaction.options.map((option) => {
            const selected = option.milestoneId === selectedOptionId;
            return (
              <button
                key={option.milestoneId}
                type="button"
                role="radio"
                aria-checked={selected}
                className={`od-journey-option${selected ? " od-journey-option-open" : ""}`}
                onClick={() => onSelect(option.milestoneId)}
              >
                <span className="od-journey-option-title">{option.text}</span>
                {option.note ? <span className="od-journey-option-note">{statusMetaLabel(option.note, tk)}</span> : null}
              </button>
            );
          })}
        </div>
      ) : null}

      {interaction.evidenceOptions.length > 0 ? (
        <div className="od-journey-evidence">
          <span className="od-journey-evidence-label">{t("glass.journey.evidenceGroup")}</span>
          {interaction.evidenceOptions.map((option) => (onPickEvidence ? (
            <button
              key={option.milestoneId}
              type="button"
              className="od-journey-evidence-option"
              disabled={disabled}
              onClick={() => onPickEvidence(option.milestoneId)}
            >
              <span className="od-journey-option-title">{option.text}</span>
              {option.note ? <span className="od-journey-option-note">{statusMetaLabel(option.note, tk)}</span> : null}
            </button>
          ) : (
            <div className="od-journey-sheet-row" key={option.milestoneId}>
              <span className={chipClass(option.chip)}>{tk(CHIP_KEY[option.chip])}</span>
              <span className="od-journey-sheet-text">{option.text}</span>
            </div>
          )))}
        </div>
      ) : null}

      {interaction.contextRows.length > 0 ? (
        <div className="od-journey-sheet-rows">
          {interaction.contextRows.map((row, index) => (
            <div className="od-journey-sheet-row" key={`ctx-${row.chip}-${index}`}>
              <span className={chipClass(row.chip)}>{t(CHIP_KEY[row.chip])}</span>
              <span className="od-journey-sheet-text">{row.text}</span>
              {row.meta ? <span className="od-journey-sheet-meta">{statusMetaLabel(row.meta, tk)}</span> : null}
            </div>
          ))}
        </div>
      ) : null}

      {hasAgentWork ? (
        <div className="od-journey-sheet-hint">
          <span className="od-journey-sheet-hint-text">{t("glass.journey.interactiveHint")}</span>
          <button className="od-journey-primary" type="button" disabled={!canConfirm} onClick={onConfirm}>
            {hasSelection ? t("glass.journey.confirmRun") : t("glass.journey.confirmPick")}
          </button>
        </div>
      ) : null}
    </div>
  );
}

/**
 * The Context station sheet's interior: the pending-candidate inbox (actionable triage), an
 * honest activity/sufficiency panel shown ONLY while research is live, and a read-only receipt of
 * the context behind the contracts. Stateless and prop-driven so it renders (and is asserted)
 * under `renderToStaticMarkup`; the accept/reject side effects route through the App handlers.
 */
export interface JourneyContextSheetBodyProps {
  loop: ContextLoopModel;
  review: ContextBundleReview;
  pendingCandidates: Memory[];
  currentAimTitle: string;
  disabled: boolean;
  onAccept: (candidate: Memory, content: string, scope: ContextInboxScope) => void;
  onReject: (candidate: Memory) => void;
}

export function JourneyContextSheetBody(props: JourneyContextSheetBodyProps) {
  const { loop, review, pendingCandidates, currentAimTitle, disabled, onAccept, onReject } = props;
  const { t } = useI18n();
  const reviewCount =
    review.usedContext.length +
    review.skippedContext.length +
    review.permissionGaps.length +
    review.decompositionRisks.length;
  const hasInbox = pendingCandidates.length > 0;
  // On a settled goal the activity rows resolve to misleading "waiting" states, so the panel is
  // shown only when research is actually in flight.
  const showActivity = loop.hasLiveResearchData;
  const isEmpty = !hasInbox && !showActivity && reviewCount === 0;

  return (
    <div className="od-journey-context">
      {hasInbox ? (
        <ContextInbox
          candidates={pendingCandidates}
          currentAimTitle={currentAimTitle}
          disabled={disabled}
          onAccept={onAccept}
          onReject={onReject}
        />
      ) : null}
      {showActivity ? <ContextActivityPanel model={loop} /> : null}
      <ContextReviewPanel bundle={review} running={false} compact />
      {isEmpty ? <p className="od-journey-context-empty">{t("glass.journey.contextEmpty")}</p> : null}
    </div>
  );
}

/**
 * The Plan station sheet's interior. Reuses `PlanPanel` for a saved goal — the node selector + one
 * contract card (why / done-when / evidence / eval-signal / routing / acceptance-rule) + metrics +
 * validation.
 *
 * Read-only by default (no `onCommitPlan`): `saved` + `onChange={undefined}`, exactly what the old
 * contracts stage shows. When `onCommitPlan` is supplied (Stage 6B), the sheet becomes editable
 * in place: edits buffer into a component-local `editedPlan` (never persisted per-keystroke —
 * `planMerge` matches milestones by title, so a per-keystroke merge would churn ids), and an
 * explicit "Save plan changes" commits the whole buffered plan through the App handler
 * (→ `updateGoalPlan`). The buffer is dropped whenever the underlying saved plan changes (commit /
 * refresh / re-plan), so a background update never fights a stale local edit. Rendered under
 * `renderToStaticMarkup` in tests (hooks are SSR-safe: the reset effect is a no-op there).
 */
export type JourneyPlanSheetBodyProps = Pick<
  PlanPanelProps,
  "plan" | "quality" | "review" | "validationErrors" | "routingAgents" | "routingValidation"
> & {
  disabled: boolean;
  /** When present, the plan sheet is editable in place; commit persists the buffered plan. */
  onCommitPlan?: (plan: DecompositionOutput) => void;
};

const NOOP_SAVE = () => {};

export function JourneyPlanSheetBody(props: JourneyPlanSheetBodyProps) {
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

/**
 * The Eval station sheet's interior: the saved-goal read-only eval review. When the aim is complete
 * it shows the real `CompletionRecapPanel` (the same recap the old Eval stage renders); otherwise it
 * frames every milestone (met/open chip + title + next-action meta, mirroring the flat `evalRows`)
 * and nests the read-only `EvidenceReviewList` under any milestone that already has evidence. Eval
 * has no live milestone-mutation (evidence review is read-only; context-candidate triage lives in the
 * Context sheet), so this body is honest read-only. Stateless; rendered under `renderToStaticMarkup`.
 */
export interface JourneyEvalSheetBodyProps {
  progress: AimProgressReadModel;
}

export function JourneyEvalSheetBody(props: JourneyEvalSheetBodyProps) {
  const { t } = useI18n();
  const tk = (key: string) => t(key as StringKey);
  const { progress } = props;

  if (progress.completion_recap?.complete) {
    return (
      <div className="od-journey-eval">
        <CompletionRecapPanel progress={progress} />
      </div>
    );
  }

  return (
    <div className="od-journey-eval">
      {progress.milestones.map((row) => {
        const chip: JourneyChip = row.eval_review.passed ? "eval.met" : "eval.open";
        const meta = row.eval_review.passed ? tk("glass.station.meta.met") : row.next_action;
        return (
          <div className="od-journey-eval-item" key={row.milestone.id}>
            <div className="od-journey-eval-head">
              <span className={chipClass(chip)}>{tk(CHIP_KEY[chip])}</span>
              <span className="od-journey-eval-title">{row.milestone.title}</span>
              {meta ? <span className="od-journey-eval-meta">{meta}</span> : null}
            </div>
            {row.evidence.length > 0 ? <EvidenceReviewList row={row} compact /> : null}
          </div>
        );
      })}
    </div>
  );
}

export interface JourneyViewProps {
  goal: Goal;
  progress: AimProgressReadModel | null;
  /** The aim's run-lifecycle event stream (loaded separately from progress). */
  runEvents?: RunEvent[];
  /** Active context/research memories in play for this aim (aim-scoped + global). */
  researchMemories?: Memory[];
  /**
   * Pure Context view-models for the Context station sheet (the saved-goal Context interior).
   * When present alongside the candidate handlers, the Context sheet hosts the inbox / activity /
   * review instead of read-only rows.
   */
  contextLoop?: ContextLoopModel;
  contextReview?: ContextBundleReview;
  onAcceptContextCandidate?: (candidate: Memory, content: string, scope: ContextInboxScope) => void;
  onRejectContextCandidate?: (candidate: Memory) => void;
  /**
   * Pure Plan view-model for the Plan station sheet. When present, the Plan sheet hosts the real
   * contract interior (`PlanPanel`) instead of flat plan rows. `onCommitPlan` (Stage 6B) makes the
   * saved-goal Plan drill-in sheet editable in place; omit it for a read-only review.
   */
  planReview?: Pick<
    PlanPanelProps,
    "plan" | "quality" | "review" | "validationErrors" | "routingAgents" | "routingValidation"
  > & { onCommitPlan?: (plan: DecompositionOutput) => void };
  /** Re-plan the SAME aim with a fresh planning run (Stage 6B; merges, freezing completed work). */
  onReplan?: () => void;
  disabled?: boolean;
  /** Count of OTHER aims with a turn waiting on the user, for the header jump chip. */
  elsewhereCount?: number;
  onOpenStage: (stage: CockpitStage) => void;
  onRunAgent: (milestone: Milestone) => void;
  /**
   * Submit human evidence for a milestone from the Run sheet's in-place evidence form (the live
   * `confirmMilestone` App handler). Returns whether the confirm persisted. When present, human
   * milestones ready for proof become actionable evidence options; otherwise they stay read-only.
   */
  onConfirmMilestone?: (
    milestone: Milestone,
    submission: Omit<ConfirmMilestoneRequest, "goalId" | "milestoneId">,
  ) => Promise<boolean>;
  /** Pick local files to attach to the in-sheet evidence draft (the App file picker). */
  onPickEvidenceFiles?: () => Promise<string[]>;
  onNewAim: () => void;
  /** Jump to the next aim with a turn waiting elsewhere (header chip). */
  onJumpElsewhere?: () => void;
  /**
   * Secondary "Your move" / ambient affordances. Each renders only when its handler is
   * provided; the routing/scheduling backends land in Stage 6, so App passes none today
   * and these stay hidden (the markup + CSS ship as forward-ready infrastructure).
   */
  onHandToAgent?: () => void;
  onSchedule?: () => void;
  onLater?: () => void;
  onTakeBack?: () => void;
  /**
   * Goal-first (Stage 6). Whether a planning runtime is configured — gates the plan-less shell's
   * "build the plan" action (a not-ready shell links to Settings instead of dead-ending).
   */
  planningRuntimeReady?: boolean;
  /** Start the first-plan research run for a plan-less shell goal. */
  onStartResearch?: () => void;
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
  // Sheet `meta` is a raw memory-category enum only on context/research rows; localize those,
  // pass other metas (run/eval status, "done"/"blocked") through verbatim.
  const sheetMetaLabel = (row: JourneyStationSheetRow): string => {
    if (!row.meta) return "";
    if (row.chip === "context") {
      const catKey = MEMORY_CAT_KEY[row.meta];
      return catKey ? tk(catKey) : row.meta;
    }
    return statusMetaLabel(row.meta, tk);
  };
  const [openStation, setOpenStation] = useState<JourneyStationId | null>(null);
  const [selectedOptionId, setSelectedOptionId] = useState<string | null>(null);
  // Evidence-form state for the Run sheet. `activeEvidenceMilestoneId` = which human milestone's
  // form is open (null → the option list); `evidenceDrafts` is a per-milestone draft map that
  // PERSISTS across sheet open/close (modal-hide, not discard) and is only dropped when a real
  // navigation unmounts this view (keyed by goal.id). The sheet never touches App nav epochs, so
  // there is no `onProofDraftActiveChange` nav-lock here — closing the sheet keeps the draft parked.
  const [activeEvidenceMilestoneId, setActiveEvidenceMilestoneId] = useState<string | null>(null);
  const [evidenceDrafts, setEvidenceDrafts] = useState<Record<string, EvidenceSubmissionDraft>>({});
  const [pickingEvidence, setPickingEvidence] = useState(false);
  const sheetCloseRef = useRef<HTMLButtonElement | null>(null);
  const sheetTriggerRef = useRef<HTMLElement | null>(null);
  const { progress, goal } = props;

  // Modal-sheet focus management: move focus into the dialog on open, close on Escape, and
  // restore focus to the control that opened it on close. `aria-modal` alone does not do this.
  // Also resets any interactive selection whenever the open station changes.
  useEffect(() => {
    setSelectedOptionId(null);
    // Return to the option list on any station change; drafts persist in `evidenceDrafts`.
    setActiveEvidenceMilestoneId(null);
    if (!openStation) return;
    sheetTriggerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusFrame = requestAnimationFrame(() => sheetCloseRef.current?.focus());
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      setOpenStation(null);
    }
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      cancelAnimationFrame(focusFrame);
      window.removeEventListener("keydown", onKeyDown, true);
      const trigger = sheetTriggerRef.current;
      sheetTriggerRef.current = null;
      if (trigger) requestAnimationFrame(() => trigger.focus());
    };
  }, [openStation]);

  if (!progress) {
    return (
      <section className="od-journey" data-od-id="journey-view">
        <header className="od-journey-head">
          <div className="od-journey-head-main">
            <h1 className="od-journey-title">{goal.title}</h1>
            <p className="od-journey-sub">{t("glass.journey.noPlan")}</p>
          </div>
        </header>
        <button className="od-journey-primary" type="button" onClick={() => props.onOpenStage("context")}>
          {t("glass.journey.noPlanCta")}
        </button>
      </section>
    );
  }

  const researchMemories = props.researchMemories ?? [];
  const stations = buildJourneyStations(progress, researchMemories);
  const move = buildJourneyYourMove(progress, t);
  const ambient = buildJourneyAmbient(progress);
  const turns = buildJourneyTurns(progress, t, Date.now());
  const journal = buildJourneyJournal(progress, props.runEvents ?? []);
  const sheet = openStation ? buildJourneyStationSheet(openStation, progress, researchMemories) : null;
  const headMeta = `${progress.completed_milestones}/${progress.total_milestones}`;
  // The Context station sheet hosts the live saved-goal Context interior when App supplies the
  // pure view-models + candidate handlers; otherwise it falls back to read-only rows.
  const contextBody =
    sheet?.station === "context" && props.contextLoop && props.contextReview
      && props.onAcceptContextCandidate && props.onRejectContextCandidate
      ? {
          loop: props.contextLoop,
          review: props.contextReview,
          onAccept: props.onAcceptContextCandidate,
          onReject: props.onRejectContextCandidate,
        }
      : null;
  // The Plan station sheet hosts the saved-goal read-only plan review (the real contract interior)
  // when App supplies the pure plan view-model; otherwise it falls back to flat plan rows.
  const planBody = sheet?.station === "plan" && props.planReview ? props.planReview : null;
  // The Eval station sheet hosts the saved-goal read-only eval review (recap or per-milestone
  // evidence). All the data is already in `progress`, so this is gated purely on the open station.
  const evalBody = sheet?.station === "eval" ? progress : null;
  // The Run sheet's in-place evidence form: the human milestone whose form is open, membership-checked
  // against the CURRENT interaction so a background refresh that drops it falls back to the option list.
  const activeEvidenceOption = sheet?.interaction && activeEvidenceMilestoneId
    ? sheet.interaction.evidenceOptions.find((option) => option.milestoneId === activeEvidenceMilestoneId) ?? null
    : null;
  const activeEvidenceMilestone = activeEvidenceOption
    ? progress.milestones.find((row) => row.milestone.id === activeEvidenceOption.milestoneId)?.milestone ?? null
    : null;
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
    props.onOpenStage(move.kind === "review_eval" ? "eval" : "run");
  }

  function confirmInteraction(): void {
    if (!progress || !sheet?.interaction) return;
    if (!canConfirmInteraction(selectedOptionId, sheet.interaction.options, Boolean(props.disabled))) return;
    const option = resolveSelectedOption(sheet.interaction.options, selectedOptionId);
    if (!option) return;
    const milestone = progress.milestones.find((row) => row.milestone.id === option.milestoneId)?.milestone;
    if (!milestone) return;
    props.onRunAgent(milestone);
    setOpenStation(null);
  }

  async function pickEvidenceFiles(milestone: Milestone): Promise<void> {
    if (!props.onPickEvidenceFiles) return;
    setPickingEvidence(true);
    try {
      const paths = await props.onPickEvidenceFiles();
      if (paths.length === 0) return;
      setEvidenceDrafts((current) => {
        const base = current[milestone.id] ?? emptyEvidenceDraft(milestone);
        return { ...current, [milestone.id]: { ...base, filePaths: [...new Set([...base.filePaths, ...paths])] } };
      });
    } finally {
      setPickingEvidence(false);
    }
  }

  async function submitEvidence(milestone: Milestone): Promise<void> {
    if (!props.onConfirmMilestone) return;
    const draft = evidenceDrafts[milestone.id] ?? emptyEvidenceDraft(milestone);
    if (!evidenceDraftIsSubmittable(draft)) return;
    const ok = await props.onConfirmMilestone(milestone, evidenceSubmissionPayload(draft));
    // On failure keep the form + draft open — App surfaces the error banner. On success drop the draft.
    if (!ok) return;
    setActiveEvidenceMilestoneId(null);
    setEvidenceDrafts((current) => {
      const next = { ...current };
      delete next[milestone.id];
      return next;
    });
  }

  return (
    <section className="od-journey" data-od-id="journey-view">
      <header className="od-journey-head">
        <div className="od-journey-head-main">
          <h1 className="od-journey-title">{goal.title}</h1>
          <p className="od-journey-sub">{t("glass.journey.headerSub")}</p>
        </div>
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
          <span className="od-journey-meta" aria-label={t("shell.progress")}>{headMeta}</span>
        </div>
      </header>

      <div className="od-journey-stations" role="group" aria-label={t("cockpit.workflow")}>
        {stations.map((station) => (
          <button
            key={station.id}
            type="button"
            className={`od-journey-station${station.kind === "up" ? " od-journey-station-up" : ""}${openStation === station.id ? " od-journey-station-open" : ""}`}
            onClick={() => setOpenStation(station.id)}
          >
            <span className="od-journey-station-name">
              <i className={stationGlyphClass(station.kind)} aria-hidden="true" />
              {tk(STATION_NAME_KEY[station.id])}
            </span>
            <span className="od-journey-station-line">
              {tk(`glass.station.line.${station.lineKey}`, station.lineVars)}
            </span>
          </button>
        ))}
      </div>

      {props.planning ? (
        <div className="od-journey-planning" data-od-id="journey-planning">
          {props.planning.clarifyPanel ? (
            props.planning.clarifyPanel
          ) : props.planning.planReady && props.planReview ? (
            <div className="od-journey-planning-review">
              <div className="od-journey-eyebrow">{t("glass.journey.planReviewTitle")}</div>
              <JourneyPlanSheetBody {...props.planReview} onCommitPlan={undefined} disabled={props.planning.busy} />
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
              <button
                className="od-journey-primary"
                type="button"
                disabled={props.disabled || !props.onStartResearch}
                onClick={props.onStartResearch}
              >
                {t("glass.journey.buildPlanCta")}
              </button>
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

      {turns.length > 0 ? (
        <div className="od-journey-turns">
          <div className="od-journey-eyebrow">{t("glass.journey.turnsTitle")}</div>
          {turns.map((turn, index) => (
            <div className="od-journey-turn" key={`${turn.who}-${index}`}>
              <span className={`od-journey-chip od-journey-chip-${turn.who}`}>{turn.label}</span>
              <span className="od-journey-turn-doing">{turn.doing}</span>
              {turn.since ? <span className="od-journey-turn-since">{turn.since}</span> : null}
            </div>
          ))}
        </div>
      ) : null}

      <div className="od-journey-journal">
        <div className="od-journey-journal-head">
          <span className="od-journey-eyebrow">{t("glass.journey.journalTitle")}</span>
          <span className="od-journey-journal-hint">{t("glass.journey.journalHint")}</span>
        </div>
        {journal.length === 0 ? (
          <div className="od-journey-journal-empty">{t("glass.journal.empty")}</div>
        ) : (
          journal.map((entry) => (
            <div className="od-journey-journal-row" key={entry.id}>
              <span className="od-journey-journal-time">{formatClock(entry.at)}</span>
              <span className={`od-journey-chip od-journey-chip-${entry.who}`}>{tk(ACTOR_KEY[entry.who])}</span>
              <span className="od-journey-journal-what">
                {entry.what || (entry.detailKey ? tk(`glass.journal.event.${entry.detailKey}`) : "")}
              </span>
              {entry.stationId ? (
                <button
                  className="od-journey-journal-view"
                  type="button"
                  aria-label={`${t("glass.journey.view")} · ${tk(STATION_NAME_KEY[entry.stationId])}`}
                  onClick={() => setOpenStation(entry.stationId ?? null)}
                >
                  {t("glass.journey.view")}
                </button>
              ) : null}
            </div>
          ))
        )}
      </div>

      {sheet ? (
        <div
          className="od-journey-sheet-scrim"
          role="presentation"
          onClick={() => setOpenStation(null)}
        >
          <div
            className="od-journey-sheet"
            role="dialog"
            aria-modal="true"
            aria-label={tk(STATION_NAME_KEY[sheet.station])}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="od-journey-sheet-head">
              <span className="od-journey-sheet-title">{tk(STATION_NAME_KEY[sheet.station])}</span>
              <span className="od-journey-sheet-sub">{t(SHEET_SUB_KEY[sheet.station])}</span>
              <button
                ref={sheetCloseRef}
                className="od-journey-sheet-close"
                type="button"
                aria-label={t("glass.journey.close")}
                onClick={() => setOpenStation(null)}
              >
                ✕
              </button>
            </div>
            {sheet.interaction ? (
              activeEvidenceMilestone ? (
                <EvidenceSubmissionForm
                  milestone={activeEvidenceMilestone}
                  draft={evidenceDrafts[activeEvidenceMilestone.id] ?? emptyEvidenceDraft(activeEvidenceMilestone)}
                  disabled={Boolean(props.disabled)}
                  pickingFiles={pickingEvidence}
                  onChange={(draft) => setEvidenceDrafts((current) => ({ ...current, [activeEvidenceMilestone.id]: draft }))}
                  onPickFiles={() => void pickEvidenceFiles(activeEvidenceMilestone)}
                  onCancel={() => setActiveEvidenceMilestoneId(null)}
                  onSubmit={() => void submitEvidence(activeEvidenceMilestone)}
                />
              ) : (
                <JourneyRunSheetBody
                  interaction={sheet.interaction}
                  selectedOptionId={selectedOptionId}
                  disabled={Boolean(props.disabled)}
                  onSelect={setSelectedOptionId}
                  onConfirm={confirmInteraction}
                  onPickEvidence={props.onConfirmMilestone ? setActiveEvidenceMilestoneId : undefined}
                />
              )
            ) : contextBody ? (
              <JourneyContextSheetBody
                loop={contextBody.loop}
                review={contextBody.review}
                pendingCandidates={pendingContextCandidates(progress.context_candidates)}
                currentAimTitle={goal.title}
                disabled={Boolean(props.disabled)}
                onAccept={contextBody.onAccept}
                onReject={contextBody.onReject}
              />
            ) : planBody ? (
              <JourneyPlanSheetBody
                plan={planBody.plan}
                quality={planBody.quality}
                review={planBody.review}
                validationErrors={planBody.validationErrors}
                routingAgents={planBody.routingAgents}
                routingValidation={planBody.routingValidation}
                onCommitPlan={planBody.onCommitPlan}
                disabled={Boolean(props.disabled)}
              />
            ) : evalBody ? (
              <JourneyEvalSheetBody progress={evalBody} />
            ) : sheet.rows.length === 0 ? (
              <p className="od-journey-sheet-empty">{t("glass.journey.sheetEmpty")}</p>
            ) : (
              <div className="od-journey-sheet-rows">
                {sheet.rows.map((row, index) => (
                  <div className="od-journey-sheet-row" key={`${row.chip}-${index}`}>
                    <span className={chipClass(row.chip)}>{tk(CHIP_KEY[row.chip])}</span>
                    <span className="od-journey-sheet-text">{row.text}</span>
                    {row.meta ? <span className="od-journey-sheet-meta">{sheetMetaLabel(row)}</span> : null}
                  </div>
                ))}
              </div>
            )}
            {sheet.actionStage || (sheet.station === "plan" && props.onReplan) ? (
              <div className="od-journey-sheet-foot">
                {sheet.station === "plan" && props.onReplan ? (
                  <button
                    className="od-journey-secondary"
                    type="button"
                    onClick={() => {
                      setOpenStation(null);
                      props.onReplan?.();
                    }}
                  >
                    {t("glass.journey.replan")}
                  </button>
                ) : null}
                {sheet.actionStage ? (
                  <button
                    className="od-journey-secondary"
                    type="button"
                    onClick={() => {
                      const stage = sheet.actionStage;
                      setOpenStation(null);
                      if (stage) props.onOpenStage(stage);
                    }}
                  >
                    {t("glass.journey.continue")}
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}
