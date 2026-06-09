/**
 * Pure presentation helpers for the dashboard. These are view-model utilities
 * (counting / formatting for the UI), NOT domain logic — domain logic lives only
 * in @core/domain. Kept here, pure and unit-tested, so the React components stay dumb.
 */
import type { Milestone, MilestoneStatus } from "@core/types";

export interface GoalProgress {
  completed: number;
  total: number;
  /** 0..1 fraction of milestones completed (0 when there are no milestones). */
  fraction: number;
  /** Rounded percentage 0..100 for display. */
  percent: number;
  /** Total xp earned from completed milestones. */
  earnedXp: number;
  /** Total xp available across all milestones. */
  totalXp: number;
}

/** Compute goal progress from its milestones. Pure; safe on an empty list. */
export function computeProgress(milestones: readonly Milestone[]): GoalProgress {
  const total = milestones.length;
  const completedList = milestones.filter((m) => m.status === "completed");
  const completed = completedList.length;
  const fraction = total === 0 ? 0 : completed / total;
  const earnedXp = completedList.reduce((sum, m) => sum + m.xp_reward, 0);
  const totalXp = milestones.reduce((sum, m) => sum + m.xp_reward, 0);
  return {
    completed,
    total,
    fraction,
    percent: Math.round(fraction * 100),
    earnedXp,
    totalXp,
  };
}

/** True once every milestone is completed and there is at least one. */
export function isGoalComplete(milestones: readonly Milestone[]): boolean {
  return milestones.length > 0 && milestones.every((m) => m.status === "completed");
}

/**
 * The next milestone eligible to light up: the lowest-order milestone that is not
 * yet completed/skipped. Mirrors the linear-dependency model (v1 is linear, not a DAG).
 * Returns null when nothing is pending.
 */
export function nextEligibleMilestone(milestones: readonly Milestone[]): Milestone | null {
  const open = milestones
    .filter((m) => m.status !== "completed" && m.status !== "skipped")
    .sort((a, b) => a.order_index - b.order_index);
  return open[0] ?? null;
}

const STATUS_LABEL: Record<MilestoneStatus, string> = {
  pending: "Pending",
  in_progress: "In progress",
  completed: "Completed",
  skipped: "Skipped",
  blocked: "Blocked",
};

export function statusLabel(status: MilestoneStatus): string {
  return STATUS_LABEL[status];
}
