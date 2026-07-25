import { readFileSync } from "node:fs";

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { AimProgressReadModel } from "@aimcub/core";
import type { Evidence, Goal, Memory, Milestone } from "@aimcub/types";

import { I18nProvider } from "../../i18n";
import { CompletionRecapPanel, EvaluatorMatchList, EvidenceReviewList } from "./EvalStage";

const OWNER = "00000000-0000-4000-8000-000000000001";
const GOAL = "00000000-0000-4000-8000-000000000010";
const MILESTONE = "00000000-0000-4000-8000-000000000020";
const MATCHED_EVIDENCE = "00000000-0000-4000-8000-000000000030";
const LOW_TRUST_EVIDENCE = "00000000-0000-4000-8000-000000000031";
const MEMORY = "00000000-0000-4000-8000-000000000040";
const ACCEPTED_MEMORY = "00000000-0000-4000-8000-000000000041";

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

const acceptedMemory: Memory = {
  ...pendingMemory,
  id: ACCEPTED_MEMORY,
  content: "Accepted eval context should stay visible in the completion recap.",
  status: "active",
  created_at: "2026-07-07T08:12:00.000Z",
};

interface ProgressOptions {
  complete?: boolean;
  contextCandidates?: Memory[];
  learnedContext?: Memory[];
  firstEvidenceMatched?: boolean;
}

function progress(options: boolean | ProgressOptions = {}): AimProgressReadModel {
  const opts = typeof options === "boolean" ? { complete: options } : options;
  const complete = opts.complete ?? false;
  const contextCandidates = opts.contextCandidates ?? [pendingMemory];
  const learnedContext = opts.learnedContext ?? contextCandidates;
  const firstEvidenceMatched = opts.firstEvidenceMatched ?? complete;

  return {
    goal,
    milestones: [{
      milestone: { ...milestone, status: complete ? "completed" : milestone.status, completed_at: complete ? "2026-07-07T08:20:00.000Z" : null },
      assignment: null,
      latest_run: null,
      child_relations: [],
      eval_review: {
        passed: complete,
        matched_evidence_ids: firstEvidenceMatched ? [MATCHED_EVIDENCE] : [],
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
        matched_evidence_ids: firstEvidenceMatched ? [MATCHED_EVIDENCE] : [],
        trust_score: complete ? 0.92 : 0,
        explanation: complete ? "commit_pattern accepted 1 evidence item(s)." : "commit_pattern has not received sufficient matching evidence.",
        failure_reason: complete ? null : "not_satisfied",
        requires_human_confirmation: false,
      }],
      evidence: [
        {
          evidence: matchedEvidence,
          rule_matches: firstEvidenceMatched ? [{ clause_index: 0, evaluator: "commit_pattern" }] : [],
          status: firstEvidenceMatched ? "matched" : "unmatched",
          review_note: firstEvidenceMatched ? "Matches rule 1 (commit_pattern)." : "Recorded evidence does not satisfy any current acceptance rule.",
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
    context_candidates: contextCandidates,
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
      learned_context: learnedContext.map((item) => ({
        id: item.id,
        content: item.content,
        category: item.category,
        source: item.source,
        status: item.status,
        scope: item.goal_id ? "aim" : "global",
        confidence: item.confidence,
      })),
      evidence_empty_reason: "",
      context_empty_reason: "",
    } : null,
    completed_milestones: complete ? 1 : 0,
    total_milestones: 1,
    blocked_count: 0,
    next_action: complete ? "Aim is complete." : "Review run evidence against the eval rule.",
  };
}

function renderRecap(progressModel: AimProgressReadModel): string {
  return renderToStaticMarkup(
    <I18nProvider>
      <CompletionRecapPanel progress={progressModel} />
    </I18nProvider>,
  );
}

function renderReceipts(progressModel: AimProgressReadModel): string {
  const row = progressModel.milestones[0]!;
  return renderToStaticMarkup(
    <I18nProvider>
      <div>
        <EvidenceReviewList row={row} />
        <EvaluatorMatchList row={row} />
      </div>
    </I18nProvider>,
  );
}

describe("Eval receipts + completion recap (the Eval stage collapsed into the Journey)", () => {
  it("renders the evidence review with rule matches, trust, and honest review notes", () => {
    const html = renderReceipts(progress({ contextCandidates: [], firstEvidenceMatched: true }));
    const matchedTime = new Date(matchedEvidence.occurred_at).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });

    expect(html).toContain("Desktop eval evidence row rendered");
    expect(html).toContain("git commit");
    expect(html).toContain(matchedTime);
    expect(html).toContain("trust 92%");
    expect(html).toContain("Rules: #1 commit_pattern");
    expect(html).toContain("matched");
    expect(html).toContain("Matches rule 1 (commit_pattern).");
    expect(html).toContain("#1 commit_pattern");
    expect(html).toContain("low trust");
    expect(html).toContain("Trust is below the 80% floor");
  });

  it("keeps the completion recap factual with no inbox duplication", () => {
    const html = renderRecap(progress(true));

    expect(html).toContain("Completion recap");
    expect(html).toContain("Completed 1/1 sub-aims for");
    expect(html).toContain("Completed sub-aims");
    expect(html).toContain("Evidence that passed");
    expect(html).toContain("Eval result");
    expect(html).toContain("Context learned");
    expect(html).toContain("Future reuse");
    expect(html).not.toContain("Context inbox");
  });

  it("keeps accepted learned context visible in the recap without a pending-candidates block", () => {
    const html = renderRecap(progress({ complete: true, contextCandidates: [acceptedMemory], learnedContext: [acceptedMemory] }));

    expect(html).toContain("Context learned");
    expect(html).toContain("Accepted eval context should stay visible in the completion recap.");
    expect(html).not.toContain("Pending context candidates");
    expect(html).not.toContain("No pending context candidates.");
  });

  it("keeps the receipt disclosures styled as closed bordered sections", () => {
    const css = readFileSync(new URL("../../cockpit.css", import.meta.url), "utf8");

    expect(css).toMatch(/\.od-eval-detail-section\s*{[^}]*border:\s*1px solid var\(--od-border-soft\);/s);
    expect(css).toMatch(/\.od-eval-detail-section summary\s*{[^}]*cursor:\s*pointer;/s);
    expect(css).toMatch(/\.od-eval-detail-section > \.od-evidence-review,\s*[\r\n\s]*\.od-eval-detail-section > \.od-evaluator-list/s);
  });
});
