import { describe, expect, it } from "vitest";

import type { PlanningPassStateView } from "../../shared/ipc";
import {
  planningPassActivity,
  planningPassAnswered,
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
