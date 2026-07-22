import { describe, expect, it } from "vitest";

import type { Goal, Memory } from "@aimcub/types";
import { reviewAimLearning } from "./aim-learning";

const goal = {
  id: "11111111-1111-4111-8111-111111111111",
  title: "Ship Aimcub context flow",
  metadata: {
    aim_intake: {
      title: "Ship Aimcub context flow",
      readiness: "needs_targeted_context",
      score: 64,
      coverage: {
        missingCoreCategories: ["eval_signal", "procedure"],
      },
      questions: [
        {
          id: "intake_1",
          category: "eval_signal",
          priority: "high",
          source: "context_profile",
          reason: "profile_missing",
          prompt: "Ask what would make this aim count as genuinely complete.",
        },
      ],
      nextActions: [],
    },
    plan_review: {
      quality: { grade: "warn", score: 90, issues: [] },
      context: {
        gaps: [
          {
            category: "procedure",
            priority: "medium",
            reason: "missing_proven_workflow",
            prompt: "Ask whether there is an existing verification command.",
          },
        ],
      },
    },
    clarify_answer_impact: {
      version: 1,
      answered_count: 1,
      impacted_count: 1,
      changed_node_count: 1,
      quality_delta: [],
      rows: [
        {
          question_id: "proof",
          question: "What proves this is complete?",
          answer: "Passing full gates",
          kind: "scope",
          source_dimension: "verifiability",
          memory_category: "eval_signal",
          memory_content: "Eval signal: Passing full gates proves this kind of aim is complete.",
          affected_node_keys: ["m1"],
          signals: ["quality_dimension_improved"],
        },
      ],
    },
  },
} as unknown as Pick<Goal, "id" | "title" | "metadata">;

const pendingContext = [
  {
    id: "22222222-0000-4000-8000-000000000001",
    owner_id: "owner",
    goal_id: goal.id,
    content: "Procedure: Run pnpm build && pnpm test before done.",
    kind: "procedural",
    category: "procedure",
    source: "agent_inferred",
    confidence: 0.6,
    status: "pending",
    superseded_by: null,
  },
] as unknown as Memory[];

describe("reviewAimLearning", () => {
  it("summarizes learned context, pending candidates, and unresolved gaps", () => {
    const report = reviewAimLearning({ goal, pendingContext });

    expect(report.intake).toMatchObject({
      readiness: "needs_targeted_context",
      score: 64,
      missingCoreCategories: ["eval_signal", "procedure"],
      questionCount: 1,
    });
    expect(report.clarify).toMatchObject({
      answeredCount: 1,
      impactedCount: 1,
      changedNodeCount: 1,
    });
    expect(report.learnedCount).toBe(1);
    expect(report.pendingContextCount).toBe(1);
    expect(report.gapCount).toBe(2);
    expect(report.rows.map((row) => row.source)).toEqual([
      "clarify_answer",
      "pending_context",
      "intake_gap",
      "review_gap",
    ]);
    expect(report.rows[0]).toMatchObject({
      status: "learned",
      category: "eval_signal",
      reason: "answer_changed_plan",
    });
    expect(report.nextActions).toContain("Review 1 pending context candidate from this aim.");
    expect(report.nextActions).toContain("Capture missing core context: eval_signal, procedure.");
  });

  it("stays useful when no learning metadata exists yet", () => {
    const report = reviewAimLearning({
      goal: { id: goal.id, title: goal.title, metadata: {} },
      pendingContext: [],
    });

    expect(report.intake).toBeNull();
    expect(report.clarify).toBeNull();
    expect(report.rows).toEqual([]);
    expect(report.nextActions).toEqual([
      "No reusable context signal was recorded yet; completion evidence should seed learning for this aim.",
    ]);
  });

  it("turns reviewed context outcomes into aim learning rows", () => {
    const contextOutcomes = [
      {
        ...pendingContext[0]!,
        id: "22222222-0000-4000-8000-000000000002",
        content: "Eval signal: passing full gates means this aim is done.",
        category: "eval_signal",
        status: "active",
        superseded_by: null,
      },
      {
        ...pendingContext[0]!,
        id: "22222222-0000-4000-8000-000000000003",
        content: "Procedure: run the repo verification ladder before claiming done.",
        category: "procedure",
        status: "deleted",
        superseded_by: "33333333-0000-4000-8000-000000000001",
      },
      {
        ...pendingContext[0]!,
        id: "22222222-0000-4000-8000-000000000004",
        content: "Preference: ask decorative landing-page questions first.",
        category: "preference",
        status: "deleted",
        superseded_by: null,
      },
      {
        ...pendingContext[0]!,
        id: "22222222-0000-4000-8000-000000000005",
        content: "Constraint: prefer slow manual reporting over automated checks.",
        category: "constraint",
        status: "deprioritized",
        superseded_by: null,
      },
      {
        ...pendingContext[0]!,
        id: "22222222-0000-4000-8000-000000000006",
        goal_id: "44444444-4444-4444-8444-444444444444",
        content: "Project fact: belongs to a different aim.",
        category: "project_fact",
        status: "active",
        superseded_by: null,
      },
    ] as unknown as Memory[];

    const report = reviewAimLearning({
      goal: { id: goal.id, title: goal.title, metadata: {} },
      contextOutcomes,
    });

    expect(report.learnedCount).toBe(2);
    expect(report.pendingContextCount).toBe(0);
    expect(report.gapCount).toBe(2);
    expect(report.rows.map((row) => row.reason)).toEqual([
      "context_accepted",
      "context_accepted_as_duplicate",
      "context_rejected",
      "context_deprioritized",
    ]);
    expect(report.rows.every((row) => row.source === "reviewed_context")).toBe(true);
  });
});
