import { describe, expect, it, vi } from "vitest";

import {
  clarify,
  buildRefinedDescription,
  type ClarifyInput,
  type ClarifyAnswer,
} from "./clarify";
import type { DecompositionOutput } from "@core/types";
import type { LlmGateway, LlmRequest, LlmResponse, LlmUsage } from "./index";

const FIXED_USAGE: LlmUsage = {
  model: "claude-haiku-4-5-20251001",
  inputTokens: 21,
  outputTokens: 40,
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

/** A minimal first-pass draft to ground questions in (shape-only; not zod-parsed). */
const DRAFT = {
  goal_summary: "Build a CLI todo app.",
  domain: "software",
  rationale: "Scaffold, implement, test, release.",
  nodes: [
    { key: "m1", title: "Scaffold the CLI", description: "Init the project.", est_effort: "s", xp_reward: 10, acceptance_rule: { logic: "all", clauses: [], threshold: 1, completion_mode: "auto" } },
    { key: "m2", title: "Implement add/list/done", description: "Core commands.", est_effort: "m", xp_reward: 20, acceptance_rule: { logic: "all", clauses: [], threshold: 1, completion_mode: "auto" } },
  ],
  edges: [{ from: "m1", to: "m2" }],
} as unknown as DecompositionOutput;

const INPUT: ClarifyInput = {
  title: "Build a CLI todo app with tests + CI",
  description: "A small command-line todo app.",
  domain: "software",
  draft: DRAFT,
};

/** A canned, valid clarify output: two real forks + a disclosed assumption. */
function validQuestions() {
  return {
    questions: [
      {
        id: "scope",
        question: "How polished should it be?",
        why_high_impact: "Decides milestone count and acceptance strictness.",
        kind: "scope",
        allow_other: true,
        options: [
          { label: "Prototype", tradeoff: "Fastest, looser." },
          { label: "Production", tradeoff: "Slower, strict CI gates." },
        ],
      },
      {
        id: "lang",
        question: "Which language?",
        why_high_impact: "Changes the scaffold and CI workflow.",
        kind: "constraint",
        allow_other: true,
        options: [
          { label: "TypeScript", tradeoff: "Node ecosystem." },
          { label: "Go", tradeoff: "Single static binary." },
        ],
      },
    ],
    assumptions: [
      { statement: "Assumed GitHub + CI as the evidence source.", default_value: "github" },
    ],
  };
}

describe("clarify · happy path", () => {
  it("maps a canned question set, validates it, and returns it + usage", async () => {
    const gw = mockGateway(validQuestions());
    const result = await clarify(gw, INPUT);

    expect(result.validation.ok).toBe(true);
    expect(result.validation.errors).toEqual([]);
    expect(result.output).not.toBeNull();
    expect(result.output?.questions.map((q) => q.id)).toEqual(["scope", "lang"]);
    expect(result.output?.questions[0]?.options).toHaveLength(2);
    expect(result.output?.assumptions[0]?.default_value).toBe("github");
    expect(result.usage).toEqual(FIXED_USAGE);
  });

  it("routes the request as a `classify` task and supplies the JSON schema + draft", async () => {
    const gw = mockGateway(validQuestions());
    await clarify(gw, INPUT);

    expect(gw.calls).toHaveLength(1);
    const call = gw.calls[0]!;
    expect(call.task).toBe("classify");
    expect(call.schema).toBeDefined();
    expect(call.system).toContain("CLARIFYING");
    expect(call.prompt).toContain(INPUT.title);
    expect(call.prompt).toContain("Scaffold the CLI"); // draft is grounded in
  });

  it("truncates to maxQuestions", async () => {
    const gw = mockGateway(validQuestions());
    const result = await clarify(gw, { ...INPUT, maxQuestions: 1 });
    expect(result.output?.questions).toHaveLength(1);
    expect(result.output?.questions[0]?.id).toBe("scope");
  });

  it("accepts an empty question set (everything defaulted) without failing", async () => {
    const gw = mockGateway({ questions: [], assumptions: [{ statement: "Assumed solo.", default_value: "solo" }] });
    const result = await clarify(gw, INPUT);
    expect(result.validation.ok).toBe(true);
    expect(result.output?.questions).toEqual([]);
    expect(result.output?.assumptions).toHaveLength(1);
  });
});

describe("clarify · validation rejections (returned, never thrown)", () => {
  it("rejects a question with fewer than 2 options", async () => {
    const bad = validQuestions();
    bad.questions[0]!.options = [{ label: "only one", tradeoff: "n/a" }];
    const result = await clarify(mockGateway(bad), INPUT);
    expect(result.validation.ok).toBe(false);
    expect(result.output).toBeNull();
    expect(result.validation.errors.some((e) => e.includes("at least 2 options"))).toBe(true);
  });

  it("rejects duplicate question ids", async () => {
    const bad = validQuestions();
    bad.questions[1]!.id = "scope"; // collide
    const result = await clarify(mockGateway(bad), INPUT);
    expect(result.validation.ok).toBe(false);
    expect(result.validation.errors.some((e) => e.includes("duplicate question id"))).toBe(true);
  });
});

describe("clarify · malformed model output (returned, never thrown)", () => {
  it("rejects output that is not question-set-shaped", async () => {
    const result = await clarify(mockGateway({ totally: "wrong" }), INPUT);
    expect(result.validation.ok).toBe(false);
    expect(result.output).toBeNull();
    expect(result.usage).toEqual(FIXED_USAGE);
  });

  it("reports a gateway transport failure instead of throwing", async () => {
    const result = await clarify(throwingGateway("boom: 503"), INPUT);
    expect(result.validation.ok).toBe(false);
    expect(result.output).toBeNull();
    expect(result.usage).toBeNull();
    expect(result.validation.errors[0]).toContain("boom: 503");
  });

  it("never rejects the returned promise", async () => {
    const spy = vi.fn();
    await clarify(throwingGateway("x"), INPUT).then(spy);
    expect(spy).toHaveBeenCalledOnce();
  });
});

describe("buildRefinedDescription", () => {
  it("folds answers into the description, rendering the question text", () => {
    const questions = validQuestions().questions as unknown as Parameters<typeof buildRefinedDescription>[1];
    const answers: ClarifyAnswer[] = [
      { question_id: "scope", selected_label: "Production", other_text: null },
      { question_id: "lang", selected_label: null, other_text: "Rust" },
    ];
    const refined = buildRefinedDescription("A small CLI.", questions, answers);
    expect(refined).toContain("A small CLI.");
    expect(refined).toContain("Clarifications from the user:");
    expect(refined).toContain("How polished should it be? → Production");
    expect(refined).toContain("Which language? → Rust");
  });

  it("returns the base description unchanged when there are no answers", () => {
    expect(buildRefinedDescription("base", [], [])).toBe("base");
  });
});
