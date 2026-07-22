import { describe, expect, it } from "vitest";

import type { AcceptanceRule, DecompositionOutput, DecompositionOwner, PlanNode } from "@aimcub/types";

import { buildLocalHandoffManifest, buildPlanHandoffReport } from "./plan-handoff";

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
    routing_override: null,
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

describe("buildLocalHandoffManifest", () => {
  it("packages agent-ready tasks with aim context and eval signals", () => {
    const plan: DecompositionOutput = {
      goal_summary: "Ship local handoff.",
      domain: "software",
      rationale: "Local agents need a queueable manifest.",
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

    const manifest = buildLocalHandoffManifest({
      plan,
      aimContext: [
        {
          content: "Project fact: Use the local workspace as the source of truth.",
          category: "project_fact",
          source: "distilled_context",
          stepId: "loop_1",
          reason: "Aim-scoped context collected through local_workspace.",
        },
        {
          content: "Constraint: This stable preference belongs in memory, not every local job.",
          category: "constraint",
          source: "user_answer",
          reason: "Durable context candidate.",
        },
      ],
    });

    expect(manifest.version).toBe(1);
    expect(manifest.agentQueue.map((job) => job.id)).toEqual(["agent:context", "agent:verify"]);
    expect(manifest.agentQueue[1]!.prerequisiteKeys).toEqual(["context"]);
    expect(manifest.agentQueue[0]!.inputContext).toEqual([
      expect.objectContaining({
        category: "project_fact",
        stepId: "loop_1",
      }),
      expect.objectContaining({
        category: "constraint",
        source: "user_answer",
      }),
    ]);
    expect(manifest.evalSignals).toEqual([
      "context meets the aim-specific standard.",
      "verify meets the aim-specific standard.",
    ]);
    expect(manifest.nextActions[0]).toBe("Prepare 2 local agent jobs for queueing.");
  });

  it("carries selected planning context into agent handoff jobs", () => {
    const plan: DecompositionOutput = {
      goal_summary: "Ship selected context handoff.",
      domain: "software",
      rationale: "Local agents need the same context the planner used.",
      nodes: [node("handoff", "agent")],
      edges: [],
    };

    const manifest = buildLocalHandoffManifest({
      plan,
      selectedContext: [
        {
          content: "Procedure: Run pnpm test before handing the task off.",
          category: "procedure",
          confidence: 0.9,
        },
        {
          content: "Preference: Keep status updates concise.",
          category: "preference",
          confidence: 0.9,
        },
      ],
    });

    expect(manifest.agentQueue[0]!.inputContext).toEqual([
      expect.objectContaining({
        category: "procedure",
        source: "selected_context",
        content: "Procedure: Run pnpm test before handing the task off.",
      }),
      expect.objectContaining({
        category: "preference",
        source: "selected_context",
        content: "Preference: Keep status updates concise.",
      }),
    ]);
  });

  it("prioritizes task-relevant context instead of blindly taking the first items", () => {
    const plan: DecompositionOutput = {
      goal_summary: "Research Cambodia entry logistics.",
      domain: "custom",
      rationale: "A local agent needs the most relevant context for each delegated task.",
      nodes: [node("visa", "agent", {
        title: "Research Cambodia visa requirements",
        description: "Find the visa requirements, official sources, and required travel documents.",
      })],
      edges: [],
    };

    const manifest = buildLocalHandoffManifest({
      plan,
      maxContextItemsPerJob: 2,
      aimContext: [
        {
          content: "Preference: Keep trip notes concise.",
          category: "preference",
          source: "user_answer",
          reason: "General formatting preference.",
        },
        {
          content: "Constraint: Keep all prices in USD.",
          category: "constraint",
          source: "user_answer",
          reason: "General budgeting preference.",
        },
        {
          content: "Project fact: Cambodia visa requirements depend on passport nationality and entry route.",
          category: "project_fact",
          source: "tool_observation",
          reason: "Web research observation.",
        },
        {
          content: "Procedure: Verify Cambodia visa requirements against official government sources.",
          category: "procedure",
          source: "distilled_context",
          reason: "Research workflow.",
        },
      ],
    });

    expect(manifest.agentQueue[0]!.inputContext.map((context) => context.content)).toEqual([
      "Project fact: Cambodia visa requirements depend on passport nationality and entry route.",
      "Procedure: Verify Cambodia visa requirements against official government sources.",
    ]);
  });

  it("carries newly sedimented durable context into agent handoff jobs", () => {
    const plan: DecompositionOutput = {
      goal_summary: "Ship answer-aware handoff.",
      domain: "software",
      rationale: "Local agents need context collected during intake.",
      nodes: [node("handoff", "agent")],
      edges: [],
    };

    const manifest = buildLocalHandoffManifest({
      plan,
      aimContext: [
        {
          content: "Project fact: Use the connected workspace.",
          category: "project_fact",
          source: "tool_observation",
          stepId: "loop_local",
          reason: "Aim-scoped context collected through local_workspace.",
        },
      ],
      durableMemoryCandidates: [
        {
          content: "Constraint: Keep local agent changes inside packages/core.",
          kind: "semantic",
          category: "constraint",
          source: "user_stated",
          confidence: 0.82,
          stepId: "loop_questionnaire",
          originId: "q_constraint",
          reason: "Durable constraint context collected through questionnaire.",
        },
        {
          content: "Constraint: Keep local agent changes inside packages/core.",
          kind: "semantic",
          category: "constraint",
          source: "user_stated",
          confidence: 0.82,
          reason: "Duplicate candidate.",
        },
      ],
      selectedContext: [
        {
          content: "Preference: Keep status updates concise.",
          category: "preference",
          confidence: 0.9,
        },
      ],
    });

    expect(manifest.agentQueue[0]!.inputContext).toEqual(expect.arrayContaining([
      expect.objectContaining({
        category: "project_fact",
        source: "tool_observation",
        stepId: "loop_local",
      }),
      expect.objectContaining({
        category: "constraint",
        source: "user_stated",
        stepId: "loop_questionnaire",
        content: "Constraint: Keep local agent changes inside packages/core.",
      }),
      expect.objectContaining({
        category: "preference",
        source: "selected_context",
      }),
    ]));
  });

  it("adds context-derived eval signals to the local handoff manifest", () => {
    const plan: DecompositionOutput = {
      goal_summary: "Ship eval-aware handoff.",
      domain: "software",
      rationale: "Aimcub owns the eval layer.",
      nodes: [node("handoff", "agent")],
      edges: [],
    };

    const manifest = buildLocalHandoffManifest({
      plan,
      durableMemoryCandidates: [
        {
          content: "Eval signal: Done means the generated handoff can be verified by pnpm test.",
          kind: "semantic",
          category: "eval_signal",
          source: "user_stated",
          confidence: 0.82,
          stepId: "loop_questionnaire",
          reason: "Durable eval_signal context collected through questionnaire.",
        },
      ],
      selectedContext: [
        {
          content: "Eval signal: Done means the generated handoff can be verified by pnpm test.",
          category: "eval_signal",
          confidence: 0.95,
        },
      ],
    });

    expect(manifest.evalSignals).toEqual([
      "handoff meets the aim-specific standard.",
      "Eval signal: Done means the generated handoff can be verified by pnpm test.",
    ]);
  });

  it("marks human prerequisites that unblock queued agent jobs", () => {
    const plan: DecompositionOutput = {
      goal_summary: "Prepare a gated local agent run.",
      domain: "software",
      rationale: "The agent can run only after the user grants access.",
      nodes: [
        node("grant", "human", {
          acceptance_rule: manualRule(),
          decomposition_contract: {
            why: "The user must grant access before automation can inspect the source.",
            definition_of_done: "The user has granted access to the source folder.",
            required_evidence: ["User confirms source folder access."],
            likely_owner: "human",
            context_gaps: [],
            eval_signal: "The source folder is available for local agent execution.",
          },
        }),
        node("inspect", "agent"),
      ],
      edges: [{ from: "grant", to: "inspect" }],
    };

    const manifest = buildLocalHandoffManifest({ plan });

    expect(manifest.agentQueue.map((job) => job.nodeKey)).toEqual(["inspect"]);
    expect(manifest.agentQueue[0]!.waitingOnHumanNodeKeys).toEqual(["grant"]);
    expect(manifest.humanQueue).toEqual([
      expect.objectContaining({
        nodeKey: "grant",
        unblocksAgentNodeKeys: ["inspect"],
      }),
    ]);
    expect(manifest.nextActions).toEqual([
      "Prepare 1 local agent job for queueing.",
      "Hold 1 queued agent job until human prerequisites complete.",
      "Route 1 human-gated task outside the agent queue.",
    ]);
  });

  it("carries pending context intake as a gate before one-click handoff", () => {
    const plan: DecompositionOutput = {
      goal_summary: "Prepare local agent work after context intake.",
      domain: "software",
      rationale: "Agent-ready tasks still need the current aim context gate.",
      nodes: [node("inspect", "agent")],
      edges: [],
    };

    const manifest = buildLocalHandoffManifest({
      plan,
      contextSedimentation: {
        readyForDecomposition: false,
        shouldIterate: true,
        pendingSteps: [
          {
            stepId: "loop_web",
            channel: "web_research",
            status: "blocked",
            blocksPlanAcceptance: true,
            remainingOutputs: ["aim_context"],
            requiredTools: [
              {
                name: "web.fetch",
                boundary: "first_party",
                reason: "Fetch selected sources before accepting the decomposition.",
              },
            ],
            reason: "web_research context intake is waiting on needs permission.",
          },
        ],
        nextActions: ["Resolve permission or connector setup for 1 blocked context step."],
      },
    });

    expect(manifest.agentQueue.map((job) => job.nodeKey)).toEqual(["inspect"]);
    expect(manifest.contextGate).toMatchObject({
      readyForDecomposition: false,
      shouldIterate: true,
      pendingSteps: [
        expect.objectContaining({
          channel: "web_research",
          requiredTools: [
            expect.objectContaining({
              name: "web.fetch",
            }),
          ],
        }),
      ],
    });
    expect(manifest.nextActions[0]).toBe("Finish 1 context intake step before one-click handoff.");
  });

  it("keeps blocked agent and human-gated work out of the ready queue", () => {
    const plan: DecompositionOutput = {
      goal_summary: "Route local handoff work.",
      domain: "software",
      rationale: "Only ready agent work should enter the queue.",
      nodes: [
        node("scan", "agent", {
          decomposition_contract: {
            why: "The agent needs the workspace.",
            definition_of_done: "Relevant files are identified.",
            required_evidence: ["Workspace scan result."],
            likely_owner: "agent",
            context_gaps: [{ category: "project_fact", question: "Which folder should be scanned?", reason: "Folder access is missing." }],
            eval_signal: "The scan points to the right source material.",
          },
        }),
        node("approve", "human", { acceptance_rule: manualRule() }),
        node("pair", "mixed"),
      ],
      edges: [],
    };

    const manifest = buildLocalHandoffManifest({
      plan,
      aimContext: [{
        content: "Project fact: The user selected /workspace/aimcub as the local source.",
        category: "project_fact",
        source: "tool_observation",
        reason: "Aim-scoped context collected through local_workspace.",
      }],
      durableMemoryCandidates: [{
        content: "Constraint: Ask before crossing the external connector boundary.",
        kind: "semantic",
        category: "constraint",
        source: "user_stated",
        confidence: 0.82,
        reason: "Durable constraint context collected through questionnaire.",
      }],
    });

    expect(manifest.agentQueue).toEqual([]);
    expect(manifest.blockedAgentQueue).toEqual([
      expect.objectContaining({
        id: "blocked:scan",
        status: "needs_context",
        inputContext: [
          expect.objectContaining({
            category: "project_fact",
            content: "Project fact: The user selected /workspace/aimcub as the local source.",
          }),
          expect.objectContaining({
            category: "constraint",
            content: "Constraint: Ask before crossing the external connector boundary.",
          }),
        ],
        nextAction: "Collect context: Which folder should be scanned?",
      }),
    ]);
    expect(manifest.humanQueue.map((task) => task.id)).toEqual(["human:approve", "human:pair"]);
    expect(manifest.humanQueue[0]!.inputContext).toEqual([
      expect.objectContaining({
        category: "project_fact",
      }),
      expect.objectContaining({
        category: "constraint",
      }),
    ]);
    expect(manifest.nextActions).toEqual([
      "Resolve 1 blocked agent job before one-click handoff.",
      "Route 2 human-gated tasks outside the agent queue.",
    ]);
  });
});
