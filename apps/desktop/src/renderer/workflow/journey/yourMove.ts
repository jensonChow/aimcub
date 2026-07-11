/**
 * Derives the Glass "Your move" card and its "Ambient" counterpart from an
 * `AimProgressReadModel`. Reuses the existing `executePrimaryAction` mapping so the
 * Journey CTA stays consistent with the Execute stage (run agent / submit proof /
 * review in eval / blocked). Pure except for the injected `t`.
 */
import type { AimProgressReadModel } from "@core/domain";

import type { I18n } from "../../i18n";
import {
  executePrimaryAction,
  executeRowNeedsEval,
  type ExecuteMilestoneRow,
} from "../../stages/execute/executePrimaryAction";
import type { JourneyAmbient, JourneyYourMove, YourMoveKind } from "./types";

const TAG_BY_KIND: Record<YourMoveKind, string> = {
  run_agent: "glass.move.tagRun",
  submit_proof: "glass.move.tagProof",
  review_eval: "glass.move.tagReview",
  blocked: "glass.move.tagBlocked",
};

function isPendingWork(row: ExecuteMilestoneRow): boolean {
  if (row.milestone.status === "skipped" || row.completed) return false;
  // Work an agent is actively running is ambient, not a move for the user.
  return row.latest_run?.status !== "running";
}

function completedNeedsReview(row: ExecuteMilestoneRow): boolean {
  if (!row.completed || row.milestone.status === "skipped") return false;
  return row.evidence.some((item) => item.status === "low_trust" || item.status === "unmatched");
}

function moveFor(row: ExecuteMilestoneRow, t: I18n["t"]): JourneyYourMove {
  const action = executePrimaryAction(row, t);
  return {
    kind: action.kind,
    milestoneId: row.milestone.id,
    tagKey: TAG_BY_KIND[action.kind],
    title: row.milestone.title,
    body: action.detail || row.next_action,
    primaryLabel: action.label,
  };
}

/**
 * The single next thing the user should look at, or `null` when nothing is waiting
 * on the human — either an agent run is in flight (→ Ambient) or the aim is complete.
 *
 * Pending, not-yet-running work wins; a completed-but-low-trust review is only
 * surfaced when there is no pending work left (so a done milestone never preempts the
 * actual next step). `executeRowNeedsEval` treats every completed row as reviewable,
 * which is right for the per-row Execute status but too eager for picking THE move.
 */
export function buildJourneyYourMove(progress: AimProgressReadModel, t: I18n["t"]): JourneyYourMove | null {
  const pending = progress.milestones.find(isPendingWork);
  if (pending) return moveFor(pending, t);

  const review = progress.milestones.find(completedNeedsReview);
  if (review && executeRowNeedsEval(review)) return moveFor(review, t);

  return null;
}

/** Shown when there is no pending human move: agents working, or the aim is idle/done. */
export function buildJourneyAmbient(progress: AimProgressReadModel): JourneyAmbient {
  const anyRunning = progress.runs.some((run) => run.status === "running");
  return {
    titleKey: anyRunning ? "glass.ambient.working" : "glass.ambient.idle",
    body: progress.next_action ?? "",
  };
}
