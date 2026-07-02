import { describe, expect, it } from "vitest";

import { createContextDistillHandler } from "./context-distill";
import { collectPlanningToolContext } from "./planning-tool-context";
import { createAimcubToolRegistry } from "./tool-registry";
import type { AimcubToolHandlerContext } from "./tool-contract";

const context: AimcubToolHandlerContext = {
  now: () => new Date("2026-07-02T00:00:00.000Z"),
  permissions: ["memory.read", "network.search", "context.distill"],
};

describe("planning tool context collector", () => {
  it("collects registry observations into planning memories", async () => {
    const registry = createAimcubToolRegistry({
      "memory.search": async () => ({
        ok: true,
        observation: {
          summary: "Selected 1 planning memory.",
          data: {
            memories: [{
              id: "memory-1",
              content: "User prefers TypeScript for Aimcub tools.",
              category: "preference",
              kind: "semantic",
              scope: "global",
              confidence: 0.95,
            }],
          },
          sources: [{ kind: "memory", uri: "memory:memory-1" }],
        },
      }),
      "web.search": async () => ({
        ok: true,
        observation: {
          summary: "Found 1 web result.",
          data: {
            results: [{
              title: "Aimcub research",
              url: "https://example.com/aimcub",
              snippet: "A first-party planning tool runtime.",
            }],
          },
          sources: [{ kind: "web", url: "https://example.com/aimcub" }],
        },
      }),
      "context.distill": createContextDistillHandler(),
    });

    const result = await collectPlanningToolContext(registry, context, {
      title: "Build Aimcub tool registry",
      includeWeb: true,
      memoryLimit: 10,
    });

    expect(result.failures).toEqual([]);
    expect(result.observations.map((observation) => observation.summary)).toEqual([
      "Selected 1 planning memory.",
      "Found 1 web result.",
      "Distilled planning tool observations into compact context.",
    ]);
    expect(result.memories.map((memory) => memory.content)).toEqual([
      "User prefers TypeScript for Aimcub tools.",
      "Web search result: Aimcub research — A first-party planning tool runtime. — Source: https://example.com/aimcub",
    ]);
    expect(result.report.selected).toHaveLength(2);
    expect(result.distillation?.summary).toContain("User prefers TypeScript");
    expect(result.distillation?.summary).toContain("Aimcub research");
  });

  it("records tool failures without blocking local context", async () => {
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
        ok: false,
        error: { code: "disabled", message: "No provider.", retryable: false },
      }),
      "context.distill": createContextDistillHandler(),
    });

    const result = await collectPlanningToolContext(registry, context, {
      title: "Build Aimcub tool registry",
      includeWeb: true,
    });

    expect(result.memories).toEqual([]);
    expect(result.failures).toEqual([
      { toolName: "web.search", error: { code: "disabled", message: "No provider.", retryable: false } },
    ]);
    expect(result.distillation?.missingQuestions.map((question) => question.id)).toContain("missing_eval_signal");
  });
});
