import { describe, expect, it } from "vitest";

import type { Goal, Memory, Milestone } from "@core/types";
import { contextCaptureFulfillmentFromLineage, reviewContextLineage, summarizeContextLineageLearning } from "./context-lineage";
import { summarizeContextCaptureLearning } from "./context-capture";

describe("reviewContextLineage", () => {
  it("links capture questions to their origin milestone, memory, impact, and pending context", () => {
    const goal = {
      id: "10000000-0000-4000-8000-000000000000",
      title: "Improve the CLI",
      metadata: {
        clarify_answer_impact: {
          version: 1,
          answered_count: 1,
          impacted_count: 1,
          changed_node_count: 1,
          quality_delta: [],
          rows: [
            {
              question_id: "proof",
              question: "What proves this milestone is complete?",
              answer: "pnpm test passes",
              kind: "scope",
              source_dimension: "verifiability",
              memory_category: "eval_signal",
              memory_content: "Eval signal: pnpm test passes.",
              affected_node_keys: ["m1"],
              signals: ["quality_dimension_improved", "acceptance_rule_changed"],
            },
          ],
        },
        context_capture_fulfillment: {
          version: 1,
          total: 2,
          answeredCount: 2,
          memoryCapturedCount: 1,
          impactedCount: 1,
          rows: [
            {
              questionId: "proof",
              question: "What proves this milestone is complete?",
              capture: {
                category: "eval_signal",
                scope: "global",
                purpose: "define_eval",
                improvesDimension: "verifiability",
                reason: "clarify_verifiability",
                origin: {
                  source: "review_gap",
                  reason: "missing_contract_eval_signal",
                  prompt: "What proves this milestone is complete?",
                  gapSource: "decomposition_contract",
                  nodeKey: "m1",
                  nodeTitle: "Scaffold CLI",
                  roiScore: 88,
                  roiSignals: ["high_priority", "decomposition_contract", "node_specific", "eval_signal"],
                  issueCodes: ["missing_contract_eval_signal"],
                },
              },
              answer: "pnpm test passes",
              answered: true,
              memoryCaptured: true,
              impactedPlan: true,
              affectedNodeKeys: ["m1"],
              signals: ["quality_dimension_improved"],
              status: "captured_and_impacted",
            },
            {
              questionId: "workflow",
              question: "Which release checklist should this follow?",
              capture: {
                category: "procedure",
                scope: "aim",
                purpose: "document_procedure",
                improvesDimension: "context_fit",
                reason: "clarify_context_fit",
              },
              answer: "Use the release checklist",
              answered: true,
              memoryCaptured: false,
              impactedPlan: false,
              affectedNodeKeys: [],
              signals: [],
              status: "answered_without_memory",
            },
          ],
        },
      },
    } as unknown as Goal;
    const milestones = [
      {
        id: "20000000-0000-4000-8000-000000000000",
        title: "Scaffold CLI",
        status: "pending",
        metadata: {
          plan_key: "m1",
          decomposition_contract: {
            why: "Users need a runnable CLI surface.",
            definition_of_done: "CLI command runs and prints help.",
            required_evidence: ["pnpm test passes"],
            likely_owner: "agent",
            context_gaps: [],
            eval_signal: "Automated test proves the command works.",
          },
        },
      },
    ] as Pick<Milestone, "id" | "title" | "status" | "metadata">[];
    const pendingContext = [
      {
        id: "30000000-0000-4000-8000-000000000000",
        goal_id: goal.id,
        content: "Procedure: Use the release checklist.",
        category: "procedure",
        source: "agent_inferred",
        confidence: 0.75,
        status: "pending",
      },
    ] as Pick<Memory, "id" | "goal_id" | "content" | "category" | "source" | "confidence" | "status">[];

    const report = reviewContextLineage({ goal, milestones, pendingContext });

    expect(report).toMatchObject({
      version: 1,
      goalId: goal.id,
      total: 2,
      answeredCount: 2,
      memoryCapturedCount: 1,
      impactedCount: 1,
      pendingContextCount: 1,
      acceptedContextCount: 0,
      rejectedContextCount: 0,
      deprioritizedContextCount: 0,
    });
    expect(report.rows[0]).toMatchObject({
      questionId: "proof",
      category: "eval_signal",
      captureStatus: "captured_and_impacted",
      source: "review_gap",
      memoryContent: "Eval signal: pnpm test passes.",
      originNode: {
        key: "m1",
        title: "Scaffold CLI",
        milestoneId: "20000000-0000-4000-8000-000000000000",
        contract: {
          definition_of_done: "CLI command runs and prints help.",
          eval_signal: "Automated test proves the command works.",
        },
      },
      affectedNodes: [
        {
          key: "m1",
          title: "Scaffold CLI",
        },
      ],
    });
    expect(report.rows[0]!.signals).toEqual(expect.arrayContaining([
      "quality_dimension_improved",
      "acceptance_rule_changed",
      "decomposition_contract",
      "missing_contract_eval_signal",
    ]));
    expect(report.rows[1]).toMatchObject({
      questionId: "workflow",
      captureStatus: "answered_without_memory",
      pendingContext: [
        {
          content: "Procedure: Use the release checklist.",
          source: "agent_inferred",
        },
      ],
      contextOutcomes: [
        {
          content: "Procedure: Use the release checklist.",
          status: "pending",
        },
      ],
      nextAction: "Turn the answer into durable memory so future aims can reuse it.",
    });
    expect(report.nextActions).toEqual(expect.arrayContaining([
      "Promote 1 answered context item into durable memory.",
      "Review 1 pending context candidate linked to this aim.",
    ]));

    const learning = summarizeContextLineageLearning([report]);
    expect(learning).toMatchObject({
      totalQuestions: 2,
      totalAnswered: 2,
      totalCaptured: 1,
      totalImpacted: 1,
      totalPending: 1,
      totalAccepted: 0,
      totalRejected: 0,
      totalDeprioritized: 0,
    });
    expect(learning.rows.find((row) => row.category === "eval_signal")).toMatchObject({
      source: "review_gap",
      gapSource: "decomposition_contract",
      recommendation: "reuse_pattern",
      exampleNodeTitle: "Scaffold CLI",
      signals: expect.arrayContaining(["quality_dimension_improved", "missing_contract_eval_signal"]),
    });
    expect(learning.rows.find((row) => row.category === "procedure")).toMatchObject({
      source: "unknown",
      recommendation: "resolve_pending",
      pendingContextCount: 1,
    });
    expect(learning.guidance.join("\n")).toContain("Reuse eval-signal verifiability questions");
    expect(learning.guidance.join("\n")).toContain("Resolve pending procedure context");
  });

  it("learns from accepted, rejected, and deprioritized context outcomes", () => {
    const goal = {
      id: "10000000-0000-4000-8000-000000000001",
      title: "Ship CLI context",
      metadata: {
        context_capture_fulfillment: {
          version: 1,
          total: 3,
          answeredCount: 3,
          memoryCapturedCount: 0,
          impactedCount: 0,
          rows: [
            {
              questionId: "workflow",
              question: "Which release workflow should this follow?",
              capture: {
                category: "procedure",
                scope: "aim",
                purpose: "document_procedure",
                improvesDimension: "verifiability",
                reason: "clarify_verifiability",
              },
              answer: "Run pnpm test before release",
              answered: true,
              memoryCaptured: false,
              impactedPlan: false,
              affectedNodeKeys: [],
              signals: [],
              status: "answered_without_memory",
            },
            {
              questionId: "budget",
              question: "What hard budget constrains this?",
              capture: {
                category: "constraint",
                scope: "global",
                purpose: "shape_plan",
                improvesDimension: "granularity",
                reason: "clarify_granularity",
              },
              answer: "No budget constraint",
              answered: true,
              memoryCaptured: false,
              impactedPlan: false,
              affectedNodeKeys: [],
              signals: [],
              status: "answered_without_memory",
            },
            {
              questionId: "deadline",
              question: "What deadline constrains this?",
              capture: {
                category: "constraint",
                scope: "global",
                purpose: "shape_plan",
                improvesDimension: "granularity",
                reason: "clarify_granularity",
              },
              answer: "No deadline constraint",
              answered: true,
              memoryCaptured: false,
              impactedPlan: false,
              affectedNodeKeys: [],
              signals: [],
              status: "answered_without_memory",
            },
          ],
        },
      },
    } as unknown as Goal;
    const contextOutcomes = [
      {
        id: "30000000-0000-4000-8000-000000000001",
        goal_id: goal.id,
        content: "Procedure: Run pnpm test before release.",
        category: "procedure",
        source: "user_stated",
        confidence: 0.95,
        status: "active",
        superseded_by: null,
      },
      {
        id: "30000000-0000-4000-8000-000000000002",
        goal_id: goal.id,
        content: "Constraint: No budget constraint.",
        category: "constraint",
        source: "agent_inferred",
        confidence: 0.7,
        status: "deleted",
        superseded_by: null,
      },
      {
        id: "30000000-0000-4000-8000-000000000003",
        goal_id: goal.id,
        content: "Constraint: No deadline constraint.",
        category: "constraint",
        source: "agent_inferred",
        confidence: 0.3,
        status: "deprioritized",
        superseded_by: null,
      },
    ] as Pick<Memory, "id" | "goal_id" | "content" | "category" | "source" | "confidence" | "status" | "superseded_by">[];

    const report = reviewContextLineage({ goal, contextOutcomes });
    const fulfillment = contextCaptureFulfillmentFromLineage(report);

    expect(report).toMatchObject({
      memoryCapturedCount: 1,
      acceptedContextCount: 1,
      rejectedContextCount: 1,
      deprioritizedContextCount: 1,
    });
    expect(report.rows.find((row) => row.questionId === "workflow")).toMatchObject({
      memoryCaptured: true,
      memoryContent: "Procedure: Run pnpm test before release.",
      acceptedContextCount: 1,
      nextAction: "Reuse the accepted context, but check whether it should change future milestone contracts.",
    });
    expect(report.rows.find((row) => row.questionId === "budget")).toMatchObject({
      rejectedContextCount: 1,
      nextAction: "Rephrase or stop asking this context pattern because the user rejected or deprioritized its candidate.",
    });
    expect(fulfillment).toMatchObject({
      total: 3,
      answeredCount: 3,
      memoryCapturedCount: 1,
    });
    expect(fulfillment?.rows[0]).toMatchObject({
      questionId: "workflow",
      capture: {
        scope: "aim",
        category: "procedure",
      },
      memoryCaptured: true,
      status: "captured",
    });

    const learning = summarizeContextLineageLearning([report]);
    const captureLearning = summarizeContextCaptureLearning([fulfillment]);
    expect(learning).toMatchObject({
      totalCaptured: 1,
      totalAccepted: 1,
      totalRejected: 1,
      totalDeprioritized: 1,
    });
    expect(learning.rows.find((row) => row.category === "procedure")).toMatchObject({
      memoryCapturedCount: 1,
      acceptedContextCount: 1,
    });
    expect(learning.rows.find((row) => row.category === "constraint")).toMatchObject({
      rejectedContextCount: 1,
      deprioritizedContextCount: 1,
      recommendation: "fix_capture",
    });
    expect(learning.guidance.join("\n")).toContain("rejected or deprioritized");
    expect(captureLearning.rows.find((row) => row.category === "procedure")).toMatchObject({
      memoryCapturedCount: 1,
      recommendation: "ask_selectively",
    });
  });
});
