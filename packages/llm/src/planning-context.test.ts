import { describe, expect, it } from "vitest";

import {
  PLANNING_CONTEXT_RULES,
  renderPlanningContext,
  selectPlanningMemories,
  selectPlanningMemoriesWithTrace,
} from "./planning-context";

describe("planning context rendering", () => {
  it("groups memories by context category in planning order", () => {
    const text = renderPlanningContext([
      { category: "preference", kind: "semantic", source: "user_stated", confidence: 0.9, content: "User prefers CLI-first workflows." },
      { category: "constraint", kind: "semantic", source: "user_stated", confidence: 1, content: "Do not add platform deps to @core packages." },
      { category: "eval_signal", kind: "semantic", source: "evidence_derived", confidence: 0.7, content: "Eval signal: User accepts work only after tests pass." },
    ]);

    expect(text.indexOf("constraint:")).toBeLessThan(text.indexOf("preference:"));
    expect(text).toContain("preference:");
    expect(text).toContain("[semantic, user_stated, confidence=0.9] User prefers CLI-first workflows.");
    expect(text).toContain("eval_signal:");
  });

  it("infers categories from legacy prefix-only memories", () => {
    const text = renderPlanningContext([{ kind: "semantic", source: "user_stated", content: "Constraint: Keep the CLI scriptable." }]);
    expect(text).toContain("constraint:");
    expect(text).toContain("Constraint: Keep the CLI scriptable.");
  });

  it("documents category semantics for the model", () => {
    expect(PLANNING_CONTEXT_RULES).toContain("constraint: treat as hard limits");
    expect(PLANNING_CONTEXT_RULES).toContain("eval_signal: use as evidence of what this user considers done");
  });

  it("selects global context and drops unrelated goal-scoped context", () => {
    const selected = selectPlanningMemories({
      title: "Build a CLI todo app",
      description: "Use TypeScript and tests.",
      memories: [
        {
          id: "memory-1",
          goalId: null,
          category: "constraint",
          content: "Constraint: Keep core packages pure.",
          confidence: 1,
        },
        {
          goalId: "old-api-aim",
          category: "project_fact",
          content: "The billing dashboard uses Stripe webhooks.",
          confidence: 1,
        },
        {
          goalId: "old-cli-aim",
          category: "project_fact",
          content: "The previous CLI used TypeScript and Vitest.",
          confidence: 1,
        },
      ],
    });

    expect(selected.map((memory) => memory.content)).toEqual([
      "Constraint: Keep core packages pure.",
      "The previous CLI used TypeScript and Vitest.",
    ]);
  });

  it("keeps current-goal context for replanning even without token overlap", () => {
    const selected = selectPlanningMemories({
      title: "Polish the launch checklist",
      currentGoalId: "goal-1",
      memories: [
        {
          goalId: "goal-1",
          category: "project_fact",
          content: "User chose the production quality bar during intake.",
          confidence: 1,
        },
        {
          goalId: "goal-2",
          category: "preference",
          content: "User chose a throwaway prototype for a separate demo.",
          confidence: 1,
        },
      ],
    });

    expect(selected.map((memory) => memory.content)).toEqual([
      "User chose the production quality bar during intake.",
    ]);
  });

  it("does not select low-confidence planning memories", () => {
    const selected = selectPlanningMemories({
      title: "Build a TypeScript CLI",
      memories: [
        {
          id: "memory-1",
          goalId: null,
          category: "constraint",
          content: "Constraint: Use TypeScript.",
          confidence: 0.4,
        },
      ],
    });

    expect(selected).toEqual([]);
  });

  it("explains selected and ignored context rows", () => {
    const result = selectPlanningMemoriesWithTrace({
      title: "Build a TypeScript CLI",
      limit: 1,
      memories: [
        {
          id: "memory-1",
          goalId: null,
          category: "constraint",
          content: "Constraint: Use TypeScript.",
          confidence: 1,
        },
        {
          goalId: "old-cli",
          category: "project_fact",
          content: "The old CLI used Vitest.",
          confidence: 1,
        },
        {
          goalId: null,
          category: "preference",
          content: "Preference: Use verbose reports.",
          confidence: 0.4,
        },
        {
          goalId: "old-billing",
          category: "project_fact",
          content: "The billing dashboard uses Stripe.",
          confidence: 1,
        },
      ],
    });

    expect(result.memories.map((memory) => memory.content)).toEqual(["Constraint: Use TypeScript."]);
    expect(result.report.total).toBe(4);
    expect(result.report.selected).toEqual([
      expect.objectContaining({
        memoryId: "memory-1",
        content: "Constraint: Use TypeScript.",
        scope: "global",
        reason: "global_context_with_goal_overlap",
        matchedTokens: ["typescript"],
      }),
    ]);
    expect(result.report.ignored).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ content: "The old CLI used Vitest.", reason: "over_selection_limit" }),
        expect.objectContaining({ content: "Preference: Use verbose reports.", reason: "low_confidence" }),
        expect.objectContaining({ content: "The billing dashboard uses Stripe.", reason: "unrelated_goal_context" }),
      ]),
    );
  });
});
