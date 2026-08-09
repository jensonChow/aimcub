import { unmetPrerequisiteIds } from "@aimcub/core";
import type { AimProgressReadModel } from "@aimcub/core";
import type { DecompositionOutput, Milestone } from "@aimcub/types";

import type { GoalDetail } from "../../shared/ipc";
import type { CockpitStage } from "../CockpitShell";

export type AppMode = "cockpit" | "contexting" | "drafting" | "answering" | "reviewing" | "settings";
export type ProgressMilestoneRow = AimProgressReadModel["milestones"][number];

export function pct(done: number, total: number): number {
  return total <= 0 ? 0 : Math.round((done / total) * 100);
}

export function planNodeForMilestone(plan: DecompositionOutput | null | undefined, milestone: Milestone) {
  const key = typeof milestone.metadata?.plan_key === "string" ? milestone.metadata.plan_key : null;
  return plan?.nodes.find((node) => node.key === key)
    ?? plan?.nodes.find((node) => node.title === milestone.title)
    ?? null;
}

/**
 * Collapsed stage model: every planning/answering/reviewing/working moment renders on the
 * Journey ("aim"); only Settings is a distinct mode-driven stage (Memory is override-only).
 */
export function cockpitStageFor(mode: AppMode): CockpitStage {
  if (mode === "settings") return "settings";
  return "aim";
}

export function progressRows(detail: GoalDetail, progress: AimProgressReadModel | null): ProgressMilestoneRow[] {
  if (progress?.milestones) return progress.milestones;
  // Readiness is derived here too rather than defaulted to true: this fallback renders before
  // the read model arrives, and claiming everything is startable would flash waiting work as
  // an available move. Same rule as core's read model — a settled prerequisite is one that
  // completed or was skipped.
  const byId = new Map(detail.milestones.map((row) => [row.id, row]));
  const completedIds = new Set<string>();
  return detail.milestones.map((milestone): ProgressMilestoneRow => {
    const waitingOn = unmetPrerequisiteIds(milestone, byId, completedIds);
    return {
      milestone,
      assignment: null,
      latest_run: null,
      child_relations: [],
      eval_review: {
        passed: milestone.status === "completed",
        matched_evidence_ids: [],
        trust_score: 0,
        reason: "",
        next_action: "",
      },
      evaluator_results: [],
      evidence: [],
      evidence_count: 0,
      completed: milestone.status === "completed",
      blocked: milestone.status === "blocked",
      ready: waitingOn.length === 0,
      waiting_on: waitingOn,
      next_action: "",
    };
  });
}
