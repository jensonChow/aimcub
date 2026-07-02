import { describe, expect, it, vi } from "vitest";

import { decompose, decomposeWithQuality, type DecomposeInput } from "./decompose";
import type { LlmGateway, LlmRequest, LlmResponse, LlmUsage } from "./index";

// ──────────────────────────────────────────────────────────────────────────
// Mock gateway: no network. `completeStructured` returns whatever canned JSON
// the test queues, plus a fixed usage record so we can assert metering passthrough.
// ──────────────────────────────────────────────────────────────────────────

const FIXED_USAGE: LlmUsage = {
  model: "claude-sonnet-5",
  inputTokens: 42,
  outputTokens: 99,
};

function mockGateway(output: unknown): LlmGateway & { calls: LlmRequest[] } {
  const calls: LlmRequest[] = [];
  return {
    calls,
    async complete(req: LlmRequest): Promise<LlmResponse<string>> {
      calls.push(req);
      return { output: typeof output === "string" ? output : JSON.stringify(output), usage: FIXED_USAGE };
    },
    async completeStructured<T>(req: LlmRequest & { schema: unknown }): Promise<LlmResponse<T>> {
      calls.push(req);
      return { output: output as T, usage: FIXED_USAGE };
    },
  };
}

function mockGatewayQueue(outputs: unknown[]): LlmGateway & { calls: LlmRequest[] } {
  const calls: LlmRequest[] = [];
  const queue = [...outputs];
  return {
    calls,
    async complete(req: LlmRequest): Promise<LlmResponse<string>> {
      calls.push(req);
      const output = queue.shift();
      return { output: typeof output === "string" ? output : JSON.stringify(output), usage: FIXED_USAGE };
    },
    async completeStructured<T>(req: LlmRequest & { schema: unknown }): Promise<LlmResponse<T>> {
      calls.push(req);
      return { output: queue.shift() as T, usage: FIXED_USAGE };
    },
  };
}

/** A gateway whose structured call throws (transport/model failure). */
function throwingGateway(message: string): LlmGateway {
  return {
    async complete(): Promise<LlmResponse<string>> {
      throw new Error(message);
    },
    async completeStructured<T>(): Promise<LlmResponse<T>> {
      throw new Error(message);
    },
  };
}

const INPUT: DecomposeInput = {
  title: "Ship the Aimcub MCP evidence ingester",
  description: "Build the v1a evidence pipeline so MCP/GitHub events auto-light milestones.",
  domain: "software",
};

/** A canned, valid two-node plan exercising both v1 evaluators + a dependency edge. */
function validPlan() {
  return {
    goal_summary: "Build the v1a evidence ingester.",
    domain: "software",
    rationale: "Set up ingestion, then prove it with CI.",
    nodes: [
      {
        key: "m1",
        title: "Implement the evidence webhook handler",
        description: "Normalize git/CI events into the append-only evidence stream.",
        est_effort: "m",
        xp_reward: 30,
        decomposition_contract: {
          why: "The ingester needs a separately verifiable implementation step before CI can prove it.",
          definition_of_done: "Git and CI events are normalized into the append-only evidence stream.",
          required_evidence: ["A commit touching the API evidence ingestion path."],
          likely_owner: "agent",
          context_gaps: [],
          eval_signal: "The milestone is done when trusted source events become idempotent evidence rows.",
        },
        acceptance_rule: {
          logic: "all",
          clauses: [
            {
              evaluator: "commit_pattern",
              auto_verifiable: true,
              match: { path_glob: "packages/api/**", min_files: 1, message_pattern: "evidence" },
            },
          ],
          threshold: 1,
          completion_mode: "auto_then_confirm",
        },
      },
      {
        key: "m2",
        title: "Green CI for the ingester",
        description: "The ingestion test workflow passes on main.",
        est_effort: "s",
        xp_reward: 15,
        decomposition_contract: {
          why: "The implementation needs a dependent verification milestone so passing tests cannot be skipped.",
          definition_of_done: "The ingestion test workflow succeeds.",
          required_evidence: ["A successful CI status for the ingestion tests."],
          likely_owner: "agent",
          context_gaps: [],
          eval_signal: "The milestone is done when CI proves the ingester still works.",
        },
        acceptance_rule: {
          logic: "all",
          clauses: [
            {
              evaluator: "ci_status",
              auto_verifiable: true,
              match: { workflow: "test", conclusion: "success" },
            },
          ],
          threshold: 1,
          completion_mode: "auto",
        },
      },
    ],
    edges: [{ from: "m1", to: "m2" }],
  };
}

describe("decompose · happy path", () => {
  it("maps a canned structured output, validates it, and returns the plan + usage", async () => {
    const gw = mockGateway(validPlan());
    const result = await decompose(gw, INPUT);

    expect(result.validation.ok).toBe(true);
    expect(result.validation.errors).toEqual([]);
    expect(result.output).not.toBeNull();
    expect(result.output?.nodes.map((n) => n.key)).toEqual(["m1", "m2"]);
    expect(result.output?.edges).toEqual([{ from: "m1", to: "m2" }]);
    expect(result.output?.nodes[0]?.decomposition_contract).toMatchObject({
      likely_owner: "agent",
      required_evidence: ["A commit touching the API evidence ingestion path."],
    });
    // Both v1 evaluators survive the round-trip.
    expect(result.output?.nodes[0]?.acceptance_rule.clauses[0]?.evaluator).toBe("commit_pattern");
    expect(result.output?.nodes[1]?.acceptance_rule.clauses[0]?.evaluator).toBe("ci_status");
    // Usage is passed through for metering.
    expect(result.usage).toEqual(FIXED_USAGE);
  });

  it("routes the request as a `decompose` task and supplies the JSON schema", async () => {
    const gw = mockGateway(validPlan());
    await decompose(gw, INPUT);

    expect(gw.calls).toHaveLength(1);
    const call = gw.calls[0]!;
    expect(call.task).toBe("decompose");
    expect(call.schema).toBeDefined();
    expect(call.system).toContain("Aimcub");
    expect(call.system).toContain("decomposition_contract");
    expect(call.system).toContain("Default to `agent` for digital work");
    expect(call.system).toContain("Use `human` only for work that must happen in the physical world");
    expect(call.system).toContain("Never put `mixed` there");
    expect(call.system).toContain("local context scanning or");
    expect(call.system).toContain("web research");
    expect(call.prompt).toContain(INPUT.title);
  });

  it("includes known user context in the prompt", async () => {
    const gw = mockGateway(validPlan());
    await decompose(gw, {
      ...INPUT,
      memories: [
        {
          category: "preference",
          kind: "semantic",
          source: "user_stated",
          confidence: 0.9,
          content: "User prefers CLI-first workflows.",
        },
      ],
    });

    expect(gw.calls[0]!.prompt).toContain("Known user context");
    expect(gw.calls[0]!.prompt).toContain("preference:");
    expect(gw.calls[0]!.prompt).toContain("User prefers CLI-first workflows.");
    expect(gw.calls[0]!.system).toContain("constraint: treat as hard limits");
    expect(gw.calls[0]!.system).toContain("eval_signal");
  });

  it("includes context lineage learning in the prompt", async () => {
    const gw = mockGateway(validPlan());
    await decompose(gw, {
      ...INPUT,
      lineageLearning: {
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
            signals: ["quality_dimension_improved", "missing_contract_eval_signal"],
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
          "Reuse eval-signal verifiability questions from decomposition-contract; 1/1 captured answers improved plans.",
          "Resolve pending procedure context from unknown before relying on it in milestone contracts.",
        ],
      },
    });

    expect(gw.calls[0]!.prompt).toContain("Historical context lineage learning");
    expect(gw.calls[0]!.prompt).toContain("2 questions · 1 captured · 1 impacted · 1 pending");
    expect(gw.calls[0]!.prompt).toContain("decomposition_contract/eval_signal");
    expect(gw.calls[0]!.prompt).toContain("reuse_pattern");
    expect(gw.calls[0]!.prompt).toContain("example node: Scaffold CLI");
    expect(gw.calls[0]!.prompt).toContain("Resolve pending procedure context");
  });

  it("includes decomposition learning in the prompt", async () => {
    const gw = mockGateway(validPlan());
    await decompose(gw, {
      ...INPUT,
      decompositionLearning: {
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
            nodeKey: "m1",
            nodeTitle: "Implement CLI command",
            dimension: "verifiability",
            issueCodes: ["weak_commit_pattern"],
            reason: "weak_commit_pattern",
            example: "Commit pattern is too broad.",
          },
          {
            source: "completed_contract",
            recommendation: "reuse_pattern",
            aimId: "goal-3",
            aimTitle: "Ship CLI",
            nodeTitle: "Implement CLI command",
            decidedBy: "rule_auto",
            evidenceKinds: ["git_commit"],
            evaluatorKinds: ["commit_pattern"],
            triggeringEvidenceCount: 1,
            minimumTrustScore: 0.95,
            completed: true,
            reason: "completed_with_evidence_attribution",
            example: "Implement CLI command: done when command runs.",
          },
          {
            source: "context_outcome",
            recommendation: "ask_context_earlier",
            aimId: "goal-2",
            aimTitle: "Release CLI",
            nodeTitle: "Release CLI",
            category: "eval_signal",
            acceptedContextCount: 1,
            rejectedContextCount: 0,
            deprioritizedContextCount: 0,
            reason: "accepted_context_changed_or_supported_plan",
            example: "Which verification command proves release readiness?",
          },
        ],
        guidance: [
          "Improve acceptance rules for \"Implement CLI command\"; prior decomposition had weak_commit_pattern issues.",
        ],
      },
    });

    expect(gw.calls[0]!.prompt).toContain("Historical decomposition learning");
    expect(gw.calls[0]!.prompt).toContain("2 aims · 3/5 milestones completed · 1 quality issues · 1 context outcomes · 1 evidence attributions");
    expect(gw.calls[0]!.prompt).toContain("improve_acceptance from quality_issue");
    expect(gw.calls[0]!.prompt).toContain("weak_commit_pattern");
    expect(gw.calls[0]!.prompt).toContain("evidence git_commit via commit_pattern");
    expect(gw.calls[0]!.prompt).toContain("min trust 0.95");
    expect(gw.calls[0]!.prompt).toContain("ask_context_earlier from context_outcome");
    expect(gw.calls[0]!.prompt).toContain("Improve acceptance rules");
  });

  it("includes decomposition strategy in the prompt", async () => {
    const gw = mockGateway(validPlan());
    await decompose(gw, {
      ...INPUT,
      decompositionStrategy: {
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
            focus: "context_fit",
            priority: "medium",
            recommendation: "Surface context_gaps before locking the plan.",
            reason: "Historical accepted context changed plans.",
            sourceRows: 1,
          },
        ],
        guidance: [
          "Treat eval signals as acceptance inputs; every milestone should name the evidence that can satisfy it.",
        ],
      },
    });

    expect(gw.calls[0]!.prompt).toContain("Current decomposition strategy");
    expect(gw.calls[0]!.prompt).toContain('Strategy for "Ship Aimcub CLI": 2 actions');
    expect(gw.calls[0]!.prompt).toContain("[high] verifiability");
    expect(gw.calls[0]!.prompt).toContain("acceptance_rule evidence-backed");
    expect(gw.calls[0]!.prompt).toContain("[medium] context_fit");
    expect(gw.calls[0]!.prompt).toContain("Treat eval signals as acceptance inputs");
  });

  it("applies zod defaults and fills domain when omitted from input", async () => {
    const plan = validPlan();
    const gw = mockGateway(plan);
    const result = await decompose(gw, { title: "Just a title" });

    expect(result.validation.ok).toBe(true);
    // The user prompt should default the domain to `software`.
    expect((gw.calls[0] as LlmRequest).prompt).toContain("software");
  });

  it("normalizes owner/completion-mode confusion from providers", async () => {
    const plan = validPlan();
    (plan.nodes[0]!.acceptance_rule as Record<string, unknown>).completion_mode = "mixed";
    const result = await decompose(mockGateway(plan), INPUT);

    expect(result.validation.ok).toBe(true);
    expect(result.output?.nodes[0]?.acceptance_rule.completion_mode).toBe("auto_then_confirm");
  });
});

describe("decomposeWithQuality", () => {
  it("retries once with critique feedback and selects the improved plan", async () => {
    const weak = validPlan();
    weak.nodes[0]!.acceptance_rule.clauses = [
      { evaluator: "commit_pattern", auto_verifiable: true, match: {} },
    ];
    const improved = validPlan();
    const gw = mockGatewayQueue([weak, improved]);

    const result = await decomposeWithQuality(gw, {
      ...INPUT,
      memories: [{ category: "constraint", content: "Constraint: Use packages/api for the evidence ingester.", confidence: 1 }],
    });

    expect(result.output?.nodes[0]?.acceptance_rule.clauses[0]).toMatchObject({
      evaluator: "commit_pattern",
      match: { path_glob: "packages/api/**" },
    });
    expect(result.quality?.grade).toBe("pass");
    expect(result.retried).toBe(true);
    expect(result.attempts).toBe(2);
    expect(result.firstQuality?.grade).toBe("fail");
    expect(gw.calls).toHaveLength(2);
    expect(gw.calls[1]!.prompt).toContain("Aimcub quality critique");
    expect(gw.calls[1]!.prompt).toContain("Scorecard dimensions to improve");
    expect(gw.calls[1]!.prompt).toContain("verifiability: fail");
    expect(gw.calls[1]!.prompt).toContain("Fix order: verifiability first");
    expect(gw.calls[1]!.prompt).toContain("commit_pattern with no filters");
  });

  it("retries with structured instructions when eval signals are missing from acceptance rules", async () => {
    const weak = validPlan();
    weak.nodes[0]!.description = "Implement the evidence path and capture a golden recording for review.";
    const improved = validPlan();
    improved.nodes[0]!.acceptance_rule.clauses = [
      {
        evaluator: "commit_pattern",
        auto_verifiable: true,
        match: { path_glob: "packages/api/**", min_files: 1, message_pattern: "golden recording" },
      },
    ];
    const gw = mockGatewayQueue([weak, improved]);

    const result = await decomposeWithQuality(gw, {
      ...INPUT,
      memories: [
        {
          category: "eval_signal",
          content: "Eval signal: Done means a golden recording proves demo readiness.",
          confidence: 0.9,
        },
      ],
    });

    expect(result.retried).toBe(true);
    expect(result.quality?.issues.map((issue) => issue.code)).not.toContain("missing_eval_acceptance_signal");
    expect(gw.calls[1]!.prompt).toContain("Actionable refinement instructions");
    expect(gw.calls[1]!.prompt).toContain("context_fit: warn");
    expect(gw.calls[1]!.prompt).toContain("Convert the eval_signal into evidence-backed acceptance_rule details");
    expect(gw.calls[1]!.prompt).toContain("commit_pattern message/path/min_files");
  });

  it("does not retry a plan that already passes quality critique", async () => {
    const gw = mockGatewayQueue([validPlan()]);
    const result = await decomposeWithQuality(gw, INPUT);

    expect(result.retried).toBe(false);
    expect(result.attempts).toBe(1);
    expect(result.quality?.grade).toBe("pass");
    expect(gw.calls).toHaveLength(1);
  });
});

describe("decompose · validatePlan rejections (returned, never thrown)", () => {
  it("rejects a dependency cycle", async () => {
    const plan = validPlan();
    plan.edges = [
      { from: "m1", to: "m2" },
      { from: "m2", to: "m1" },
    ];
    const result = await decompose(mockGateway(plan), INPUT);

    expect(result.validation.ok).toBe(false);
    expect(result.output).toBeNull();
    expect(result.validation.errors).toContain("dependency cycle detected");
  });

  it("rejects duplicate node keys", async () => {
    const plan = validPlan();
    plan.nodes[1]!.key = "m1"; // collide with the first node
    plan.edges = [];
    const result = await decompose(mockGateway(plan), INPUT);

    expect(result.validation.ok).toBe(false);
    expect(result.output).toBeNull();
    expect(result.validation.errors).toContain("duplicate node keys");
  });

  it("rejects an out-of-range plan (more than 15 nodes)", async () => {
    const plan = validPlan();
    const base = plan.nodes[0]!;
    // 16 unique nodes, no edges → over the 1..15 cap.
    plan.nodes = Array.from({ length: 16 }, (_, i) => ({ ...base, key: `n${i}` }));
    plan.edges = [];
    const result = await decompose(mockGateway(plan), INPUT);

    expect(result.validation.ok).toBe(false);
    expect(result.output).toBeNull();
    // zod's `.max(15)` trips first; assert via the issue path either way.
    expect(result.validation.errors.join(" ")).toMatch(/nodes|node count/i);
  });

  it("rejects an edge that references an unknown node", async () => {
    const plan = validPlan();
    plan.edges = [{ from: "m1", to: "ghost" }];
    const result = await decompose(mockGateway(plan), INPUT);

    expect(result.validation.ok).toBe(false);
    expect(result.validation.errors.some((e) => e.includes("ghost"))).toBe(true);
  });
});

describe("decompose · malformed model output (returned, never thrown)", () => {
  it("surfaces zod parse failures as errors without throwing", async () => {
    // `nodes` empty violates zod `.min(1)`.
    const gw = mockGateway({ goal_summary: "x", nodes: [], edges: [] });
    const result = await decompose(gw, INPUT);

    expect(result.validation.ok).toBe(false);
    expect(result.output).toBeNull();
    expect(result.validation.errors.length).toBeGreaterThan(0);
    // usage is still reported (the model did respond).
    expect(result.usage).toEqual(FIXED_USAGE);
  });

  it("rejects garbage that is not even plan-shaped", async () => {
    const result = await decompose(mockGateway({ totally: "wrong" }), INPUT);
    expect(result.validation.ok).toBe(false);
    expect(result.output).toBeNull();
  });

  it("reports a gateway transport failure instead of throwing", async () => {
    const result = await decompose(throwingGateway("boom: 503"), INPUT);
    expect(result.validation.ok).toBe(false);
    expect(result.output).toBeNull();
    expect(result.usage).toBeNull();
    expect(result.validation.errors[0]).toContain("boom: 503");
  });
});

describe("decompose · does not throw on any of the above", () => {
  it("never rejects the returned promise", async () => {
    const spy = vi.fn();
    await decompose(throwingGateway("x"), INPUT).then(spy);
    expect(spy).toHaveBeenCalledOnce();
  });
});
