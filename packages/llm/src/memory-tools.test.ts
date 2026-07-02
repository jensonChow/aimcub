import { describe, expect, it } from "vitest";

import { createMemorySearchHandler, createMemoryWriteCandidateHandler } from "./memory-tools";
import type { AimcubToolHandlerContext } from "./tool-contract";
import type { Memory } from "@core/types";

const context: AimcubToolHandlerContext = {
  now: () => new Date("2026-07-02T00:00:00.000Z"),
  permissions: ["memory.read", "memory.write_candidate"],
};

function memory(input: Partial<Memory> & Pick<Memory, "id" | "content" | "goal_id">): Memory {
  return {
    owner_id: "owner-1",
    kind: "semantic",
    category: "project_fact",
    confidence: 0.9,
    source: "user_stated",
    status: "active",
    superseded_by: null,
    created_at: "2026-07-02T00:00:00.000Z",
    ...input,
  };
}

describe("memory.search handler", () => {
  it("requires memory.read permission", async () => {
    const handler = createMemorySearchHandler({ async listMemories() { return []; } });

    const result = await handler({ query: "Aimcub" }, { ...context, permissions: [] });

    expect(result).toMatchObject({
      ok: false,
      error: { code: "permission_denied", retryable: false },
    });
  });

  it("selects planning memories and preserves aim scope", async () => {
    const handler = createMemorySearchHandler({
      async listMemories() {
        return [
          memory({
            id: "global",
            goal_id: null,
            category: "preference",
            content: "User prefers TypeScript for Aimcub tools.",
          }),
          memory({
            id: "current",
            goal_id: "aim-1",
            category: "eval_signal",
            content: "Aimcub is done when pnpm test passes.",
          }),
          memory({
            id: "related",
            goal_id: "aim-2",
            category: "procedure",
            content: "For tools registry releases, run pnpm build before shipping.",
          }),
        ];
      },
    });

    const result = await handler({ query: "Aimcub tools", aimId: "aim-1", scope: "both", limit: 10 }, context);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.observation.data.memories.map((row) => [row.id, row.scope, row.goalId])).toEqual([
      ["current", "current_aim", "aim-1"],
      ["global", "global", undefined],
      ["related", "related_aim", "aim-2"],
    ]);
    expect(result.observation.sources.map((source) => source.uri)).toEqual([
      "memory:current",
      "memory:global",
      "memory:related",
    ]);
  });

  it("honors current_aim scope", async () => {
    const handler = createMemorySearchHandler({
      async listMemories() {
        return [
          memory({ id: "global", goal_id: null, content: "Global Aimcub fact." }),
          memory({ id: "current", goal_id: "aim-1", content: "Current Aimcub fact." }),
        ];
      },
    });

    const result = await handler({ query: "Aimcub", aimId: "aim-1", scope: "current_aim" }, context);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.observation.data.memories.map((row) => row.id)).toEqual(["current"]);
  });
});

describe("memory.write_candidate handler", () => {
  it("creates pending memory candidates through the injected store", async () => {
    const handler = createMemoryWriteCandidateHandler({
      async addMemoryCandidate(input) {
        return memory({
          id: "candidate-1",
          goal_id: input.goalId ?? null,
          content: input.content,
          category: input.category ?? "project_fact",
          status: "pending",
          source: input.source ?? "agent_inferred",
        });
      },
    });

    const result = await handler({
      content: "User prefers agent-visible process traces.",
      category: "preference",
      scope: "global",
    }, context);

    expect(result).toMatchObject({
      ok: true,
      observation: {
        data: { candidateId: "candidate-1", status: "pending" },
      },
    });
  });
});
