import { describe, expect, it } from "vitest";

import type { ClarifyQuestion } from "@core/llm";

import { parseAnswers, answersToMemories } from "./answers";

const QUESTIONS: ClarifyQuestion[] = [
  {
    id: "scope",
    question: "How polished should it be?",
    why_high_impact: "Decides milestone count.",
    kind: "scope",
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
    expect(memories).toEqual([{ content: "How polished should it be? → Production", source: "user_stated" }]);
  });

  it("prefers free text over the selected label and falls back to the id as label", () => {
    const memories = answersToMemories(QUESTIONS, [
      { question_id: "scope", selected_label: "Production", other_text: "actually, a demo" },
      { question_id: "unknown", selected_label: null, other_text: "x" },
    ]);
    expect(memories[0]!.content).toBe("How polished should it be? → actually, a demo");
    expect(memories[1]!.content).toBe("unknown → x"); // no matching question → label is the id
  });
});
