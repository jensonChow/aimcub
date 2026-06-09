import { colors, radius, space } from "@ui/tokens";
import Link from "next/link";
import type { Goal, Milestone } from "@core/types";
import { computeProgress } from "../lib/progress";
import { ProgressBar } from "./ProgressBar";

/** Compact goal card for the home list: title, target date, and its progress bar. */
export function GoalListItem({ goal, milestones }: { goal: Goal; milestones: Milestone[] }) {
  const progress = computeProgress(milestones);
  return (
    <Link
      href={`/goals/${goal.id}`}
      style={{
        display: "block",
        textDecoration: "none",
        color: colors.text,
        background: colors.surface,
        border: "1px solid #232733",
        borderRadius: radius.lg,
        padding: space.md,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", gap: space.sm, marginBottom: space.sm }}>
        <strong style={{ fontSize: 16 }}>{goal.title}</strong>
        {goal.target_date ? (
          <span style={{ fontSize: 12, color: colors.textMuted }}>
            due {goal.target_date.slice(0, 10)}
          </span>
        ) : null}
      </div>
      <ProgressBar progress={progress} />
    </Link>
  );
}
