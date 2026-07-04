import { describe, expect, it } from "vitest";

import type { Evidence, Goal, Memory, Milestone, MilestoneCompletion, Run, SubAimRelation, ToolTrace } from "@core/types";
import {
  buildAimCompletionRecap,
  buildAimProgressReadModel,
  buildHumanTaskHandoff,
  decideContextIntakeSession,
  deriveContextCandidatesFromWork,
  evaluateWithRuntimeReport,
  recommendAssignmentForMilestone,
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
  });
});

describe("Aim OS cockpit read model", () => {
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
