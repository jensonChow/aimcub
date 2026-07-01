import { describe, expect, it } from "vitest";

import type { Evidence, Goal, Milestone, MilestoneCompletion } from "@core/types";
import type { ContextLineageReport } from "./context-lineage";
import { reviewDecompositionStrategy, summarizeDecompositionLearning } from "./decomposition-learning";

const goal = {
  id: "11111111-1111-4111-8111-111111111111",
  title: "Ship Aimcub CLI",
  metadata: {
    plan_quality: {
      score: 78,
      grade: "warn",
      issues: [
        {
          code: "weak_commit_pattern",
          severity: "warning",
          nodeKey: "m1",
          message: "Commit pattern is too broad.",
        },
        {
          code: "compound_milestone",
          severity: "warning",
          nodeKey: "m2",
          message: "Milestone combines implementation and release.",
        },
      ],
      dimensions: [
        { dimension: "verifiability", score: 75, grade: "warn", issueCount: 1, issueCodes: ["weak_commit_pattern"] },
      ],
    },
  },
} as unknown as Pick<Goal, "id" | "title" | "metadata">;

const milestones = [
  {
    id: "22222222-0000-4000-8000-000000000001",
    title: "Implement CLI command",
    status: "completed",
    metadata: {
      plan_key: "m1",
      decomposition_contract: {
        why: "Makes the feature usable from the terminal.",
        definition_of_done: "The command runs and prints useful output.",
        required_evidence: ["commit touching apps/cli"],
        likely_owner: "agent",
        context_gaps: [],
        eval_signal: "CLI output matches the user's workflow.",
      },
    },
    acceptance_rule: {
      logic: "all",
      clauses: [{ evaluator: "commit_pattern", match: { path_glob: "apps/cli/**", message_pattern: "cli" } }],
    },
  },
  {
    id: "22222222-0000-4000-8000-000000000002",
    title: "Release CLI",
    status: "pending",
    metadata: { plan_key: "m2" },
    acceptance_rule: { logic: "all", clauses: [{ evaluator: "ci_status", match: { conclusion: "success" } }] },
  },
] as unknown as Pick<Milestone, "id" | "title" | "status" | "metadata" | "acceptance_rule">[];

const evidence = [
  {
    id: "33333333-0000-4000-8000-000000000001",
    kind: "git_commit",
    payload: {
      sha: "abc123",
      message: "ship cli command",
      files: ["apps/cli/src/index.ts"],
    },
    trust_score: 0.95,
  },
] as unknown as Pick<Evidence, "id" | "kind" | "payload" | "trust_score">[];

const completions = [
  {
    milestone_id: "22222222-0000-4000-8000-000000000001",
    decided_by: "rule_auto",
    triggering_evidence_ids: ["33333333-0000-4000-8000-000000000001"],
  },
] as unknown as Pick<MilestoneCompletion, "milestone_id" | "decided_by" | "triggering_evidence_ids">[];

const lineage = {
  rows: [
    {
      questionId: "q1",
      question: "Which verification command proves the CLI is ready?",
      answer: "pnpm test",
      category: "eval_signal",
      captureStatus: "captured_and_impacted",
      capturePurpose: "define_eval",
      improvesDimension: "verifiability",
      source: "review_gap",
      reason: "missing_eval",
      originNode: { key: "m1", title: "Implement CLI command" },
      affectedNodes: [],
      memoryContent: "Eval signal: pnpm test proves CLI readiness.",
      memoryCaptured: true,
      impactedPlan: true,
      pendingContext: [],
      acceptedContextCount: 1,
      rejectedContextCount: 0,
      deprioritizedContextCount: 0,
      signals: [],
      nextAction: "Reuse this captured context.",
    },
    {
      questionId: "q2",
      question: "Should release include a marketing site?",
      answer: "No",
      category: "preference",
      captureStatus: "captured",
      capturePurpose: "reuse_preference",
      improvesDimension: "context_fit",
      source: "review_gap",
      reason: "scope_unclear",
      originNode: { key: "m2", title: "Release CLI" },
      affectedNodes: [],
      memoryContent: null,
      memoryCaptured: false,
      impactedPlan: false,
      pendingContext: [],
      acceptedContextCount: 0,
      rejectedContextCount: 1,
      deprioritizedContextCount: 1,
      signals: [],
      nextAction: "Stop asking this pattern.",
    },
  ],
} as unknown as ContextLineageReport;

describe("summarizeDecompositionLearning", () => {
  it("summarizes quality issues, completed contract patterns, and context outcomes", () => {
    const report = summarizeDecompositionLearning([{ goal, milestones, lineage, evidence, completions }]);

    expect(report).toMatchObject({
      version: 1,
      totalAims: 1,
      totalMilestones: 2,
      completedMilestones: 1,
      qualityIssueCount: 2,
      contextOutcomeCount: 2,
      evidenceAttributionCount: 1,
    });
    expect(report.rows.map((row) => row.source)).toEqual([
      "context_outcome",
      "quality_issue",
      "context_outcome",
      "quality_issue",
      "completed_contract",
    ]);
    expect(report.rows.map((row) => row.recommendation)).toEqual([
      "tighten_contract",
      "improve_acceptance",
      "ask_context_earlier",
      "reconsider_granularity",
      "reuse_pattern",
    ]);
    expect(report.rows.find((row) => row.recommendation === "reuse_pattern")).toMatchObject({
      nodeTitle: "Implement CLI command",
      completed: true,
      decidedBy: "rule_auto",
      evidenceKinds: ["git_commit"],
      evaluatorKinds: ["commit_pattern"],
      triggeringEvidenceCount: 1,
      minimumTrustScore: 0.95,
    });
    expect(report.guidance[0]).toContain("Tighten milestone contracts");
  });
});

describe("reviewDecompositionStrategy", () => {
  it("turns historical decomposition learning into current aim strategy actions", () => {
    const learning = summarizeDecompositionLearning([{ goal, milestones, lineage, evidence, completions }]);
    const strategy = reviewDecompositionStrategy({
      title: "Improve Aimcub decomposition",
      description: "Make aim decomposition more context-aware.",
      learning,
    });

    expect(strategy).toMatchObject({
      version: 1,
      title: "Improve Aimcub decomposition",
      actionCount: 5,
    });
    expect(strategy.actions.map((action) => action.focus)).toEqual([
      "contract_specificity",
      "verifiability",
      "context_fit",
      "evidence_pattern",
      "granularity",
    ]);
    expect(strategy.actions.find((action) => action.focus === "evidence_pattern")?.recommendation).toContain("git_commit via commit_pattern");
    expect(strategy.actions.find((action) => action.focus === "verifiability")?.recommendation).toContain("acceptance_rule");
    expect(strategy.actions.find((action) => action.focus === "context_fit")?.recommendation).toContain("context_gaps");
    expect(strategy.guidance).toContain("Collect only context that can change milestone boundaries, owner routing, evidence choice, or eval signals.");
  });

  it("asks for context fit when the current aim is underspecified", () => {
    const strategy = reviewDecompositionStrategy({ title: "Ship CLI" });

    expect(strategy.actions).toEqual([
      {
        focus: "context_fit",
        priority: "low",
        recommendation: "Surface context_gaps before locking the plan when target, constraints, procedure, or eval standards are underspecified.",
        reason: "The current aim has a short description.",
        sourceRows: 0,
      },
    ]);
  });
});
