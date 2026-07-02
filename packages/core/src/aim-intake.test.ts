import { describe, expect, it } from "vitest";

import type { DecompositionOutput, Memory } from "@core/types";
import { reviewAimIntake } from "./aim-intake";
import { reviewPlan } from "./plan-quality";

const memoryBase = {
  owner_id: "owner",
  kind: "semantic",
  source: "user_stated",
  superseded_by: null,
} as const;

describe("reviewAimIntake", () => {
  it("asks targeted context questions when an aim is too thin to decompose confidently", () => {
    const report = reviewAimIntake({
      title: "Ship auth",
      memories: [
        {
          ...memoryBase,
          id: "11111111-0000-4000-8000-000000000001",
          goal_id: null,
          status: "active",
          category: "preference",
          content: "Preference: Prefer CLI-first workflows.",
          confidence: 0.9,
        },
        {
          ...memoryBase,
          id: "11111111-0000-4000-8000-000000000002",
          goal_id: null,
          status: "pending",
          category: "constraint",
          content: "Constraint: Confirm whether auth must be Supabase-only.",
          confidence: 0.7,
        },
      ] as Memory[],
      selectedContext: [],
    });

    expect(report.readiness).toBe("needs_targeted_context");
    expect(report.coverage.selectedTotal).toBe(0);
    expect(report.coverage.missingCoreCategories).toEqual(["eval_signal", "constraint", "procedure"]);
    expect(report.questions.map((question) => question.category)).toContain("project_fact");
    expect(report.questions.map((question) => question.category)).toContain("eval_signal");
    expect(report.questions.find((question) => question.category === "constraint")).toMatchObject({
      source: "planning_context",
      reason: "pending_context_not_selected",
      capture: {
        category: "constraint",
        scope: "global",
        purpose: "shape_plan",
        improvesDimension: "granularity",
      },
    });
    expect(report.questions.find((question) => question.category === "eval_signal")?.capture).toMatchObject({
      scope: "global",
      purpose: "define_eval",
      improvesDimension: "verifiability",
    });
    expect(report.acquisition.map((row) => row.channel)).toEqual(expect.arrayContaining([
      "local_workspace",
      "conversation",
      "questionnaire",
    ]));
    expect(report.acquisition.find((row) => row.channel === "local_workspace")).toMatchObject({
      priority: "high",
      scope: "aim",
      suggestedTools: expect.arrayContaining(["local.scan_workspace", "local.search", "local.read"]),
      memoryTargets: [
        {
          scope: "aim",
          kind: "semantic",
          categories: expect.arrayContaining(["project_fact", "procedure"]),
        },
      ],
    });
    expect(report.nextActions).toContain("Review pending context candidates so future aims need fewer questions.");
  });

  it("recommends local, personal, web, conversational, and questionnaire context acquisition channels", () => {
    const report = reviewAimIntake({
      title: "Plan a Cambodia trip using current travel information",
      description: "Use my Notion travel notes and any local folder I attach, then ask only the decisions that still need my input.",
      memories: [],
      selectedContext: [],
    });

    expect(report.readiness).toBe("needs_targeted_context");
    expect(report.acquisition.map((row) => row.channel)).toEqual(expect.arrayContaining([
      "local_workspace",
      "personal_database",
      "web_research",
      "conversation",
      "questionnaire",
    ]));
    expect(report.acquisition.find((row) => row.channel === "web_research")).toMatchObject({
      priority: "high",
      scope: "aim",
      categories: expect.arrayContaining(["project_fact", "procedure", "eval_signal"]),
      suggestedTools: ["web.search", "web.fetch", "memory.write_candidate"],
      memoryTargets: [
        {
          scope: "aim",
          kind: "semantic",
          categories: expect.arrayContaining(["project_fact", "procedure", "eval_signal"]),
        },
      ],
    });
    expect(report.acquisition.find((row) => row.channel === "personal_database")).toMatchObject({
      suggestedTools: expect.arrayContaining(["external.notion"]),
      memoryTargets: expect.arrayContaining([
        expect.objectContaining({
          scope: "global",
          categories: expect.arrayContaining(["preference", "constraint", "capability"]),
        }),
      ]),
    });
    expect(report.acquisition.find((row) => row.channel === "questionnaire")?.memoryTargets.length).toBeGreaterThan(0);
  });

  it("uses draft review gaps and quality actions to mark a plan as needing refinement", () => {
    const plan = {
      goal_summary: "Ship Aimcub CLI context.",
      domain: "software",
      rationale: "Draft from a thin aim.",
      nodes: [
        {
          key: "all",
          title: "Build and verify context flow",
          description: "Implement and test the whole context flow.",
          est_effort: "xl",
          xp_reward: 20,
          acceptance_rule: {
            logic: "all",
            threshold: 1,
            completion_mode: "manual",
            clauses: [{ evaluator: "manual_confirm", auto_verifiable: false, match: {} }],
          },
        },
      ],
      edges: [],
    } as unknown as DecompositionOutput;
    const review = reviewPlan({ plan, context: [] });

    const report = reviewAimIntake({
      title: "Improve context collection",
      description: "Make Aimcub ask better intake questions and collect context from the answers.",
      memories: [],
      selectedContext: [],
      draftReview: review,
    });

    expect(report.readiness).toBe("needs_plan_refinement");
    expect(report.questions[0]).toMatchObject({
      source: "draft_review",
      category: "eval_signal",
      priority: "high",
    });
    expect(report.questions[0]!.issueCodes).toContain("manual_only_verification");
    expect(report.questions[0]!.capture).toMatchObject({
      category: "eval_signal",
      scope: "global",
      purpose: "define_eval",
      improvesDimension: "verifiability",
    });
    expect(report.nextActions[0]).toBe("Refine the draft before accepting the decomposition.");
  });

  it("turns milestone contract gaps from draft review into targeted intake questions", () => {
    const plan = {
      goal_summary: "Ship context review.",
      domain: "software",
      rationale: "Split implementation from proof.",
      nodes: [
        {
          key: "core",
          title: "Implement context review",
          description: "Add pure support for reviewing context candidates.",
          est_effort: "m",
          xp_reward: 20,
          decomposition_contract: {
            why: "Context review is the core capability.",
            definition_of_done: "Pending context can be reviewed before it becomes active memory.",
            required_evidence: ["A trusted commit touching packages/core."],
            likely_owner: "agent",
            context_gaps: [
              {
                category: "procedure",
                question: "Which command proves context review works before save?",
                reason: "missing_verification_command",
              },
            ],
            eval_signal: "Done means context review works through a repeatable verification command.",
          },
          acceptance_rule: {
            logic: "all",
            threshold: 1,
            completion_mode: "auto_then_confirm",
            clauses: [
              {
                evaluator: "commit_pattern",
                auto_verifiable: true,
                match: { path_glob: "packages/core/**", min_files: 1, message_pattern: "context review" },
              },
            ],
          },
        },
      ],
      edges: [],
    } as unknown as DecompositionOutput;
    const review = reviewPlan({
      plan,
      context: [
        { category: "eval_signal", content: "Eval signal: Repeatable verification command proves context review.", confidence: 1 },
        { category: "constraint", content: "Constraint: Keep @core pure.", confidence: 1 },
        { category: "procedure", content: "Procedure: A command proves context review works before save.", confidence: 1 },
      ],
    });

    const report = reviewAimIntake({
      title: "Ship context review",
      description: "Add pure support for reviewing context candidates before they become active memory.",
      memories: [],
      selectedContext: [
        { content: "Eval signal: Repeatable verification command proves context review.", category: "eval_signal", confidence: 1 },
        { content: "Constraint: Keep @core pure.", category: "constraint", confidence: 1 },
        { content: "Procedure: A command proves context review works before save.", category: "procedure", confidence: 1 },
      ],
      draftReview: review,
    });

    expect(report.readiness).toBe("needs_targeted_context");
    expect(report.questions[0]).toMatchObject({
      source: "draft_review",
      category: "procedure",
      reason: "missing_verification_command",
      prompt: expect.stringContaining("Which command proves context review works"),
      roiScore: expect.any(Number),
      roiSignals: expect.arrayContaining(["decomposition_contract", "node_specific", "procedure"]),
      capture: {
        category: "procedure",
        scope: "aim",
        purpose: "document_procedure",
        improvesDimension: "verifiability",
        origin: {
          source: "draft_review",
          reason: "missing_verification_command",
          gapSource: "decomposition_contract",
          nodeKey: "core",
          nodeTitle: "Implement context review",
          roiScore: expect.any(Number),
          roiSignals: expect.arrayContaining(["decomposition_contract", "node_specific"]),
        },
      },
    });
  });

  it("uses lineage learning to raise high-impact intake questions", () => {
    const report = reviewAimIntake({
      title: "Ship release workflow",
      description: "Add a release command and verify it.",
      memories: [],
      selectedContext: [
        { content: "Eval signal: Done means tests and typecheck pass.", category: "eval_signal", confidence: 0.95 },
        { content: "Constraint: Keep @core pure.", category: "constraint", confidence: 0.95 },
      ],
      lineageLearning: {
        version: 1,
        totalQuestions: 1,
        totalAnswered: 1,
        totalCaptured: 1,
        totalImpacted: 1,
        totalPending: 0,
        rows: [
          {
            source: "review_gap",
            gapSource: "decomposition_contract",
            category: "procedure",
            capturePurpose: "document_procedure",
            improvesDimension: "verifiability",
            askedCount: 1,
            answeredCount: 1,
            memoryCapturedCount: 1,
            impactedCount: 1,
            pendingContextCount: 0,
            answerRate: 1,
            captureRate: 1,
            impactRate: 1,
            recommendation: "reuse_pattern",
            exampleQuestion: "Which command proves this milestone works?",
            exampleAnswer: "pnpm test passes",
            exampleNodeTitle: "Scaffold CLI",
            signals: ["quality_dimension_improved"],
          },
        ],
        guidance: ["Reuse procedure verifiability questions from decomposition-contract."],
      },
    });

    expect(report.questions[0]).toMatchObject({
      category: "procedure",
      priority: "high",
      source: "context_profile",
      roiScore: expect.any(Number),
      roiSignals: expect.arrayContaining(["lineage_learning", "procedure"]),
      capture: {
        category: "procedure",
        scope: "aim",
        purpose: "document_procedure",
        improvesDimension: "verifiability",
        origin: {
          roiSignals: expect.arrayContaining(["lineage_learning", "procedure"]),
        },
      },
    });
    expect(report.questions[0]!.roiScore).toBeGreaterThan(20);
  });

  it("is ready when selected context covers the core intake categories and review passes", () => {
    const report = reviewAimIntake({
      title: "Ship CLI context profile",
      description: "Add a CLI command that reports context readiness by category.",
      memories: [
        {
          ...memoryBase,
          id: "11111111-0000-4000-8000-000000000003",
          goal_id: null,
          status: "active",
          category: "eval_signal",
          content: "Eval signal: Done means tests and typecheck pass.",
          confidence: 0.9,
        },
      ] as Memory[],
      selectedContext: [
        { content: "Eval signal: Done means tests and typecheck pass.", category: "eval_signal", confidence: 0.9 },
        { content: "Constraint: Keep @core pure.", category: "constraint", confidence: 0.95 },
        { content: "Procedure: Run pnpm build before done.", category: "procedure", confidence: 0.9 },
      ],
    });

    expect(report.readiness).toBe("ready");
    expect(report.questions).toEqual([]);
    expect(report.nextActions).toEqual(["Proceed with decomposition and keep collecting eval signals from evidence."]);
  });
});
