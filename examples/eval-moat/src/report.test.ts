import { describe, expect, it } from "vitest";

import { renderReport, summarizeJudgements, summaryLine } from "./report.ts";
import { RUBRIC_CRITERIA } from "./rubric.ts";
import type { BenchmarkRun, ConditionId, ContextDiff, PlanCell, ResolvedJudgement } from "./types.ts";

/** `bare` and `contexted` are PER-CRITERION scores (1-5); a total is five times that. */
function judgement(aimId: string, bare: number, contexted: number, repetition = 1): ResolvedJudgement {
  const criteria = (score: number) =>
    RUBRIC_CRITERIA.map((criterion) => ({ criterion: criterion.id, score, justification: "" }));
  return {
    aimId,
    repetition,
    labelMap: { A: "bare", B: "contexted" },
    byCondition: { bare: criteria(bare), contexted: criteria(contexted) },
    notes: `${aimId}: the plans differ on evidence.`,
  };
}

function cell(aimId: string, condition: ConditionId, score: number): PlanCell {
  return {
    aimId,
    condition,
    repetition: 1,
    ok: true,
    errors: [],
    plan: null,
    groundTruthQuality: { score, grade: "warn", issues: [], dimensions: [] },
    nodeCount: 5,
    manualOnlyNodes: 1,
    ownerMix: { agent: 4, human: 1 },
    usage: { model: "test-model", inputTokens: 100, outputTokens: 200 },
  };
}

const diff: ContextDiff = {
  aimId: "receipt-scanning",
  injectedRows: 8,
  injectedChars: 1300,
  bareRows: 0,
  bareChars: 0,
  byCategory: [{ category: "constraint", count: 2 }],
  injectedOnly: [{ content: "Constraint: offline only.", category: "constraint", scope: "global", reason: "global_context", score: 80 }],
  weakMatches: [{ content: "Preference: unrelated site.", category: "preference", matchedTokens: ["the"] }],
  withheld: [{ content: "Procedure: pending row.", category: "procedure", scope: "aim_scoped", reason: "not_active_context:pending" }],
  learningDelta: ["decomposition learning: 1 more prior aim(s)"],
  nonEmpty: true,
};

function run(overrides: Partial<BenchmarkRun> = {}): BenchmarkRun {
  return {
    mode: "live",
    startedAt: "2026-07-22T00:00:00.000Z",
    seed: "seed",
    repeat: 1,
    provider: "anthropic",
    model: "claude-sonnet-5",
    providerCalls: 9,
    aims: ["receipt-scanning"],
    diffs: [diff],
    cells: [cell("receipt-scanning", "bare", 70), cell("receipt-scanning", "contexted", 85)],
    judgements: [judgement("receipt-scanning", 3, 4)],
    warnings: [],
    ...overrides,
  };
}

describe("summarizeJudgements", () => {
  it("aggregates totals, per-criterion means, and win counts", () => {
    const summary = summarizeJudgements([
      judgement("a", 2, 4),
      judgement("b", 4, 2),
      judgement("c", 3, 3),
    ]);
    expect(summary.comparisons).toBe(3);
    expect(summary.contextedWins).toBe(1);
    expect(summary.bareWins).toBe(1);
    expect(summary.ties).toBe(1);
    expect(summary.perCondition.bare).toBeCloseTo(15);
    expect(summary.perCondition.contexted).toBeCloseTo(15);
    expect(summary.delta).toBeCloseTo(0);
    expect(summary.perCriterion).toHaveLength(RUBRIC_CRITERIA.length);
  });

  it("has no scores to aggregate when nothing was judged", () => {
    const summary = summarizeJudgements([]);
    expect(summary.delta).toBeNull();
    expect(summary.comparisons).toBe(0);
  });
});

describe("summaryLine", () => {
  it("says plainly when context made the plans worse", () => {
    const worse = run({ judgements: [judgement("receipt-scanning", 4, 2)] });
    const line = summaryLine(worse, summarizeJudgements(worse.judgements));
    expect(line).toContain("LOWER");
    expect(line).toContain("0 win / 1 loss");
    expect(line).toContain("directional signal");
  });

  it("reports a tie as identical rather than as a win", () => {
    const tied = run({ judgements: [judgement("receipt-scanning", 3, 3)] });
    expect(summaryLine(tied, summarizeJudgements(tied.judgements))).toContain("identical");
  });

  it("claims nothing about plan quality in a dry run", () => {
    const dry = run({ mode: "dry-run", judgements: [], cells: [], providerCalls: 0 });
    const line = summaryLine(dry, summarizeJudgements([]));
    expect(line).toContain("No plans were generated");
    expect(line).not.toContain("win");
  });

  it("calls out a fixture that injected nothing extra", () => {
    const empty = run({
      mode: "dry-run",
      judgements: [],
      diffs: [{ ...diff, injectedOnly: [], nonEmpty: false }],
    });
    expect(summaryLine(empty, summarizeJudgements([]))).toContain("the fixture, not the product");
  });

  it("makes no claim when live judging produced nothing", () => {
    const none = run({ judgements: [] });
    expect(summaryLine(none, summarizeJudgements([]))).toContain("no claim can be made");
  });
});

describe("renderReport", () => {
  it("renders scores, the context diff, and the deterministic cross-check", () => {
    const report = renderReport(run());
    expect(report).toContain("# Eval-moat benchmark report");
    expect(report).toContain("provider calls made: **9**");
    expect(report).toContain("| receipt-scanning | 1 | 15 | 20 | +5 |");
    expect(report).toContain("Deterministic cross-check");
    expect(report).toContain("| receipt-scanning | 70.0 | 85.0 | +15.0 |");
    expect(report).toContain("function-word overlap");
    expect(report).toContain("not_active_context:pending");
    expect(report).toContain("Re-score this by hand");
  });

  it("surfaces warnings rather than hiding them", () => {
    const report = renderReport(run({ warnings: ["judge call failed for receipt-scanning rep 1: timeout"] }));
    expect(report).toContain("### Warnings");
    expect(report).toContain("timeout");
  });

  it("says explicitly that a dry run generated no plans", () => {
    const report = renderReport(run({ mode: "dry-run", judgements: [], cells: [], providerCalls: 0 }));
    expect(report).toContain("No plans were generated");
    expect(report).not.toContain("Blind judgement");
  });
});
