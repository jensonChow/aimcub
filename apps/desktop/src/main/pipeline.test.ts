import { describe, expect, it } from "vitest";

import {
  localDecompose,
  type ClarifyAnswer,
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
    const milestones = materialize(d.output!, "goal-1", "owner-1");
    expect(milestones).toHaveLength(d.output!.nodes.length);
    expect(milestones[0]!.depends_on_id).toBeNull();
  });

  it("clarifies into real forks (>=2 options each)", async () => {
    const draft = localDecompose(aim);
    const c = await runClarify(mockGateway(), aim.title, aim.description, draft);
    expect(c.ok).toBe(true);
    expect(c.output!.questions.length).toBeGreaterThan(0);
    expect(c.output!.questions.every((q) => q.options.length >= 2)).toBe(true);
  });

  it("refines a plan from the user's answers", async () => {
    const draft = localDecompose(aim);
    const answers: ClarifyAnswer[] = [
      { question_id: "scope", selected_label: "Production", other_text: null },
    ];
    const r = await runRefine(mockGateway(), aim.title, aim.description, draft, CLARIFY_OUTPUT.questions as never, answers);
    expect(r.ok).toBe(true);
    expect(r.output!.nodes.length).toBeGreaterThan(0);
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
