import { colors, radius, space } from "@ui/tokens";
import type { Milestone } from "@core/types";
import { acceptanceSummary } from "../lib/acceptance";
import { statusLabel } from "../lib/progress";
import { statusColor } from "./styles";

/**
 * One milestone row: title, status pill, acceptance-rule summary, xp_reward.
 * `justCompleted` triggers a brief glow so the auto-light moment is visible.
 */
export function MilestoneCard({
  milestone,
  index,
  justCompleted = false,
}: {
  milestone: Milestone;
  index: number;
  justCompleted?: boolean;
}) {
  const done = milestone.status === "completed";
  const sc = statusColor(milestone.status);
  return (
    <li
      style={{
        listStyle: "none",
        display: "flex",
        gap: space.md,
        padding: space.md,
        background: colors.surface,
        borderRadius: radius.md,
        border: `1px solid ${justCompleted ? colors.success : "#232733"}`,
        boxShadow: justCompleted ? `0 0 0 2px ${colors.success}55` : "none",
        transition: "box-shadow 600ms ease, border-color 600ms ease",
        opacity: milestone.status === "skipped" ? 0.5 : 1,
      }}
    >
      <div
        aria-hidden
        style={{
          flex: "0 0 28px",
          height: 28,
          borderRadius: radius.pill,
          background: done ? colors.success : "#232733",
          color: done ? colors.bg : colors.textMuted,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 14,
          fontWeight: 700,
        }}
      >
        {done ? "✓" : index + 1}
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: space.sm, flexWrap: "wrap" }}>
          <strong style={{ textDecoration: done ? "line-through" : "none" }}>{milestone.title}</strong>
          <span
            style={{
              fontSize: 12,
              padding: "2px 8px",
              borderRadius: radius.pill,
              color: sc,
              border: `1px solid ${sc}`,
            }}
          >
            {statusLabel(milestone.status)}
          </span>
          <span style={{ marginLeft: "auto", fontSize: 13, color: colors.warning, fontWeight: 700 }}>
            +{milestone.xp_reward} XP
          </span>
        </div>
        {milestone.description ? (
          <p style={{ margin: "6px 0 4px", color: colors.text, fontSize: 14 }}>{milestone.description}</p>
        ) : null}
        <p style={{ margin: 0, color: colors.textMuted, fontSize: 12, fontFamily: "ui-monospace, monospace" }}>
          Accepts when {acceptanceSummary(milestone.acceptance_rule)}
        </p>
      </div>
    </li>
  );
}
