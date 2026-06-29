import { describe, expect, it } from "vitest";

import { localDecompose, type ClarifyOutput } from "@core/llm";

import type { MergedItem } from "@core/domain";
import type { Goal } from "@core/types";

import { formatPlanPretty, formatClarifyPretty, formatGoalList, formatMergeSummary, ruleSummary } from "./format";

describe("formatPlanPretty", () => {
  it("renders the goal summary, milestone count, and each milestone", () => {
    const plan = localDecompose({ title: "Build a CLI todo app" });
    const text = formatPlanPretty(plan);
    expect(text).toContain("Build a CLI todo app");
    expect(text).toContain(`${plan.nodes.length} milestone`);
    expect(text).toContain(`1. ${plan.nodes[0]!.title}`);
    expect(text).toContain("✓ "); // acceptance summary line
  });
});

describe("ruleSummary", () => {
  it("joins clause evaluators by the rule's logic", () => {
    const plan = localDecompose({ title: "x" });
    const rule = plan.nodes[0]!.acceptance_rule;
    const summary = ruleSummary(rule);
    expect(summary.length).toBeGreaterThan(0);
    expect(summary).toContain(rule.clauses[0]!.evaluator);
  });
});

describe("formatClarifyPretty", () => {
  const out: ClarifyOutput = {
    questions: [
      {
        id: "scope",
        question: "How polished should it be?",
        why_high_impact: "Decides milestone count.",
        kind: "scope",
        allow_other: true,
        options: [
          { label: "Prototype", tradeoff: "Faster, looser." },
          { label: "Production", tradeoff: "Strict CI gates." },
        ],
      },
    ],
    assumptions: [{ statement: "Assumed GitHub + CI.", default_value: "github" }],
  };

  it("renders the title, question, options, and assumptions", () => {
    const text = formatClarifyPretty("Ship auth", out);
    expect(text).toContain("Clarifying questions for: Ship auth");
    expect(text).toContain("[scope] How polished should it be?");
    expect(text).toContain("- Prototype — Faster, looser.");
    expect(text).toContain("Assuming");
    expect(text).toContain("Assumed GitHub + CI. (github)");
  });

  it("handles an empty question set", () => {
    const text = formatClarifyPretty("X", { questions: [], assumptions: [] });
    expect(text).toContain("no high-impact questions");
  });
});

describe("formatGoalList", () => {
  const goal = {
    id: "abcd1234-0000-4000-8000-000000000000",
    title: "Ship auth",
    created_at: "2026-06-29T10:00:00.000Z",
  } as unknown as Goal;

  it("uses the provided milestone-row count (not plan_json) and a short id", () => {
    const text = formatGoalList([{ goal, milestoneCount: 3 }]);
    expect(text).toContain("abcd1234");
    expect(text).toContain("Ship auth");
    expect(text).toContain("3 milestones");
    expect(text).toContain("2026-06-29");
  });

  it("singularizes a 1-milestone aim and handles the empty list", () => {
    expect(formatGoalList([{ goal, milestoneCount: 1 }])).toMatch(/1 milestone[^s]/); // singular, not "milestones"
    expect(formatGoalList([])).toContain("No aims yet");
  });
});

describe("formatMergeSummary", () => {
  it("counts each merge action", () => {
    const merged: MergedItem[] = [
      { action: "freeze", existingId: "a", nodeKey: "k1", title: "Done" },
      { action: "update", existingId: "b", nodeKey: "k2", title: "Changed" },
      { action: "add", existingId: null, nodeKey: "k3", title: "New" },
      { action: "skip", existingId: "c", nodeKey: null, title: "Dropped" },
    ];
    expect(formatMergeSummary(merged)).toBe("re-plan: 1 added · 1 updated · 1 kept (done) · 1 skipped");
  });
});
