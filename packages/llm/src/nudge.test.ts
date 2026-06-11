import { describe, expect, it, vi } from "vitest";

import { nudge, type NudgeInput } from "./nudge";
import { PERSONA_MESSAGE_MAX_CHARS, PERSONA_SYSTEM_PROMPT } from "./persona";
import { Models, routeModel, type LlmGateway, type LlmRequest, type LlmResponse, type LlmUsage } from "./index";

// ──────────────────────────────────────────────────────────────────────────
// Mock gateway: no network. `complete` returns the canned text the test
// queues, plus a fixed usage record so we can assert metering passthrough.
// ──────────────────────────────────────────────────────────────────────────

const FIXED_USAGE: LlmUsage = {
  model: "claude-haiku-4-5-20251001",
  inputTokens: 17,
  outputTokens: 33,
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
      throw new Error("nudge must use plain-text complete(), not completeStructured()");
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

const STALE_INPUT: NudgeInput = {
  trigger: "stale",
  goalTitle: "Ship the Aimcub MCP evidence ingester",
  daysInactive: 5,
  pendingMilestoneTitle: "Green CI for the ingester",
};

const DEADLINE_INPUT: NudgeInput = {
  trigger: "deadline_near",
  goalTitle: "Ship the Aimcub MCP evidence ingester",
  dueAt: "2026-06-30T00:00:00Z",
};

describe("nudge · happy path", () => {
  it("returns the trimmed pet message plus usage", async () => {
    const gw = mockGateway("  I miss you! Green CI for the ingester is so close. \n");
    const result = await nudge(gw, STALE_INPUT);

    expect(result.message).toBe("I miss you! Green CI for the ingester is so close.");
    expect(result.errors).toEqual([]);
    expect(result.usage).toEqual(FIXED_USAGE);
  });

  it("passes the stale-trigger context into the user prompt", async () => {
    const gw = mockGateway("hi");
    await nudge(gw, STALE_INPUT);

    expect(gw.calls).toHaveLength(1);
    const prompt = gw.calls[0]!.prompt;
    expect(prompt).toContain(STALE_INPUT.goalTitle);
    expect(prompt).toContain("5 days");
    expect(prompt).toContain(STALE_INPUT.pendingMilestoneTitle!);
    expect(prompt).toContain("miss your owner");
  });

  it("passes the deadline-trigger context into the user prompt", async () => {
    const gw = mockGateway("hi");
    await nudge(gw, DEADLINE_INPUT);

    const prompt = gw.calls[0]!.prompt;
    expect(prompt).toContain(DEADLINE_INPUT.goalTitle);
    expect(prompt).toContain(DEADLINE_INPUT.dueAt!);
    expect(prompt).toContain("deadline");
    // Optional fields not supplied must not leak placeholder text.
    expect(prompt).not.toContain("undefined");
    expect(prompt).not.toContain("milestone waiting");
  });
});

describe("nudge · task routing", () => {
  it("routes as the `nudge` task, which maps to the Haiku route", async () => {
    const gw = mockGateway("ok");
    await nudge(gw, STALE_INPUT);

    const call = gw.calls[0]!;
    expect(call.task).toBe("nudge");
    expect(call.model).toBeUndefined(); // no override — routeModel decides
    expect(routeModel(call.task)).toBe(Models.haiku);
  });
});

describe("nudge · system prompt (cache-friendliness)", () => {
  it("is referentially stable across calls and carries no user data", async () => {
    const gw = mockGateway("ok");
    await nudge(gw, STALE_INPUT);
    await nudge(gw, DEADLINE_INPUT);

    const [first, second] = gw.calls;
    // Same frozen module constant on every call — byte-identical prefix for prompt caching.
    expect(first!.system).toBe(PERSONA_SYSTEM_PROMPT);
    expect(second!.system).toBe(PERSONA_SYSTEM_PROMPT);
    expect(first!.system).toBe(second!.system);
    // No volatile/user data in the system prompt.
    expect(PERSONA_SYSTEM_PROMPT).not.toContain(STALE_INPUT.goalTitle);
    expect(PERSONA_SYSTEM_PROMPT).not.toContain(DEADLINE_INPUT.dueAt!);
    expect(PERSONA_SYSTEM_PROMPT).not.toContain("5 days");
  });

  it("shares the exact same system prompt with the celebrate pipeline", async () => {
    const gw = mockGateway("ok");
    await nudge(gw, STALE_INPUT);
    expect(gw.calls[0]!.system).toBe(PERSONA_SYSTEM_PROMPT);
  });
});

describe("nudge · clamping and empty output", () => {
  it("clamps over-long model output to the max message length", async () => {
    const gw = mockGateway("y".repeat(PERSONA_MESSAGE_MAX_CHARS + 1));
    const result = await nudge(gw, STALE_INPUT);

    expect(result.message).toHaveLength(PERSONA_MESSAGE_MAX_CHARS);
    expect(result.errors).toEqual([]);
  });

  it("rejects an empty output as message null + error", async () => {
    const result = await nudge(mockGateway(""), STALE_INPUT);

    expect(result.message).toBeNull();
    expect(result.errors).toEqual(["model returned an empty message"]);
    expect(result.usage).toEqual(FIXED_USAGE);
  });
});

describe("nudge · gateway failure (returned, never thrown)", () => {
  it("reports a transport failure as message null + errors", async () => {
    const result = await nudge(throwingGateway("boom: 429"), STALE_INPUT);

    expect(result.message).toBeNull();
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain("boom: 429");
    expect(result.usage).toBeNull();
  });

  it("never rejects the returned promise", async () => {
    const spy = vi.fn();
    await nudge(throwingGateway("x"), STALE_INPUT).then(spy);
    expect(spy).toHaveBeenCalledOnce();
  });
});
