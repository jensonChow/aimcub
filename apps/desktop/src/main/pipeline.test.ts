import { describe, expect, it } from "vitest";

import {
  collectPlanningToolContext,
  createAimcubToolRegistry,
  createContextDistillHandler,
  localDecompose,
  type ClarifyAnswer,
  type AimcubToolHandlerContext,
  type LlmGateway,
  type LlmRequest,
  type LlmResponse,
  type LlmUsage,
} from "@core/llm";

import { runClarify, runDraft, runRefine } from "./planner";
import { materialize } from "./materialize";

/**
 * Exercises the desktop main-process planner end to end with a MOCK gateway (no Electron,
 * no network). The planner has no offline/template fallback: with no gateway it must fail
 * honestly; with a gateway it runs the real @core/llm decompose/clarify pipeline.
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
      options: [
        { label: "Prototype", tradeoff: "Faster, looser." },
        { label: "Production", tradeoff: "Strict CI gates." },
      ],
    },
  ],
  assumptions: [{ statement: "Assumed GitHub + CI.", default_value: "github" }],
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

describe("desktop planner · with a gateway (real @core/llm pipeline)", () => {
  it("drafts a valid, materializable plan", async () => {
    const d = await runDraft(mockGateway(), aim.title, aim.description);
    expect(d.ok).toBe(true);
    expect(d.output!.nodes.length).toBeGreaterThan(0);
    expect(d.quality?.grade).toBe("pass");
    expect(d.review?.quality.grade).toBe("pass");
    expect(d.qualityRetry?.attempts).toBe(1);
    const milestones = materialize(d.output!, "goal-1", "owner-1");
    expect(milestones).toHaveLength(d.output!.nodes.length);
    expect(milestones[0]!.depends_on_id).toBeNull();
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
  });
});
