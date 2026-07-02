import { describe, expect, it } from "vitest";

import type { Goal, Memory } from "@core/types";

import {
  buildAimIntakeReport,
  planningContextReportsFromGoals,
  selectPlanningContextForStore,
} from "./context-workflow";

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
});
