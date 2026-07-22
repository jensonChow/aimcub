import type { AimProgressReadModel } from "@aimcub/core";
import type { DecompositionOutput, Goal, Milestone } from "@aimcub/types";

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

export function cockpitStageFor(mode: AppMode, selected: Goal | null, activePlan: DecompositionOutput | null): CockpitStage {
  if (mode === "settings") return "settings";
  if (mode === "contexting" || mode === "answering") return "context";
  if (mode === "reviewing" || (!selected && activePlan)) return "contracts";
  if (selected) return "run";
  return "aim";
}

export function progressRows(detail: GoalDetail, progress: AimProgressReadModel | null): ProgressMilestoneRow[] {
  return progress?.milestones ?? detail.milestones.map((milestone): ProgressMilestoneRow => ({
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
    next_action: "",
  }));
}
