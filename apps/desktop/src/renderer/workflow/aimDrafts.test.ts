import { describe, expect, it } from "vitest";

import type { ClarifyOutput } from "@core/llm";
import type { DecompositionOutput } from "@core/types";

import {
  buildAimDraftUpsertRequest,
  hydrateAimDraft,
  saveBlockFromProductError,
} from "./aimDrafts";

const plan: DecompositionOutput = {
  goal_summary: "Recover draft work",
  domain: "software",
  rationale: "Drafts must survive navigation.",
  nodes: [{
    key: "draft-recovery",
    title: "Persist the draft",
    description: "Store user-entered work before navigation hides it.",
    est_effort: "s",
    xp_reward: 10,
    acceptance_rule: {
      logic: "all",
      threshold: 1,
      completion_mode: "manual",
      clauses: [{ evaluator: "manual_confirm", auto_verifiable: false, match: {} }],
    },
    decomposition_contract: {
      why: "The local-first promise depends on recoverability.",
      definition_of_done: "The draft can be resumed with plan edits intact.",
      required_evidence: ["Store round-trip test."],
      likely_owner: "agent",
      context_gaps: [],
      eval_signal: "Recoverable draft state exists.",
    },
    routing_override: null,
  }],
  edges: [],
};

const intake: ClarifyOutput = {
  questions: [{
    id: "intake_scope",
    question: "What context must survive?",
    why_high_impact: "It changes the recovery path.",
    kind: "constraint",
    source_dimension: "context_fit",
    allow_other: true,
    selection_mode: "multiple",
    options: [{ label: "Context answers", tradeoff: "Draft resumes in Context." }],
  }],
  assumptions: [],
};

describe("aim draft persistence helpers", () => {
  it("captures a New Aim title and Context answers as a recoverable context draft", () => {
    const req = buildAimDraftUpsertRequest({
      id: null,
      title: "Plan a local alpha demo",
      description: "Use an isolated store.",
      parent: null,
      activeStage: "context",
      phase: "intake",
      contextNote: "Keep AIMCUB_HOME under /tmp.",
      intakeClarify: intake,
      intakeAnswers: [{
        question_id: "intake_scope",
        selected_label: "Context answers",
        selected_labels: ["Context answers"],
        other_text: "Also preserve the note.",
      }],
      clarify: null,
      clarifyAnswers: [],
      draft: null,
      finalPlan: null,
      saveBlock: null,
    });

    expect(req).toMatchObject({
      title: "Plan a local alpha demo",
      currentStage: "context",
      phase: "intake",
      status: "context_needed",
      contextNote: "Keep AIMCUB_HOME under /tmp.",
    });
    expect(req?.intakeQuestions).toHaveLength(1);
    expect(req?.intakeAnswers?.[0]?.other_text).toBe("Also preserve the note.");
  });

  it("keeps generated plan edits and save-block state product-facing", () => {
    const saveBlock = saveBlockFromProductError({
      title: "Aim needs a plan repair",
      message: "Acceptance rule needs repair.",
      recovery: "Edit the contract, then save again.",
      details: ["nodes.0.acceptance_rule.clauses.0.match.min_files: Invalid input"],
    });
    const req = buildAimDraftUpsertRequest({
      id: "00000000-0000-4000-8000-000000000099",
      title: "Blocked save",
      description: "",
      parent: null,
      activeStage: "contracts",
      phase: "postDraft",
      contextNote: "",
      intakeClarify: null,
      intakeAnswers: [],
      clarify: { questions: [], assumptions: [] },
      clarifyAnswers: [],
      draft: plan,
      finalPlan: { ...plan, nodes: [{ ...plan.nodes[0]!, title: "Edited persisted plan" }] },
      saveBlock,
    });

    expect(req?.status).toBe("save_blocked");
    expect(req?.currentStage).toBe("contracts");
    expect(req?.finalPlan?.nodes[0]?.title).toBe("Edited persisted plan");
    expect(req?.saveBlock?.issues.join(" ")).not.toContain("nodes.0");
  });

  it("hydrates saved draft rows back into renderer state", () => {
    const hydrated = hydrateAimDraft({
      id: "00000000-0000-4000-8000-000000000099",
      owner_id: "00000000-0000-4000-8000-000000000001",
      title: "Resume me",
      description: "Recovered description.",
      parent_goal_id: "00000000-0000-4000-8000-000000000010",
      parent_milestone_id: "00000000-0000-4000-8000-000000000020",
      current_stage: "context",
      phase: "post_draft",
      status: "plan_ready",
      context_note: "Recovered note.",
      intake_questions: [],
      intake_answers: [],
      clarify_questions: [{
        id: "q1",
        question: "Refine?",
        why_high_impact: "Improves the plan.",
        kind: "scope",
        source_dimension: null,
        allow_other: true,
        selection_mode: "single",
        options: [{ label: "Yes", tradeoff: "Use the answer." }],
      }],
      clarify_answers: [{
        question_id: "q1",
        selected_label: "Yes",
        selected_labels: ["Yes"],
        other_text: "Keep this answer.",
      }],
      clarify_assumptions: [],
      draft_plan: plan,
      final_plan: plan,
      save_block: null,
      created_at: "2026-07-09T00:00:00.000Z",
      updated_at: "2026-07-09T00:01:00.000Z",
    });

    expect(hydrated.parent).toEqual({
      goalId: "00000000-0000-4000-8000-000000000010",
      milestoneId: "00000000-0000-4000-8000-000000000020",
    });
    expect(hydrated.phase).toBe("postDraft");
    expect(hydrated.clarify?.questions[0]?.question).toBe("Refine?");
    expect(hydrated.clarifyAnswers.q1?.other).toBe("Keep this answer.");
  });
});
