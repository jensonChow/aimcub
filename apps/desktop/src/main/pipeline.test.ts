import { describe, expect, it } from "vitest";

import {
  collectPlanningToolContext,
  createAimcubToolRegistry,
  createContextDistillHandler,
  localDecompose,
  type ClarifyAnswer,
  type ClarifyQuestion,
  type AimcubToolHandlerContext,
  type LlmGateway,
  type LlmRequest,
  type LlmResponse,
  type LlmUsage,
} from "@aimcub/llm";
import { reviewAimIntake } from "@aimcub/core";

import { runClarify, runDraft, runIntakeQuestions, runRefine, type PlanningModelRunLiveEvent } from "./planner";
import { materialize } from "./materialize";

/**
 * Exercises the desktop main-process planner end to end with a MOCK gateway (no Electron,
 * no network). The planner has no offline/template fallback: with no gateway it must fail
 * honestly; with a gateway it runs the real @aimcub/llm decompose/clarify pipeline.
 */

const USAGE: LlmUsage = { model: "mock-model", inputTokens: 1, outputTokens: 1 };

/** A valid clarify question set (>=2 options each) for the `classify` task. */
const CLARIFY_OUTPUT = {
  questions: [
    {
      id: "scope",
      question: "How polished should it be?",
      why_high_impact: "Decides milestone count.",
      kind: "scope",
      allow_other: true,
      selection_mode: "single",
      selection_mode_reason: "mutually_exclusive",
      options: [
        { label: "Prototype", tradeoff: "Faster, looser." },
        { label: "Production", tradeoff: "Strict CI gates." },
      ],
    },
  ],
  assumptions: [{ statement: "Assumed GitHub + CI.", default_value: "github" }],
};

const INTAKE_OUTPUT = {
  questions: [
    {
      source_question_id: "intake_1",
      question: "Do you already have the Apple Developer access needed to distribute the tarot app?",
      why_high_impact: "This decides whether access setup blocks implementation.",
      selection_mode: "single",
      selection_mode_reason: "mutually_exclusive",
      options: [
        { label: "Yes", tradeoff: "Planning can continue to product/build work." },
        { label: "No", tradeoff: "Planning must add an access prerequisite first." },
      ],
    },
  ],
};

/**
 * A gateway that returns a valid plan for `decompose` and a valid question set for
 * `classify` — a stand-in for a real model. `localDecompose` is reused only as a
 * known-valid plan fixture (the planner itself never falls back to it).
 */
function mockGateway(): LlmGateway {
  return {
    async complete(): Promise<LlmResponse<string>> {
      return { output: "", usage: USAGE };
    },
    async completeStructured<T>(req: LlmRequest & { schema: unknown }): Promise<LlmResponse<T>> {
      const output = req.task === "decompose" ? localDecompose({ title: "mock plan" }) : CLARIFY_OUTPUT;
      return { output: output as T, usage: USAGE };
    },
  };
}

function recordingGateway(): { gateway: LlmGateway; calls: Array<LlmRequest & { schema?: unknown }> } {
  const calls: Array<LlmRequest & { schema?: unknown }> = [];
  return {
    calls,
    gateway: {
      async complete(): Promise<LlmResponse<string>> {
        return { output: "", usage: USAGE };
      },
      async completeStructured<T>(req: LlmRequest & { schema: unknown }): Promise<LlmResponse<T>> {
        calls.push(req);
        const output = req.task === "decompose" ? localDecompose({ title: "mock plan" }) : CLARIFY_OUTPUT;
        return { output: output as T, usage: USAGE };
      },
    },
  };
}

/** A gateway whose calls always throw (transport failure). */
function throwingGateway(): LlmGateway {
  return {
    async complete(): Promise<never> {
      throw new Error("boom: 503");
    },
    async completeStructured<T>(): Promise<LlmResponse<T>> {
      throw new Error("boom: 503");
    },
  };
}

const aim = { title: "Build a CLI todo app with tests + CI", description: "A small command-line todo app." };
const toolContext: AimcubToolHandlerContext = {
  now: () => new Date("2026-07-02T00:00:00.000Z"),
  permissions: ["memory.read", "context.distill"],
};

describe("desktop planner · no provider configured (no templates)", () => {
  it("runDraft fails honestly with a 'no provider' error", async () => {
    const r = await runDraft(null, aim.title, aim.description);
    expect(r.ok).toBe(false);
    expect(r.output).toBeNull();
    expect(r.errors[0]).toMatch(/no llm provider/i);
  });

  it("runClarify and runRefine also fail honestly with no gateway", async () => {
    const draft = localDecompose(aim);
    const c = await runClarify(null, aim.title, aim.description, draft);
    expect(c.ok).toBe(false);
    expect(c.output).toBeNull();
    const r = await runRefine(null, aim.title, aim.description, draft, [], []);
    expect(r.ok).toBe(false);
    expect(r.output).toBeNull();
  });
});

describe("desktop planner · intake question generation", () => {
  it("uses the model and emits intake-stage model run hooks before showing questions", async () => {
    const calls: Array<LlmRequest & { schema?: unknown }> = [];
    const gateway: LlmGateway = {
      async complete(): Promise<LlmResponse<string>> {
        return { output: "", usage: USAGE };
      },
      async completeStructured<T>(req: LlmRequest & { schema: unknown }): Promise<LlmResponse<T>> {
        calls.push(req);
        return { output: INTAKE_OUTPUT as T, usage: USAGE };
      },
    };
    const events: PlanningModelRunLiveEvent[] = [];
    const intake = reviewAimIntake({
      title: "Develop a tarot app",
      memories: [],
      selectedContext: [],
    });

    const result = await runIntakeQuestions(gateway, {
      title: "Develop a tarot app",
      intake,
      researchRequired: true,
      toolSignals: [{ toolName: "memory.search", summary: "No relevant memory found." }],
    }, { onModelRun: (event) => events.push(event) });

    expect(result.ok).toBe(true);
    expect(result.intake?.questions[0]).toMatchObject({
      prompt: expect.stringContaining("Apple Developer access"),
      selectionMode: "single",
    });
    expect(calls[0]!.task).toBe("classify");
    expect(calls[0]!.prompt).toContain("No relevant memory found");
    expect(calls[0]!.prompt).toContain("Return at most 6 atomic questions");
    expect(result.debugTrace?.stage).toBe("intake");
    expect(result.debugTrace?.modelRuns[0]).toMatchObject({
      stage: "intake",
      task: "classify",
      status: "ok",
    });
    expect(events.map((event) => event.type)).toEqual(["model.started", "model.completed"]);
  });

  it("forwards adaptive exploration history and a one-question turn budget", async () => {
    const calls: Array<LlmRequest & { schema?: unknown }> = [];
    const gateway: LlmGateway = {
      async complete(): Promise<LlmResponse<string>> {
        return { output: "", usage: USAGE };
      },
      async completeStructured<T>(req: LlmRequest & { schema: unknown }): Promise<LlmResponse<T>> {
        calls.push(req);
        return { output: INTAKE_OUTPUT as T, usage: USAGE };
      },
    };
    const intake = reviewAimIntake({ title: "Develop a tarot app", memories: [], selectedContext: [] });

    const result = await runIntakeQuestions(gateway, {
      title: "Develop a tarot app",
      intake,
      maxQuestions: 1,
      explorationHistory: [{
        question: "Who should use the pilot?",
        answer: "A private group of experienced readers.",
      }],
    });

    expect(result.ok).toBe(true);
    expect(calls[0]!.prompt).toContain("A private group of experienced readers");
    expect(calls[0]!.prompt).toContain("Return at most 1 atomic questions");
  });
});

describe("desktop planner · with a gateway (real @aimcub/llm pipeline)", () => {
  it("drafts a valid, materializable plan", async () => {
    const d = await runDraft(mockGateway(), aim.title, aim.description);
    expect(d.ok).toBe(true);
    expect(d.output!.nodes.length).toBeGreaterThan(0);
    expect(d.quality?.grade).toBe("pass");
    expect(d.review?.quality.grade).toBe("pass");
    expect(d.qualityRetry?.attempts).toBe(1);
    expect(d.debugTrace?.stage).toBe("draft");
    expect(d.debugTrace?.modelRuns).toHaveLength(1);
    expect(d.debugTrace?.modelRuns[0]).toMatchObject({
      stage: "draft",
      task: "decompose",
      status: "ok",
      structured: true,
      model: "mock-model",
      usage: USAGE,
    });
    const milestones = materialize(d.output!, "goal-1", "owner-1");
    expect(milestones).toHaveLength(d.output!.nodes.length);
    expect(milestones[0]!.depends_on_ids).toEqual([]);
  });

  it("emits live model run hooks while drafting", async () => {
    const events: PlanningModelRunLiveEvent[] = [];
    const d = await runDraft(
      mockGateway(),
      aim.title,
      aim.description,
      [],
      null,
      null,
      null,
      null,
      false,
      { onModelRun: (event) => events.push(event) },
    );

    expect(d.ok).toBe(true);
    expect(events.map((event) => event.type)).toEqual(["model.started", "model.completed"]);
    expect(events[0]!.run).toMatchObject({
      stage: "draft",
      task: "decompose",
      status: "running",
      structured: true,
    });
    expect(events[1]!.run).toMatchObject({
      id: events[0]!.run.id,
      status: "ok",
      usage: USAGE,
    });
  });

  it("passes context lineage learning into the draft prompt", async () => {
    const { gateway, calls } = recordingGateway();
    const d = await runDraft(gateway, aim.title, aim.description, [], {
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
      ],
      guidance: ["Reuse eval-signal verifiability questions from decomposition-contract."],
    });

    expect(d.ok).toBe(true);
    const decomposeCall = calls.find((call) => call.task === "decompose");
    expect(decomposeCall?.prompt).toContain("Historical context lineage learning");
    expect(decomposeCall?.prompt).toContain("decomposition_contract/eval_signal");
    expect(decomposeCall?.prompt).toContain("Scaffold CLI");
  });

  it("passes registry-collected first-party tool context into the draft prompt", async () => {
    const registry = createAimcubToolRegistry({
      "memory.search": async () => ({
        ok: true,
        observation: {
          summary: "Selected 1 planning memory.",
          data: {
            memories: [{
              id: "memory-1",
              content: "User prefers CLI-first workflows with visible process traces.",
              category: "preference",
              kind: "semantic",
              scope: "global",
              confidence: 0.95,
            }],
          },
          sources: [{ kind: "memory", uri: "memory:memory-1" }],
        },
      }),
      "context.distill": createContextDistillHandler(),
    });
    const collected = await collectPlanningToolContext(registry, toolContext, aim);
    const { gateway, calls } = recordingGateway();

    const d = await runDraft(gateway, aim.title, aim.description, collected.memories);

    expect(d.ok).toBe(true);
    const decomposeCall = calls.find((call) => call.task === "decompose");
    expect(decomposeCall?.prompt).toContain("Known user context from previous aims");
    expect(decomposeCall?.prompt).toContain("visible process traces");
  });

  it("passes first-party web research evidence into the draft prompt", async () => {
    const registry = createAimcubToolRegistry({
      "memory.search": async () => ({
        ok: true,
        observation: {
          summary: "Selected 0 planning memories.",
          data: { memories: [] },
          sources: [],
        },
      }),
      "web.search": async () => ({
        ok: true,
        observation: {
          summary: "Found 1 web result.",
          data: {
            results: [{
              title: "Cambodia visa guidance",
              url: "https://example.com/cambodia-visa",
              snippet: "Current visa and travel basics.",
            }],
          },
          sources: [{ kind: "web", url: "https://example.com/cambodia-visa" }],
        },
      }),
      "web.fetch": async () => ({
        ok: true,
        observation: {
          summary: "Fetched Cambodia visa guidance.",
          data: {
            finalUrl: "https://example.com/cambodia-visa",
            status: 200,
            title: "Cambodia visa guidance",
            text: "Travelers should verify passport validity, visa requirements, local transport, and health guidance before departure.",
            truncated: false,
          },
          sources: [{ kind: "web", url: "https://example.com/cambodia-visa" }],
        },
      }),
    });
    const collected = await collectPlanningToolContext(
      registry,
      { ...toolContext, permissions: ["memory.read", "network.search", "network.fetch"] },
      {
        title: "Plan a Cambodia trip",
        includeWeb: true,
        fetchWebResults: true,
        webQueryLimit: 1,
      },
    );
    const { gateway, calls } = recordingGateway();

    const d = await runDraft(gateway, "Plan a Cambodia trip", "Make a practical travel plan.", collected.memories, null, null, null, collected.research);

    expect(d.ok).toBe(true);
    const decomposeCall = calls.find((call) => call.task === "decompose");
    expect(decomposeCall?.prompt).toContain("First-party web research evidence");
    expect(decomposeCall?.prompt).toContain("Cambodia visa guidance");
    expect(decomposeCall?.prompt).toContain("https://example.com/cambodia-visa");
    expect(decomposeCall?.prompt).toContain("passport validity");
  });

  it("instructs draft output to follow a Chinese aim language", async () => {
    const { gateway, calls } = recordingGateway();

    const d = await runDraft(gateway, "我想找一个工作", "希望先拆成清晰的求职计划。");

    expect(d.ok).toBe(true);
    const decomposeCall = calls.find((call) => call.task === "decompose");
    expect(decomposeCall?.prompt).toContain("Output language: Simplified Chinese");
    expect(decomposeCall?.prompt).toContain("user-facing JSON string");
  });

  it("clarifies into real forks (>=2 options each)", async () => {
    const draft = localDecompose(aim);
    const c = await runClarify(mockGateway(), aim.title, aim.description, draft);
    expect(c.ok).toBe(true);
    expect(c.output!.questions.length).toBeGreaterThan(0);
    expect(c.output!.questions.every((q) => q.options.length >= 2)).toBe(true);
    expect(c.debugTrace?.modelRuns[0]).toMatchObject({
      stage: "clarify",
      task: "classify",
      status: "ok",
      structured: true,
    });
  });

  it("instructs clarify output to follow a Chinese aim language", async () => {
    const draft = localDecompose({ title: "我想找一个工作" });
    const { gateway, calls } = recordingGateway();

    const c = await runClarify(gateway, "我想找一个工作", "希望先拆成清晰的求职计划。", draft);

    expect(c.ok).toBe(true);
    const clarifyCall = calls.find((call) => call.task === "classify");
    expect(clarifyCall?.prompt).toContain("Output language: Simplified Chinese");
    expect(clarifyCall?.prompt).toContain("question, reason, option label");
  });

  it("passes aim intake readiness into the clarify prompt", async () => {
    const draft = localDecompose(aim);
    const { gateway, calls } = recordingGateway();

    const c = await runClarify(
      gateway,
      aim.title,
      aim.description,
      draft,
      [],
      null,
      null,
      {
        title: aim.title,
        readiness: "needs_targeted_context",
        score: 50,
        coverage: {
          profile: {
            totalActive: 0,
            totalPending: 0,
            highConfidenceActive: 0,
            coverageScore: 10,
            rows: [],
            gaps: [],
          },
          selectedTotal: 0,
          selectedByCategory: [],
          missingCoreCategories: ["eval_signal"],
        },
        questions: [
          {
            id: "intake_1",
            category: "eval_signal",
            priority: "high",
            source: "context_profile",
            reason: "profile_missing",
            prompt: "Ask what proves this aim is complete.",
          },
        ],
        acquisition: [],
        loop: {
          version: 1,
          shouldContinue: false,
          nextStepId: null,
          stopCondition: "Context is sufficient for decomposition; continue collecting eval signals from evidence after execution.",
          steps: [],
          aimContextTargets: [],
          durableMemoryTargets: [],
        },
        nextActions: ["Answer 1 high-priority intake question before accepting a plan."],
      },
    );

    expect(c.ok).toBe(true);
    const clarifyCall = calls.find((call) => call.task === "classify");
    expect(clarifyCall?.prompt).toContain("Aim intake readiness");
    expect(clarifyCall?.prompt).toContain("needs_targeted_context");
    expect(clarifyCall?.prompt).toContain("Ask what proves this aim is complete.");
  });

  it("passes capture learning into the clarify prompt", async () => {
    const draft = localDecompose(aim);
    const { gateway, calls } = recordingGateway();

    const c = await runClarify(
      gateway,
      aim.title,
      aim.description,
      draft,
      [],
      null,
      {
        version: 1,
        totalAsked: 1,
        totalAnswered: 1,
        totalCaptured: 1,
        totalImpacted: 1,
        rows: [
          {
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
        guidance: ["Prefer eval-signal questions for verifiability."],
      },
    );

    expect(c.ok).toBe(true);
    const clarifyCall = calls.find((call) => call.task === "classify");
    expect(clarifyCall?.prompt).toContain("Historical capture learning");
    expect(clarifyCall?.prompt).toContain("global/eval_signal");
    expect(clarifyCall?.prompt).toContain("ask_more");
    expect(clarifyCall?.prompt).toContain("Origin-specific capture signals");
    expect(clarifyCall?.prompt).toContain("m1 (Scaffold the CLI)");
  });

  it("refines a plan from the user's answers", async () => {
    const draft = localDecompose(aim);
    const answers: ClarifyAnswer[] = [
      { question_id: "scope", selected_label: "Production", other_text: null },
    ];
    const r = await runRefine(mockGateway(), aim.title, aim.description, draft, CLARIFY_OUTPUT.questions as never, answers);
    expect(r.ok).toBe(true);
    expect(r.output!.nodes.length).toBeGreaterThan(0);
    expect(r.quality?.grade).toBe("pass");
    expect(r.review?.quality.grade).toBe("pass");
  });

  it("passes structured answer context into the refine decomposition", async () => {
    const draft = localDecompose(aim);
    const { gateway, calls } = recordingGateway();
    const questions: ClarifyQuestion[] = [
      {
        id: "proof",
        question: "What evidence should prove this is done?",
        why_high_impact: "Shapes acceptance rules and eval.",
        kind: "assumption",
        allow_other: true,
        source_dimension: "verifiability",
        capture: {
          category: "eval_signal",
          scope: "global",
          purpose: "define_eval",
          improvesDimension: "verifiability",
          reason: "test_refine_answer_context",
        },
        options: [
          { label: "Passing smoke tests", tradeoff: "Repeatable and agent-checkable." },
          { label: "Manual review", tradeoff: "Needs user confirmation." },
        ],
      },
    ];

    const r = await runRefine(
      gateway,
      aim.title,
      aim.description,
      draft,
      questions,
      [{ question_id: "proof", selected_label: "Passing smoke tests", other_text: null }],
    );

    expect(r.ok).toBe(true);
    const decomposeCall = calls.find((call) => call.task === "decompose");
    expect(decomposeCall?.prompt).toContain("Clarifications from the user");
    expect(decomposeCall?.prompt).toContain("Known user context from previous aims");
    expect(decomposeCall?.prompt).toContain("eval_signal:");
    expect(decomposeCall?.prompt).toContain("Eval signal: Passing smoke tests.");
    expect(decomposeCall?.prompt).toContain("Clarify question: What evidence should prove this is done?");
  });

  it("passes review action prompts into the refine decomposition", async () => {
    const draft = localDecompose(aim);
    const { gateway, calls } = recordingGateway();

    const r = await runRefine(
      gateway,
      aim.title,
      aim.description,
      draft,
      [],
      [],
      [],
      "Revise the decomposition to explicitly account for screenshots.",
    );

    expect(r.ok).toBe(true);
    const decomposeCall = calls.find((call) => call.task === "decompose");
    expect(decomposeCall?.prompt).toContain("Plan review action to address before accepting");
    expect(decomposeCall?.prompt).toContain("screenshots");
  });
});

describe("desktop planner · gateway failure is reported, never thrown", () => {
  it("runDraft returns ok:false with the transport error", async () => {
    const r = await runDraft(throwingGateway(), aim.title, aim.description);
    expect(r.ok).toBe(false);
    expect(r.output).toBeNull();
    expect(r.errors.join(" ")).toMatch(/boom: 503/);
    expect(r.debugTrace?.modelRuns[0]).toMatchObject({
      stage: "draft",
      task: "decompose",
      status: "error",
      error: "boom: 503",
    });
  });
});
