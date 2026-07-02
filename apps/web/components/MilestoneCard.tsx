import { colors, radius, space } from "@ui/tokens";
import type { DecompositionContract, Milestone } from "@core/types";
import { acceptanceSummary } from "../lib/acceptance";
import { statusLabel } from "../lib/progress";
import { statusColor } from "./styles";

function shortText(value: string, max = 120): string {
  const text = value.replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max - 1)}...` : text;
}

function contractFromMetadata(metadata: Milestone["metadata"]): DecompositionContract | null {
  const value = metadata.decomposition_contract;
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const contract = value as Partial<DecompositionContract>;
  if (
    typeof contract.definition_of_done !== "string" ||
    typeof contract.eval_signal !== "string" ||
    !Array.isArray(contract.required_evidence)
  ) {
    return null;
  }
  return {
    why: typeof contract.why === "string" ? contract.why : "",
    definition_of_done: contract.definition_of_done,
    required_evidence: contract.required_evidence.filter((item): item is string => typeof item === "string"),
    likely_owner: contract.likely_owner ?? "either",
    context_gaps: [],
    eval_signal: contract.eval_signal,
  };
}

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
  const contract = contractFromMetadata(milestone.metadata);
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
        {contract ? (
          <div style={{ marginTop: space.sm, paddingTop: space.sm, borderTop: "1px solid #232733", color: colors.textMuted, fontSize: 12 }}>
            <div style={{ color: colors.text, fontWeight: 700 }}>Contract · {contract.likely_owner}</div>
            <div>Done: {shortText(contract.definition_of_done)}</div>
            <div>Evidence: {contract.required_evidence.map((item) => shortText(item, 72)).join(" · ")}</div>
            <div>Eval: {shortText(contract.eval_signal)}</div>
          </div>
        ) : null}
      </div>
    </li>
  );
}
