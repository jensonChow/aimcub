/**
 * Pure renderer transforms for a STOPPED planning pass — the checkpoint a session left on the
 * aim when it ended (almost always because the app was quit).
 *
 * The live lane derives its thought trace from main's activity ring buffer; a stopped pass has
 * no ring buffer, only the persisted transcript. These helpers project that transcript onto the
 * same `PlanningSessionActivityItem` structure, so the paused surface speaks through the exact
 * voice layer the live one does (`planningActivityTrace`) instead of inventing a second dialect.
 *
 * The transcript is deliberately permissive on disk (`AimDraftPlanningSession.transcript` is a
 * bag of records), so every entry is guarded here: anything unrecognized is dropped rather than
 * guessed at, mirroring how unsayable live rows drop instead of leaking raw ids.
 */
import type { PlanningPassStateView, PlanningSessionActivityItem } from "../../shared/ipc";

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function at(entry: Record<string, unknown>): string {
  return text(entry.at);
}

/**
 * One persisted transcript entry → one activity item, or null when the entry says nothing a
 * trace can show. Structure only: no localized words are produced here.
 */
function activityFromEntry(entry: Record<string, unknown>): PlanningSessionActivityItem | null {
  switch (entry.kind) {
    case "user_message":
    case "note": {
      const label = text(entry.text);
      return label ? { at: at(entry), kind: "chat", label } : null;
    }
    case "question": {
      const question = entry.question;
      const label = question && typeof question === "object"
        ? text((question as Record<string, unknown>).question)
        : "";
      return label ? { at: at(entry), kind: "question", label } : null;
    }
    case "answer":
      return { at: at(entry), kind: "status", code: "question_answered", label: "" };
    case "research": {
      const findings = Array.isArray(entry.findings) ? entry.findings.length : 0;
      return findings > 0 ? { at: at(entry), kind: "research", label: "", count: findings } : null;
    }
    case "memory_candidate": {
      const candidate = entry.candidate;
      const category = candidate && typeof candidate === "object"
        ? text((candidate as Record<string, unknown>).category)
        : "";
      return { at: at(entry), kind: "status", code: "memory_proposed", label: category };
    }
    case "plan_attempt": {
      if (entry.accepted === true) return { at: at(entry), kind: "status", code: "plan_accepted", label: "" };
      const attempt = typeof entry.attempt === "number" ? entry.attempt : 1;
      const errors = Array.isArray(entry.errors) ? entry.errors : [];
      return {
        at: at(entry),
        kind: "status",
        code: "plan_rejected",
        label: text(errors[0]),
        count: attempt,
      };
    }
    default:
      return null;
  }
}

/** The stopped pass's history, in the shape the live trace already knows how to say. */
export function planningPassActivity(
  pass: Pick<PlanningPassStateView, "transcript">,
): PlanningSessionActivityItem[] {
  return pass.transcript.flatMap((entry) => {
    const item = activityFromEntry(entry);
    return item ? [item] : [];
  });
}

/** How many of the pass's questions the user actually answered. */
export function planningPassAnswered(pass: Pick<PlanningPassStateView, "transcript">): number {
  return pass.transcript.filter((entry) => entry.kind === "answer").length;
}

/**
 * What the paused lane should offer. A pass that drafted a plan is not "paused planning" — it is
 * a finished plan waiting to be adopted, and offering to resume research instead would throw
 * away the most expensive thing the brain produced.
 */
export type PlanningPassOffer = "review_plan" | "resume";

export function planningPassOffer(pass: Pick<PlanningPassStateView, "landing">): PlanningPassOffer {
  return pass.landing ? "review_plan" : "resume";
}

/**
 * Whether this pass is worth a surface at all. A pass with nothing in it — no history, no
 * findings, no plan — describes no work, so the aim is honestly "not planned yet" and should get
 * the ordinary start card rather than an empty "we were working on this" claim.
 */
export function planningPassWorthShowing(
  pass: PlanningPassStateView | null,
): pass is PlanningPassStateView {
  if (!pass) return false;
  if (pass.landing) return true;
  return planningPassActivity(pass).length > 0
    || pass.researchFindingCount > 0
    || pass.researchGapCount > 0;
}
