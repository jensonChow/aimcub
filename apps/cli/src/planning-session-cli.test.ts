import { describe, expect, it } from "vitest";

import type { PlanningSessionOutcome, PlanningSessionQuestion } from "@aimcub/llm";

import { formatSessionSummary, parseSessionAnswerLine } from "./planning-session-cli";

function question(overrides: Partial<PlanningSessionQuestion> = {}): PlanningSessionQuestion {
  return {
    id: "ask_1",
    question: "Which platforms should the release cover?",
    kind: "scope",
    why_high_impact: "",
    allow_other: true,
    selection_mode: "multiple",
    selection_mode_reason: "compatible_options",
    capture_scope: "current_aim",
    options: [
      { label: "iOS", tradeoff: "" },
      { label: "Web", tradeoff: "" },
      { label: "Android", tradeoff: "" },
    ],
    ...overrides,
  };
}

describe("parseSessionAnswerLine", () => {
  it("maps number lists onto option labels", () => {
    expect(parseSessionAnswerLine(question(), "1,3")).toEqual({ labels: ["iOS", "Android"], other: null });
    expect(parseSessionAnswerLine(question(), "2")).toEqual({ labels: ["Web"], other: null });
  });

  it("bounds a single-select to one option even if more were typed", () => {
    expect(parseSessionAnswerLine(question({ selection_mode: "single" }), "2, 3")).toEqual({
      labels: ["Web"],
      other: null,
    });
  });

  it("treats out-of-range numbers and prose as free text", () => {
    expect(parseSessionAnswerLine(question(), "9")).toEqual({ labels: [], other: "9" });
    expect(parseSessionAnswerLine(question(), "only where my users are")).toEqual({
      labels: [],
      other: "only where my users are",
    });
  });

  it("skips with a dash and treats duplicates once", () => {
    expect(parseSessionAnswerLine(question(), "-")).toEqual({ labels: [], other: null, skipped: true });
    expect(parseSessionAnswerLine(question(), "1,1,2")).toEqual({ labels: ["iOS", "Web"], other: null });
  });

  it("keeps free text for questions without options", () => {
    expect(parseSessionAnswerLine(question({ options: [] }), "3")).toEqual({ labels: [], other: "3" });
  });
});

describe("formatSessionSummary", () => {
  it("prints research, gaps, assumptions, and open questions honestly", () => {
    const outcome: PlanningSessionOutcome = {
      plan: { goal_summary: "", domain: "software", rationale: "", nodes: [], edges: [] },
      quality: { grade: "pass", score: 100, issues: [], dimensions: [] } as unknown as PlanningSessionOutcome["quality"],
      attempts: 2,
      acceptedAttempt: 2,
      acceptedAtSessionEnd: false,
      assumptions: [{ statement: "English-only launch", default_value: "en" }],
      openQuestions: ["Pricing?"],
      research: {
        findings: [{ summary: "Store policy requires a disclaimer", source_urls: ["https://a.example"] }],
        gaps: ["no web access"],
      },
      memoryCandidates: [{ content: "Has ASC account", category: "capability", scope: "global" }],
      answers: [],
    };
    const text = formatSessionSummary(outcome);
    expect(text).toContain("questions answered: 0 · submit attempts: 2");
    expect(text).toContain("Store policy requires a disclaimer [https://a.example]");
    expect(text).toContain("research gaps: no web access");
    expect(text).toContain("English-only launch (default: en)");
    expect(text).toContain("open questions: Pricing?");
    expect(text).toContain("1 candidate (not stored by `plan`)");
  });
});
