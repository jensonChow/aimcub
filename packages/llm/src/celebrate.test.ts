import { describe, expect, it, vi } from "vitest";

import { celebrate, type CelebrateInput } from "./celebrate";
import { PERSONA_MESSAGE_MAX_CHARS, PERSONA_SYSTEM_PROMPT } from "./persona";
import { Models, routeModel, type LlmGateway, type LlmRequest, type LlmResponse, type LlmUsage } from "./index";

// ──────────────────────────────────────────────────────────────────────────
// Mock gateway: no network. `complete` returns the canned text the test
// queues, plus a fixed usage record so we can assert metering passthrough.
// ──────────────────────────────────────────────────────────────────────────

const FIXED_USAGE: LlmUsage = {
  model: "claude-sonnet-4-6",
  inputTokens: 42,
  outputTokens: 99,
};

function mockGateway(text: string): LlmGateway & { calls: LlmRequest[] } {
  const calls: LlmRequest[] = [];
  return {
    calls,
    async complete(req: LlmRequest): Promise<LlmResponse<string>> {
      calls.push(req);
      return { output: text, usage: FIXED_USAGE };
    },
    async completeStructured<T>(): Promise<LlmResponse<T>> {
      throw new Error("celebrate must use plain-text complete(), not completeStructured()");
    },
  };
}

/** A gateway whose plain-text call throws (transport/model failure). */
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

const INPUT: CelebrateInput = {
  goalTitle: "Ship the Aimcub MCP evidence ingester",
  milestoneTitle: "Green CI for the ingester",
  petStage: "baby",
  stagedUp: true,
  xpAwarded: 30,
  goalCompleted: false,
};

describe("celebrate · happy path", () => {
  it("returns the trimmed pet message plus usage", async () => {
    const gw = mockGateway("  We did it — Green CI for the ingester! I grew a whole stage. \n");
    const result = await celebrate(gw, INPUT);

    expect(result.message).toBe("We did it — Green CI for the ingester! I grew a whole stage.");
    expect(result.errors).toEqual([]);
    expect(result.usage).toEqual(FIXED_USAGE);
  });

  it("passes the concrete goal/milestone context into the user prompt", async () => {
    const gw = mockGateway("yay");
    await celebrate(gw, INPUT);

    expect(gw.calls).toHaveLength(1);
    const call = gw.calls[0]!;
    expect(call.prompt).toContain(INPUT.goalTitle);
    expect(call.prompt).toContain(INPUT.milestoneTitle);
    expect(call.prompt).toContain(String(INPUT.xpAwarded));
    expect(call.prompt).toContain(INPUT.petStage);
    expect(call.prompt).toContain("evolved"); // stagedUp: true is surfaced
  });

  it("surfaces the goal-completed grand finale in the prompt", async () => {
    const gw = mockGateway("grand!");
    await celebrate(gw, { ...INPUT, stagedUp: false, goalCompleted: true });

    const prompt = gw.calls[0]!.prompt;
    expect(prompt).toContain("ENTIRE goal");
    expect(prompt).not.toContain("evolved");
  });
});

describe("celebrate · task routing", () => {
  it("routes as the `celebrate` task, which maps to the Sonnet route", async () => {
    const gw = mockGateway("ok");
    await celebrate(gw, INPUT);

    const call = gw.calls[0]!;
    expect(call.task).toBe("celebrate");
    expect(call.model).toBeUndefined(); // no override — routeModel decides
    expect(routeModel(call.task)).toBe(Models.sonnet);
  });
});

describe("celebrate · system prompt (cache-friendliness)", () => {
  it("is referentially stable across calls and carries no user data", async () => {
    const gw = mockGateway("ok");
    await celebrate(gw, INPUT);
    await celebrate(gw, { ...INPUT, goalTitle: "A totally different goal", xpAwarded: 999 });

    const [first, second] = gw.calls;
    // Same frozen module constant on every call — byte-identical prefix for prompt caching.
    expect(first!.system).toBe(PERSONA_SYSTEM_PROMPT);
    expect(second!.system).toBe(PERSONA_SYSTEM_PROMPT);
    expect(first!.system).toBe(second!.system);
    // No volatile/user data in the system prompt.
    expect(PERSONA_SYSTEM_PROMPT).not.toContain(INPUT.goalTitle);
    expect(PERSONA_SYSTEM_PROMPT).not.toContain("A totally different goal");
    expect(PERSONA_SYSTEM_PROMPT).not.toContain(INPUT.milestoneTitle);
    expect(PERSONA_SYSTEM_PROMPT).not.toContain("999");
  });

  it("encodes the locked persona invariants (no shaming, brevity, English)", () => {
    expect(PERSONA_SYSTEM_PROMPT).toMatch(/NEVER shame/i);
    expect(PERSONA_SYSTEM_PROMPT).toMatch(/2 sentences/);
    expect(PERSONA_SYSTEM_PROMPT).toMatch(/200 characters/);
    expect(PERSONA_SYSTEM_PROMPT).toMatch(/at most one emoji/i);
    expect(PERSONA_SYSTEM_PROMPT).toMatch(/English/);
  });
});

describe("celebrate · clamping and empty output", () => {
  it("clamps over-long model output to the max message length", async () => {
    const gw = mockGateway("x".repeat(PERSONA_MESSAGE_MAX_CHARS + 200));
    const result = await celebrate(gw, INPUT);

    expect(result.message).toHaveLength(PERSONA_MESSAGE_MAX_CHARS);
    expect(result.errors).toEqual([]);
  });

  it("rejects an empty / whitespace-only output as message null + error", async () => {
    const result = await celebrate(mockGateway("   \n  "), INPUT);

    expect(result.message).toBeNull();
    expect(result.errors).toEqual(["model returned an empty message"]);
    // usage is still reported (the model did respond).
    expect(result.usage).toEqual(FIXED_USAGE);
  });
});

describe("celebrate · gateway failure (returned, never thrown)", () => {
  it("reports a transport failure as message null + errors", async () => {
    const result = await celebrate(throwingGateway("boom: 529"), INPUT);

    expect(result.message).toBeNull();
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain("boom: 529");
    expect(result.usage).toBeNull();
  });

  it("never rejects the returned promise", async () => {
    const spy = vi.fn();
    await celebrate(throwingGateway("x"), INPUT).then(spy);
    expect(spy).toHaveBeenCalledOnce();
  });
});
