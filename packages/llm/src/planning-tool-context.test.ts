import { describe, expect, it } from "vitest";

import { createContextAskUserHandler } from "./context-ask-user";
import { createContextDistillHandler } from "./context-distill";
import { createContextLinkedSourcesHandler } from "./context-linked-sources";
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
      webQueryLimit: 1,
      memoryLimit: 10,
    });

    expect(result.failures).toEqual([]);
    expect(result.observations.map((observation) => observation.summary)).toEqual([
      "Selected 1 planning memory.",
      "Found 1 web result.",
      "Built research brief from 1 queries, 1 sources, and 0 fetched pages.",
      "Distilled planning tool observations into compact context.",
    ]);
    expect(result.observationEvents.map((event) => event.toolName)).toEqual([
      "memory.search",
      "web.search",
      "context.distill",
    ]);
    expect(result.memories.map((memory) => memory.content)).toEqual(expect.arrayContaining([
      "User prefers TypeScript for Aimcub tools.",
      "Web search result: Aimcub research — A first-party planning tool runtime. — Source: https://example.com/aimcub",
      expect.stringContaining("Research brief for aim: Build Aimcub tool registry"),
    ]));
    expect(result.research?.uncertainties).toContain("No source pages were fetched; findings rely on search snippets only.");
    expect(result.report.selected).toHaveLength(3);
    expect(result.distillation?.summary).toContain("User prefers TypeScript");
    expect(result.distillation?.summary).toContain("Aimcub research");
    expect(result.distillation?.durableMemoryCandidates).toEqual([]);
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
    expect(result.observationEvents.map((event) => event.toolName)).toEqual(["memory.search", "context.distill"]);
    expect(result.distillation?.missingQuestions.map((question) => question.id)).toContain("missing_eval_signal");
  });

  it("builds a research brief from multi-query search and fetched sources", async () => {
    const searchedQueries: string[] = [];
    const fetchedUrls: string[] = [];
    const registry = createAimcubToolRegistry({
      "memory.search": async () => ({
        ok: true,
        observation: {
          summary: "Selected 0 planning memories.",
          data: { memories: [] },
          sources: [],
        },
      }),
      "web.search": async (input) => {
        searchedQueries.push(input.query);
        const suffix = searchedQueries.length;
        return {
          ok: true,
          observation: {
            summary: "Found 2 web results.",
            data: {
              results: [
                { title: `Official guide ${suffix}`, url: `https://example.com/source-${suffix}`, snippet: `Official source ${suffix}.` },
                { title: "Duplicate overview", url: "https://example.com/shared", snippet: "Shared source." },
              ],
            },
            sources: [
              { kind: "web", url: `https://example.com/source-${suffix}` },
              { kind: "web", url: "https://example.com/shared" },
            ],
          },
        };
      },
      "web.fetch": async (input) => {
        fetchedUrls.push(input.url);
        return {
          ok: true,
          observation: {
            summary: `Fetched ${input.url}.`,
            data: {
              finalUrl: input.url,
              status: 200,
              title: input.url,
              text: `Detailed source text for ${input.url}.`,
              truncated: false,
            },
            sources: [{ kind: "web", url: input.url }],
          },
        };
      },
    });

    const result = await collectPlanningToolContext(
      registry,
      { ...context, permissions: ["memory.read", "network.search", "network.fetch"] },
      {
        title: "Research Cambodia travel basics",
        includeWeb: true,
        fetchWebResults: true,
        webQueryLimit: 2,
        webFetchLimit: 2,
      },
    );

    expect(result.failures).toEqual([]);
    expect(searchedQueries).toHaveLength(2);
    expect(fetchedUrls).toEqual(["https://example.com/source-1", "https://example.com/shared"]);
    expect(result.observationEvents.map((event) => event.toolName)).toEqual([
      "memory.search",
      "web.search",
      "web.search",
      "web.fetch",
      "web.fetch",
    ]);
    expect(result.research).toMatchObject({
      searchResultCount: 4,
      fetchedSourceCount: 2,
    });
    expect(result.research?.queries).toEqual(searchedQueries);
    expect(result.research?.findings.join("\n")).toContain("Detailed source text");
    expect(result.observations.map((observation) => observation.summary)).toContain(
      "Built research brief from 2 queries, 3 sources, and 2 fetched pages.",
    );
    expect(result.memories.map((memory) => memory.source)).toEqual(expect.arrayContaining([
      "web.search",
      "web.fetch",
      "web.research",
    ]));
  });

  it("turns distilled missing context into structured user requests when enabled", async () => {
    const registry = createAimcubToolRegistry({
      "memory.search": async () => ({
        ok: true,
        observation: {
          summary: "Selected 0 planning memories.",
          data: { memories: [] },
          sources: [],
        },
      }),
      "context.distill": createContextDistillHandler(),
      "context.ask_user": createContextAskUserHandler(),
    });

    const result = await collectPlanningToolContext(
      registry,
      { ...context, permissions: ["memory.read", "context.distill", "user.ask"] },
      {
        title: "Build Aimcub tool registry",
        askMissingQuestions: true,
      },
    );

    expect(result.failures).toEqual([]);
    expect(result.observationEvents.map((event) => event.toolName)).toEqual([
      "memory.search",
      "context.distill",
      "context.ask_user",
    ]);
    expect(result.observations.at(-1)).toMatchObject({
      summary: "Prepared 2 user context questions.",
      data: {
        questions: [
          expect.objectContaining({ id: "missing_planning_context", captureScope: "current_aim" }),
          expect.objectContaining({ id: "missing_eval_signal", captureScope: "current_aim" }),
        ],
      },
    });
  });

  it("records linked context sources and reads explicitly attached local files", async () => {
    const registry = createAimcubToolRegistry({
      "context.linked_sources": createContextLinkedSourcesHandler(),
      "memory.search": async () => ({
        ok: true,
        observation: {
          summary: "Selected 0 planning memories.",
          data: { memories: [] },
          sources: [],
        },
      }),
      "local.read": async (input) => ({
        ok: true,
        observation: {
          summary: `Read attached file ${input.path}.`,
          data: {
            path: input.path,
            lines: [
              { line: 1, text: "# Tarot app notes" },
              { line: 2, text: "User has beginner tarot knowledge and needs App Store distribution." },
            ],
            truncated: false,
            byteLength: 96,
          },
          sources: [{ kind: "file", path: input.path }],
        },
      }),
      "context.distill": createContextDistillHandler(),
    });

    const result = await collectPlanningToolContext(
      registry,
      {
        ...context,
        workspaceRoot: "/workspace/app",
        permissions: ["context.source", "memory.read", "filesystem.read", "context.distill"],
      },
      {
        title: "Develop a tarot app",
        includeLocal: true,
        localFilePaths: ["/workspace/app/docs/tarot.md"],
        linkedSources: [
          {
            id: "workspace",
            kind: "local_folder",
            label: "Workspace",
            enabled: true,
            status: "available",
            path: "/workspace/app",
          },
          {
            id: "notion",
            kind: "notion",
            label: "Product wiki",
            enabled: true,
            status: "needs_connector",
            uri: "notion://workspace/product",
          },
        ],
      },
    );

    expect(result.failures).toEqual([]);
    expect(result.observationEvents.map((event) => event.toolName)).toEqual([
      "context.linked_sources",
      "memory.search",
      "local.read",
      "context.distill",
    ]);
    expect(result.memories.map((memory) => memory.source)).toEqual(expect.arrayContaining([
      "context.linked_sources",
      "local.read",
    ]));
    expect(result.memories.find((memory) => memory.source === "context.linked_sources")?.content).toContain("Product wiki");
    expect(result.memories.find((memory) => memory.source === "local.read")?.content).toContain("beginner tarot knowledge");
    expect(result.distillation?.summary).toContain("linked sources");
    expect(result.distillation?.missingQuestions.map((question) => question.id)).toContain("missing_connector_access");
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
      "local.read": async (input) => ({
        ok: true,
        observation: {
          summary: "Read 6 lines from package.json.",
          data: {
            path: input.path,
            lines: [
              { line: 1, text: "{" },
              { line: 2, text: '  "name": "aimcub",' },
              { line: 3, text: '  "scripts": {' },
              { line: 4, text: '    "test": "vitest run",' },
              { line: 5, text: '    "build": "tsc -p tsconfig.json"' },
              { line: 6, text: "  }" },
            ],
            truncated: false,
            byteLength: 120,
          },
          sources: [{ kind: "file", path: input.path }],
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
    expect(result.observationEvents.map((event) => event.toolName)).toEqual([
      "memory.search",
      "local.scan_workspace",
      "local.read",
      "context.distill",
    ]);
    expect(result.memories.map((memory) => memory.source)).toContain("local.scan_workspace");
    expect(result.memories.map((memory) => memory.source)).toContain("local.read");
    expect(result.memories.find((memory) => memory.source === "local.scan_workspace")?.content).toContain("Workspace scan: /workspace/aimcub");
    expect(result.memories.find((memory) => memory.source === "local.read")?.content).toContain('"name": "aimcub"');
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
    expect(result.memories).toEqual(expect.arrayContaining([
      expect.objectContaining({
        source: "context.distill",
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
