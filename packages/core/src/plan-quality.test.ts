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

/**
 * A plan whose work happens in the physical world: no milestone here can produce a commit or a CI
 * run, so `manual_confirm` is the only honest verification. Shaped after the non-technical personas
 * in `examples/eval-moat`, where the deterministic scorer used to zero exactly this kind of plan.
 */
const HUMAN_PLAN = {
  goal_summary: "Run a beginner pottery workshop series.",
  domain: "operations",
  rationale: "The studio owner does the teaching, the firing, and the scheduling.",
  nodes: [
    {
      key: "waivers",
      title: "Collect signed liability waivers",
      description: "Every student signs the studio waiver before touching a wheel.",
      est_effort: "s",
      xp_reward: 10,
      decomposition_contract: {
        why: "The insurer voids cover without a signed waiver from every student.",
        definition_of_done: "A signed waiver is on file for every enrolled student.",
        required_evidence: ["The owner confirms every enrolled student has a signed waiver on file."],
        likely_owner: "human",
        context_gaps: [],
        eval_signal: "The milestone is done when no student can sit at a wheel unwaived.",
      },
      acceptance_rule: {
        logic: "all",
        threshold: 1,
        completion_mode: "manual",
        clauses: [{ evaluator: "manual_confirm", auto_verifiable: false, match: {} }],
      },
    },
    {
      key: "kiln",
      title: "Book the kiln firing window",
      description: "Reserve a fourteen-hour bisque window that no session sits on top of.",
      est_effort: "s",
      xp_reward: 10,
      decomposition_contract: {
        why: "One kiln means a firing plus cooldown blocks the next session that needs fired work.",
        definition_of_done: "The firing window is reserved on the studio calendar.",
        required_evidence: ["The owner confirms the firing window is reserved."],
        likely_owner: "human",
        context_gaps: [],
        eval_signal: "The milestone is done when no two firing-dependent sessions sit back to back.",
      },
      acceptance_rule: {
        logic: "all",
        threshold: 1,
        completion_mode: "manual",
        clauses: [{ evaluator: "manual_confirm", auto_verifiable: false, match: {} }],
      },
    },
    {
      key: "seats",
      title: "Confirm paid seats a week out",
      description: "Six of eight seats are paid in full seven days before the first session.",
      est_effort: "s",
      xp_reward: 10,
      decomposition_contract: {
        why: "A session below six paid seats does not cover the owner's time at the wheel.",
        definition_of_done: "At least six seats are paid in full a week before the series starts.",
        required_evidence: ["The owner confirms the paid seat count a week before the series."],
        likely_owner: "human",
        context_gaps: [],
        eval_signal: "The milestone is done when paid seats, not reservations, clear the bar.",
      },
      acceptance_rule: {
        logic: "all",
        threshold: 1,
        completion_mode: "manual",
        clauses: [{ evaluator: "manual_confirm", auto_verifiable: false, match: {} }],
      },
    },
  ],
  edges: [{ from: "waivers", to: "seats" }, { from: "kiln", to: "seats" }],
} as unknown as DecompositionOutput;

function travelResearchPlan(): DecompositionOutput {
  const plan = structuredClone(GOOD_PLAN);
  plan.goal_summary = "Plan a current Cambodia travel itinerary.";
  plan.rationale = "The route depends on current visa, safety, transport, hotel, and pricing facts.";
  plan.nodes[0]!.title = "Research Cambodia travel basics";
  plan.nodes[0]!.description = "Gather current official visa, safety, transport, and budget information for Cambodia.";
  plan.nodes[0]!.decomposition_contract!.why = "Current external travel facts determine what the itinerary can safely include.";
  plan.nodes[0]!.decomposition_contract!.definition_of_done = "The plan cites current sources for Cambodia travel constraints and risks.";
  plan.nodes[0]!.decomposition_contract!.required_evidence = ["A research brief with current Cambodia travel sources."];
  plan.nodes[0]!.decomposition_contract!.eval_signal = "The milestone is done when current external facts are sourced before itinerary planning.";
  plan.nodes[0]!.acceptance_rule.clauses = [
    {
      evaluator: "commit_pattern",
      auto_verifiable: true,
      match: { path_glob: "research/**", min_files: 1, message_pattern: "cambodia travel research" },
    },
  ];
  return plan;
}

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

  it("warns when web-sensitive plans lack first-party research evidence", () => {
    const report = critiquePlan({ plan: travelResearchPlan() });

    expect(report.grade).toBe("warn");
    expect(report.issues).toEqual([
      expect.objectContaining({
        code: "missing_research_evidence",
        contextCategory: "project_fact",
      }),
    ]);
    expect(report.dimensions?.find((row) => row.dimension === "context_fit")?.issueCodes).toContain(
      "missing_research_evidence",
    );
  });

  it("honors an explicit research requirement even when the plan text is generic", () => {
    const generic = structuredClone(GOOD_PLAN);

    const report = critiquePlan({
      plan: generic,
      research: { required: true, sourceCount: 0, fetchedSourceCount: 0, searchResultCount: 0 },
    });

    expect(report.grade).toBe("warn");
    expect(report.issues).toEqual([
      expect.objectContaining({
        code: "missing_research_evidence",
      }),
    ]);
  });

  it("warns when first-party research coverage is too thin", () => {
    const report = critiquePlan({
      plan: travelResearchPlan(),
      research: {
        sourceCount: 2,
        fetchedSourceCount: 0,
        searchResultCount: 4,
        uncertainties: ["No source pages were fetched; findings rely on search snippets only."],
      },
    });

    expect(report.grade).toBe("warn");
    expect(report.issues).toEqual([
      expect.objectContaining({
        code: "insufficient_research_coverage",
        message: expect.stringContaining("research coverage is thin"),
      }),
    ]);
  });

  it("accepts web-sensitive plans when research coverage is sufficient", () => {
    const report = critiquePlan({
      plan: travelResearchPlan(),
      research: {
        sourceCount: 4,
        fetchedSourceCount: 2,
        searchResultCount: 8,
        uncertainties: [],
      },
    });

    expect(report.issues.map((issue) => issue.code)).not.toContain("missing_research_evidence");
    expect(report.issues.map((issue) => issue.code)).not.toContain("insufficient_research_coverage");
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

  // Regression: `examples/eval-moat` scored honestly human-routed plans at 0/100 while a blind
  // judge preferred them. Human work cannot produce a commit, so confirmation is not a shortcut.
  it("does not penalize human-routed milestones verified by confirmation", () => {
    const report = critiquePlan({ plan: HUMAN_PLAN });

    expect(report.score).toBe(100);
    expect(report.grade).toBe("pass");
    expect(report.issues).toEqual([]);
  });

  it("keeps repeated manual confirmation across distinct human milestones out of the duplicate rule", () => {
    const report = critiquePlan({ plan: HUMAN_PLAN });

    // All three rules are byte-identical because `manual_confirm` has no fields to differ on.
    expect(report.issues.map((issue) => issue.code)).not.toContain("duplicate_acceptance_rule");
    expect(report.dimensions?.find((row) => row.dimension === "distinctness")?.score).toBe(100);
  });

  it("still warns when work nobody routed to a person can only be completed manually", () => {
    const bad = structuredClone(HUMAN_PLAN);
    bad.nodes[0]!.decomposition_contract!.likely_owner = "agent";
    bad.nodes[1]!.decomposition_contract!.likely_owner = "either";

    const report = critiquePlan({ plan: bad });

    expect(report.issues.filter((issue) => issue.code === "manual_only_verification").map((issue) => issue.nodeKey))
      .toEqual(["waivers", "kiln"]);
    // The repetition is still not the actionable defect; the unrouted manual verification is.
    expect(report.issues.map((issue) => issue.code)).not.toContain("duplicate_acceptance_rule");
  });

  it("lets an explicit routing override decide who the milestone is gated on", () => {
    const overridden = structuredClone(HUMAN_PLAN);
    overridden.nodes[0]!.decomposition_contract!.likely_owner = "agent";
    overridden.nodes[0]!.routing_override = {
      owner: "human",
      agent_id: null,
      agent_label: null,
      run_mode: null,
      model: null,
      model_label: null,
      reason: "The owner signs the waivers personally.",
    };
    overridden.nodes[1]!.routing_override = {
      owner: "agent",
      agent_id: null,
      agent_label: null,
      run_mode: null,
      model: null,
      model_label: null,
      reason: "Routed to an agent by the user.",
    };

    const report = critiquePlan({ plan: overridden });

    expect(report.issues.filter((issue) => issue.code === "manual_only_verification").map((issue) => issue.nodeKey))
      .toEqual(["kiln"]);
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
      "What would make this aim count as genuinely complete",
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

  it("surfaces research coverage gaps before accepting web-sensitive plans", () => {
    const report = reviewPlan({ plan: travelResearchPlan(), context: [] });
    const researchGap = report.context.gaps.find((gap) => gap.category === "project_fact");

    expect(researchGap).toMatchObject({
      priority: "high",
      reason: "insufficient_research_evidence",
      issueCodes: ["missing_research_evidence"],
    });
    expect(researchGap!.prompt).toContain("Run first-party web research");
    expect(report.actions[0]).toMatchObject({
      code: "review_quality_warnings",
      issueCodes: ["missing_research_evidence"],
    });
    expect(report.actions[0]!.refinePrompt).toContain("Collect first-party web research");
    expect(report.guidance.join(" ")).toContain("Web-sensitive decomposition needs stronger first-party research evidence");
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
