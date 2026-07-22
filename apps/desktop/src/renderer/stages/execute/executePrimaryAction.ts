import { routingOverrideForMilestone, type AimProgressReadModel } from "@aimcub/core";

import type { I18n } from "../../i18n";

export type ExecuteMilestoneRow = AimProgressReadModel["milestones"][number];
export type ExecutePrimaryActionKind = "run_agent" | "submit_proof" | "review_eval" | "blocked";

export function isHumanExecuteRoute(row: ExecuteMilestoneRow): boolean {
  const override = routingOverrideForMilestone(row.milestone);
  return override?.owner === "human" || row.assignment?.actor_kind === "human";
}

export function executeRouteLabel(row: ExecuteMilestoneRow, t: I18n["t"]): string {
  return isHumanExecuteRoute(row) ? t("execute.routeHuman") : t("execute.routeAgent");
}

export function executeRowNeedsEval(row: ExecuteMilestoneRow): boolean {
  if (row.completed) return true;
  if (row.evidence.some((item) => item.status === "low_trust" || item.status === "unmatched")) return true;
  return row.evidence_count > 0 && !row.eval_review.passed && Boolean(row.eval_review.next_action);
}

export function executeRowStatus(row: ExecuteMilestoneRow, t: I18n["t"]): { label: string; tone: string } {
  if (row.completed) return { label: t("os.done"), tone: "success" };
  if (row.blocked) return { label: t("os.blocked"), tone: "danger" };
  if (executeRowNeedsEval(row)) return { label: t("execute.needsEvalReview"), tone: "warn" };
  return { label: row.milestone.status, tone: "" };
}

export function executeEvidenceLine(row: ExecuteMilestoneRow, t: I18n["t"]): string {
  const count = Math.max(row.evidence_count, row.evidence.length);
  if (count === 0) return t("execute.selectorEvidenceNone");
  const lowTrust = row.evidence.filter((item) => item.status === "low_trust").length;
  if (lowTrust > 0) return t("execute.selectorEvidenceLowTrust", { n: lowTrust });
  return t("os.evidenceCount", { n: count });
}

export function executeBlockedDetail(row: ExecuteMilestoneRow, t: I18n["t"]): string {
  return row.latest_run?.error
    || row.eval_review.next_action
    || row.next_action
    || row.assignment?.reason
    || t("execute.blockedDefault");
}

export function executePrimaryAction(row: ExecuteMilestoneRow, t: I18n["t"]): {
  kind: ExecutePrimaryActionKind;
  label: string;
  detail: string;
} {
  if (executeRowNeedsEval(row)) {
    return {
      kind: "review_eval",
      label: t("execute.reviewInEval"),
      detail: row.eval_review.next_action || row.next_action || t("execute.primaryReviewDetail"),
    };
  }

  if (row.blocked) {
    return {
      kind: "blocked",
      label: t("os.blocked"),
      detail: executeBlockedDetail(row, t),
    };
  }

  if (isHumanExecuteRoute(row)) {
    return {
      kind: "submit_proof",
      label: t("os.submitProof"),
      detail: t("execute.primaryProofDetail"),
    };
  }

  return {
    kind: "run_agent",
    label: t("os.runAgent"),
    detail: t("execute.primaryRunDetail"),
  };
}
