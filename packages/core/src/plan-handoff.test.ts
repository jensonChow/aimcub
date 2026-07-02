import { describe, expect, it } from "vitest";

import type { AcceptanceRule, DecompositionOutput, DecompositionOwner, PlanNode } from "@core/types";

import { buildPlanHandoffReport } from "./plan-handoff";

function commitRule(mode: AcceptanceRule["completion_mode"] = "auto_then_confirm"): AcceptanceRule {
  return {
    logic: "all",
    threshold: 1,
    completion_mode: mode,
    clauses: [
      {
        evaluator: "commit_pattern",
        auto_verifiable: true,
        match: { path_glob: "packages/core/**", min_files: 1, message_pattern: "handoff" },
      },
    ],
  };
}

function manualRule(): AcceptanceRule {
  return {
    logic: "all",
    threshold: 1,
    completion_mode: "manual",
    clauses: [{ evaluator: "manual_confirm", auto_verifiable: false, match: {} }],
  };
}

function node(
  key: string,
  owner: DecompositionOwner,
  overrides: Partial<PlanNode> = {},
): PlanNode {
  return {
    key,
    title: `${key} task`,
    description: `Deliver ${key}.`,
    est_effort: "s",
    xp_reward: 10,
    acceptance_rule: commitRule(),
    decomposition_contract: {
      why: `${key} is a separately verifiable step.`,
      definition_of_done: `${key} is delivered and reviewable.`,
      required_evidence: [`Evidence for ${key}.`],
      likely_owner: owner,
      context_gaps: [],
      eval_signal: `${key} meets the aim-specific standard.`,
    },
    ...overrides,
  };
}

describe("buildPlanHandoffReport", () => {
  it("marks agent-owned digital milestones as agent-ready handoff tasks", () => {
    const plan: DecompositionOutput = {
      goal_summary: "Ship handoff routing.",
      domain: "software",
      rationale: "Agent-ready work should be explicit.",
      nodes: [
        node("context", "agent"),
        node("verify", "agent", { acceptance_rule: {
          logic: "all",
          threshold: 1,
          completion_mode: "auto",
          clauses: [{ evaluator: "ci_status", auto_verifiable: true, match: { conclusion: "success" } }],
        } }),
      ],
      edges: [{ from: "context", to: "verify" }],
    };

    const report = buildPlanHandoffReport({ plan });

    expect(report.total).toBe(2);
    expect(report.agentReady.map((task) => task.nodeKey)).toEqual(["context", "verify"]);
    expect(report.agentReady[1]!.prerequisiteKeys).toEqual(["context"]);
    expect(report.agentReady[0]!.handoffBrief).toContain("Evidence for context.");
    expect(report.nextActions[0]).toBe("Queue 2 agent-ready tasks for local agent handoff.");
  });

  it("separates human, mixed, and either-owned milestones", () => {
    const plan: DecompositionOutput = {
      goal_summary: "Plan gated work.",
      domain: "software",
      rationale: "Some steps need approval.",
      nodes: [
        node("approve", "human", { acceptance_rule: manualRule() }),
        node("connect", "mixed"),
        node("research", "either"),
      ],
      edges: [],
    };

    const report = buildPlanHandoffReport({ plan });

    expect(report.humanRequired.map((task) => task.nodeKey)).toEqual(["approve"]);
    expect(report.mixed.map((task) => task.nodeKey)).toEqual(["connect"]);
    expect(report.either.map((task) => task.nodeKey)).toEqual(["research"]);
    expect(report.humanRequired[0]!.readiness).toBe("needs_human");
    expect(report.mixed[0]!.blockerCodes).toContain("human_handoff");
    expect(report.agentReady.map((task) => task.nodeKey)).toEqual(["research"]);
  });

  it("blocks agent-intended tasks that still need context or reviewable evidence", () => {
    const plan: DecompositionOutput = {
      goal_summary: "Collect context before handoff.",
      domain: "software",
      rationale: "Agent work needs enough context.",
      nodes: [
        node("scan", "agent", {
          decomposition_contract: {
            why: "The agent needs the workspace.",
            definition_of_done: "Relevant files are identified.",
            required_evidence: ["Workspace scan result."],
            likely_owner: "agent",
            context_gaps: [{ category: "project_fact", question: "Which folder should be scanned?", reason: "Without the folder, the agent cannot inspect files." }],
            eval_signal: "The scan points to the right source material.",
          },
        }),
        node("vague", "agent", {
          decomposition_contract: null,
          acceptance_rule: manualRule(),
        }),
        node("future", "agent", {
          acceptance_rule: {
            logic: "all",
            threshold: 1,
            completion_mode: "auto",
            clauses: [{ evaluator: "url", auto_verifiable: true, match: { pattern: "https://example.com" } }],
          },
        }),
      ],
      edges: [],
    };

    const report = buildPlanHandoffReport({ plan });

    expect(report.agentBlocked.map((task) => task.nodeKey)).toEqual(["scan", "vague", "future"]);
    expect(report.needsContext.map((task) => task.nodeKey)).toEqual(["scan"]);
    expect(report.agentBlocked[0]!.readiness).toBe("needs_context");
    expect(report.agentBlocked[1]!.readiness).toBe("needs_human");
    expect(report.agentBlocked[1]!.blockerCodes).toEqual(
      expect.arrayContaining(["missing_contract", "manual_completion", "missing_agent_evidence"]),
    );
    expect(report.agentBlocked[2]!.blockerCodes).toEqual(
      expect.arrayContaining(["missing_agent_evidence", "unsupported_auto_evaluator"]),
    );
  });
});
