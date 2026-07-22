import { describe, expect, it } from "vitest";

import {
  DecompositionOutput,
  type Assignment,
  type Evidence,
  type Goal,
  type Memory,
  type Milestone,
  type MilestoneCompletion,
  type Run,
  type SubAimRelation,
  type ToolTrace,
} from "@aimcub/types";
import {
  buildAimCompletionRecap,
  buildAimProgressReadModel,
  buildHumanTaskHandoff,
  decideContextIntakeSession,
  deriveContextCandidatesFromWork,
  evaluateWithRuntimeReport,
  recommendAssignmentForMilestone,
  routingRecommendationForPlanNode,
  summarizeAimProgress,
  summarizeAimResearch,
  validatePlanRouting,
} from "./aim-os";

const OWNER = "00000000-0000-4000-8000-000000000001";
const GOAL = "00000000-0000-4000-8000-000000000010";
const CHILD_GOAL = "00000000-0000-4000-8000-000000000011";
const MILESTONE = "00000000-0000-4000-8000-000000000020";
const CHILD_MILESTONE = "00000000-0000-4000-8000-000000000021";

function milestone(input: Partial<Milestone> = {}): Milestone {
  return {
    id: MILESTONE,
    goal_id: GOAL,
    owner_id: OWNER,
    title: "Implement CLI",
    description: "Build and test the CLI.",
    status: "pending",
    order_index: 0,
    depends_on_id: null,
    acceptance_rule: {
      logic: "all",
      threshold: 1,
      completion_mode: "auto_then_confirm",
      clauses: [{ evaluator: "commit_pattern", auto_verifiable: true, match: { message_pattern: "init", min_files: 1 } }],
    },
    xp_reward: 10,
    completed_at: null,
    metadata: {
      decomposition_contract: {
        why: "Code can be delegated.",
        definition_of_done: "A tested CLI exists.",
        required_evidence: ["Trusted commit and passing tests."],
        likely_owner: "agent",
        context_gaps: [],
        eval_signal: "Done means a trusted commit proves the CLI works.",
      },
    },
    ...input,
  };
}

function goal(id = GOAL): Goal {
  return {
    id,
    owner_id: OWNER,
    title: id === GOAL ? "Build CLI" : "Child aim",
    description: "",
    domain: "software",
    status: "active",
    target_date: null,
    plan_json: null,
    metadata: {},
    created_at: "2026-07-03T00:00:00.000Z",
  };
}

function commitAcceptanceRule(messagePattern: string, minFiles = 1): Milestone["acceptance_rule"] {
  return {
    logic: "all",
    threshold: 1,
    completion_mode: "auto_then_confirm",
    clauses: [{ evaluator: "commit_pattern", auto_verifiable: true, match: { message_pattern: messagePattern, min_files: minFiles } }],
  };
}

function manualAcceptanceRule(): Milestone["acceptance_rule"] {
  return {
    logic: "all",
    threshold: 1,
    completion_mode: "manual",
    clauses: [{ evaluator: "manual_confirm", auto_verifiable: false, match: {} }],
  };
}

function decompositionContract(input: {
  why: string;
  definitionOfDone: string;
  requiredEvidence: string[];
  likelyOwner: "agent" | "human";
  evalSignal: string;
}): Record<string, unknown> {
  return {
    why: input.why,
    definition_of_done: input.definitionOfDone,
    required_evidence: input.requiredEvidence,
    likely_owner: input.likelyOwner,
    context_gaps: [],
    eval_signal: input.evalSignal,
  };
}

function assignmentRow(input: Partial<Assignment> & Pick<Assignment, "id" | "milestone_id" | "actor_kind">): Assignment {
  return {
    id: input.id,
    owner_id: input.owner_id ?? OWNER,
    goal_id: input.goal_id !== undefined ? input.goal_id : GOAL,
    milestone_id: input.milestone_id,
    actor_kind: input.actor_kind,
    actor_id: input.actor_id ?? null,
    status: input.status ?? "assigned",
    source: input.source ?? "routing",
    reason: input.reason ?? "Routed by Aim OS.",
    capability_tags: input.capability_tags ?? [],
    created_at: input.created_at ?? "2026-07-07T00:00:00.000Z",
    updated_at: input.updated_at ?? "2026-07-07T00:00:00.000Z",
  };
}

function runRow(input: Partial<Run> & Pick<Run, "id" | "milestone_id" | "assignment_id">): Run {
  const actorKind = input.actor_kind ?? "agent";
  return {
    id: input.id,
    owner_id: input.owner_id ?? OWNER,
    goal_id: input.goal_id !== undefined ? input.goal_id : GOAL,
    milestone_id: input.milestone_id,
    assignment_id: input.assignment_id,
    actor_kind: actorKind,
    actor_id: input.actor_id ?? null,
    kind: input.kind ?? (actorKind === "agent" ? "agent" : "human"),
    status: input.status ?? "completed",
    attempt: input.attempt ?? 1,
    workspace_root: input.workspace_root ?? null,
    sandbox: input.sandbox ?? "workspace-write",
    network_enabled: input.network_enabled ?? false,
    model: input.model ?? "gpt-5",
    reasoning: input.reasoning ?? null,
    summary: input.summary ?? "",
    error: input.error ?? null,
    queued_at: input.queued_at ?? "2026-07-07T00:00:00.000Z",
    started_at: input.started_at ?? "2026-07-07T00:00:00.000Z",
    finished_at: input.finished_at ?? "2026-07-07T01:00:00.000Z",
    created_at: input.created_at ?? "2026-07-07T00:00:00.000Z",
  };
}

function evidenceRow(input: Partial<Evidence> & Pick<Evidence, "id" | "milestone_id" | "kind">): Evidence {
  return {
    id: input.id,
    owner_id: input.owner_id ?? OWNER,
    goal_id: input.goal_id ?? GOAL,
    milestone_id: input.milestone_id,
    emitter_id: input.emitter_id ?? null,
    kind: input.kind,
    source_event_id: input.source_event_id ?? null,
    occurred_at: input.occurred_at ?? "2026-07-07T01:00:00.000Z",
    summary: input.summary ?? "",
    payload: input.payload ?? {},
    trust_score: input.trust_score ?? 1,
    created_at: input.created_at,
  };
}

function completionRow(
  input: Partial<MilestoneCompletion> & Pick<MilestoneCompletion, "id" | "milestone_id" | "decided_by">,
): MilestoneCompletion {
  return {
    id: input.id,
    milestone_id: input.milestone_id,
    owner_id: input.owner_id ?? OWNER,
    decided_by: input.decided_by,
    triggering_evidence_ids: input.triggering_evidence_ids ?? [],
    awarded_xp: input.awarded_xp ?? 10,
    created_at: input.created_at ?? "2026-07-07T01:00:00.000Z",
  };
}

function memoryRow(input: Partial<Memory> & Pick<Memory, "id" | "content" | "category" | "status">): Memory {
  return {
    id: input.id,
    owner_id: input.owner_id ?? OWNER,
    goal_id: input.goal_id !== undefined ? input.goal_id : GOAL,
    kind: input.kind ?? "semantic",
    category: input.category,
    content: input.content,
    confidence: input.confidence ?? 0.78,
    source: input.source ?? "evidence_derived",
    status: input.status,
    superseded_by: input.superseded_by ?? null,
    created_at: input.created_at ?? "2026-07-07T01:00:00.000Z",
  };
}

describe("Aim OS context intake", () => {
  it("pauses for missing user context and blocks on blocked tools", () => {
    const needsUser = decideContextIntakeSession({
      aimTitle: "Build CLI",
      missingQuestions: ["What evidence proves done?"],
    });

    expect(needsUser.status).toBe("needs_user");
    expect(needsUser.should_pause).toBe(true);
    expect(needsUser.can_continue).toBe(false);

    const blockedTrace: Pick<ToolTrace, "id" | "status" | "error"> = {
      id: "00000000-0000-4000-8000-000000000030",
      status: "blocked",
      error: "Workspace permission required.",
    };
    const blocked = decideContextIntakeSession({
      aimTitle: "Build CLI",
      toolTraces: [blockedTrace],
    });

    expect(blocked.status).toBe("blocked");
    expect(blocked.blocked_reasons).toEqual(["Workspace permission required."]);
  });
});

describe("Aim OS routing and human handoff", () => {
  it("routes digital work to agents and judgment/access work to humans", () => {
    expect(recommendAssignmentForMilestone({ milestone: milestone() }).actorKind).toBe("agent");

    const humanMilestone = milestone({
      acceptance_rule: {
        logic: "all",
        threshold: 1,
        completion_mode: "manual",
        clauses: [{ evaluator: "manual_confirm", auto_verifiable: false, match: {} }],
      },
      metadata: {
        decomposition_contract: {
          why: "Requires access.",
          definition_of_done: "The user approves the release credential setup.",
          required_evidence: ["Approval note."],
          likely_owner: "human",
          context_gaps: [],
          eval_signal: "Done means the user confirms access is correct.",
        },
      },
    });

    const assignment = recommendAssignmentForMilestone({ milestone: humanMilestone });
    const handoff = buildHumanTaskHandoff(humanMilestone);

    expect(assignment.actorKind).toBe("human");
    expect(handoff.approvalRequired).toBe(true);
    expect(handoff.secretOrAccessRequired).toBe(true);
    expect(handoff.finalConfirmationRequired).toBe(true);
  });

  it("validates impossible agent routes against the available runtime", () => {
    const plan = DecompositionOutput.parse({
      nodes: [{
        key: "agent-work",
        title: "Implement CLI",
        description: "Build the command.",
        acceptance_rule: {
          clauses: [{ evaluator: "commit_pattern", auto_verifiable: true, match: { message_pattern: "cli" } }],
        },
        decomposition_contract: {
          why: "Code can be delegated.",
          definition_of_done: "The command is implemented.",
          required_evidence: ["Commit with CLI implementation."],
          likely_owner: "agent",
          context_gaps: [],
          eval_signal: "A commit proves the CLI exists.",
        },
      }],
      edges: [],
    });

    const missingRuntime = validatePlanRouting({ plan, agents: [] });
    expect(missingRuntime.ok).toBe(false);
    expect(missingRuntime.issues[0]?.code).toBe("missing_agent_runtime");

    const withHumanOverride = DecompositionOutput.parse({
      ...plan,
      nodes: [{ ...plan.nodes[0]!, routing_override: { owner: "human" } }],
    });
    expect(validatePlanRouting({ plan: withHumanOverride, agents: [] }).ok).toBe(true);
  });

  it("requires selected agent models to belong to the current runtime", () => {
    const plan = DecompositionOutput.parse({
      nodes: [{
        key: "agent-work",
        title: "Implement CLI",
        acceptance_rule: {
          clauses: [{ evaluator: "commit_pattern", auto_verifiable: true, match: { message_pattern: "cli" } }],
        },
        decomposition_contract: {
          why: "Code can be delegated.",
          definition_of_done: "The command is implemented.",
          required_evidence: ["Commit with CLI implementation."],
          likely_owner: "agent",
          context_gaps: [],
          eval_signal: "A commit proves the CLI exists.",
        },
        routing_override: {
          owner: "agent",
          agent_id: "codex",
          agent_label: "Codex CLI",
          run_mode: "local_cli",
          model: "missing-model",
          model_label: "missing-model",
        },
      }],
      edges: [],
    });
    const agents = [{
      id: "codex",
      label: "Codex CLI",
      available: true,
      authenticated: true,
      models: [{ id: "gpt-5", label: "GPT-5" }],
    }];

    expect(validatePlanRouting({ plan, agents }).issues[0]?.code).toBe("unknown_agent_model");

    const valid = DecompositionOutput.parse({
      ...plan,
      nodes: [{ ...plan.nodes[0]!, routing_override: { ...plan.nodes[0]!.routing_override!, model: "gpt-5" } }],
    });
    expect(validatePlanRouting({ plan: valid, agents }).ok).toBe(true);
    expect(routingRecommendationForPlanNode(valid.nodes[0]!).rationale).toMatch(/agent/i);
  });
});

describe("Aim OS evaluator registry surface", () => {
  it("explains matched evidence and unsupported evaluator boundaries", () => {
    const ev: Evidence = {
      id: "00000000-0000-4000-8000-000000000040",
      owner_id: OWNER,
      goal_id: GOAL,
      milestone_id: MILESTONE,
      emitter_id: null,
      kind: "git_commit",
      source_event_id: "sha",
      occurred_at: "2026-07-03T00:00:00.000Z",
      summary: "init",
      payload: { sha: "sha", message: "init project", files: ["src/index.ts"] },
      trust_score: 1,
    };
    const report = evaluateWithRuntimeReport(milestone().acceptance_rule, [ev]);

    expect(report.passed).toBe(true);
    expect(report.evaluatorResults[0]?.status).toBe("passed");

    const unsupported = evaluateWithRuntimeReport({
      logic: "all",
      threshold: 1,
      completion_mode: "auto_then_confirm",
      clauses: [{ evaluator: "file_uploaded", auto_verifiable: true, match: { min_count: 1 } }],
    }, []);

    expect(unsupported.passed).toBe(false);
    expect(unsupported.evaluatorResults[0]?.status).toBe("unsupported");
    expect(unsupported.evalReview.reason).toContain("Cannot auto-evaluate");
  });
});

describe("Aim OS cockpit read model", () => {
  it("adds evidence details, trust, reasoning, and rule matches to milestone rows", () => {
    const trusted: Evidence = {
      id: "00000000-0000-4000-8000-000000000070",
      owner_id: OWNER,
      goal_id: GOAL,
      milestone_id: MILESTONE,
      emitter_id: null,
      kind: "git_commit",
      source_event_id: "sha-trusted",
      occurred_at: "2026-07-03T00:00:00.000Z",
      summary: "init project",
      payload: { sha: "sha-trusted", message: "init project", files: ["src/index.ts"] },
      trust_score: 0.95,
    };
    const lowTrust: Evidence = {
      ...trusted,
      id: "00000000-0000-4000-8000-000000000071",
      source_event_id: "sha-low",
      summary: "agent reported init project",
      payload: { sha: "sha-low", message: "init project", files: ["src/index.ts"] },
      trust_score: 0.5,
    };

    const model = buildAimProgressReadModel({
      goal: goal(),
      milestones: [milestone()],
      evidence: [trusted, lowTrust],
    });
    const row = model.milestones[0]!;

    expect(row.eval_review).toMatchObject({
      passed: true,
      matched_evidence_ids: [trusted.id],
      trust_score: 0.95,
    });
    expect(row.eval_review.reason).toContain("passed");
    expect(row.evidence).toHaveLength(2);
    expect(row.evidence[0]).toMatchObject({
      evidence: { id: trusted.id, summary: "init project", trust_score: 0.95 },
      rule_matches: [{ clause_index: 0, evaluator: "commit_pattern" }],
      status: "matched",
    });
    expect(row.evidence[1]).toMatchObject({
      evidence: { id: lowTrust.id, trust_score: 0.5 },
      rule_matches: [],
      status: "low_trust",
    });
  });

  it("makes missing evidence actionable in the eval review", () => {
    const model = buildAimProgressReadModel({
      goal: goal(),
      milestones: [milestone()],
      evidence: [],
    });
    const row = model.milestones[0]!;

    expect(row.eval_review.passed).toBe(false);
    expect(row.eval_review.reason).toBe("No evidence has been recorded for this sub-aim yet.");
    expect(row.eval_review.next_action).toContain("Run the assigned agent");
    expect(row.evidence).toEqual([]);
  });

  it("locks the local alpha golden path in the pure progress model", () => {
    const agentMilestone = milestone({
      id: "00000000-0000-4000-8000-000000000022",
      title: "Implement local alpha proof path",
      description: "Update local alpha docs and core/store tests.",
      status: "completed",
      completed_at: "2026-07-07T01:00:00.000Z",
      acceptance_rule: commitAcceptanceRule("local alpha", 2),
      metadata: {
        decomposition_contract: decompositionContract({
          why: "Digital documentation and tests can be delegated to a local agent.",
          definitionOfDone: "Docs and tests describe and exercise the local alpha golden path.",
          requiredEvidence: ["Trusted commit touching docs and tests."],
          likelyOwner: "agent",
          evalSignal: "Done means trusted evidence proves the alpha loop is locked.",
        }),
      },
    });
    const humanMilestone = milestone({
      id: "00000000-0000-4000-8000-000000000023",
      title: "Approve local alpha scope",
      description: "Human reviews the alpha non-goals and proof.",
      order_index: 1,
      depends_on_id: agentMilestone.id,
      acceptance_rule: manualAcceptanceRule(),
      metadata: {
        decomposition_contract: decompositionContract({
          why: "A human owns the final scope call.",
          definitionOfDone: "The user confirms the local alpha contract and non-goals are correct.",
          requiredEvidence: ["Approval note."],
          likelyOwner: "human",
          evalSignal: "Done means the approval proof is explicit and inspectable.",
        }),
      },
    });
    const agentAssignment = assignmentRow({
      id: "00000000-0000-4000-8000-000000000024",
      milestone_id: agentMilestone.id,
      actor_kind: "agent",
      status: "completed",
      reason: "Agent-owned digital work.",
      capability_tags: ["software"],
      updated_at: "2026-07-07T01:00:00.000Z",
    });
    const humanAssignment = assignmentRow({
      id: "00000000-0000-4000-8000-000000000025",
      milestone_id: humanMilestone.id,
      actor_kind: "human",
      reason: "Human-owned approval.",
      capability_tags: ["human_judgment"],
    });
    const run = runRow({
      id: "00000000-0000-4000-8000-000000000026",
      milestone_id: agentMilestone.id,
      assignment_id: agentAssignment.id,
      summary: "Updated the local alpha contract and golden-loop tests.",
    });
    const commitEvidence = evidenceRow({
      id: "00000000-0000-4000-8000-000000000027",
      milestone_id: agentMilestone.id,
      kind: "git_commit",
      source_event_id: "alpha-proof",
      summary: "local alpha docs and tests",
      payload: {
        sha: "alpha-proof",
        message: "local alpha docs and tests",
        files: ["docs/local-alpha.md", "packages/store/src/store.test.ts"],
      },
    });
    const autoCompletion = completionRow({
      id: "00000000-0000-4000-8000-000000000028",
      milestone_id: agentMilestone.id,
      decided_by: "rule_auto",
      triggering_evidence_ids: [commitEvidence.id],
    });
    const candidate = memoryRow({
      id: "00000000-0000-4000-8000-000000000029",
      kind: "procedural",
      category: "procedure",
      content: "Procedure: Update alpha docs and golden-loop tests together.",
      status: "pending",
    });

    const inFlight = buildAimProgressReadModel({
      goal: goal(),
      milestones: [agentMilestone, humanMilestone],
      assignments: [agentAssignment, humanAssignment],
      runs: [run],
      evidence: [commitEvidence],
      completions: [autoCompletion],
      contextCandidates: [candidate],
    });

    expect(inFlight.completed_milestones).toBe(1);
    expect(inFlight.next_action).toBe("Collect human proof and confirm completion.");
    expect(inFlight.context_candidates).toContainEqual(expect.objectContaining({ id: candidate.id, status: "pending" }));
    expect(inFlight.milestones[0]?.evidence[0]).toMatchObject({
      evidence: { id: commitEvidence.id },
      status: "matched",
      rule_matches: [{ clause_index: 0, evaluator: "commit_pattern" }],
    });

    const manualEvidence = evidenceRow({
      id: "00000000-0000-4000-8000-000000000030",
      milestone_id: humanMilestone.id,
      kind: "manual_check",
      summary: "User approved the local alpha scope.",
      payload: {
        confirmed: true,
        milestone_id: humanMilestone.id,
        proof_note: "User approved the local alpha scope.",
        required_evidence: [{ text: "Approval note.", satisfied: true }],
      },
    });
    const manualCompletion = completionRow({
      id: "00000000-0000-4000-8000-000000000031",
      milestone_id: humanMilestone.id,
      decided_by: "user_confirm",
      triggering_evidence_ids: [manualEvidence.id],
      created_at: "2026-07-07T01:10:00.000Z",
    });
    const acceptedContext = memoryRow({
      id: "00000000-0000-4000-8000-000000000032",
      goal_id: null,
      content: "Eval signal: Local alpha work needs docs, tests, and human approval.",
      category: "eval_signal",
      status: "active",
    });
    const complete = buildAimProgressReadModel({
      goal: goal(),
      milestones: [
        agentMilestone,
        { ...humanMilestone, status: "completed", completed_at: "2026-07-07T01:10:00.000Z" },
      ],
      assignments: [agentAssignment, { ...humanAssignment, status: "completed" }],
      runs: [run],
      evidence: [commitEvidence, manualEvidence],
      completions: [autoCompletion, manualCompletion],
      contextCandidates: [candidate],
      acceptedContext: [acceptedContext],
    });

    expect(complete.next_action).toBe("Aim is complete.");
    expect(complete.milestones[1]?.evaluator_results[0]?.matched_evidence_ids).toContain(manualEvidence.id);
    expect(complete.completion_recap?.learned_context).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: candidate.id, status: "pending", scope: "aim" }),
      expect.objectContaining({ id: acceptedContext.id, status: "active", scope: "global" }),
    ]));
  });

  it("rolls child aim status back into the parent milestone view", () => {
    const childMilestone = milestone({
      id: CHILD_MILESTONE,
      goal_id: CHILD_GOAL,
      status: "completed",
      completed_at: "2026-07-03T01:00:00.000Z",
    });
    const relation: SubAimRelation = {
      id: "00000000-0000-4000-8000-000000000050",
      owner_id: OWNER,
      parent_goal_id: GOAL,
      parent_milestone_id: MILESTONE,
      child_goal_id: CHILD_GOAL,
      status: "active",
      reason: "manual decomposition",
      created_at: "2026-07-03T00:00:00.000Z",
      updated_at: "2026-07-03T00:00:00.000Z",
    };

    const model = buildAimProgressReadModel({
      goal: goal(),
      milestones: [milestone()],
      subAimRelations: [relation],
      goals: [goal(), goal(CHILD_GOAL)],
      milestonesByGoal: { [GOAL]: [milestone()], [CHILD_GOAL]: [childMilestone] },
    });

    expect(model.milestones[0]?.child_relations[0]?.status).toBe("completed");
    expect(model.milestones[0]?.next_action).toMatch(/child aim/i);
  });

  it("derives pending context candidates from completions and runs", () => {
    const run: Run = {
      id: "00000000-0000-4000-8000-000000000060",
      owner_id: OWNER,
      goal_id: GOAL,
      milestone_id: MILESTONE,
      assignment_id: null,
      actor_kind: "agent",
      actor_id: null,
      kind: "agent",
      status: "completed",
      attempt: 1,
      workspace_root: null,
      sandbox: "read-only",
      network_enabled: false,
      model: "default",
      reasoning: null,
      summary: "run pnpm test before handoff",
      error: null,
      queued_at: "2026-07-03T00:00:00.000Z",
      started_at: "2026-07-03T00:00:00.000Z",
      finished_at: "2026-07-03T00:05:00.000Z",
      created_at: "2026-07-03T00:00:00.000Z",
    };
    const completion: MilestoneCompletion = {
      id: "00000000-0000-4000-8000-000000000061",
      milestone_id: MILESTONE,
      owner_id: OWNER,
      decided_by: "user_confirm",
      triggering_evidence_ids: [],
      awarded_xp: 10,
      created_at: "2026-07-03T00:06:00.000Z",
    };

    const candidates = deriveContextCandidatesFromWork({
      goal: goal(),
      milestones: [milestone()],
      runs: [run],
      completions: [completion],
    });

    expect(candidates.map((candidate) => candidate.category)).toContain("eval_signal");
    expect(candidates.map((candidate) => candidate.category)).toContain("procedure");
  });

  it("maps completed progress into a completion recap with evidence, eval, and learned context", () => {
    const ev: Evidence = {
      id: "00000000-0000-4000-8000-000000000070",
      owner_id: OWNER,
      goal_id: GOAL,
      milestone_id: MILESTONE,
      emitter_id: null,
      kind: "git_commit",
      source_event_id: "sha",
      occurred_at: "2026-07-03T00:00:00.000Z",
      summary: "init project",
      payload: { sha: "sha", message: "init project", files: ["src/index.ts"] },
      trust_score: 1,
    };
    const completion: MilestoneCompletion = {
      id: "00000000-0000-4000-8000-000000000071",
      milestone_id: MILESTONE,
      owner_id: OWNER,
      decided_by: "rule_auto",
      triggering_evidence_ids: [ev.id],
      awarded_xp: 10,
      created_at: "2026-07-03T00:01:00.000Z",
    };
    const candidate: Memory = {
      id: "00000000-0000-4000-8000-000000000072",
      owner_id: OWNER,
      goal_id: GOAL,
      kind: "semantic",
      category: "eval_signal",
      content: "Eval signal: trusted commits can complete scaffold work.",
      confidence: 0.78,
      source: "evidence_derived",
      status: "pending",
      superseded_by: null,
      created_at: "2026-07-03T00:01:00.000Z",
    };
    const model = buildAimProgressReadModel({
      goal: goal(),
      milestones: [milestone({
        status: "completed",
        completed_at: "2026-07-03T00:01:00.000Z",
      })],
      evidence: [ev],
      completions: [completion],
      contextCandidates: [candidate],
    });

    const recap = model.completion_recap ?? buildAimCompletionRecap({
      goal: goal(),
      milestones: model.milestones,
      evidence: [ev],
      completions: [completion],
      learnedContext: [candidate],
    });

    expect(recap?.complete).toBe(true);
    expect(recap?.completed_sub_aims).toMatchObject([{
      title: "Implement CLI",
      decided_by: "rule_auto",
      evidence_ids: [ev.id],
      eval_status: "passed",
    }]);
    expect(recap?.passing_evidence).toMatchObject([{ id: ev.id, summary: "init project", kind: "git_commit" }]);
    expect(recap?.eval_results).toMatchObject([{ milestone_id: MILESTONE, evaluator: "commit_pattern", status: "passed" }]);
    expect(recap?.learned_context).toMatchObject([{ id: candidate.id, status: "pending", scope: "aim" }]);
  });

  it("does not create a completion recap while an aim still has open sub-aims", () => {
    const model = buildAimProgressReadModel({
      goal: goal(),
      milestones: [milestone()],
    });

    expect(model.completion_recap).toBeNull();
  });
});

describe("summarizeAimProgress", () => {
  it("reports planning when an aim has no milestones yet", () => {
    const summary = summarizeAimProgress({ goal: goal(), milestones: [] });
    expect(summary).toMatchObject({ goal_id: GOAL, status: "planning", total: 0, completed: 0 });
  });

  it("reports needs_you when work is incomplete and nothing is running", () => {
    const summary = summarizeAimProgress({
      goal: goal(),
      milestones: [milestone({ id: "m1", status: "pending" }), milestone({ id: "m2", status: "completed" })],
    });
    expect(summary).toMatchObject({ status: "needs_you", total: 2, completed: 1, running: 0 });
  });

  it("prefers running over blocked, and blocked over needs_you", () => {
    const running = summarizeAimProgress({
      goal: goal(),
      milestones: [milestone({ id: "m1", status: "blocked" }), milestone({ id: "m2", status: "pending" })],
      runs: [runRow({ id: "r1", milestone_id: "m2", assignment_id: null, status: "running" })],
    });
    expect(running).toMatchObject({ status: "running", blocked: 1, running: 1 });

    const blocked = summarizeAimProgress({
      goal: goal(),
      milestones: [milestone({ id: "m1", status: "blocked" }), milestone({ id: "m2", status: "pending" })],
    });
    expect(blocked).toMatchObject({ status: "blocked", blocked: 1, running: 0 });
  });

  it("counts an assignment-level block even when the milestone status is not blocked", () => {
    const summary = summarizeAimProgress({
      goal: goal(),
      milestones: [milestone({ id: "m1", status: "pending" })],
      assignments: [assignmentRow({ id: "a1", milestone_id: "m1", actor_kind: "agent", status: "blocked" })],
    });
    expect(summary).toMatchObject({ status: "blocked", blocked: 1 });
  });

  it("reports complete when every milestone is done or the goal is achieved", () => {
    const done = summarizeAimProgress({
      goal: goal(),
      milestones: [milestone({ id: "m1", status: "completed" }), milestone({ id: "m2", status: "completed" })],
    });
    expect(done).toMatchObject({ status: "complete", total: 2, completed: 2 });

    const achieved = summarizeAimProgress({
      goal: { ...goal(), status: "achieved" },
      milestones: [milestone({ id: "m1", status: "pending" })],
    });
    expect(achieved.status).toBe("complete");
  });
});

describe("summarizeAimResearch", () => {
  it("reports none when nothing has been gathered and no plan exists", () => {
    expect(summarizeAimResearch({ planExists: false })).toMatchObject({ status: "none", memoryCount: 0, pendingCount: 0 });
  });

  it("reports gathering from active memories or pending candidates before a plan exists", () => {
    const fromMemories = summarizeAimResearch({
      planExists: false,
      memories: [memoryRow({ id: "mem1", content: "macOS user", category: "project_fact", status: "active" })],
    });
    expect(fromMemories).toMatchObject({ status: "gathering", memoryCount: 1 });

    const fromCandidates = summarizeAimResearch({
      planExists: false,
      contextCandidates: [memoryRow({ id: "cand1", content: "pending fact", category: "project_fact", status: "pending" })],
    });
    expect(fromCandidates).toMatchObject({ status: "gathering", pendingCount: 1 });
  });

  it("ignores non-active memories when counting gathered research", () => {
    const signal = summarizeAimResearch({
      planExists: false,
      memories: [memoryRow({ id: "mem1", content: "archived", category: "project_fact", status: "deleted" })],
    });
    expect(signal).toMatchObject({ status: "none", memoryCount: 0 });
  });

  it("reports ready once a plan exists, carrying the gathered memory count", () => {
    const signal = summarizeAimResearch({
      planExists: true,
      memories: [memoryRow({ id: "mem1", content: "macOS user", category: "project_fact", status: "active" })],
    });
    expect(signal).toMatchObject({ status: "ready", memoryCount: 1 });
  });
});
