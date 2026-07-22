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

  // Regression: `examples/eval-moat` reproduced this leak on all three of its personas — context
  // from a completely unrelated aim was admitted into planning on "the"/"should"/"for" alone.
  it("does not admit another aim's context on function-word overlap alone", () => {
    const result = selectPlanningMemoriesWithTrace({
      title: "Add receipt scanning to my invoicing desktop app",
      description:
        "A user should be able to drop a photo of a paper receipt into the app and get a draft expense entry they can correct before saving.",
      currentGoalId: "receipt-scanning",
      memories: [
        {
          id: "marketing-site",
          goalId: "old-marketing-aim",
          category: "preference",
          content: "Preference: The marketing site should stay a single static page with no JavaScript framework.",
          confidence: 1,
        },
        {
          id: "expense-table",
          goalId: "old-export-aim",
          category: "project_fact",
          content:
            "Project fact: Expense rows live in a local SQLite table with a NOT NULL merchant column, so any importer must produce a merchant value or an explicit unknown sentinel.",
          confidence: 1,
        },
      ],
    });

    // One shared content word ("expense") is enough for a row from another aim to keep flowing.
    expect(result.report.selected).toEqual([
      expect.objectContaining({
        memoryId: "expense-table",
        scope: "related_goal",
        reason: "related_goal_context",
        matchedTokens: ["expense"],
      }),
    ]);
    expect(result.report.ignored).toEqual([
      expect.objectContaining({
        memoryId: "marketing-site",
        scope: "unrelated_goal",
        reason: "unrelated_goal_context",
        score: 0,
        matchedTokens: [],
      }),
    ]);
  });

  it("does not let a shared bare figure carry a cross-aim match", () => {
    const result = selectPlanningMemoriesWithTrace({
      title: "Write the annual impact report",
      description: "The funder wants a plain-text summary under 500 words.",
      currentGoalId: "impact-report",
      memories: [
        {
          id: "lease",
          goalId: "old-office-aim",
          category: "project_fact",
          content: "Project fact: The office lease renewal costs 500 more each month.",
          confidence: 1,
        },
      ],
    });

    expect(result.memories).toEqual([]);
    expect(result.report.ignored[0]).toEqual(
      expect.objectContaining({ memoryId: "lease", reason: "unrelated_goal_context", matchedTokens: [] }),
    );
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
