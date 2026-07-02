import { describe, expect, it } from "vitest";

import type { DecompositionOutput } from "@core/types";

import { critiquePlan, reviewPlan } from "./plan-quality";

const GOOD_PLAN = {
  goal_summary: "Ship a CLI context review flow.",
  domain: "software",
  rationale: "Keep @core pure and verify with tests.",
  nodes: [
    {
      key: "core",
      title: "Implement core context review",
      description: "Add pure store/domain support for pending context review.",
      est_effort: "m",
      xp_reward: 20,
      decomposition_contract: {
        why: "Core context review is the durable domain capability that the CLI can call without platform logic.",
        definition_of_done: "Pending context can be reviewed through pure store/domain support while @core stays platform-free.",
        required_evidence: ["A commit touching packages/core with context review behavior."],
        likely_owner: "agent",
        context_gaps: [],
        eval_signal: "The milestone is done when core logic can review pending context without platform dependencies.",
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
    {
      key: "test",
      title: "Verify tests pass",
      description: "Run the test suite for the context review path.",
      est_effort: "s",
      xp_reward: 10,
      decomposition_contract: {
        why: "Verification should be a dependent milestone so the implementation is not accepted without tests.",
        definition_of_done: "The context review test path passes in CI.",
        required_evidence: ["A successful CI status for the test suite."],
        likely_owner: "agent",
        context_gaps: [],
        eval_signal: "The milestone is done when automated tests prove the context review path works.",
      },
      acceptance_rule: {
        logic: "all",
        threshold: 1,
        completion_mode: "auto_then_confirm",
        clauses: [{ evaluator: "ci_status", auto_verifiable: true, match: { conclusion: "success" } }],
      },
    },
  ],
  edges: [{ from: "core", to: "test" }],
} as unknown as DecompositionOutput;

describe("critiquePlan", () => {
  it("passes a context-aware, evidence-verifiable plan", () => {
    const report = critiquePlan({
      plan: GOOD_PLAN,
      context: [
        { category: "constraint", content: "Constraint: Keep @core pure.", confidence: 1 },
        { category: "procedure", content: "Procedure: Verify with tests.", confidence: 0.9 },
      ],
    });

    expect(report.grade).toBe("pass");
    expect(report.score).toBe(100);
    expect(report.issues).toEqual([]);
    expect(report.dimensions).toEqual([
      { dimension: "verifiability", score: 100, grade: "pass", issueCount: 0, issueCodes: [] },
      { dimension: "granularity", score: 100, grade: "pass", issueCount: 0, issueCodes: [] },
      { dimension: "distinctness", score: 100, grade: "pass", issueCount: 0, issueCodes: [] },
      { dimension: "context_fit", score: 100, grade: "pass", issueCount: 0, issueCodes: [] },
    ]);
  });

  it("warns when a milestone is missing its decomposition contract", () => {
    const bad = structuredClone(GOOD_PLAN);
    bad.nodes[0]!.decomposition_contract = null;

    const report = critiquePlan({ plan: bad });

    expect(report.grade).toBe("warn");
    expect(report.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "missing_decomposition_contract",
          nodeKey: "core",
        }),
      ]),
    );
    expect(report.dimensions?.find((row) => row.dimension === "context_fit")?.issueCodes).toContain(
      "missing_decomposition_contract",
    );
  });

  it("fails an empty commit pattern because any trusted commit could satisfy it", () => {
    const bad = structuredClone(GOOD_PLAN);
    bad.nodes[0]!.acceptance_rule.clauses = [
      { evaluator: "commit_pattern", auto_verifiable: true, match: {} },
    ];

    const report = critiquePlan({ plan: bad });

    expect(report.grade).toBe("fail");
    expect(report.issues.map((issue) => issue.code)).toContain("empty_commit_pattern");
  });

  it("warns when high-impact context is not visibly applied", () => {
    const report = critiquePlan({
      plan: GOOD_PLAN,
      context: [{ category: "constraint", content: "Constraint: Must use Supabase realtime.", confidence: 1 }],
    });

    expect(report.grade).toBe("warn");
    expect(report.issues[0]!.code).toBe("missing_context_application");
    expect(report.issues[0]!.contextCategory).toBe("constraint");
  });

  it("warns when eval context is visible in the plan but missing from acceptance rules", () => {
    const bad = structuredClone(GOOD_PLAN);
    bad.nodes[0]!.description = "Add core support and capture screenshots for review.";

    const report = critiquePlan({
      plan: bad,
      context: [
        {
          category: "eval_signal",
          content: "Eval signal: Done means screenshots prove the shipped flow works.",
          confidence: 0.9,
        },
      ],
    });

    expect(report.grade).toBe("warn");
    expect(report.issues.map((issue) => issue.code)).toEqual(["missing_eval_acceptance_signal"]);
  });

  it("accepts eval context when acceptance rules carry the user's done signal", () => {
    const plan = structuredClone(GOOD_PLAN);
    plan.nodes[0]!.acceptance_rule.clauses = [
      {
        evaluator: "commit_pattern",
        auto_verifiable: true,
        match: { path_glob: "packages/core/**", min_files: 1, message_pattern: "screenshots shipped" },
      },
    ];

    const report = critiquePlan({
      plan,
      context: [
        {
          category: "eval_signal",
          content: "Eval signal: Done means screenshots prove the shipped flow works.",
          confidence: 0.9,
        },
      ],
    });

    expect(report.issues.map((issue) => issue.code)).not.toContain("missing_eval_acceptance_signal");
  });

  it("warns on manual-only milestones and broad commit message patterns", () => {
    const bad = structuredClone(GOOD_PLAN);
    bad.nodes[0]!.acceptance_rule.clauses = [
      { evaluator: "commit_pattern", auto_verifiable: true, match: { message_pattern: "fix" } },
    ];
    bad.nodes[1]!.acceptance_rule = {
      logic: "all",
      threshold: 1,
      completion_mode: "manual",
      clauses: [{ evaluator: "manual_confirm", auto_verifiable: false, match: {} }],
    };

    const report = critiquePlan({ plan: bad });

    expect(report.grade).toBe("warn");
    expect(report.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(["weak_commit_pattern", "manual_only_verification"]),
    );
  });

  it("warns when verification-only milestones are not linked after implementation work", () => {
    const bad = structuredClone(GOOD_PLAN);
    bad.edges = [];

    const report = critiquePlan({ plan: bad });

    expect(report.grade).toBe("warn");
    expect(report.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "orphan_verification_milestone",
          nodeKey: "test",
        }),
      ]),
    );
  });

  it("warns when milestones share the same acceptance rule", () => {
    const bad = structuredClone(GOOD_PLAN);
    bad.nodes[1]!.acceptance_rule = structuredClone(bad.nodes[0]!.acceptance_rule);

    const report = critiquePlan({ plan: bad });

    expect(report.grade).toBe("warn");
    expect(report.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "duplicate_acceptance_rule",
          nodeKey: "test",
        }),
      ]),
    );
    expect(report.issues.map((issue) => issue.code)).not.toContain("indistinct_acceptance_rule");
  });

  it("warns when different milestones can be completed by the same evidence filter", () => {
    const bad = structuredClone(GOOD_PLAN);
    bad.nodes[1]!.title = "Publish core context review";
    bad.nodes[1]!.description = "Make the context review path available to clients.";
    bad.nodes[1]!.acceptance_rule = {
      logic: "any",
      threshold: 1,
      completion_mode: "auto_then_confirm",
      clauses: [
        {
          evaluator: "commit_pattern",
          auto_verifiable: true,
          match: { path_glob: "packages/core/**", min_files: 1, message_pattern: "context review" },
        },
        {
          evaluator: "ci_status",
          auto_verifiable: true,
          match: { workflow: "test", conclusion: "success" },
        },
      ],
    };

    const report = critiquePlan({ plan: bad });

    expect(report.grade).toBe("warn");
    expect(report.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "indistinct_acceptance_rule",
          nodeKey: "test",
        }),
      ]),
    );
  });

  it("warns on oversized milestones", () => {
    const bad = structuredClone(GOOD_PLAN);
    bad.nodes[0]!.est_effort = "xl";

    const report = critiquePlan({ plan: bad });

    expect(report.grade).toBe("warn");
    expect(report.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "oversized_milestone",
          nodeKey: "core",
        }),
      ]),
    );
  });

  it("warns when a milestone bundles multiple deliverables", () => {
    const bad = structuredClone(GOOD_PLAN);
    bad.nodes[0]!.title = "Build API and expose CLI review";
    bad.nodes[0]!.description = "Implement store support and render review output.";

    const report = critiquePlan({ plan: bad });

    expect(report.grade).toBe("warn");
    expect(report.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "compound_milestone",
          nodeKey: "core",
        }),
      ]),
    );
  });

  it("summarizes quality by decomposition scorecard dimension", () => {
    const bad = structuredClone(GOOD_PLAN);
    bad.nodes[0]!.est_effort = "xl";
    bad.nodes[1]!.acceptance_rule = {
      logic: "any",
      threshold: 1,
      completion_mode: "auto_then_confirm",
      clauses: [
        {
          evaluator: "commit_pattern",
          auto_verifiable: true,
          match: { path_glob: "packages/core/**", min_files: 1, message_pattern: "context review" },
        },
        {
          evaluator: "ci_status",
          auto_verifiable: true,
          match: { workflow: "test", conclusion: "success" },
        },
      ],
    };

    const report = critiquePlan({
      plan: bad,
      context: [{ category: "constraint", content: "Constraint: Must use Supabase realtime.", confidence: 1 }],
    });

    expect(report.dimensions).toEqual([
      { dimension: "verifiability", score: 100, grade: "pass", issueCount: 0, issueCodes: [] },
      { dimension: "granularity", score: 90, grade: "warn", issueCount: 1, issueCodes: ["oversized_milestone"] },
      { dimension: "distinctness", score: 90, grade: "warn", issueCount: 1, issueCodes: ["indistinct_acceptance_rule"] },
      { dimension: "context_fit", score: 90, grade: "warn", issueCount: 1, issueCodes: ["missing_context_application"] },
    ]);
  });
});

describe("reviewPlan", () => {
  it("reports applied and unapplied context before a plan is accepted", () => {
    const report = reviewPlan({
      plan: GOOD_PLAN,
      context: [
        { category: "constraint", content: "Constraint: Keep @core pure.", confidence: 1 },
        { category: "procedure", content: "Procedure: Use Playwright screenshots.", confidence: 0.9 },
        { category: "preference", content: "Preference: Prefer dense CLI output.", confidence: 0.5 },
      ],
    });

    expect(report.quality.grade).toBe("warn");
    expect(report.context.total).toBe(3);
    expect(report.context.applied.map((row) => row.content)).toContain("Constraint: Keep @core pure.");
    expect(report.context.unapplied.map((row) => row.category)).toContain("procedure");
    expect(report.context.ignoredLowConfidence.map((row) => row.category)).toContain("preference");
    expect(report.actions[0]).toMatchObject({
      code: "refine_with_unapplied_context",
      priority: "high",
      contextCategories: ["procedure"],
    });
    expect(report.actions[0]!.refinePrompt).toContain("Use Playwright screenshots");
    expect(report.guidance.join(" ")).toMatch(/unapplied high-impact context/i);
  });

  it("guides the first run when no context exists yet", () => {
    const report = reviewPlan({ plan: GOOD_PLAN, context: [] });

    expect(report.context.total).toBe(0);
    expect(report.context.gaps.map((gap) => gap.category)).toEqual([
      "eval_signal",
      "constraint",
      "procedure",
      "capability",
    ]);
    expect(report.actions.map((action) => action.code)).toContain("capture_initial_context");
    expect(report.actions.find((action) => action.code === "capture_initial_context")).toMatchObject({
      contextCategories: ["eval_signal", "constraint", "procedure", "capability"],
    });
    expect(report.actions.find((action) => action.code === "capture_initial_context")!.refinePrompt).toContain(
      "what would make this aim count as genuinely complete",
    );
    expect(report.guidance.join(" ")).toMatch(/No active context/);
  });

  it("promotes milestone decomposition contract gaps into review context gaps", () => {
    const plan = structuredClone(GOOD_PLAN);
    plan.nodes[0]!.decomposition_contract!.context_gaps = [
      {
        category: "procedure",
        question: "Which command proves the review flow before save?",
        reason: "missing_verification_command",
      },
    ];

    const report = reviewPlan({
      plan,
      context: [
        { category: "eval_signal", content: "Eval signal: Core logic can review pending context.", confidence: 1 },
        { category: "constraint", content: "Constraint: Keep @core pure.", confidence: 1 },
        { category: "procedure", content: "Procedure: Run the context review test suite.", confidence: 1 },
        { category: "capability", content: "Capability: Agents can implement core context review.", confidence: 1 },
      ],
    });

    expect(report.context.gaps).toEqual([
      expect.objectContaining({
        category: "procedure",
        priority: "medium",
        reason: "missing_verification_command",
        source: "decomposition_contract",
        nodeKey: "core",
        nodeTitle: "Implement core context review",
        roiScore: expect.any(Number),
        roiSignals: expect.arrayContaining(["decomposition_contract", "node_specific", "procedure"]),
      }),
    ]);
    expect(report.context.gaps[0]!.roiScore).toBeGreaterThan(60);
    expect(report.context.gaps[0]!.prompt).toContain("Which command proves the review flow");
  });

  it("sharpens missing-context prompts from decomposition quality issues", () => {
    const bad = structuredClone(GOOD_PLAN);
    bad.nodes[0]!.est_effort = "xl";
    bad.nodes[1]!.title = "Publish core context review";
    bad.nodes[1]!.acceptance_rule = {
      logic: "any",
      threshold: 1,
      completion_mode: "auto_then_confirm",
      clauses: [
        {
          evaluator: "commit_pattern",
          auto_verifiable: true,
          match: { path_glob: "packages/core/**", min_files: 1, message_pattern: "context review" },
        },
        {
          evaluator: "ci_status",
          auto_verifiable: true,
          match: { workflow: "test", conclusion: "success" },
        },
      ],
    };

    const report = reviewPlan({ plan: bad, context: [] });
    const evalGap = report.context.gaps.find((gap) => gap.category === "eval_signal");
    const constraintGap = report.context.gaps.find((gap) => gap.category === "constraint");
    const procedureGap = report.context.gaps.find((gap) => gap.category === "procedure");

    expect(evalGap).toMatchObject({ priority: "high" });
    expect(evalGap!.prompt).toContain("separate milestones");
    expect(evalGap!.prompt).toContain("one event cannot complete unrelated work");
    expect(constraintGap).toMatchObject({ priority: "medium" });
    expect(constraintGap!.prompt).toContain("scope boundaries");
    expect(procedureGap).toMatchObject({ priority: "medium" });
    expect(procedureGap!.prompt).toContain("shared verification");
  });

  it("promotes error-level quality issues into a high-priority action", () => {
    const bad = structuredClone(GOOD_PLAN);
    bad.nodes[0]!.acceptance_rule.clauses = [
      { evaluator: "commit_pattern", auto_verifiable: true, match: {} },
    ];

    const report = reviewPlan({ plan: bad, context: [] });

    expect(report.actions[0]).toMatchObject({
      code: "fix_quality_errors",
      priority: "high",
      issueCodes: ["empty_commit_pattern"],
    });
    expect(report.actions[0]!.refinePrompt).toContain("commit_pattern with no filters");
  });

  it("guides warning refinement to convert eval signals into acceptance rules", () => {
    const bad = structuredClone(GOOD_PLAN);
    bad.nodes[0]!.description = "Add core support and capture screenshots for review.";

    const report = reviewPlan({
      plan: bad,
      context: [
        {
          category: "eval_signal",
          content: "Eval signal: Done means screenshots prove the shipped flow works.",
          confidence: 0.9,
        },
      ],
    });

    expect(report.actions[0]).toMatchObject({
      code: "review_quality_warnings",
      priority: "medium",
      issueCodes: ["missing_eval_acceptance_signal"],
    });
    expect(report.actions[0]!.refinePrompt).toContain("Convert the eval_signal into evidence-backed acceptance_rule details");
    expect(report.actions[0]!.refinePrompt).toContain("commit_pattern message/path/min_files");
  });

  it("guides warning refinement to split oversized milestones", () => {
    const bad = structuredClone(GOOD_PLAN);
    bad.nodes[0]!.est_effort = "xl";

    const report = reviewPlan({ plan: bad, context: [] });

    expect(report.actions[0]).toMatchObject({
      code: "review_quality_warnings",
      priority: "medium",
      issueCodes: ["oversized_milestone"],
    });
    expect(report.actions[0]!.refinePrompt).toContain("Split the milestone into smaller evidence-verifiable milestones");
  });

  it("guides warning refinement to separate bundled deliverables", () => {
    const bad = structuredClone(GOOD_PLAN);
    bad.nodes[0]!.title = "Build API and expose CLI review";
    bad.nodes[0]!.description = "Implement store support and render review output.";

    const report = reviewPlan({ plan: bad, context: [] });

    expect(report.actions[0]).toMatchObject({
      code: "review_quality_warnings",
      priority: "medium",
      issueCodes: ["compound_milestone"],
    });
    expect(report.actions[0]!.refinePrompt).toContain("Separate bundled deliverables into distinct milestones");
  });

  it("guides warning refinement to make evidence filters distinguishable", () => {
    const bad = structuredClone(GOOD_PLAN);
    bad.nodes[1]!.title = "Publish core context review";
    bad.nodes[1]!.acceptance_rule = {
      logic: "any",
      threshold: 1,
      completion_mode: "auto_then_confirm",
      clauses: [
        {
          evaluator: "commit_pattern",
          auto_verifiable: true,
          match: { path_glob: "packages/core/**", min_files: 1, message_pattern: "context review" },
        },
        {
          evaluator: "ci_status",
          auto_verifiable: true,
          match: { workflow: "test", conclusion: "success" },
        },
      ],
    };

    const report = reviewPlan({ plan: bad, context: [] });

    expect(report.actions[0]).toMatchObject({
      code: "review_quality_warnings",
      priority: "medium",
      issueCodes: ["indistinct_acceptance_rule"],
    });
    expect(report.actions[0]!.refinePrompt).toContain("Make each milestone's acceptance_rule distinguishable");
  });

  it("returns an accept action when quality and context usage look clean", () => {
    const report = reviewPlan({
      plan: GOOD_PLAN,
      context: [{ category: "constraint", content: "Constraint: Keep @core pure.", confidence: 1 }],
    });

    expect(report.context.gaps.map((gap) => gap.category)).toEqual(["eval_signal", "procedure", "capability"]);
    expect(report.actions).toEqual([
      {
        code: "accept_plan",
        priority: "low",
        title: "Accept plan",
        reason: "No blocking quality or context-usage issues were detected.",
      },
    ]);
  });
});
