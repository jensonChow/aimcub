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
  // Waiting on a prerequisite is a QUIET state, never danger: nothing is wrong, this work
  // simply is not up yet. Blocked means something failed and needs a person.
  if (!row.ready && row.milestone.status !== "skipped") return { label: t("execute.waiting"), tone: "" };
  return { label: row.milestone.status, tone: "" };
}

/**
 * What a waiting row is waiting for, in product words. Named prerequisites when few enough to
 * read; a count otherwise. Empty when the row is ready — a ready row says nothing about waiting.
 */
export function executeWaitingLine(
  row: ExecuteMilestoneRow,
  titleById: ReadonlyMap<string, string>,
  t: I18n["t"],
): string {
  if (row.ready || row.waiting_on.length === 0) return "";
  const named = row.waiting_on.map((id) => titleById.get(id)).filter((title): title is string => Boolean(title));
  if (named.length === 1 && named.length === row.waiting_on.length) {
    return t("execute.waitingOnOne", { title: named[0]! });
  }
  return t("execute.waitingOnMany", { n: row.waiting_on.length });
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
