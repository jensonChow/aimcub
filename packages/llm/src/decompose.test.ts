import { describe, expect, it, vi } from "vitest";

import { decompose, type DecomposeInput } from "./decompose";
import type { LlmGateway, LlmRequest, LlmResponse, LlmUsage } from "./index";

// ──────────────────────────────────────────────────────────────────────────
// Mock gateway: no network. `completeStructured` returns whatever canned JSON
// the test queues, plus a fixed usage record so we can assert metering passthrough.
// ──────────────────────────────────────────────────────────────────────────

const FIXED_USAGE: LlmUsage = {
  model: "claude-sonnet-4-6",
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
        rarity: "uncommon",
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
        rarity: "common",
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
    expect(call.prompt).toContain(INPUT.title);
  });

  it("applies zod defaults and fills domain when omitted from input", async () => {
    const plan = validPlan();
    const gw = mockGateway(plan);
    const result = await decompose(gw, { title: "Just a title" });

    expect(result.validation.ok).toBe(true);
    // The user prompt should default the domain to `software`.
    expect((gw.calls[0] as LlmRequest).prompt).toContain("software");
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
