import { describe, expect, it } from "vitest";

import type { PlanningPassStateView } from "../../shared/ipc";
import {
  planningPassActivity,
  planningPassAnswered,
  planningPassJournal,
  planningPassOffer,
  planningPassWorthShowing,
} from "./planningPass";
import { planningActivityTrace } from "./planningSession";

function pass(overrides: Partial<PlanningPassStateView> = {}): PlanningPassStateView {
  return {
    goalId: "g1",
    agentId: "codex",
    model: "gpt-5.6-sol",
    phase: "waiting_user",
    stoppedReason: "app_quit",
    resumedCount: 0,
    startedAt: "2026-07-25T14:03:09.714Z",
    updatedAt: "2026-07-25T14:31:00.000Z",
    truncated: false,
    questionsAsked: 0,
    researchFindingCount: 0,
    researchGapCount: 0,
    transcript: [],
    landing: null,
    ...overrides,
  };
}

const t = (key: string, vars?: Record<string, string | number>) =>
  vars ? `${key}:${Object.values(vars).join(",")}` : key;

describe("planningPassActivity", () => {
  it("projects a persisted transcript onto the live activity structure", () => {
    const items = planningPassActivity(pass({
      transcript: [
        { at: "1", kind: "research", findings: [{ summary: "a" }, { summary: "b" }], gaps: ["no web"] },
        { at: "2", kind: "question", question: { question: "What is your budget?" } },
        { at: "3", kind: "answer", request_id: "q1", answer: { selected_labels: ["Under 200"] } },
        { at: "4", kind: "memory_candidate", candidate: { category: "capability" } },
        { at: "5", kind: "user_message", text: "keep it cheap" },
        { at: "6", kind: "plan_attempt", attempt: 1, accepted: false, errors: ["missing acceptance rule"] },
        { at: "7", kind: "plan_attempt", attempt: 2, accepted: true, errors: [] },
      ],
    }));

    expect(items.map((item) => item.kind)).toEqual([
      "research", "question", "status", "status", "chat", "status", "status",
    ]);
    expect(items[0]!.count).toBe(2);
    expect(items[1]!.label).toBe("What is your budget?");
    expect(items[2]!.code).toBe("question_answered");
    expect(items[5]!.code).toBe("plan_rejected");
    expect(items[6]!.code).toBe("plan_accepted");
  });

  it("drops entries that say nothing rather than guessing at them", () => {
    const items = planningPassActivity(pass({
      transcript: [
        { at: "1", kind: "user_message", text: "   " },
        { at: "2", kind: "question", question: {} },
        { at: "3", kind: "research", findings: [] },
        { at: "4", kind: "totally_unknown_future_kind" },
        { at: "5", kind: "question", question: { question: "Real question?" } },
      ],
    }));
    expect(items).toHaveLength(1);
    expect(items[0]!.label).toBe("Real question?");
  });

  it("feeds the SAME voice layer the live lane uses", () => {
    // The paused surface must not invent a second dialect: a projected transcript renders
    // through planningActivityTrace exactly like main's live activity ring buffer.
    const trace = planningActivityTrace(planningPassActivity(pass({
      transcript: [
        { at: "1", kind: "research", findings: [{ summary: "a" }], gaps: [] },
        { at: "2", kind: "question", question: { question: "Budget?" } },
        { at: "3", kind: "answer", request_id: "q1", answer: { selected_labels: ["yes"] } },
      ],
    })), t);
    expect(trace).toEqual([
      "planningSession.now.research:1",
      "planningSession.now.askedYou:Budget?",
      "planningSession.now.answered",
    ]);
  });
});

describe("planningPassAnswered", () => {
  it("counts answers the user actually gave, not questions asked", () => {
    const view = pass({
      questionsAsked: 3,
      transcript: [
        { at: "1", kind: "question", question: { question: "a" } },
        { at: "2", kind: "answer", request_id: "a", answer: {} },
        { at: "3", kind: "question", question: { question: "b" } },
      ],
    });
    expect(planningPassAnswered(view)).toBe(1);
  });
});

describe("planningPassOffer", () => {
  it("offers the drafted plan for review rather than resuming research", () => {
    expect(planningPassOffer(pass())).toBe("resume");
    expect(planningPassOffer(pass({
      landing: {
        plan: { nodes: [] } as never,
        quality: null,
        review: null,
        questions: [],
        answers: [],
        assumptions: [],
      },
    }))).toBe("review_plan");
  });
});

describe("planningPassJournal", () => {
  const withHistory = pass({
    startedAt: "2026-07-25T14:03:00.000Z",
    updatedAt: "2026-07-25T14:31:00.000Z",
    researchFindingCount: 12,
    researchGapCount: 2,
    transcript: [
      { at: "2026-07-25T14:04:00.000Z", kind: "research", findings: [{ summary: "a" }], gaps: [] },
      { at: "2026-07-25T14:06:00.000Z", kind: "question", question: { id: "q1", question: "Who are your first users?" } },
      { at: "2026-07-25T14:12:00.000Z", kind: "answer", request_id: "q1", answer: { selected_labels: ["Tarot hobbyists"] } },
      { at: "2026-07-25T14:20:00.000Z", kind: "question", question: { id: "q2", question: "Never answered?" } },
    ],
  });

  it("gives the pass its milestones — start, the user's answers, research, and how it stopped", () => {
    const rows = planningPassJournal(withHistory);
    expect(rows.map((row) => row.detailKey)).toEqual([
      "planning.started",
      "planning.answered",
      "planning.research",
      "planning.paused",
    ]);
    // The user's own answer is attributed to THEM, and carries the question it settled.
    const answer = rows.find((row) => row.detailKey === "planning.answered")!;
    expect(answer.who).toBe("you");
    expect(answer.detailVars).toEqual({ q: "Who are your first users?" });
    expect(answer.at).toBe("2026-07-25T14:12:00.000Z");
    // A question the user never answered is NOT a receipt: nothing happened.
    expect(rows.filter((row) => row.detailKey === "planning.answered")).toHaveLength(1);
    // Research is one aggregate row placed at the last research moment, not one row per finding.
    const research = rows.find((row) => row.detailKey === "planning.research")!;
    expect(research.detailVars).toEqual({ findings: 12, gaps: 2 });
    expect(research.at).toBe("2026-07-25T14:04:00.000Z");
    // Every row can be placed in time, which is what the ledger sorts on.
    expect(rows.every((row) => Boolean(row.at))).toBe(true);
  });

  it("reports a drafted plan, and a failure as a failure", () => {
    const drafted = planningPassJournal(pass({
      startedAt: "2026-07-25T14:03:00.000Z",
      updatedAt: "2026-07-25T14:40:00.000Z",
      stoppedReason: "",
      transcript: [{ at: "2026-07-25T14:38:00.000Z", kind: "plan_attempt", attempt: 1, accepted: true, errors: [] }],
    }));
    expect(drafted.map((row) => row.detailKey)).toEqual(["planning.started", "planning.drafted"]);
    expect(drafted[1]!.at).toBe("2026-07-25T14:38:00.000Z");

    const failed = planningPassJournal(pass({ stoppedReason: "failed" }));
    expect(failed.map((row) => row.detailKey)).toContain("planning.failed");
    expect(failed.map((row) => row.detailKey)).not.toContain("planning.paused");
  });

  it("says nothing about a live pass's ending, and nothing at all without a pass", () => {
    const live = planningPassJournal(pass({ stoppedReason: "" }));
    expect(live.map((row) => row.detailKey)).not.toContain("planning.paused");
    expect(live.map((row) => row.detailKey)).not.toContain("planning.failed");
    expect(planningPassJournal(null)).toEqual([]);
  });
});

describe("planningPassWorthShowing", () => {
  it("shows a pass that did something and hides one that describes no work", () => {
    expect(planningPassWorthShowing(null)).toBe(false);
    // Checkpointed before the brain achieved anything: the aim is honestly not planned yet.
    expect(planningPassWorthShowing(pass())).toBe(false);
    expect(planningPassWorthShowing(pass({ researchGapCount: 1 }))).toBe(true);
    expect(planningPassWorthShowing(pass({
      transcript: [{ at: "1", kind: "question", question: { question: "Budget?" } }],
    }))).toBe(true);
  });
});
