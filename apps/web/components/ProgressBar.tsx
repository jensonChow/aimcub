import { colors, radius } from "@ui/tokens";
import type { GoalProgress } from "../lib/progress";

/** Goal progress bar: completed / total + earned xp. Pure presentational. */
export function ProgressBar({ progress }: { progress: GoalProgress }) {
  const done = progress.total > 0 && progress.completed === progress.total;
  return (
    <div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          fontSize: 14,
          color: colors.textMuted,
          marginBottom: 6,
        }}
      >
        <span>
          {progress.completed} / {progress.total} milestones
        </span>
        <span>
          {progress.earnedXp} / {progress.totalXp} XP
        </span>
      </div>
      <div
        role="progressbar"
        aria-valuenow={progress.percent}
        aria-valuemin={0}
        aria-valuemax={100}
        style={{
          height: 12,
          background: "#232733",
          borderRadius: radius.pill,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            width: `${progress.percent}%`,
            height: "100%",
            background: done ? colors.success : colors.primary,
            borderRadius: radius.pill,
            transition: "width 600ms ease",
          }}
        />
      </div>
    </div>
  );
}
