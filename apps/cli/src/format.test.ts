import { describe, expect, it } from "vitest";

import { localDecompose, type ClarifyOutput, type PlanningContextSelectionReport } from "@core/llm";

import type { AimLearningReport, ContextLineageReport, MergedItem } from "@core/domain";
import type { Evidence, Goal } from "@core/types";

import {
  formatBoard,
  formatContext,
  formatEvidenceList,
  formatEvidenceResult,
  formatGoalDetail,
  formatMemoryCandidateList,
  formatMemoryList,
  formatContextHealth,
  formatContextProfile,
  formatAimIntake,
  formatAimLearning,
  formatClarifyImpact,
  formatClarifyLearning,
  formatContextCaptureFulfillment,
  formatContextCaptureLearning,
  formatContextLineage,
  formatContextLineageLearning,
  formatDecompositionLearning,
  formatDecompositionStrategy,
  formatPlanningContextSelection,
  formatPlanPretty,
  formatClarifyPretty,
  formatGoalList,
  formatMergeSummary,
  ruleSummary,
} from "./format";

describe("formatPlanPretty", () => {
  const planningContext: PlanningContextSelectionReport = {
    total: 3,
    limit: 12,
    selected: [
      {
        content: "Constraint: Keep the CLI scriptable for automation.",
        category: "constraint",
        confidence: 0.95,
        goalId: null,
        scope: "global",
        score: 80,
        reason: "global_context",
        matchedTokens: ["cli"],
      },
    ],
    ignored: [
      {
        content: "Project fact: The old iOS shell used SwiftUI.",
        category: "project_fact",
        confidence: 0.9,
        goalId: "99999999-0000-4000-8000-000000000000",
        scope: "unrelated_goal",
        score: 0,
        reason: "unrelated_goal_context",
        matchedTokens: [],
      },
      {
        content: "",
        category: "project_fact",
        confidence: 1,
        goalId: null,
        scope: "global",
        score: 0,
        reason: "empty_content",
        matchedTokens: [],
      },
    ],
  };

  it("renders the goal summary, milestone count, and each milestone", () => {
    const plan = localDecompose({ title: "Build a CLI todo app" });
    const text = formatPlanPretty(plan);
    expect(text).toContain("Build a CLI todo app");
    expect(text).toContain(`${plan.nodes.length} milestone`);
    expect(text).toContain(`1. ${plan.nodes[0]!.title}`);
    expect(text).toContain("✓ "); // acceptance summary line
    expect(text).toContain("contract: owner");
    expect(text).toContain("evidence:");
    expect(text).toContain("eval:");
  });

  it("renders optional plan quality feedback", () => {
    const plan = localDecompose({ title: "Build a CLI todo app" });
    const text = formatPlanPretty(plan, {
      grade: "warn",
      score: 90,
      dimensions: [
        { dimension: "verifiability", grade: "pass", score: 100, issueCount: 0, issueCodes: [] },
        { dimension: "granularity", grade: "warn", score: 90, issueCount: 1, issueCodes: ["oversized_milestone"] },
        { dimension: "distinctness", grade: "pass", score: 100, issueCount: 0, issueCodes: [] },
        { dimension: "context_fit", grade: "pass", score: 100, issueCount: 0, issueCodes: [] },
      ],
      issues: [
        {
          code: "missing_context_application",
          severity: "warning",
          contextCategory: "constraint",
          message: "No obvious use of constraint context.",
        },
      ],
    });
    expect(text).toContain("quality: warn (90/100)");
    expect(text).toContain("scorecard: verifiability pass 100/100 · granularity warn 90/100");
    expect(text).toContain("No obvious use of constraint context.");
  });

  it("renders optional plan review context usage", () => {
    const plan = localDecompose({ title: "Build a CLI todo app" });
    const text = formatPlanPretty(
      plan,
      { grade: "pass", score: 100, issues: [] },
      {
        quality: { grade: "pass", score: 100, issues: [] },
        context: {
          total: 2,
          applied: [
            {
              content: "Constraint: Use tests.",
              category: "constraint",
              confidence: 1,
              applied: true,
              matchedKeywords: ["tests"],
            },
          ],
          unapplied: [
            {
              content: "Procedure: Take screenshots.",
              category: "procedure",
              confidence: 1,
              applied: false,
              matchedKeywords: [],
            },
          ],
          ignoredLowConfidence: [],
          gaps: [
            {
              category: "eval_signal",
              priority: "medium",
              reason: "missing_personalized_eval",
              prompt: "Ask what would make this aim count as genuinely complete, and what evidence would prove it.",
            },
          ],
        },
        guidance: ["Confirm whether unapplied high-impact context is irrelevant, or refine the plan with it."],
        actions: [
          {
            code: "refine_with_unapplied_context",
            priority: "high",
            title: "Refine with unapplied context",
            reason: "1 high-impact context row did not appear in the plan.",
          },
        ],
      },
    );

    expect(text).toContain("context: 1 applied · 1 unapplied · 0 low-confidence · 1 gaps");
    expect(text).toContain("[constraint] Constraint: Use tests.");
    expect(text).toContain("[procedure] Procedure: Take screenshots.");
    expect(text).toContain("gap: [medium] eval_signal");
    expect(text).toContain("action: [high] refine_with_unapplied_context");
  });

  it("renders optional planning context selection trace", () => {
    const plan = localDecompose({ title: "Build a CLI todo app" });
    const text = formatPlanPretty(plan, undefined, undefined, planningContext);
    expect(text).toContain("planning context: 1 selected · 2 ignored · limit 12");
    expect(text).toContain("+ [constraint] global · score 80 · 95% · global_context");
    expect(text).toContain("matches: cli");
    expect(text).toContain("- [project_fact] unrelated_goal · score 0 · 90% · unrelated_goal_context");
  });

  it("renders optional aim intake readiness", () => {
    const plan = localDecompose({ title: "Build a CLI todo app" });
    const text = formatPlanPretty(plan, undefined, undefined, undefined, {
      title: "Build a CLI todo app",
      readiness: "needs_targeted_context",
      score: 64,
      coverage: {
        profile: {
          totalActive: 1,
          totalPending: 0,
          highConfidenceActive: 1,
          coverageScore: 42,
          rows: [],
          gaps: [],
        },
        selectedTotal: 0,
        selectedByCategory: [],
        missingCoreCategories: ["eval_signal", "constraint", "procedure"],
      },
      questions: [
        {
          id: "intake_1",
          category: "eval_signal",
          priority: "high",
          source: "context_profile",
          reason: "profile_missing",
          prompt: "Ask what counts as complete.",
        },
      ],
      acquisition: [],
      nextActions: ["Answer 1 high-priority intake question before accepting a plan."],
    });

    expect(text).toContain("aim intake: needs-targeted-context (64/100)");
    expect(text).toContain("missing core context: eval-signal, constraint, procedure");
    expect(text).toContain("? [high] eval-signal");
  });

  it("renders planning context selection as a standalone block", () => {
    const text = formatPlanningContextSelection(planningContext);
    expect(text).toContain("Constraint: Keep the CLI scriptable");
    expect(text).not.toContain("empty_content");
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
        source_dimension: "granularity",
        capture: {
          category: "constraint",
          scope: "global",
          purpose: "shape_plan",
          improvesDimension: "granularity",
          reason: "clarify_granularity",
        },
        why_asked: [
          {
            code: "quality_dimension",
            source_dimension: "granularity",
            detail: "granularity is warn",
          },
          {
            code: "historical_learning",
            source_dimension: "granularity",
            recommendation: "ask_more",
            detail: "1/1 past answers impacted plans",
          },
          {
            code: "aim_intake",
            source_dimension: "granularity",
            category: "constraint",
            priority: "medium",
            detail: "aim_text: thin_aim_statement",
          },
          {
            code: "decomposition_strategy",
            source_dimension: "granularity",
            priority: "high",
            strategyFocus: "granularity",
            sourceRows: 2,
            detail: "granularity: split milestones",
          },
        ],
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
    expect(text).toContain("[scope · granularity] How polished should it be?");
    expect(text).toContain("asked: quality/granularity · learning/ask_more · intake/constraint · strategy/granularity");
    expect(text).toContain("capture: global constraint · shape-plan · improves granularity");
    expect(text).toContain("- Prototype — Faster, looser.");
    expect(text).toContain("Assuming");
    expect(text).toContain("Assumed GitHub + CI. (github)");
  });

  it("handles an empty question set", () => {
    const text = formatClarifyPretty("X", { questions: [], assumptions: [] });
    expect(text).toContain("no high-impact questions");
  });
});

describe("formatClarifyLearning", () => {
  it("renders dimension recommendations and guidance", () => {
    const text = formatClarifyLearning({
      version: 1,
      total_answered: 2,
      total_impacted: 1,
      rows: [
        {
          source_dimension: "verifiability",
          answered_count: 1,
          impacted_count: 1,
          impact_rate: 1,
          affected_node_count: 1,
          total_quality_delta: 20,
          average_quality_delta: 20,
          recommendation: "ask_more",
        },
        {
          source_dimension: "distinctness",
          answered_count: 1,
          impacted_count: 0,
          impact_rate: 0,
          affected_node_count: 0,
          total_quality_delta: 0,
          average_quality_delta: 0,
          recommendation: "ask_selectively",
        },
      ],
      guidance: ["Prefer verifiability questions."],
    });

    expect(text).toContain("clarify learning: 2 answers · 1 impacted");
    expect(text).toContain("verifiability: ask_more · 1/1 impacted");
    expect(text).toContain("distinctness: ask_selectively · 0/1 impacted");
    expect(text).toContain("Prefer verifiability questions.");
  });
});

describe("formatContextCaptureLearning", () => {
  it("renders capture recommendations with origin-specific learning", () => {
    const text = formatContextCaptureLearning({
      version: 1,
      totalAsked: 2,
      totalAnswered: 2,
      totalCaptured: 2,
      totalImpacted: 1,
      rows: [
        {
          category: "eval_signal",
          scope: "global",
          purpose: "define_eval",
          improvesDimension: "verifiability",
          askedCount: 2,
          answeredCount: 2,
          memoryCapturedCount: 2,
          impactedCount: 1,
          answerRate: 1,
          captureRate: 1,
          impactRate: 0.5,
          recommendation: "ask_more",
        },
      ],
      originRows: [
        {
          source: "review_gap",
          gapSource: "decomposition_contract",
          nodeKey: "m1",
          nodeTitle: "Scaffold the CLI",
          category: "eval_signal",
          scope: "global",
          purpose: "define_eval",
          improvesDimension: "verifiability",
          askedCount: 1,
          answeredCount: 1,
          memoryCapturedCount: 1,
          impactedCount: 1,
          answerRate: 1,
          captureRate: 1,
          impactRate: 1,
          avgRoiScore: 88,
          roiSignals: ["high_priority", "decomposition_contract", "node_specific", "eval_signal"],
          issueCodes: ["missing_contract_eval_signal"],
          recommendation: "ask_more",
        },
      ],
      guidance: ["For m1 (Scaffold the CLI), prefer eval-signal questions."],
    });

    expect(text).toContain("capture learning: 2 asked · 2 answered · 2 captured · 1 impacted");
    expect(text).toContain("global/eval-signal · define-eval · improves verifiability: ask-more");
    expect(text).toContain("origins:");
    expect(text).toContain("m1 (Scaffold the CLI): eval-signal · ask-more · 1/1 impacted · avg roi 88");
    expect(text).toContain("For m1 (Scaffold the CLI), prefer eval-signal questions.");
  });
});

describe("formatContextLineageLearning", () => {
  it("renders lineage recommendations with examples and guidance", () => {
    const text = formatContextLineageLearning({
      version: 1,
      totalQuestions: 2,
      totalAnswered: 2,
      totalCaptured: 1,
      totalImpacted: 1,
      totalPending: 1,
      rows: [
        {
          source: "review_gap",
          gapSource: "decomposition_contract",
          category: "eval_signal",
          capturePurpose: "define_eval",
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
          exampleQuestion: "What proves this milestone is complete?",
          exampleAnswer: "pnpm test passes",
          exampleNodeTitle: "Scaffold CLI",
          signals: ["quality_dimension_improved"],
        },
        {
          source: "unknown",
          category: "procedure",
          capturePurpose: "document_procedure",
          improvesDimension: "context_fit",
          askedCount: 1,
          answeredCount: 1,
          memoryCapturedCount: 0,
          impactedCount: 0,
          pendingContextCount: 1,
          answerRate: 1,
          captureRate: 0,
          impactRate: 0,
          recommendation: "resolve_pending",
          exampleQuestion: "Which release checklist should this follow?",
          exampleAnswer: "Use the release checklist",
          signals: [],
        },
      ],
      guidance: [
        "Reuse eval-signal verifiability questions from decomposition-contract.",
        "Resolve pending procedure context from unknown before relying on it in milestone contracts.",
      ],
    });

    expect(text).toContain("lineage learning: 2 questions · 1 captured · 1 impacted · 1 pending");
    expect(text).toContain("decomposition-contract/eval-signal · define-eval");
    expect(text).toContain("reuse-pattern · 1/1 impacted · pending 0 · example Scaffold CLI");
    expect(text).toContain("q: What proves this milestone is complete?");
    expect(text).toContain("a: pnpm test passes");
    expect(text).toContain("Resolve pending procedure context");
  });
});

describe("formatDecompositionLearning", () => {
  it("renders decomposition learning rows and guidance", () => {
    const text = formatDecompositionLearning({
      version: 1,
      totalAims: 2,
      totalMilestones: 5,
      completedMilestones: 3,
      qualityIssueCount: 1,
      contextOutcomeCount: 1,
      evidenceAttributionCount: 1,
      rows: [
        {
          source: "quality_issue",
          recommendation: "improve_acceptance",
          aimId: "goal-1",
          aimTitle: "Ship CLI",
          nodeTitle: "Implement CLI command",
          dimension: "verifiability",
          issueCodes: ["weak_commit_pattern"],
          reason: "weak_commit_pattern",
          example: "Commit pattern is too broad.",
        },
        {
          source: "completed_contract",
          recommendation: "reuse_pattern",
          aimId: "goal-2",
          aimTitle: "Ship CLI",
          nodeTitle: "Implement CLI command",
          decidedBy: "rule_auto",
          evidenceKinds: ["git_commit"],
          evaluatorKinds: ["commit_pattern"],
          triggeringEvidenceCount: 1,
          minimumTrustScore: 0.95,
          completed: true,
          reason: "completed_with_evidence_attribution",
          example: "Implemented CLI command.",
        },
      ],
      guidance: ["Improve acceptance rules for the CLI command."],
    });

    expect(text).toContain("decomposition learning: 2 aims · 3/5 milestones completed · 1 quality issues · 1 context outcomes · 1 evidence attributions");
    expect(text).toContain("improve-acceptance · quality-issue · Implement CLI command · verifiability · weak-commit-pattern");
    expect(text).toContain("reuse-pattern · completed-contract · Implement CLI command · evidence git_commit via commit_pattern · trust 0.95");
    expect(text).toContain("Improve acceptance rules for the CLI command.");
  });
});

describe("formatDecompositionStrategy", () => {
  it("renders decomposition strategy actions and guidance", () => {
    const text = formatDecompositionStrategy({
      version: 1,
      title: "Ship Aimcub CLI",
      actionCount: 2,
      actions: [
        {
          focus: "verifiability",
          priority: "high",
          recommendation: "Make every acceptance_rule evidence-backed and specific.",
          reason: "Historical decompositions had acceptance weaknesses.",
          sourceRows: 2,
        },
        {
          focus: "evidence_pattern",
          priority: "medium",
          recommendation: "Reuse proven evidence/evaluator pairings such as git_commit via commit_pattern when they fit this aim.",
          reason: "Historical milestones reached completion through trusted evidence attribution.",
          sourceRows: 1,
        },
      ],
      guidance: [
        "Treat eval signals as acceptance inputs; every milestone should name the evidence that can satisfy it.",
      ],
    });

    expect(text).toContain("decomposition strategy: Ship Aimcub CLI · 2 actions");
    expect(text).toContain("[high] verifiability · 2 source rows");
    expect(text).toContain("acceptance_rule evidence-backed");
    expect(text).toContain("[medium] evidence-pattern · 1 source row");
    expect(text).toContain("git_commit via commit_pattern");
    expect(text).toContain("Treat eval signals as acceptance inputs");
  });
});

describe("formatAimIntake", () => {
  it("renders readiness, questions, and next actions", () => {
    const text = formatAimIntake({
      title: "Ship auth",
      readiness: "needs_targeted_context",
      score: 52,
      coverage: {
        profile: {
          totalActive: 0,
          totalPending: 1,
          highConfidenceActive: 0,
          coverageScore: 12,
          rows: [],
          gaps: [],
        },
        selectedTotal: 1,
        selectedByCategory: [{ category: "constraint", count: 1, highConfidenceCount: 0 }],
        missingCoreCategories: ["eval_signal", "procedure"],
      },
      questions: [
        {
          id: "intake_1",
          category: "eval_signal",
          priority: "high",
          source: "aim_text",
          reason: "thin_aim_statement",
          prompt: "Ask what would make this aim count as complete.",
          capture: {
            category: "eval_signal",
            scope: "global",
            purpose: "define_eval",
            improvesDimension: "verifiability",
            reason: "thin_aim_statement",
          },
        },
      ],
      acquisition: [
        {
          id: "acq_1",
          channel: "web_research",
          priority: "high",
          scope: "aim",
          categories: ["project_fact", "procedure"],
          reason: "Need current docs.",
          action: "Run first-party web research before finalizing milestones.",
          suggestedTools: ["web.search", "web.fetch"],
          memoryTargets: [
            {
              scope: "aim",
              kind: "semantic",
              categories: ["project_fact", "procedure"],
            },
          ],
        },
      ],
      nextActions: ["Answer 1 high-priority intake question before accepting a plan."],
    });

    expect(text).toContain("aim intake: needs-targeted-context (52/100)");
    expect(text).toContain("selected: constraint 1");
    expect(text).toContain("missing core context: eval-signal, procedure");
    expect(text).toContain("thin_aim_statement");
    expect(text).toContain("capture: global eval-signal · define-eval · improves verifiability");
    expect(text).toContain("acquire: [high] web-research · aim · project-fact, procedure");
    expect(text).toContain("tools web.search, web.fetch");
    expect(text).toContain("Answer 1 high-priority intake question");
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

describe("formatGoalDetail", () => {
  it("renders persisted planning context metadata", () => {
    const plan = localDecompose({ title: "Build a CLI todo app" });
    const goal = {
      id: "abcd1234-0000-4000-8000-000000000000",
      title: "Build a CLI todo app",
      metadata: {
        planning_context: {
          total: 1,
          limit: 12,
          selected: [
            {
              content: "Preference: CLI-first workflows.",
              category: "preference",
              confidence: 1,
              goalId: null,
              scope: "global",
              score: 78,
              reason: "global_context_with_goal_overlap",
              matchedTokens: ["cli"],
            },
          ],
          ignored: [],
        },
        clarify_answer_impact: {
          version: 1,
          answered_count: 1,
          impacted_count: 1,
          changed_node_count: 1,
          quality_delta: [],
          rows: [
            {
              question_id: "proof",
              question: "What proves this is complete?",
              answer: "Passing CLI smoke test",
              kind: "scope",
              source_dimension: "verifiability",
              memory_category: "eval_signal",
              memory_content: "Eval signal: Passing CLI smoke test.",
              affected_node_keys: ["m1"],
              signals: ["quality_dimension_improved", "acceptance_rule_changed"],
            },
          ],
        },
        context_capture_fulfillment: {
          version: 1,
          total: 1,
          answeredCount: 1,
          memoryCapturedCount: 1,
          impactedCount: 1,
          rows: [
            {
              questionId: "proof",
              question: "What proves this is complete?",
              capture: {
                category: "eval_signal",
                scope: "global",
                purpose: "define_eval",
                improvesDimension: "verifiability",
                reason: "clarify_verifiability",
                origin: {
                  source: "review_gap",
                  reason: "missing_contract_eval_signal",
                  gapSource: "decomposition_contract",
                  nodeKey: "m1",
                  nodeTitle: "Scaffold CLI",
                  roiScore: 88,
                  roiSignals: ["high_priority", "decomposition_contract", "node_specific", "eval_signal"],
                  issueCodes: ["missing_contract_eval_signal"],
                },
              },
              answer: "Passing CLI smoke test",
              answered: true,
              memoryCaptured: true,
              impactedPlan: true,
              affectedNodeKeys: ["m1"],
              signals: ["quality_dimension_improved"],
              status: "captured_and_impacted",
            },
          ],
        },
      },
    } as unknown as Goal;
    const milestones = plan.nodes.map((node, i) => ({
      id: `00000000-0000-4000-8000-00000000000${i}`,
      goal_id: goal.id,
      owner_id: "owner",
      title: node.title,
      description: node.description,
      status: "pending",
      order_index: i,
      depends_on_id: null,
      acceptance_rule: node.acceptance_rule,
      xp_reward: node.xp_reward,
      completed_at: null,
      metadata: i === 0
        ? {
            plan_key: "m1",
            decomposition_contract: {
              why: "The CLI needs a runnable entrypoint.",
              definition_of_done: "CLI smoke test passes.",
              required_evidence: ["Passing CLI smoke test"],
              likely_owner: "agent",
              context_gaps: [],
              eval_signal: "The smoke test proves the command works.",
            },
          }
        : {},
    })) as never;

    const learning: AimLearningReport = {
      goalId: goal.id,
      title: goal.title,
      intake: {
        readiness: "needs_targeted_context",
        score: 64,
        missingCoreCategories: ["eval_signal"],
        questionCount: 1,
      },
      clarify: {
        answeredCount: 1,
        impactedCount: 1,
        changedNodeCount: 1,
      },
      learnedCount: 1,
      pendingContextCount: 1,
      gapCount: 1,
      rows: [
        {
          source: "clarify_answer",
          status: "learned",
          category: "eval_signal",
          content: "Eval signal: Passing CLI smoke test.",
          reason: "answer_changed_plan",
        },
        {
          source: "pending_context",
          status: "pending",
          category: "procedure",
          content: "Procedure: Run pnpm test.",
          reason: "needs_user_review",
        },
      ],
      nextActions: ["Review 1 pending context candidate from this aim."],
    };
    const lineage: ContextLineageReport = {
      version: 1,
      goalId: goal.id,
      title: goal.title,
      total: 1,
      answeredCount: 1,
      memoryCapturedCount: 1,
      impactedCount: 1,
      pendingContextCount: 0,
      rows: [
        {
          questionId: "proof",
          question: "What proves this is complete?",
          answer: "Passing CLI smoke test",
          category: "eval_signal",
          captureStatus: "captured_and_impacted",
          capturePurpose: "define_eval",
          improvesDimension: "verifiability",
          source: "review_gap",
          reason: "missing_contract_eval_signal",
          originNode: {
            key: "m1",
            title: "Scaffold CLI",
            contract: {
              definition_of_done: "CLI smoke test passes.",
              required_evidence: ["Passing CLI smoke test"],
              likely_owner: "agent",
              eval_signal: "The smoke test proves the command works.",
            },
          },
          affectedNodes: [{ key: "m1", title: "Scaffold CLI" }],
          memoryContent: "Eval signal: Passing CLI smoke test.",
          memoryCaptured: true,
          impactedPlan: true,
          pendingContext: [],
          signals: ["quality_dimension_improved"],
          nextAction: "Reuse this captured context as a future decomposition and eval signal.",
        },
      ],
      nextActions: ["Use impacted context rows as examples for future aim decomposition."],
    };

    const text = formatGoalDetail(goal, milestones, learning, lineage);
    expect(text).toContain("planning context: 1 selected · 0 ignored");
    expect(text).toContain("Preference: CLI-first workflows.");
    expect(text).toContain("clarify impact: 1 answer · 1 impacted · 1 changed milestone");
    expect(text).toContain("[eval-signal · verifiability] Passing CLI smoke test (m1)");
    expect(text).toContain("capture fulfillment: 1/1 answered · 1 captured · 1 impacted");
    expect(text).toContain("captured-and-impacted [global/eval-signal] define-eval");
    expect(text).toContain("context lineage: 1 question · 1 captured · 1 impacted · 0 pending");
    expect(text).toContain("from m1 (Scaffold CLI)");
    expect(text).toContain("contract: done CLI smoke test passes.");
    expect(text).toContain("aim learning: 1 learned · 1 pending · 1 gaps");
    expect(text).toContain("intake: needs-targeted-context (64/100)");
    expect(text).toContain("Procedure: Run pnpm test.");
  });
});

describe("formatContextLineage", () => {
  it("renders question-to-memory-to-plan-impact lineage", () => {
    const text = formatContextLineage({
      version: 1,
      goalId: "goal",
      title: "Ship CLI",
      total: 1,
      answeredCount: 1,
      memoryCapturedCount: 0,
      impactedCount: 0,
      pendingContextCount: 1,
      rows: [
        {
          questionId: "workflow",
          question: "Which release checklist should this follow?",
          answer: "Use the release checklist",
          category: "procedure",
          captureStatus: "answered_without_memory",
          capturePurpose: "document_procedure",
          improvesDimension: "context_fit",
          source: "unknown",
          reason: "clarify_context_fit",
          affectedNodes: [],
          memoryContent: null,
          memoryCaptured: false,
          impactedPlan: false,
          pendingContext: [
            {
              memoryId: "mem",
              category: "procedure",
              content: "Procedure: Use the release checklist.",
              source: "agent_inferred",
              confidence: 0.75,
            },
          ],
          signals: [],
          nextAction: "Turn the answer into durable memory so future aims can reuse it.",
        },
      ],
      nextActions: ["Promote 1 answered context item into durable memory."],
    });

    expect(text).toContain("context lineage: 1 question · 0 captured · 0 impacted · 1 pending");
    expect(text).toContain("answered-without-memory [procedure] document-procedure");
    expect(text).toContain("q: Which release checklist should this follow?");
    expect(text).toContain("pending: Procedure: Use the release checklist.");
    expect(text).toContain("next: Promote 1 answered context item into durable memory.");
  });
});

describe("formatClarifyImpact", () => {
  it("renders answer impact as a standalone block", () => {
    const text = formatClarifyImpact({
      version: 1,
      answered_count: 1,
      impacted_count: 1,
      changed_node_count: 1,
      quality_delta: [
        { dimension: "verifiability", beforeScore: 70, afterScore: 100, delta: 30, beforeGrade: "warn", afterGrade: "pass" },
      ],
      rows: [
        {
          question_id: "proof",
          question: "What proves this is complete?",
          answer: "Passing CLI smoke test",
          kind: "scope",
          source_dimension: "verifiability",
          memory_category: "eval_signal",
          memory_content: "Eval signal: Passing CLI smoke test.",
          affected_node_keys: ["m1"],
          signals: ["quality_dimension_improved", "acceptance_rule_changed"],
        },
      ],
    });

    expect(text).toContain("clarify impact: 1 answer · 1 impacted · 1 changed milestone");
    expect(text).toContain("[eval-signal · verifiability] Passing CLI smoke test (m1)");
  });
});

describe("formatContextCaptureFulfillment", () => {
  it("renders capture contract fulfillment status", () => {
    const text = formatContextCaptureFulfillment({
      version: 1,
      total: 2,
      answeredCount: 1,
      memoryCapturedCount: 1,
      impactedCount: 1,
      rows: [
        {
          questionId: "proof",
          question: "What proves this is complete?",
          capture: {
            category: "eval_signal",
            scope: "global",
            purpose: "define_eval",
            improvesDimension: "verifiability",
            reason: "clarify_verifiability",
          },
          answer: "Passing CLI smoke test",
          answered: true,
          memoryCaptured: true,
          impactedPlan: true,
          affectedNodeKeys: ["m1"],
          signals: ["quality_dimension_improved"],
          status: "captured_and_impacted",
        },
        {
          questionId: "workflow",
          question: "What release workflow should this follow?",
          capture: {
            category: "procedure",
            scope: "aim",
            purpose: "document_procedure",
            improvesDimension: "verifiability",
            reason: "profile_missing",
          },
          answer: null,
          answered: false,
          memoryCaptured: false,
          impactedPlan: false,
          affectedNodeKeys: [],
          signals: [],
          status: "unanswered",
        },
      ],
    });

    expect(text).toContain("capture fulfillment: 1/2 answered · 1 captured · 1 impacted");
    expect(text).toContain("captured-and-impacted [global/eval-signal] define-eval · improves verifiability (m1)");
    expect(text).toContain("unanswered [aim/procedure] document-procedure");
  });
});

describe("formatAimLearning", () => {
  it("renders a compact learning report", () => {
    const text = formatAimLearning({
      goalId: "goal-1",
      title: "Ship auth",
      intake: null,
      clarify: null,
      learnedCount: 0,
      pendingContextCount: 0,
      gapCount: 1,
      rows: [
        {
          source: "review_gap",
          status: "gap",
          category: "eval_signal",
          priority: "high",
          content: "Ask what proves completion.",
          reason: "missing_personalized_eval",
        },
      ],
      nextActions: ["Turn unresolved intake/review gaps into concrete context through the next clarify or evidence event."],
    });

    expect(text).toContain("aim learning: 0 learned · 0 pending · 1 gaps");
    expect(text).toContain("gap [eval-signal] review-gap · high");
    expect(text).toContain("Ask what proves completion.");
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

describe("formatBoard", () => {
  it("renders progress, status marks, acceptance summaries, and evidence count", () => {
    const plan = localDecompose({ title: "Ship auth" });
    const goal = {
      id: "abcd1234-0000-4000-8000-000000000000",
      title: "Ship auth",
    } as unknown as Goal;
    const milestones = plan.nodes.map((node, i) => ({
      id: `00000000-0000-4000-8000-00000000000${i}`,
      goal_id: goal.id,
      owner_id: "owner",
      title: node.title,
      description: node.description,
      status: i === 0 ? "completed" : "pending",
      order_index: i,
      depends_on_id: null,
      acceptance_rule: node.acceptance_rule,
      xp_reward: node.xp_reward,
      completed_at: i === 0 ? "2026-06-29T00:00:00.000Z" : null,
      metadata: {},
    })) as never;
    const evidence = [{ id: "eeeeeeee-0000-4000-8000-000000000000", goal_id: goal.id, milestone_id: null }] as Evidence[];

    const text = formatBoard(goal, milestones, evidence);
    expect(text).toContain("progress:");
    expect(text).toContain("done");
    expect(text).toContain("todo");
    expect(text).toContain("1 evidence");
  });
});

describe("formatEvidenceList", () => {
  it("renders empty and non-empty evidence streams", () => {
    expect(formatEvidenceList([])).toContain("No evidence");
    const text = formatEvidenceList([
      {
        id: "eeeeeeee-0000-4000-8000-000000000000",
        owner_id: "owner",
        goal_id: "goal",
        milestone_id: null,
        emitter_id: null,
        kind: "manual_check",
        source_event_id: null,
        occurred_at: "2026-06-29T00:00:00.000Z",
        summary: "Looks done",
        payload: {},
        trust_score: 1,
      },
    ]);
    expect(text).toContain("manual_check");
    expect(text).toContain("Looks done");
  });

  it("renders context candidate counts after evidence writes", () => {
    const text = formatEvidenceResult(
      {
        id: "eeeeeeee-0000-4000-8000-000000000000",
        owner_id: "owner",
        goal_id: "goal",
        milestone_id: null,
        emitter_id: null,
        kind: "manual_check",
        source_event_id: null,
        occurred_at: "2026-06-29T00:00:00.000Z",
        summary: "",
        payload: {},
        trust_score: 1,
      },
      [],
      false,
      2,
    );
    expect(text).toContain("context candidates: 2 pending");
  });
});

describe("memory/context formatters", () => {
  const memory = {
    id: "11111111-0000-4000-8000-000000000000",
    owner_id: "owner",
    goal_id: null,
    kind: "semantic",
    category: "preference",
    content: "User prefers CLI-first workflows.",
    confidence: 1,
    source: "user_stated",
    status: "active",
    superseded_by: null,
  } as const;

  it("renders memory rows and grouped context", () => {
    expect(formatMemoryList([memory])).toContain("User prefers CLI-first workflows.");
    expect(formatMemoryList([memory])).toContain("preference");
    expect(formatMemoryList([memory])).toContain("global");
    expect(formatContext([memory])).toContain("preference:");
    expect(formatContext([memory])).toContain("CLI-first");
  });

  it("renders pending context candidates", () => {
    const text = formatMemoryCandidateList([{ ...memory, status: "pending" }]);
    expect(text).toContain("semantic");
    expect(text).toContain("global");
    expect(text).toContain("recommended global");
    expect(text).toContain("CLI-first");
  });

  it("marks prompt-like context candidates as edit-required", () => {
    const text = formatMemoryCandidateList([
      {
        ...memory,
        status: "pending",
        category: "eval_signal",
        content:
          'Eval signal: For "Ship Aimcub CLI", pending answer needed: Ask what would make this aim count as complete.',
      },
    ]);

    expect(text).toContain("edit required");
    expect(text).toContain("Edit this into an actual answer");
    expect(text).toContain("--text");
  });

  it("handles empty memory sets", () => {
    expect(formatMemoryList([])).toContain("No memories");
    expect(formatMemoryCandidateList([])).toContain("No pending");
    expect(formatContext([])).toContain("No context");
    expect(formatContextHealth([])).toContain("No active context");
  });

  it("renders context profile coverage and next steps", () => {
    const text = formatContextProfile({
      totalActive: 1,
      totalPending: 1,
      highConfidenceActive: 1,
      coverageScore: 42,
      rows: [
        {
          category: "eval_signal",
          activeCount: 1,
          pendingCount: 0,
          highConfidenceCount: 1,
          globalCount: 1,
          aimScopedCount: 0,
          averageConfidence: 0.9,
          strength: "ready",
          recommendation: "capture_completion_criteria",
        },
        {
          category: "procedure",
          activeCount: 0,
          pendingCount: 1,
          highConfidenceCount: 0,
          globalCount: 0,
          aimScopedCount: 0,
          averageConfidence: null,
          strength: "thin",
          recommendation: "review_pending_candidates",
        },
      ],
      gaps: [],
    });

    expect(text).toContain("context profile: 42/100 coverage");
    expect(text).toContain("eval_signal: ready");
    expect(text).toContain("procedure: thin");
    expect(text).toContain("next: review_pending_candidates");
  });

  it("renders context health attention rows", () => {
    const text = formatContextHealth([
      {
        memoryId: "11111111-0000-4000-8000-000000000000",
        content: "Project fact: The old dashboard uses Stripe.",
        category: "project_fact",
        confidence: 0.9,
        goalId: "22222222-0000-4000-8000-000000000000",
        selectedCount: 0,
        ignoredCount: 2,
        lowConfidenceCount: 0,
        unrelatedCount: 2,
        overLimitCount: 0,
        lastReasons: ["unrelated_goal_context"],
        action: "archive_candidate",
        reason: "aim_scoped_context_repeatedly_unrelated",
      },
    ]);
    expect(text).toContain("Context health: 1 row need attention");
    expect(text).toContain("archive_candidate");
    expect(text).toContain("0 selected / 2 ignored");
    expect(text).toContain("old dashboard uses Stripe");
  });

  it("renders clean context health", () => {
    const text = formatContextHealth([
      {
        memoryId: "11111111-0000-4000-8000-000000000000",
        content: "Constraint: Keep the CLI scriptable.",
        category: "constraint",
        confidence: 1,
        goalId: null,
        selectedCount: 1,
        ignoredCount: 0,
        lowConfidenceCount: 0,
        unrelatedCount: 0,
        overLimitCount: 0,
        lastReasons: ["global_context"],
        action: "keep",
        reason: "selected_or_not_enough_signal",
      },
    ]);
    expect(text).toContain("Context health: clean");
  });
});
