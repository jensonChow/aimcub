import { readFileSync } from "node:fs";

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { AimProgressReadModel } from "@core/domain";
import type { Evidence, Goal, Memory, Milestone } from "@core/types";

import { I18nProvider } from "../../i18n";
import { EvalStage } from "./EvalStage";

const OWNER = "00000000-0000-4000-8000-000000000001";
const GOAL = "00000000-0000-4000-8000-000000000010";
const MILESTONE = "00000000-0000-4000-8000-000000000020";
const MATCHED_EVIDENCE = "00000000-0000-4000-8000-000000000030";
const LOW_TRUST_EVIDENCE = "00000000-0000-4000-8000-000000000031";
const MEMORY = "00000000-0000-4000-8000-000000000040";

const noop = () => {};

const goal: Goal = {
  id: GOAL,
  owner_id: OWNER,
  title: "Clarify eval review",
  description: "Make Eval explain evidence and trust.",
  domain: "software",
  status: "active",
  target_date: null,
  plan_json: null,
  metadata: {},
};

const milestone: Milestone = {
  id: MILESTONE,
  goal_id: GOAL,
  owner_id: OWNER,
  title: "Show evidence review",
  description: "Render rule matching and low-trust proof.",
  status: "in_progress",
  order_index: 0,
  depends_on_id: null,
  acceptance_rule: {
    logic: "all",
    threshold: 1,
    completion_mode: "auto_then_confirm",
    clauses: [{ evaluator: "commit_pattern", auto_verifiable: true, match: { path_glob: "apps/desktop/**", min_files: 1 } }],
  },
  xp_reward: 10,
  completed_at: null,
  metadata: {},
};

const matchedEvidence: Evidence = {
  id: MATCHED_EVIDENCE,
  owner_id: OWNER,
  goal_id: GOAL,
  milestone_id: MILESTONE,
  emitter_id: null,
  kind: "git_commit",
  source_event_id: "commit:abc123",
  occurred_at: "2026-07-07T08:00:00.000Z",
  summary: "Desktop eval evidence row rendered",
  payload: {
    message: "Clarify eval evidence review",
    branch: "main",
    files: ["apps/desktop/src/renderer/stages/eval/EvalStage.tsx"],
  },
  trust_score: 0.92,
  created_at: "2026-07-07T08:00:00.000Z",
};

const lowTrustEvidence: Evidence = {
  id: LOW_TRUST_EVIDENCE,
  owner_id: OWNER,
  goal_id: GOAL,
  milestone_id: MILESTONE,
  emitter_id: null,
  kind: "mcp_report",
  source_event_id: "agent:self-report",
  occurred_at: "2026-07-07T08:05:00.000Z",
  summary: "Agent self-report needs trusted proof",
  payload: {},
  trust_score: 0.45,
  created_at: "2026-07-07T08:05:00.000Z",
};

const pendingMemory: Memory = {
  id: MEMORY,
  owner_id: OWNER,
  goal_id: GOAL,
  kind: "semantic",
  category: "eval_signal",
  content: "Eval signal: Evidence review should show rule matches and trust before completion.",
  confidence: 0.84,
  source: "evidence_derived",
  status: "pending",
  superseded_by: null,
  created_at: "2026-07-07T08:10:00.000Z",
};

function progress(complete = false): AimProgressReadModel {
  return {
    goal,
    milestones: [{
      milestone: { ...milestone, status: complete ? "completed" : milestone.status, completed_at: complete ? "2026-07-07T08:20:00.000Z" : null },
      assignment: null,
      latest_run: null,
      child_relations: [],
      eval_review: {
        passed: complete,
        matched_evidence_ids: complete ? [MATCHED_EVIDENCE] : [],
        trust_score: complete ? 0.92 : 0,
        reason: complete
          ? "All acceptance rules passed with 1 matched evidence item."
          : "1 evidence item is below the auto-verification trust floor.",
        next_action: complete
          ? "Review the matched evidence for the audit trail."
          : "Add trusted webhook or CI evidence, or confirm manually if the proof is sufficient.",
      },
      evaluator_results: [{
        evaluator: "commit_pattern",
        status: complete ? "passed" : "failed",
        matched_evidence_ids: complete ? [MATCHED_EVIDENCE] : [],
        trust_score: complete ? 0.92 : 0,
        explanation: complete ? "commit_pattern accepted 1 evidence item(s)." : "commit_pattern has not received sufficient matching evidence.",
        failure_reason: complete ? null : "not_satisfied",
        requires_human_confirmation: false,
      }],
      evidence: [
        {
          evidence: matchedEvidence,
          rule_matches: complete ? [{ clause_index: 0, evaluator: "commit_pattern" }] : [],
          status: complete ? "matched" : "unmatched",
          review_note: complete ? "Matches rule 1 (commit_pattern)." : "Recorded evidence does not satisfy any current acceptance rule.",
        },
        {
          evidence: lowTrustEvidence,
          rule_matches: [],
          status: "low_trust",
          review_note: "Trust is below the 80% floor for auto-verifiable rules; add trusted evidence or confirm manually.",
        },
      ],
      evidence_count: 2,
      completed: complete,
      blocked: false,
      next_action: complete ? "Completed." : "Review run evidence against the eval rule.",
    }],
    actors: [],
    assignments: [],
    runs: [],
    sub_aim_relations: [],
    context_candidates: [pendingMemory],
    completion_recap: complete ? {
      complete: true,
      final_outcome: "Completed 1/1 sub-aims for \"Clarify eval review\".",
      completed_sub_aims: [{
        milestone_id: MILESTONE,
        title: "Show evidence review",
        outcome: "Evidence review is clear.",
        completed_at: "2026-07-07T08:20:00.000Z",
        decided_by: "rule_auto",
        evidence_ids: [MATCHED_EVIDENCE],
        eval_status: "passed",
      }],
      passing_evidence: [{
        id: MATCHED_EVIDENCE,
        milestone_id: MILESTONE,
        kind: "git_commit",
        summary: "Desktop eval evidence row rendered",
        occurred_at: "2026-07-07T08:00:00.000Z",
        trust_score: 0.92,
      }],
      eval_results: [{
        milestone_id: MILESTONE,
        evaluator: "commit_pattern",
        status: "passed",
        explanation: "commit_pattern accepted 1 evidence item(s).",
        trust_score: 0.92,
        matched_evidence_ids: [MATCHED_EVIDENCE],
      }],
      learned_context: [{
        id: MEMORY,
        content: pendingMemory.content,
        category: "eval_signal",
        source: "evidence_derived",
        status: "pending",
        scope: "aim",
        confidence: 0.84,
      }],
      evidence_empty_reason: "",
      context_empty_reason: "",
    } : null,
    completed_milestones: complete ? 1 : 0,
    total_milestones: 1,
    blocked_count: 0,
    next_action: complete ? "Aim is complete." : "Review run evidence against the eval rule.",
  };
}

function renderEval(progressModel: AimProgressReadModel): string {
  return renderToStaticMarkup(
    <I18nProvider>
      <EvalStage
        goalTitle={progressModel.goal.title}
        rows={progressModel.milestones}
        progress={progressModel}
        disabled={false}
        onAcceptContextCandidate={noop}
        onRejectContextCandidate={noop}
      />
    </I18nProvider>,
  );
}

describe("EvalStage", () => {
  it("renders evidence, rule matches, trust, missing proof, and context candidates", () => {
    const html = renderEval(progress(false));

    expect(html).toContain("Evidence and eval review");
    expect(html).toContain("Missing rule matches");
    expect(html).toContain("Low-trust evidence");
    expect(html).toContain("Context candidates");
    expect(html).toContain("Rule/evaluator matches");
    expect(html).toContain("Evidence review");
    expect(html).toContain("Agent self-report needs trusted proof");
    expect(html).toContain("low trust");
    expect(html).toContain("trust 45%");
    expect(html).toContain("No acceptance rule match yet.");
    expect(html).toContain("Trust is below the 80% floor");
    expect(html).toContain("Context inbox");
    expect(html).toContain("Accepted global context is reused when Aimcub plans future aims.");
  });

  it("keeps the completion recap factual and leaves Context Inbox in Eval flow", () => {
    const html = renderEval(progress(true));

    expect(html).toContain("Completion recap");
    expect(html).toContain("Completed 1/1 sub-aims for");
    expect(html).toContain("Completed sub-aims");
    expect(html).toContain("Evidence that passed");
    expect(html).toContain("Eval result");
    expect(html).toContain("Context learned");
    expect(html).toContain("Future reuse");
    expect(html).toContain("Context inbox");
  });

  it("keeps Eval CSS scoped to stage content surfaces", () => {
    const css = readFileSync(new URL("../../cockpit.css", import.meta.url), "utf8");

    expect(css).toMatch(/\.od-eval-review-strip\s*{[^}]*grid-template-columns:\s*repeat\(3, minmax\(0, 1fr\)\);/s);
    expect(css).toMatch(/\.od-eval-review-section\s*{[^}]*border-top:\s*1px solid var\(--od-border-soft\);/s);
    expect(css).toMatch(/\.od-eval-review-strip,\s*[\r\n\s]*\.od-work-detail-grid/s);
  });
});
