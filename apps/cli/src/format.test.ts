import { describe, expect, it } from "vitest";

import { localDecompose, type ClarifyOutput } from "@core/llm";

import { formatPlanPretty, formatClarifyPretty, ruleSummary } from "./format";

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
