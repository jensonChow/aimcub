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

function formatRunDate(value: string | null | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function runTimingLine(row: ExecuteMilestoneRow, t: I18n["t"]): string {
  const run = row.latest_run;
  if (!run) return "";
  if (run.status === "queued") {
    const queued = formatRunDate(run.queued_at);
    return queued ? t("execute.runQueuedAt", { time: queued }) : "";
  }
  const started = formatRunDate(run.started_at);
  return started ? t("execute.runStartedAt", { time: started }) : "";
}

export interface ExecuteStatusLine {
  tone: "" | "warn" | "danger" | "success";
  text: string;
}

/**
 * The expanded row's ONE state sentence, in product words — or null when the row is simply
 * ready and quiet. Replaces the old four-card machine grid + blocked banner: a failed run, an
 * in-flight run, and the evidence verdict were three tellings of the same story, and a human
 * needs it told once (founder, 2026-08-14: "这不是给人用的产品").
 */
export function executeStatusLine(row: ExecuteMilestoneRow, t: I18n["t"]): ExecuteStatusLine | null {
  if (row.blocked) {
    // The attempt count is the one honest fact the deleted run-timeline ledger carried:
    // "tried 3 times" changes what a human does next, three cards of step counts did not.
    const attempt = row.latest_run?.attempt ?? 1;
    const attempts = attempt > 1 ? ` · ${t("execute.statusAttempts", { n: attempt })}` : "";
    return { tone: "danger", text: `${executeBlockedDetail(row, t)}${attempts}` };
  }

  const runStatus = row.latest_run?.status;
  if (runStatus === "queued" || runStatus === "running") {
    const label = t(runStatus === "queued" ? "execute.runStatus.queued" : "execute.runStatus.running");
    const timing = runTimingLine(row, t);
    return { tone: "", text: timing ? `${label} · ${timing}` : label };
  }

  const count = Math.max(row.evidence_count, row.evidence.length);
  if (count === 0) return null;
  const lowTrust = row.evidence.filter((item) => item.status === "low_trust").length;
  if (lowTrust > 0) {
    return { tone: "warn", text: t("execute.evidenceLowTrustDetail", { lowTrust, total: count }) };
  }
  const matched = row.evidence.filter((item) => item.status === "matched").length;
  if (matched > 0) {
    const trust = `${Math.round(row.eval_review.trust_score * 100)}%`;
    return { tone: "success", text: t("execute.evidenceMatchedDetail", { matched, total: count, trust }) };
  }
  return { tone: "", text: t("execute.evidenceNeedsEvalDetail", { total: count }) };
}

export function executePrimaryAction(row: ExecuteMilestoneRow, t: I18n["t"]): {
  kind: ExecutePrimaryActionKind;
  label: string;
  detail: string;
} {
  // Receipts replace the button only on a COMPLETED row. An incomplete row always offers its
  // route's action: a blocked or low-trust row's next human move is trying again (or proving
  // it by hand), and the status line already says what went wrong — the old rules left a
  // blocked low-trust row with nothing to press but Break down (founder, 2026-08-14).
  if (row.completed) {
    return {
      kind: "review_eval",
      label: t("execute.reviewInEval"),
      detail: row.eval_review.next_action || row.next_action || t("execute.primaryReviewDetail"),
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
    detail: row.blocked ? t("execute.primaryRunRetryDetail") : t("execute.primaryRunDetail"),
  };
}
