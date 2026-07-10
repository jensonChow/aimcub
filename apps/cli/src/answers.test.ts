import { describe, expect, it } from "vitest";

import type { ClarifyQuestion } from "@core/llm";

import { parseAnswers, parseChoiceReply, answersToIntakeSignals, answersToMemories } from "./answers";

const QUESTIONS: ClarifyQuestion[] = [
  {
    id: "scope",
    question: "How polished should it be?",
    why_high_impact: "Decides milestone count.",
    kind: "scope",
    source_dimension: "granularity",
    allow_other: true,
    options: [
      { label: "Prototype", tradeoff: "Faster." },
      { label: "Production", tradeoff: "Strict." },
    ],
  },
];

const MULTI_QUESTION: ClarifyQuestion = {
  ...QUESTIONS[0]!,
  id: "sources",
  question: "Which context sources should Aimcub inspect?",
  selection_mode: "multiple",
  selection_mode_reason: "compatible_options",
  options: [
    { label: "Local files", tradeoff: "Grounds current state." },
    { label: "Web research", tradeoff: "Adds current facts." },
    { label: "Notion", tradeoff: "Adds user-owned context." },
  ],
};

describe("parseAnswers", () => {
  it("parses a well-formed array and keeps real answers", () => {
    const answers = parseAnswers(
      JSON.stringify([
        { question_id: "scope", selected_label: "Production" },
        { question_id: "q2", other_text: "ship by Friday" },
      ]),
    );
    expect(answers).toEqual([
      { question_id: "scope", selected_label: "Production", other_text: null },
      { question_id: "q2", selected_label: null, other_text: "ship by Friday" },
    ]);
  });

  it("accepts `id` as an alias for question_id and drops non-answers", () => {
    const answers = parseAnswers(
      JSON.stringify([
        { id: "scope", selected_label: "Prototype" }, // alias
        { question_id: "blank" }, // no answer → dropped
        { selected_label: "orphan" }, // no id → dropped
      ]),
    );
    expect(answers).toEqual([{ question_id: "scope", selected_label: "Prototype", other_text: null }]);
  });

  it("throws on non-array or invalid JSON", () => {
    expect(() => parseAnswers("{}")).toThrow(/array/);
    expect(() => parseAnswers("not json")).toThrow(/valid JSON/);
  });

  it("preserves selected_labels from non-interactive multi-select input", () => {
    expect(parseAnswers(JSON.stringify([{
      question_id: "sources",
      selected_labels: ["Local files", "Web research", "Local files"],
    }]))).toEqual([{
      question_id: "sources",
      selected_label: "Local files",
      selected_labels: ["Local files", "Web research"],
      other_text: null,
    }]);
  });

  it("keeps an explicit selected_label first and merges it with selected_labels", () => {
    expect(parseAnswers(JSON.stringify([{
      question_id: "sources",
      selected_label: "Notion",
      selected_labels: ["Local files", "Notion"],
    }]))).toEqual([{
      question_id: "sources",
      selected_label: "Notion",
      selected_labels: ["Notion", "Local files"],
      other_text: null,
    }]);
  });

  it("rejects multiple or conflicting answers for a known single-select question", () => {
    expect(() => parseAnswers(JSON.stringify([{
      question_id: "scope",
      selected_labels: ["Prototype", "Production"],
    }]), QUESTIONS)).toThrow(/single-select/);

    expect(() => parseAnswers(JSON.stringify([{
      question_id: "scope",
      selected_label: "Prototype",
      other_text: "A custom alternative",
    }]), QUESTIONS)).toThrow(/single-select/);
  });
});

describe("parseChoiceReply", () => {
  it("accepts comma-separated indexes for a multi-select question", () => {
    expect(parseChoiceReply(MULTI_QUESTION, "1, 3")).toEqual({
      question_id: "sources",
      selected_label: "Local files",
      selected_labels: ["Local files", "Notion"],
      other_text: null,
    });
  });

  it("keeps selected options plus a custom answer for multi-select input", () => {
    expect(parseChoiceReply(MULTI_QUESTION, "1, 2 | Google Drive")).toEqual({
      question_id: "sources",
      selected_label: "Local files",
      selected_labels: ["Local files", "Web research"],
      other_text: "Google Drive",
    });
  });

  it("keeps a single-choice reply to one selected label", () => {
    expect(parseChoiceReply({
      ...QUESTIONS[0]!,
      selection_mode: "single",
      selection_mode_reason: "mutually_exclusive",
    }, "2")).toEqual({
      question_id: "scope",
      selected_label: "Production",
      selected_labels: ["Production"],
      other_text: null,
    });
  });
});

describe("answersToMemories", () => {
  it("folds answers into question-text → answer memories", () => {
    const memories = answersToMemories(QUESTIONS, [
      { question_id: "scope", selected_label: "Production", other_text: null },
    ]);
    expect(memories).toEqual([
      {
        content: "Constraint: Production. Clarify question: How polished should it be? Source dimension: granularity.",
        kind: "semantic",
        category: "constraint",
        source: "user_stated",
      },
    ]);
  });

  it("prefers free text over the selected label and falls back to the id as label", () => {
    const memories = answersToMemories(QUESTIONS, [
      { question_id: "scope", selected_label: "Production", other_text: "actually, a demo" },
      { question_id: "unknown", selected_label: null, other_text: "x" },
    ]);
    expect(memories[0]!.content).toBe(
      "Constraint: actually, a demo. Clarify question: How polished should it be? Source dimension: granularity.",
    );
    expect(memories[1]!.content).toBe("Preference: x. Clarify question: unknown."); // no matching question → label is the id
    expect(memories[1]!.category).toBe("preference");
  });

  it("maps constraint and capability answers to structured context categories", () => {
    const memories = answersToMemories(
      [
        { ...QUESTIONS[0]!, id: "deadline", question: "Any hard deadline?", kind: "constraint" },
        { ...QUESTIONS[0]!, id: "skills", question: "Who can do this?", kind: "capability" },
      ],
      [
        { question_id: "deadline", selected_label: "Friday", other_text: null },
        { question_id: "skills", selected_label: "Codex can implement it", other_text: null },
      ],
    );
    expect(memories.map((m) => m.category)).toEqual(["constraint", "capability"]);
  });

  it("maps verifiability and distinctness answers to eval-signal context", () => {
    const memories = answersToMemories(
      [
        { ...QUESTIONS[0]!, id: "proof", question: "What proves this is complete?", source_dimension: "verifiability" },
        { ...QUESTIONS[0]!, id: "unique", question: "What evidence should be unique?", source_dimension: "distinctness" },
      ],
      [
        { question_id: "proof", selected_label: "Passing CLI smoke test", other_text: null },
        { question_id: "unique", selected_label: "Commit touches the CLI package only", other_text: null },
      ],
    );

    expect(memories.map((m) => m.category)).toEqual(["eval_signal", "eval_signal"]);
    expect(memories[0]!.content).toContain("Eval signal: Passing CLI smoke test.");
    expect(memories[1]!.content).toContain("Source dimension: distinctness.");
  });
});

describe("answersToIntakeSignals", () => {
  it("uses question capture contracts for intake progress signals", () => {
    const signals = answersToIntakeSignals(
      [
        {
          ...QUESTIONS[0]!,
          capture: {
            category: "procedure",
            scope: "aim",
            purpose: "document_procedure",
            improvesDimension: "verifiability",
            reason: "test_capture_contract",
          },
        },
      ],
      [{ question_id: "scope", selected_label: "Run pnpm test before release", other_text: null }],
    );

    expect(signals).toEqual([
      {
        source: "user_answer",
        channel: "questionnaire",
        category: "procedure",
        scope: "aim",
        questionId: "scope",
        summary: "Run pnpm test before release",
      },
    ]);
  });

  it("falls back to aim-scoped inferred context for legacy questions", () => {
    const signals = answersToIntakeSignals(QUESTIONS, [
      { question_id: "scope", selected_label: "Production", other_text: null },
    ]);

    expect(signals).toEqual([
      expect.objectContaining({
        category: "constraint",
        scope: "aim",
        summary: "Production",
      }),
    ]);
  });

  it("keeps every selected label in the intake progress summary", () => {
    const signals = answersToIntakeSignals([MULTI_QUESTION], [{
      question_id: "sources",
      selected_label: "Local files",
      selected_labels: ["Local files", "Web research"],
      other_text: null,
    }]);

    expect(signals[0]?.summary).toBe("Local files; Web research");
  });

  it("treats legacy selected_label plus other_text as one custom alternative", () => {
    const signals = answersToIntakeSignals(QUESTIONS, [{
      question_id: "scope",
      selected_label: "Production",
      other_text: "A demo-quality release",
    }]);

    expect(signals[0]?.summary).toBe("A demo-quality release");
  });
});
