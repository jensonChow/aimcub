/**
 * Builds the read-only drill-in content for a Journey station "sheet", the interactive
 * stage its footer CTA opens, and — for the Run station — an in-place interactive affordance
 * (selectable options → confirm). Pure, no i18n (chips are semantic tokens the component
 * localizes). The sheet is an overlay: opening it must never touch the workspace/surface
 * navigation epochs.
 */
import type { AimProgressReadModel, Memory } from "@aimcub/core";

import { executeRowNeedsEval, isHumanExecuteRoute, type ExecuteMilestoneRow } from "../../stages/execute/executePrimaryAction";
import type { CockpitStage } from "../workspaceNavigation";
import type {
  JourneyStationId,
  JourneyStationInteraction,
  JourneyStationOption,
  JourneyStationSheet,
  JourneyStationSheetRow,
} from "./types";

const ACTION_STAGE: Record<JourneyStationId, CockpitStage | null> = {
  aim: "aim",
  // Research is a read-only receipt of what the aim has gathered; the actionable
  // context surface is the Context station, so this stays CTA-less to avoid two
  // stations pointing at the same stage.
  research: null,
  context: "context",
  plan: "contracts",
  run: "run",
  eval: "eval",
};

/** Run statuses that mean a milestone's work is already in flight (not re-dispatchable). */
const IN_FLIGHT_RUN_STATUSES = new Set(["queued", "running"]);

/** The pending, non-skipped milestones the Run station lists — the base for rows + options. */
function pendingRunMilestones(progress: AimProgressReadModel): ExecuteMilestoneRow[] {
  return progress.milestones.filter((row) => !row.completed && row.milestone.status !== "skipped");
}

function runRowOf(row: ExecuteMilestoneRow): JourneyStationSheetRow {
  return {
    chip: row.blocked ? "status.blocked" : isHumanExecuteRoute(row) ? "owner.you" : "owner.agent",
    text: row.milestone.title,
    meta: row.latest_run?.status ?? undefined,
  };
}

/** A pending milestone an agent can take a turn on right now: agent-routed, unblocked, not in flight. */
function isDispatchable(row: ExecuteMilestoneRow): boolean {
  if (isHumanExecuteRoute(row) || row.blocked) return false;
  const runStatus = row.latest_run?.status;
  return !(runStatus && IN_FLIGHT_RUN_STATUSES.has(runStatus));
}

function planRows(progress: AimProgressReadModel): JourneyStationSheetRow[] {
  return progress.milestones.map((row) => ({
    chip: isHumanExecuteRoute(row) ? "owner.you" : "owner.agent",
    text: row.milestone.title,
    meta: row.completed ? "done" : row.blocked ? "blocked" : row.milestone.status,
  }));
}

function runRows(progress: AimProgressReadModel): JourneyStationSheetRow[] {
  return pendingRunMilestones(progress).map(runRowOf);
}

/** A pending human milestone whose next move is submitting evidence: human-routed, unblocked, not awaiting eval. */
function isEvidenceReady(row: ExecuteMilestoneRow): boolean {
  return isHumanExecuteRoute(row) && !row.blocked && !executeRowNeedsEval(row);
}

/**
 * The Run station's interactive payload, partitioning the pending set three ways with no overlap:
 * agent-dispatchable milestones become selectable `options`; human milestones ready for proof become
 * `evidenceOptions` (selecting one opens the in-sheet evidence form); everything else pending
 * (blocked / in-flight / needs-eval) stays visible as read-only `contextRows` so the sheet never
 * hides part of the picture. `null` only when there is neither a dispatchable option nor an evidence
 * option — the sheet then falls back to its plain read-only rows.
 */
function runInteraction(progress: AimProgressReadModel): JourneyStationInteraction | null {
  const options: JourneyStationOption[] = [];
  const evidenceOptions: JourneyStationOption[] = [];
  const contextRows: JourneyStationSheetRow[] = [];
  for (const row of pendingRunMilestones(progress)) {
    if (isDispatchable(row)) {
      options.push({
        milestoneId: row.milestone.id,
        text: row.milestone.title,
        note: row.latest_run?.status ?? row.milestone.status,
        chip: "owner.agent",
      });
    } else if (isEvidenceReady(row)) {
      evidenceOptions.push({
        milestoneId: row.milestone.id,
        text: row.milestone.title,
        note: row.milestone.status,
        chip: "owner.you",
      });
    } else {
      contextRows.push(runRowOf(row));
    }
  }
  if (options.length === 0 && evidenceOptions.length === 0) return null;
  return { actionKind: "run_agent", options, evidenceOptions, contextRows };
}

function evalRows(progress: AimProgressReadModel): JourneyStationSheetRow[] {
  return progress.milestones.map((row) => ({
    chip: row.eval_review.passed ? "eval.met" : "eval.open",
    text: row.milestone.title,
    meta: row.eval_review.passed ? "met" : row.next_action || undefined,
  }));
}

function memoryRows(memories: readonly Memory[]): JourneyStationSheetRow[] {
  return memories.map((memory) => ({
    chip: "context",
    text: memory.content,
    meta: memory.category,
  }));
}

/**
 * Whether an interactive sheet's confirm may fire: an option is still selected AND that
 * selection is still among the current options. The membership check (not just non-null)
 * defends against a background `progress` refresh dropping the selected milestone out of the
 * dispatchable set while the sheet is open.
 */
export function canConfirmInteraction(
  selectedId: string | null,
  options: readonly JourneyStationOption[],
  disabled = false,
): boolean {
  if (disabled || selectedId === null) return false;
  return options.some((option) => option.milestoneId === selectedId);
}

/** The currently-selected option, or `null` if nothing is selected or the selection went stale. */
export function resolveSelectedOption(
  options: readonly JourneyStationOption[],
  selectedId: string | null,
): JourneyStationOption | null {
  if (selectedId === null) return null;
  return options.find((option) => option.milestoneId === selectedId) ?? null;
}

export function buildJourneyStationSheet(
  station: JourneyStationId,
  progress: AimProgressReadModel,
  researchMemories: readonly Memory[] = [],
): JourneyStationSheet {
  let rows: JourneyStationSheetRow[];
  switch (station) {
    case "aim":
      rows = [{ chip: "aim", text: progress.goal.title, meta: undefined }];
      if (progress.goal.description) rows.push({ chip: "aim", text: progress.goal.description });
      break;
    case "research":
      // The real gathered context in play for this aim (aim-scoped + global memories).
      rows = memoryRows(researchMemories);
      break;
    case "context":
      // Only candidates still awaiting triage — accepted/rejected ones have left the inbox.
      rows = memoryRows(progress.context_candidates.filter((candidate) => candidate.status === "pending"));
      break;
    case "plan":
      rows = planRows(progress);
      break;
    case "run":
      rows = runRows(progress);
      break;
    case "eval":
      rows = evalRows(progress);
      break;
    default:
      rows = [];
      break;
  }
  return {
    station,
    rows,
    actionStage: ACTION_STAGE[station],
    interaction: station === "run" ? runInteraction(progress) : null,
  };
}
