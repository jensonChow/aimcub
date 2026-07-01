import { describe, expect, it } from "vitest";

import type { ClarifyQuestion } from "@core/llm";

import { parseAnswers, answersToMemories } from "./answers";

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
