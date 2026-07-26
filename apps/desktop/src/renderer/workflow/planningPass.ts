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
import type { JourneyJournalEntry } from "./journey";

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
 * The pass's receipts for the Journal.
 *
 * The Journal reads run events and evidence, and planning is neither — so a planning pass left no
 * receipt at all, in a ledger whose own subtitle promises "every pass leaves a receipt". These rows
 * close that gap without a new event table: they are derived from the pass already on the aim.
 *
 * Milestones only, not every breath. The thought trace on the card is where step-by-step belongs;
 * a ledger that reprinted forty tool calls would bury the run receipts beside them. What earns a
 * row: the pass starting, each question the user actually answered (their own contribution, and
 * attributed to them), the research total, the plan being drafted, and how the pass stopped.
 */
export function planningPassJournal(pass: PlanningPassStateView | null): JourneyJournalEntry[] {
  if (!pass) return [];
  const rows: JourneyJournalEntry[] = [];
  if (pass.startedAt) {
    rows.push({ id: `pp:start:${pass.goalId}`, at: pass.startedAt, who: "cub", what: "", detailKey: "planning.started" });
  }

  let answered = 0;
  let lastResearchAt = "";
  let draftedAt = "";
  const questions = new Map<string, string>();
  for (const entry of pass.transcript) {
    if (entry.kind === "question") {
      const question = entry.question;
      const id = text((question as Record<string, unknown> | undefined)?.id);
      const label = text((question as Record<string, unknown> | undefined)?.question);
      if (id && label) questions.set(id, label);
      continue;
    }
    if (entry.kind === "answer") {
      const label = questions.get(text(entry.request_id));
      if (!label) continue;
      answered += 1;
      rows.push({
        id: `pp:ans:${pass.goalId}:${answered}`,
        at: at(entry),
        who: "you",
        what: "",
        detailKey: "planning.answered",
        detailVars: { q: label },
      });
      continue;
    }
    if (entry.kind === "research") lastResearchAt = at(entry) || lastResearchAt;
    if (entry.kind === "plan_attempt" && entry.accepted === true) draftedAt = at(entry) || draftedAt;
  }

  if (pass.researchFindingCount > 0 || pass.researchGapCount > 0) {
    rows.push({
      id: `pp:research:${pass.goalId}`,
      at: lastResearchAt || pass.updatedAt,
      who: "cub",
      what: "",
      detailKey: "planning.research",
      detailVars: { findings: pass.researchFindingCount, gaps: pass.researchGapCount },
    });
  }
  if (draftedAt || pass.landing) {
    rows.push({
      id: `pp:drafted:${pass.goalId}`,
      at: draftedAt || pass.updatedAt,
      who: "cub",
      what: "",
      detailKey: "planning.drafted",
    });
  }
  // How it ended, only when it actually stopped: a live pass has nothing to report here.
  const stoppedKey = pass.stoppedReason === "failed"
    ? "planning.failed"
    : pass.stoppedReason === "app_quit" ? "planning.paused" : "";
  if (stoppedKey && pass.updatedAt) {
    rows.push({ id: `pp:stop:${pass.goalId}`, at: pass.updatedAt, who: "cub", what: "", detailKey: stoppedKey });
  }
  return rows;
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
