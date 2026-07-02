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

  it("collects local workspace scans into planning context", async () => {
    const registry = createAimcubToolRegistry({
      "memory.search": async () => ({
        ok: true,
        observation: {
          summary: "Selected 0 planning memories.",
          data: { memories: [] },
          sources: [],
        },
      }),
      "local.scan_workspace": async () => ({
        ok: true,
        observation: {
          summary: "Scanned workspace .: 12 files, 3 directories.",
          data: {
            root: "/workspace/aimcub",
            fileCount: 12,
            directoryCount: 3,
            likelyProjectTypes: ["node", "typescript"],
            manifests: [{ path: "/workspace/aimcub/package.json", kind: "node-package" }],
            ignoredPatterns: ["node_modules/"],
            sensitivePathsExcluded: [".env"],
          },
          sources: [{ kind: "workspace", path: "/workspace/aimcub" }],
        },
      }),
      "context.distill": createContextDistillHandler(),
    });

    const result = await collectPlanningToolContext(
      registry,
      { ...context, workspaceRoot: "/workspace/aimcub", permissions: ["memory.read", "filesystem.read", "context.distill"] },
      {
        title: "Use project files to plan Aimcub work",
        includeLocal: true,
        workspaceRoot: "/workspace/aimcub",
      },
    );

    expect(result.failures).toEqual([]);
    expect(result.memories.map((memory) => memory.source)).toContain("local.scan_workspace");
    expect(result.memories[0]?.content).toContain("Workspace scan: /workspace/aimcub");
    expect(result.distillation?.summary).toContain("workspace");
  });

  it("writes distilled current-aim memory candidates when explicitly enabled", async () => {
    const writes: Array<{ content: string; category: string; scope: string; aimId?: string }> = [];
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
              snippet: "Current visa requirements and travel basics.",
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
            text: "Travelers should check visa, passport validity, local transport, and health guidance before departure.",
            truncated: false,
          },
          sources: [{ kind: "web", url: "https://example.com/cambodia-visa" }],
        },
      }),
      "context.distill": createContextDistillHandler(),
      "memory.write_candidate": async (input) => {
        writes.push({
          content: input.content,
          category: input.category,
          scope: input.scope,
          aimId: input.aimId,
        });
        return {
          ok: true,
          observation: {
            summary: "Created a pending memory candidate.",
            data: { candidateId: `candidate-${writes.length}`, status: "pending" },
            sources: [{ kind: "memory", uri: `memory:candidate-${writes.length}` }],
          },
        };
      },
    });

    const result = await collectPlanningToolContext(
      registry,
      {
        ...context,
        aimId: "aim-1",
        permissions: ["memory.read", "network.search", "network.fetch", "context.distill", "memory.write_candidate"],
      },
      {
        title: "Plan a Cambodia trip",
        currentAimId: "aim-1",
        includeWeb: true,
        fetchWebResults: true,
        writeDistilledMemoryCandidates: true,
      },
    );

    expect(result.failures).toEqual([]);
    expect(result.distillation?.durableMemoryCandidates).toEqual(expect.arrayContaining([
      expect.objectContaining({
        scope: "current_aim",
        category: "project_fact",
        content: expect.stringContaining("Cambodia visa guidance"),
      }),
    ]));
    expect(writes.length).toBeGreaterThan(0);
    expect(writes[0]).toMatchObject({
      category: "project_fact",
      scope: "current_aim",
      aimId: "aim-1",
    });
    expect(result.observations.map((observation) => observation.summary)).toContain("Created a pending memory candidate.");
  });
});
