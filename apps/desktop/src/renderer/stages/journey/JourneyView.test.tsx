import type { AimProgressMilestoneRead, AimProgressReadModel, DecompositionOutput, Goal, Memory } from "@core/domain";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { ContextBundleReview } from "../../contextReview";
import { I18nProvider } from "../../i18n";
import type { JourneyStationInteraction } from "../../workflow/journey";
import { buildContextLoopModel } from "../context/contextLoop";
import { JourneyContextSheetBody, JourneyEvalSheetBody, JourneyPlanSheetBody, JourneyRunSheetBody, JourneyView, type JourneyViewProps } from "./JourneyView";

const OWNER = "owner-1";
const noop = () => {};

const goal: Goal = {
  id: "g1",
  owner_id: OWNER,
  title: "Two weeks in Japan",
  description: "Autumn, kid-friendly",
  domain: "life" as never,
  status: "active",
  target_date: null,
  plan_json: null,
  metadata: {},
};

function row(o: { id: string; title: string; human?: boolean; completed?: boolean; running?: boolean }): AimProgressMilestoneRead {
  return {
    milestone: {
      id: o.id,
      goal_id: "g1",
      owner_id: OWNER,
      title: o.title,
      description: "",
      status: (o.completed ? "completed" : "pending") as never,
      order_index: 0,
      depends_on_id: null,
      acceptance_rule: { logic: "all", clauses: [], threshold: 1, completion_mode: "manual" },
      xp_reward: 10,
      completed_at: null,
      metadata: {},
    },
    assignment: {
      id: `a-${o.id}`, owner_id: OWNER, goal_id: "g1", milestone_id: o.id,
      actor_kind: (o.human ? "human" : "agent") as never, actor_id: null,
      status: "assigned", source: "routing", reason: "", capability_tags: [],
    },
    latest_run: o.running
      ? ({ id: `r-${o.id}`, owner_id: OWNER, goal_id: "g1", milestone_id: o.id, assignment_id: null, actor_kind: "agent", actor_id: null, kind: "agent", status: "running", attempt: 1, workspace_root: null, sandbox: null, network_enabled: false, model: null, reasoning: null, summary: "drafting", error: null, started_at: null, finished_at: null } as never)
      : null,
    child_relations: [],
    eval_review: { passed: Boolean(o.completed), matched_evidence_ids: [], trust_score: 0, reason: "", next_action: "" },
    evaluator_results: [],
    evidence: [],
    evidence_count: 0,
    completed: Boolean(o.completed),
    blocked: false,
    next_action: "",
  } as AimProgressMilestoneRead;
}

function progressOf(rows: AimProgressMilestoneRead[], extra: Partial<AimProgressReadModel> = {}): AimProgressReadModel {
  return {
    goal,
    milestones: rows,
    actors: [],
    assignments: [],
    runs: rows.map((r) => r.latest_run).filter(Boolean) as never[],
    sub_aim_relations: [],
    context_candidates: [],
    completion_recap: null,
    completed_milestones: rows.filter((r) => r.completed).length,
    total_milestones: rows.length,
    blocked_count: 0,
    next_action: "Pick a flight",
    ...extra,
  } as AimProgressReadModel;
}

function render(progress: AimProgressReadModel | null, extra: Partial<JourneyViewProps> = {}): string {
  return renderToStaticMarkup(
    <I18nProvider>
      <JourneyView goal={goal} progress={progress} onOpenStage={noop} onRunAgent={noop} onNewAim={noop} {...extra} />
    </I18nProvider>,
  );
}

// A minimal valid plan for the in-Journey first-plan review surface (Stage 6A).
const miniPlan: DecompositionOutput = {
  goal_summary: "Ship it.",
  domain: "software",
  rationale: "Needs a plan.",
  nodes: [
    {
      key: "n1",
      title: "Do the thing",
      description: "d",
      est_effort: "s",
      xp_reward: 10,
      acceptance_rule: {
        logic: "all",
        threshold: 1,
        completion_mode: "auto_then_confirm",
        clauses: [{ evaluator: "manual_confirm", auto_verifiable: false, match: {} }],
      },
      decomposition_contract: {
        why: "w",
        definition_of_done: "done",
        required_evidence: ["e"],
        likely_owner: "human",
        context_gaps: [],
        eval_signal: "s",
      },
      routing_override: null,
    },
  ],
  edges: [],
} as unknown as DecompositionOutput;

describe("JourneyView", () => {
  it("renders the aim title, all six stations, and the journal", () => {
    const html = render(progressOf([row({ id: "m1", title: "Book flights", human: true })]));
    expect(html).toContain("Two weeks in Japan");
    for (const name of ["Aim", "Research", "Context", "Plan", "Run", "Eval"]) {
      expect(html).toContain(`>${name}`);
    }
    expect(html).toContain("Journal");
    expect(html).toContain("journey-view");
  });

  it("shows a Your-move card for a human-routed task", () => {
    const html = render(progressOf([row({ id: "m1", title: "Book flights", human: true })]));
    expect(html).toContain("journey-move");
    expect(html).toContain("YOUR MOVE");
    expect(html).toContain("Book flights");
  });

  it("shows the Ambient card when the only work is an agent running", () => {
    const html = render(progressOf([row({ id: "m1", title: "Drafting", running: true })]));
    expect(html).toContain("journey-ambient");
    expect(html).not.toContain("journey-move");
  });

  it("renders a no-plan state when progress is null", () => {
    const html = render(null);
    expect(html).toContain("Two weeks in Japan");
    expect(html).toContain("Gather context");
  });

  it("shows the in-Journey aim-rename control only when onRenameAim is provided (both header sites)", () => {
    // Main (planned) header + the plan-less shell header both gate the control on the prop.
    const planned = progressOf([row({ id: "m1", title: "Book flights", human: true })]);
    expect(render(planned)).not.toContain("od-journey-aim-rename");
    expect(render(planned, { onRenameAim: noop })).toContain("od-journey-aim-rename");
    expect(render(null)).not.toContain("od-journey-aim-rename");
    expect(render(null, { onRenameAim: noop })).toContain("od-journey-aim-rename");
  });

  it("renders a You chip in the Your-move head", () => {
    const html = render(progressOf([row({ id: "m1", title: "Book flights", human: true })]));
    expect(html).toContain("od-journey-move-head");
    expect(html).toContain("od-journey-chip-you");
  });

  it("shows the 'N turns elsewhere' jump chip only when there are turns elsewhere", () => {
    const p = progressOf([row({ id: "m1", title: "x", human: true })]);
    const many = render(p, { elsewhereCount: 2, onJumpElsewhere: noop });
    expect(many).toContain("od-journey-elsewhere");
    expect(many).toContain("2 turns elsewhere");

    const one = render(p, { elsewhereCount: 1, onJumpElsewhere: noop });
    expect(one).toContain("1 turn elsewhere");

    const none = render(p, { elsewhereCount: 0, onJumpElsewhere: noop });
    expect(none).not.toContain("od-journey-elsewhere");
  });

  it("hides the secondary move actions unless their handlers are provided", () => {
    const p = progressOf([row({ id: "m1", title: "Book flights", human: true })]);
    expect(render(p)).not.toContain("od-journey-move-secondary");

    const withHandlers = render(p, { onHandToAgent: noop, onLater: noop });
    expect(withHandlers).toContain("od-journey-move-secondary");
    expect(withHandlers).toContain("Hand to agent");
    expect(withHandlers).toContain("Later");
    expect(withHandlers).not.toContain("Schedule"); // onSchedule not passed
  });

  it("shows the ambient take-back button only when its handler is provided", () => {
    const p = progressOf([row({ id: "m1", title: "Drafting", running: true })]);
    const bare = render(p);
    expect(bare).toContain("od-journey-ambient");
    expect(bare).not.toContain("od-journey-ambient-btn");

    const withTakeBack = render(p, { onTakeBack: noop });
    expect(withTakeBack).toContain("od-journey-ambient-btn");
    expect(withTakeBack).toContain("Take it back");
  });

  // ── Stage 6A: goal-first in-Journey first-plan ──

  it("renders the build-the-plan card for a plan-less shell, not a false-complete ambient", () => {
    // A shell has 0 milestones; buildAimProgressReadModel would report next_action "Aim is complete."
    const html = render(progressOf([], { next_action: "Aim is complete." }), { onStartResearch: noop });
    expect(html).toContain("journey-build-plan");
    expect(html).toContain("Build the plan");
    expect(html).not.toContain("journey-ambient");
    expect(html).not.toContain("Aim is complete.");
  });

  it("links to Settings from the build-plan card when no planning runtime is configured", () => {
    const html = render(progressOf([]), { onStartResearch: noop, planningRuntimeReady: false });
    expect(html).toContain("Connect a runtime in Settings");
    expect(html).not.toContain(">Build the plan<");
  });

  it("hosts the in-Journey clarify Q&A while a clarify phase is active", () => {
    const html = render(progressOf([]), {
      planning: { busy: false, clarifyPanel: <div>CLARIFY_QA_MARKER</div>, planReady: false, onCommitPlan: noop },
    });
    expect(html).toContain("journey-planning");
    expect(html).toContain("CLARIFY_QA_MARKER");
    expect(html).not.toContain("journey-build-plan");
  });

  it("hosts the generated plan review + Save when a plan is ready", () => {
    const html = render(progressOf([]), {
      planning: { busy: false, clarifyPanel: null, planReady: true, onCommitPlan: noop },
      planReview: { plan: miniPlan, quality: null, review: null, validationErrors: [], routingAgents: [], routingValidation: null },
    });
    expect(html).toContain("Review the plan");
    expect(html).toContain("Save plan");
    expect(html).toContain("od-journey-plan");
  });

  it("shows a working indicator while the plan is generating", () => {
    const html = render(progressOf([]), {
      planning: { busy: true, clarifyPanel: null, planReady: false, onCommitPlan: noop },
    });
    expect(html).toContain("od-journey-planning-working");
    expect(html).toContain("Working on the plan");
  });
});

describe("JourneyRunSheetBody", () => {
  const interaction: JourneyStationInteraction = {
    actionKind: "run_agent",
    options: [
      { milestoneId: "m1", text: "Draft the copy", note: "pending", chip: "owner.agent" },
      { milestoneId: "m2", text: "Book the venue", note: "pending", chip: "owner.agent" },
    ],
    evidenceOptions: [],
    contextRows: [{ chip: "status.blocked", text: "Blocked bit", meta: "blocked" }],
  };

  function renderBody(selectedOptionId: string | null, disabled = false): string {
    return renderToStaticMarkup(
      <I18nProvider>
        <JourneyRunSheetBody
          interaction={interaction}
          selectedOptionId={selectedOptionId}
          disabled={disabled}
          onSelect={noop}
          onConfirm={noop}
        />
      </I18nProvider>,
    );
  }

  it("renders a radiogroup of options plus read-only context, confirm disabled until a pick", () => {
    const html = renderBody(null);
    expect(html).toContain('role="radiogroup"');
    expect(html).toContain('role="radio"');
    expect(html).toContain("Draft the copy");
    expect(html).toContain("Book the venue");
    expect(html).toContain("Blocked bit"); // non-dispatchable context stays visible
    expect(html).toContain('aria-checked="false"');
    expect(html).toContain("Pick one to continue");
    expect(html).toContain("disabled"); // the confirm button
  });

  it("enables confirm and marks the chosen option once a selection is made", () => {
    const html = renderBody("m2");
    expect(html).toContain("Run with agent");
    expect(html).toContain('aria-checked="true"');
    expect(html).toContain("od-journey-option-open");
    expect(html).not.toContain("Pick one to continue");
  });

  it("keeps confirm disabled while busy even with a valid selection", () => {
    const html = renderBody("m2", true);
    expect(html).toContain("Run with agent"); // label reflects the live selection
    expect(html).toContain("disabled"); // but busy → not confirmable
  });

  const evidenceInteraction: JourneyStationInteraction = {
    actionKind: "run_agent",
    options: [],
    evidenceOptions: [{ milestoneId: "h1", text: "Submit launch approval", note: "pending", chip: "owner.you" }],
    contextRows: [],
  };

  it("renders ready human milestones as actionable evidence options when a submit handler is wired", () => {
    const html = renderToStaticMarkup(
      <I18nProvider>
        <JourneyRunSheetBody
          interaction={evidenceInteraction}
          selectedOptionId={null}
          disabled={false}
          onSelect={noop}
          onConfirm={noop}
          onPickEvidence={noop}
        />
      </I18nProvider>,
    );
    expect(html).toContain("od-journey-evidence-option");
    expect(html).toContain("Submit launch approval");
    expect(html).toContain("Your move — submit proof");
    expect(html).not.toContain('role="radiogroup"'); // no agent work → no radiogroup or confirm hint
    expect(html).not.toContain("Pick one to continue");
  });

  it("renders evidence options as read-only rows when no submit handler is wired (honest)", () => {
    const html = renderToStaticMarkup(
      <I18nProvider>
        <JourneyRunSheetBody
          interaction={evidenceInteraction}
          selectedOptionId={null}
          disabled={false}
          onSelect={noop}
          onConfirm={noop}
        />
      </I18nProvider>,
    );
    expect(html).toContain("Submit launch approval");
    expect(html).not.toContain("od-journey-evidence-option"); // not actionable without a handler
  });
});

describe("JourneyContextSheetBody", () => {
  const emptyReview: ContextBundleReview = {
    usedContext: [],
    skippedContext: [],
    permissionGaps: [],
    decompositionRisks: [],
    sourceCount: 0,
  };
  const reviewWithItems: ContextBundleReview = {
    usedContext: [{ id: "u1", title: "Prefers nonstop flights", body: "From the Japan trip", meta: [], tone: "neutral" }],
    skippedContext: [],
    permissionGaps: [],
    decompositionRisks: [],
    sourceCount: 1,
  };
  // Real builder → valid i18n message keys; running:true flips hasLiveResearchData on.
  const idleLoop = buildContextLoopModel({ contextSources: null, review: emptyReview });
  const liveLoop = buildContextLoopModel({ contextSources: null, review: emptyReview, running: true });

  function candidate(): Memory {
    return {
      id: "aaaaaaaa-1111-4111-8111-111111111111",
      owner_id: "bbbbbbbb-2222-4222-8222-222222222222",
      goal_id: "g1",
      kind: "semantic",
      category: "preference",
      content: "Prefers nonstop flights when traveling with kids.",
      confidence: 0.9,
      source: "user_stated",
      status: "pending",
      superseded_by: null,
      created_at: "2026-07-05T08:00:00.000Z",
    } as Memory;
  }

  function renderBody(
    over: Partial<{ loop: typeof idleLoop; review: ContextBundleReview; pendingCandidates: Memory[]; disabled: boolean }> = {},
  ): string {
    return renderToStaticMarkup(
      <I18nProvider>
        <JourneyContextSheetBody
          loop={over.loop ?? idleLoop}
          review={over.review ?? emptyReview}
          pendingCandidates={over.pendingCandidates ?? []}
          currentAimTitle="Two weeks in Japan"
          disabled={over.disabled ?? false}
          onAccept={noop}
          onReject={noop}
        />
      </I18nProvider>,
    );
  }

  it("shows the honest empty hint when nothing is pending, live, or reviewed", () => {
    const html = renderBody();
    expect(html).toContain("Context is folded into the plan");
    expect(html).not.toContain("od-context-inbox");
    expect(html).not.toContain("context-activity-surface");
    expect(html).not.toContain("context-bundle-review");
  });

  it("renders the pending-candidate inbox (actionable triage)", () => {
    const html = renderBody({ pendingCandidates: [candidate()] });
    expect(html).toContain("od-context-inbox");
    expect(html).toContain("Prefers nonstop flights when traveling with kids.");
    expect(html).toContain("Accept");
    expect(html).toContain("Reject");
    expect(html).not.toContain("Context is folded into the plan");
  });

  it("shows the activity panel only while research is live", () => {
    expect(renderBody({ loop: liveLoop })).toContain("context-activity-surface");
    expect(renderBody({ loop: idleLoop })).not.toContain("context-activity-surface");
  });

  it("renders the context review receipt when there are review items", () => {
    const html = renderBody({ review: reviewWithItems });
    expect(html).toContain("context-bundle-review");
    expect(html).toContain("Prefers nonstop flights");
    expect(html).not.toContain("Context is folded into the plan");
  });
});

describe("JourneyPlanSheetBody", () => {
  // Two nodes so the contract selector renders (PlanPanel gates it on nodes.length > 1); the second
  // node's distinctive body text must NOT appear (only the selected first node's card is rendered).
  const planFixture: DecompositionOutput = {
    goal_summary: "Ship a useful contract review.",
    domain: "software",
    rationale: "The aim needs execution contracts before work is saved.",
    nodes: [
      {
        key: "contract-review",
        title: "Review execution contracts",
        description: "Check the sub-aim contract before saving.",
        est_effort: "s",
        xp_reward: 10,
        acceptance_rule: {
          logic: "all",
          threshold: 1,
          completion_mode: "auto_then_confirm",
          clauses: [{ evaluator: "manual_confirm", auto_verifiable: false, match: {} }],
        },
        decomposition_contract: {
          why: "A clear agreement before execution starts.",
          definition_of_done: "Every sub-aim has a clear owner and evidence standard.",
          required_evidence: ["Reviewed contract notes."],
          likely_owner: "human",
          context_gaps: [],
          eval_signal: "The saved aim contains reviewed contract terms.",
        },
        routing_override: null,
      },
      {
        key: "ship-contract",
        title: "Ship the reviewed contract",
        description: "Deliver the final signed-off contract to the owner.",
        est_effort: "s",
        xp_reward: 10,
        acceptance_rule: {
          logic: "all",
          threshold: 1,
          completion_mode: "auto_then_confirm",
          clauses: [{ evaluator: "manual_confirm", auto_verifiable: false, match: {} }],
        },
        decomposition_contract: {
          why: "The reviewed contract must reach the owner.",
          definition_of_done: "The owner has the signed-off contract.",
          required_evidence: ["Delivery receipt."],
          likely_owner: "human",
          context_gaps: [],
          eval_signal: "The owner acknowledges receipt.",
        },
        routing_override: null,
      },
    ],
    edges: [],
  };

  function renderBody(opts: { editable?: boolean; disabled?: boolean } = {}): string {
    return renderToStaticMarkup(
      <I18nProvider>
        <JourneyPlanSheetBody
          plan={planFixture}
          quality={null}
          review={null}
          validationErrors={[]}
          routingAgents={[]}
          routingValidation={null}
          disabled={opts.disabled ?? false}
          onCommitPlan={opts.editable ? noop : undefined}
        />
      </I18nProvider>,
    );
  }

  it("hosts the real read-only plan contract interior (selector + one contract card)", () => {
    const html = renderBody();
    expect(html).toContain("od-journey-plan");
    expect(html).toContain('data-od-id="plan-contract-selector"');
    expect(html.match(/class="od-plan-contract-card/g)).toHaveLength(1);
    // The selected (first) node's contract renders read-only.
    expect(html).toContain("od-plan-readonly-title");
    expect(html).toContain("Review execution contracts");
    // Only the selected node's card is shown — the other node's body text stays hidden.
    expect(html).not.toContain("Deliver the final signed-off contract to the owner.");
  });

  it("renders read-only (no edit affordances) when no commit handler is wired", () => {
    const html = renderBody();
    expect(html).not.toContain("<textarea"); // no editable contract/rule fields
    expect(html).not.toContain("od-plan-routing-details"); // routing controls are editable-gated
    expect(html).not.toContain("od-plan-structure-details"); // reorder/merge/split are editable-gated
    expect(html).not.toContain("od-journey-plan-actions"); // no commit row without onCommitPlan
    expect(html).not.toContain("Save plan changes");
  });

  it("becomes editable in place with a buffered Save plan changes commit (Stage 6B)", () => {
    const html = renderBody({ editable: true });
    // The editable contract interior appears (the affordances the read-only case denies).
    expect(html).toContain("od-plan-structure-details");
    expect(html).not.toContain("od-plan-readonly-title");
    // The sheet's own commit row (distinct from the funnel's "Save aim" button).
    expect(html).toContain("od-journey-plan-actions");
    expect(html).toContain("Save plan changes");
    // Disabled until the buffer is dirty (nothing edited yet at initial render).
    expect(html).toMatch(/Save plan changes[\s\S]*?<\/button>/);
    expect(html).not.toContain("Save aim"); // not the funnel save button
  });
});

describe("JourneyEvalSheetBody", () => {
  function renderBody(progress: AimProgressReadModel): string {
    return renderToStaticMarkup(
      <I18nProvider>
        <JourneyEvalSheetBody progress={progress} />
      </I18nProvider>,
    );
  }

  function evidenceRow(): AimProgressMilestoneRead {
    return {
      ...row({ id: "m1", title: "Ship the fix" }),
      evidence: [
        {
          evidence: {
            id: "ev-1", owner_id: OWNER, goal_id: "g1", milestone_id: "m1", emitter_id: null,
            kind: "git_commit", source_event_id: "commit:xyz", occurred_at: "2026-07-07T08:00:00.000Z",
            summary: "Journey eval evidence row rendered", payload: { message: "Fix" }, trust_score: 0.9,
            created_at: "2026-07-07T08:00:00.000Z",
          },
          rule_matches: [],
          status: "matched",
          review_note: "Matches the acceptance rule.",
        },
      ],
      evidence_count: 1,
    } as AimProgressMilestoneRead;
  }

  it("frames every milestone with a met/open chip and no evidence list when there is no evidence", () => {
    const html = renderBody(progressOf([
      row({ id: "m1", title: "Book flights", human: true }),
      row({ id: "m2", title: "Draft the copy" }),
    ]));
    expect(html).toContain("od-journey-eval");
    expect(html).toContain("od-journey-eval-title");
    expect(html).toContain("Book flights");
    expect(html).toContain("Draft the copy"); // no milestone dropped
    expect(html).toContain("od-journey-chip-eval");
    expect(html).not.toContain("od-evidence-review"); // nothing to review yet
  });

  it("nests the read-only evidence review under a milestone that has evidence", () => {
    const html = renderBody(progressOf([evidenceRow()]));
    expect(html).toContain("od-journey-eval");
    expect(html).toContain("od-evidence-review");
    expect(html).toContain("Journey eval evidence row rendered");
  });

  it("shows the completion recap when the aim is complete", () => {
    const recap = {
      complete: true,
      final_outcome: "Completed 1/1 sub-aims.",
      completed_sub_aims: [{
        milestone_id: "m1", title: "Ship the fix", outcome: "Shipped.",
        completed_at: "2026-07-07T08:20:00.000Z", decided_by: "rule_auto",
        evidence_ids: [], eval_status: "passed",
      }],
      passing_evidence: [],
      eval_results: [],
      learned_context: [],
      evidence_empty_reason: "",
      context_empty_reason: "",
    };
    const html = renderBody(progressOf(
      [row({ id: "m1", title: "Ship the fix", completed: true })],
      { completion_recap: recap as AimProgressReadModel["completion_recap"] },
    ));
    expect(html).toContain("Completion recap");
    expect(html).toContain("Completed 1/1 sub-aims.");
    expect(html).not.toContain("od-journey-eval-title"); // recap branch, not the per-milestone frame
  });
});
