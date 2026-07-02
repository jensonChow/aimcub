import { describe, expect, it } from "vitest";

import type { Goal, Memory } from "@core/types";
import { buildContextIntakeLoop, reviewContextIntakeProgress } from "@core/domain";

import {
  buildAimIntakeReport,
  contextIntakeSignalsFromPlanningToolEvents,
  planningContextReportsFromGoals,
  recordSedimentationAimContextForStore,
  recordSedimentationMemoryCandidatesForStore,
  selectPlanningContextForStore,
} from "./context-workflow";
import type { PlanningToolObservationEvent } from "./planning-tool-context";

const ownerId = "00000000-0000-4000-8000-000000000001";

function memory(overrides: Partial<Memory>): Memory {
  return {
    id: "10000000-0000-4000-8000-000000000001",
    owner_id: ownerId,
    goal_id: null,
    kind: "semantic",
    category: "project_fact",
    content: "Project fact: Aimcub uses TypeScript.",
    confidence: 1,
    source: "user_stated",
    status: "active",
    superseded_by: null,
    ...overrides,
  };
}

function goal(overrides: Partial<Goal>): Goal {
  return {
    id: "20000000-0000-4000-8000-000000000001",
    owner_id: ownerId,
    title: "Build a TypeScript CLI",
    description: "",
    domain: "software",
    status: "draft",
    target_date: null,
    plan_json: null,
    metadata: {},
    ...overrides,
  };
}

describe("context workflow", () => {
  it("turns planning tool observations into structured intake signals", () => {
    const events: PlanningToolObservationEvent[] = [
      {
        toolName: "local.scan_workspace",
        observation: {
          summary: "Scanned workspace.",
          data: {
            root: "/workspace/aimcub",
            fileCount: 42,
            directoryCount: 8,
            likelyProjectTypes: ["node", "typescript"],
            manifests: [{ path: "/workspace/aimcub/package.json", kind: "node-package" }],
            ignoredPatterns: ["node_modules/"],
            sensitivePathsExcluded: [],
          },
          sources: [{ kind: "workspace", path: "/workspace/aimcub" }],
        },
      },
      {
        toolName: "web.fetch",
        observation: {
          summary: "Fetched official docs.",
          data: {
            finalUrl: "https://example.com/docs",
            status: 200,
            title: "Official docs",
            text: "Use the official documentation as the current source of truth.",
            truncated: false,
          },
          sources: [{ kind: "web", url: "https://example.com/docs" }],
        },
      },
      {
        toolName: "context.distill",
        observation: {
          summary: "Distilled context.",
          data: {
            summary: "Relevant current docs and reusable preference.",
            usedSources: [],
            missingQuestions: [],
            durableMemoryCandidates: [{
              content: "Preference: Keep generated plans concise.",
              category: "preference",
              scope: "global",
            }],
          },
          sources: [],
        },
      },
      {
        toolName: "context.ask_user",
        observation: {
          summary: "Prepared one question.",
          data: {
            requestId: "ask-1",
            questions: [{
              id: "q1",
              question: "What evidence proves this aim is done?",
              category: "eval_signal",
              captureScope: "current_aim",
            }],
          },
          sources: [],
        },
      },
      {
        toolName: "memory.search",
        observation: {
          summary: "Selected planning memories.",
          data: {
            memories: [
              {
                id: "global-memory",
                content: "Constraint: Keep @core pure.",
                category: "constraint",
                kind: "semantic",
                scope: "global",
                confidence: 0.95,
              },
              {
                id: "old-aim-memory",
                content: "Project fact: Previous unrelated aim used SQLite.",
                category: "project_fact",
                kind: "semantic",
                scope: "related_aim",
                confidence: 0.9,
              },
            ],
          },
          sources: [{ kind: "memory", uri: "memory:global-memory" }],
        },
      },
    ];

    const signals = contextIntakeSignalsFromPlanningToolEvents(events);

    expect(signals).toEqual(expect.arrayContaining([
      expect.objectContaining({
        source: "tool_observation",
        toolName: "local.scan_workspace",
        channel: "local_workspace",
        category: "project_fact",
        scope: "aim",
        summary: expect.stringContaining("Workspace scan: /workspace/aimcub"),
      }),
      expect.objectContaining({
        source: "tool_observation",
        toolName: "web.fetch",
        channel: "web_research",
        category: "project_fact",
        scope: "aim",
        summary: expect.stringContaining("Official docs"),
      }),
      expect.objectContaining({
        source: "memory_candidate",
        toolName: "context.distill",
        category: "preference",
        scope: "global",
      }),
      expect.objectContaining({
        source: "user_request",
        toolName: "context.ask_user",
        channel: "questionnaire",
        category: "eval_signal",
        scope: "aim",
        questionId: "q1",
      }),
      expect.objectContaining({
        source: "tool_observation",
        toolName: "memory.search",
        channel: "personal_database",
        category: "constraint",
        scope: "global",
        questionId: "global-memory",
      }),
    ]));
    expect(signals.find((signal) => signal.questionId === "old-aim-memory")).toBeUndefined();

    const loop = buildContextIntakeLoop({
      readiness: "needs_targeted_context",
      acquisition: [
        {
          id: "acq_local",
          channel: "local_workspace",
          priority: "high",
          scope: "aim",
          categories: ["project_fact"],
          reason: "Local workspace should ground the aim.",
          action: "Scan local workspace.",
          suggestedTools: ["local.scan_workspace"],
          memoryTargets: [{ scope: "aim", kind: "semantic", categories: ["project_fact"] }],
        },
        {
          id: "acq_web",
          channel: "web_research",
          priority: "high",
          scope: "aim",
          categories: ["project_fact"],
          reason: "Current docs should ground the aim.",
          action: "Fetch current docs.",
          suggestedTools: ["web.search", "web.fetch"],
          memoryTargets: [{ scope: "aim", kind: "semantic", categories: ["project_fact"] }],
        },
      ],
    });
    const progress = reviewContextIntakeProgress({ loop, signals });

    expect(progress.steps).toEqual([
      expect.objectContaining({ channel: "local_workspace", status: "satisfied" }),
      expect.objectContaining({ channel: "web_research", status: "satisfied" }),
    ]);
  });

  it("selects planning context through a store-like port", async () => {
    const planning = await selectPlanningContextForStore(
      {
        async listMemories() {
          return [
            memory({
              id: "10000000-0000-4000-8000-000000000002",
              category: "constraint",
              content: "Constraint: Keep the CLI scriptable.",
            }),
            memory({
              id: "10000000-0000-4000-8000-000000000003",
              goal_id: "old-billing-goal",
              category: "project_fact",
              content: "The billing dashboard uses Stripe.",
            }),
          ];
        },
      },
      { title: "Build a scriptable CLI" },
    );

    expect(planning.sourceMemories).toHaveLength(2);
    expect(planning.memories.map((row) => row.content)).toEqual(["Constraint: Keep the CLI scriptable."]);
    expect(planning.report.ignored).toEqual([
      expect.objectContaining({ reason: "unrelated_goal_context" }),
    ]);
  });

  it("reads stored planning-context traces from goal metadata", () => {
    const traces = planningContextReportsFromGoals([
      goal({
        metadata: {
          planning_context: {
            selected: [{ content: "Constraint: Keep core pure.", category: "constraint", goalId: null }],
            ignored: [{ content: "Preference: low confidence", category: "preference", goalId: null }],
          },
        },
      }),
      goal({ id: "20000000-0000-4000-8000-000000000002", metadata: { planning_context: null } }),
    ]);

    expect(traces).toHaveLength(1);
    expect(traces[0]).toMatchObject({ total: 2, limit: 1 });
    expect(traces[0]!.selected[0]).toMatchObject({ content: "Constraint: Keep core pure." });
  });

  it("builds intake from both selected and source memories", async () => {
    const planning = await selectPlanningContextForStore(
      {
        async listMemories() {
          return [
            memory({
              category: "eval_signal",
              content: "Eval signal: Work is done only after tests and typecheck pass.",
            }),
          ];
        },
      },
      { title: "Ship a CLI command", description: "It should include tests." },
    );

    const intake = buildAimIntakeReport({
      title: "Ship a CLI command",
      description: "It should include tests.",
      planning,
    });

    expect(intake.coverage.profile.totalActive).toBe(1);
    expect(intake.coverage.selectedTotal).toBe(1);
    expect(intake.coverage.missingCoreCategories).not.toContain("eval_signal");
  });

  it("records sedimented durable context as global pending memory candidates", async () => {
    const calls: Array<{
      goalId?: string | null;
      content: string;
      kind?: Memory["kind"];
      category?: Memory["category"];
      source?: Memory["source"];
      confidence?: number;
    }> = [];

    const saved = await recordSedimentationMemoryCandidatesForStore(
      {
        async addMemoryCandidate(input) {
          calls.push(input);
          return memory({
            id: `10000000-0000-4000-8000-00000000000${calls.length + 3}`,
            goal_id: input.goalId ?? null,
            content: input.content,
            kind: input.kind ?? "semantic",
            category: input.category ?? "project_fact",
            source: input.source ?? "agent_inferred",
            confidence: input.confidence ?? 0.7,
            status: "pending",
          });
        },
      },
      {
        version: 1,
        readyForDecomposition: true,
        shouldIterate: false,
        aimContextCount: 1,
        durableMemoryCandidateCount: 2,
        aimContext: [{
          content: "Project fact: This context stays aim-local.",
          category: "project_fact",
          source: "distilled_context",
          reason: "Aim-local context collected for the current decomposition.",
        }],
        durableMemoryCandidates: [
          {
            content: "Constraint: Always cite official documentation before travel planning.",
            kind: "semantic",
            category: "constraint",
            source: "agent_inferred",
            confidence: 0.74,
            reason: "Durable constraint context collected during planning.",
          },
          {
            content: "Preference: Keep planning output concise.",
            kind: "semantic",
            category: "preference",
            source: "user_stated",
            confidence: 0.82,
            reason: "Durable preference context collected during planning.",
          },
        ],
        pendingSteps: [],
        nextActions: [],
      },
    );

    expect(calls).toEqual([
      expect.objectContaining({
        goalId: null,
        content: "Constraint: Always cite official documentation before travel planning.",
        category: "constraint",
        source: "agent_inferred",
        confidence: 0.74,
      }),
      expect.objectContaining({
        goalId: null,
        content: "Preference: Keep planning output concise.",
        category: "preference",
        source: "user_stated",
        confidence: 0.82,
      }),
    ]);
    expect(saved).toEqual([
      expect.objectContaining({
        status: "pending",
        goal_id: null,
        category: "constraint",
      }),
      expect.objectContaining({
        status: "pending",
        goal_id: null,
        category: "preference",
        source: "user_stated",
      }),
    ]);
  });

  it("records sedimented aim context as current-goal pending memory candidates", async () => {
    const calls: Array<{
      goalId?: string | null;
      content: string;
      kind?: Memory["kind"];
      category?: Memory["category"];
      source?: Memory["source"];
      confidence?: number;
    }> = [];
    const currentGoal = goal({ id: "20000000-0000-4000-8000-000000000099" });

    const saved = await recordSedimentationAimContextForStore(
      {
        async addMemoryCandidate(input) {
          calls.push(input);
          return memory({
            id: `30000000-0000-4000-8000-00000000000${calls.length}`,
            goal_id: input.goalId ?? null,
            content: input.content,
            kind: input.kind ?? "semantic",
            category: input.category ?? "project_fact",
            source: input.source ?? "agent_inferred",
            confidence: input.confidence ?? 0.7,
            status: "pending",
          });
        },
      },
      currentGoal,
      {
        version: 1,
        readyForDecomposition: true,
        shouldIterate: false,
        aimContextCount: 2,
        durableMemoryCandidateCount: 1,
        aimContext: [
          {
            content: "Project fact: Official visa page was fetched for this trip.",
            category: "project_fact",
            source: "tool_observation",
            reason: "Aim-scoped context collected through web_research.",
          },
          {
            content: "Procedure: Check passport validity before booking.",
            category: "procedure",
            source: "user_answer",
            reason: "Aim-scoped context collected through questionnaire.",
          },
        ],
        durableMemoryCandidates: [
          {
            content: "Preference: Keep travel plans concise.",
            kind: "semantic",
            category: "preference",
            source: "user_stated",
            confidence: 0.82,
            reason: "Durable preference context collected during planning.",
          },
        ],
        pendingSteps: [],
        nextActions: [],
      },
    );

    expect(calls).toEqual([
      expect.objectContaining({
        goalId: currentGoal.id,
        content: "Project fact: Official visa page was fetched for this trip.",
        kind: "semantic",
        category: "project_fact",
        source: "agent_inferred",
      }),
      expect.objectContaining({
        goalId: currentGoal.id,
        content: "Procedure: Check passport validity before booking.",
        kind: "procedural",
        category: "procedure",
        source: "user_stated",
        confidence: 0.82,
      }),
    ]);
    expect(saved.map((row) => [row.goal_id, row.status, row.category])).toEqual([
      [currentGoal.id, "pending", "project_fact"],
      [currentGoal.id, "pending", "procedure"],
    ]);
  });
});
