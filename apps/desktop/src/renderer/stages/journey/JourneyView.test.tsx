import type { AimProgressMilestoneRead, AimProgressReadModel, DecompositionOutput, Goal, Memory } from "@aimcub/core";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { I18nProvider } from "../../i18n";
import { JourneyPlanBand, planRowIsLive, type JourneyPlanBandProps } from "./JourneyPlanBand";
import { JourneyPlanReview, JourneyView, type JourneyViewProps } from "./JourneyView";

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
  it("renders the aim title, the plan band, and the journal — with no station strip, sheet, or turns roster", () => {
    const html = render(progressOf([row({ id: "m1", title: "Book flights", human: true })]));
    expect(html).toContain("Two weeks in Japan");
    expect(html).toContain("journey-plan-band");
    expect(html).toContain("Journal");
    expect(html).toContain("journey-view");
    expect(html).not.toContain("od-journey-stations");
    expect(html).not.toContain("od-journey-sheet");
    expect(html).not.toContain("od-journey-turns");
  });

  it("keeps the journal behind a quiet disclosure (a details element, closed by default)", () => {
    const html = render(progressOf([row({ id: "m1", title: "Book flights", human: true })]));
    expect(html).toContain("<details class=\"od-journey-journal\"");
    expect(html).toContain("<summary class=\"od-journey-journal-head\"");
    expect(html).not.toContain("<details class=\"od-journey-journal\" open");
  });

  it("surfaces pending context candidates as an inline review band only when they exist", () => {
    const candidate: Memory = {
      id: "c1", owner_id: OWNER, goal_id: "g1", kind: "semantic", category: "preference",
      content: "Prefers window seats", confidence: 0.7, source: "agent_inferred", status: "pending",
      superseded_by: null,
    } as Memory;
    const p = progressOf([row({ id: "m1", title: "Book flights", human: true })], { context_candidates: [candidate] });
    const withHandlers = render(p, { onAcceptContextCandidate: noop, onRejectContextCandidate: noop });
    expect(withHandlers).toContain("journey-inbox");
    expect(withHandlers).toContain("Prefers window seats");

    expect(render(p)).not.toContain("journey-inbox"); // no handlers → no dead surface
    const none = render(progressOf([row({ id: "m1", title: "Book flights", human: true })]), {
      onAcceptContextCandidate: noop,
      onRejectContextCandidate: noop,
    });
    expect(none).not.toContain("journey-inbox"); // no candidates → no band
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

  it("renders a quiet header-only state while progress has not loaded", () => {
    const html = render(null);
    expect(html).toContain("Two weeks in Japan");
    expect(html).not.toContain("od-journey-primary"); // no dead CTA into removed stages
  });

  it("leads with the completion recap for a completed aim (no live lane, no plan band)", () => {
    const recap = {
      complete: true,
      final_outcome: "Completed 1/1 sub-aims.",
      completed_sub_aims: [],
      passing_evidence: [],
      eval_results: [],
      learned_context: [],
      evidence_empty_reason: "",
      context_empty_reason: "",
    };
    const html = render(progressOf(
      [row({ id: "m1", title: "Ship the fix", completed: true })],
      { completion_recap: recap as AimProgressReadModel["completion_recap"] },
    ));
    expect(html).toContain("Completion recap");
    expect(html).toContain("Completed 1/1 sub-aims.");
    expect(html).not.toContain("journey-plan-band");
    expect(html).not.toContain("journey-move");
    expect(html).toContain("od-journey-journal");
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
    expect(html).toContain("Start planning");
    expect(html).not.toContain("journey-ambient");
    expect(html).not.toContain("Aim is complete.");
  });

  it("shows a stopped pass instead of the start card — an aim already being planned never re-asks", () => {
    // The founder's 2026-07-26 report: this aim HAD been planned, and the Journey greeted him with
    // "Start planning" as though nothing had happened.
    const html = render(progressOf([]), {
      onStartResearch: noop,
      pausedPlanning: <div>PAUSED_PASS_MARKER</div>,
    });
    expect(html).toContain("journey-paused-planning");
    expect(html).toContain("PAUSED_PASS_MARKER");
    expect(html).not.toContain("journey-build-plan");
    expect(html).not.toContain(">Start planning<");
  });

  it("keeps the start card for an aim with no pass at all", () => {
    // No checkpoint means nothing was ever planned: the ordinary start card IS the honest state.
    const html = render(progressOf([]), { onStartResearch: noop, pausedPlanning: undefined });
    expect(html).toContain("journey-build-plan");
    expect(html).not.toContain("journey-paused-planning");
  });

  it("lets a LIVE session outrank a checkpointed pass", () => {
    // A pass is the trailing record of a session that stopped; if one is running, it owns the lane.
    const html = render(progressOf([]), {
      planning: { busy: true, clarifyPanel: <div>LIVE_MARKER</div>, planReady: false, onCommitPlan: noop },
      pausedPlanning: <div>PAUSED_PASS_MARKER</div>,
    });
    expect(html).toContain("LIVE_MARKER");
    expect(html).not.toContain("PAUSED_PASS_MARKER");
  });

  it("ignores a pass once the aim has a plan", () => {
    const html = render(progressOf([row({ id: "m1", title: "Ship it", human: true })]), {
      pausedPlanning: <div>PAUSED_PASS_MARKER</div>,
    });
    expect(html).not.toContain("PAUSED_PASS_MARKER");
    expect(html).not.toContain("journey-paused-planning");
  });

  it("links to Settings from the build-plan card when no planning runtime is configured", () => {
    const html = render(progressOf([]), { onStartResearch: noop, planningRuntimeReady: false });
    expect(html).toContain("Connect a planning brain in Settings");
    expect(html).not.toContain(">Start planning<");
  });

  it("swaps the header sub for the planning explainer while a session runs", () => {
    const planning = render(progressOf([]), {
      planning: { busy: true, clarifyPanel: null, planReady: false, onCommitPlan: noop },
    });
    expect(planning).toContain("asks only what research can");
    const idle = render(progressOf([row({ id: "m1", title: "x", human: true })]));
    expect(idle).toContain("an aim moves by turns");
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
    expect(html).toContain("Adopt this plan");
    expect(html).toContain("od-journey-plan");
  });

  it("shows a working indicator while the plan is generating", () => {
    const html = render(progressOf([]), {
      planning: { busy: true, clarifyPanel: null, planReady: false, onCommitPlan: noop },
    });
    expect(html).toContain("od-journey-planning-working");
    expect(html).toContain("Aimcub is researching and drafting");
  });
});

describe("JourneyPlanReview", () => {
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
        <JourneyPlanReview
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

describe("JourneyPlanBand (the plan as the object, Collapse Stage 1)", () => {
  function renderBand(rows: AimProgressMilestoneRead[], extra: Partial<JourneyPlanBandProps> = {}): string {
    return renderToStaticMarkup(
      <I18nProvider>
        <JourneyPlanBand
          progress={progressOf(rows)}
          disabled={false}
          selectedMilestoneId={null}
          onSelectMilestone={noop}
          activeProofId={null}
          onProofActiveChange={noop}
          onRunAgent={noop}
          {...extra}
        />
      </I18nProvider>,
    );
  }

  it("renders one collapsed row per sub-aim with owner chip and status pill", () => {
    const html = renderBand([
      row({ id: "m1", title: "Book flights", human: true }),
      row({ id: "m2", title: "Draft itinerary" }),
    ]);
    expect(html).toContain("journey-plan-band");
    expect(html).toContain("Book flights");
    expect(html).toContain("Draft itinerary");
    expect(html).toContain("od-journey-chip-you");
    expect(html).toContain("od-journey-chip-agent");
    expect(html).not.toContain("journey-planrow-detail");
  });

  it("expands the selected row to the work detail with consent control for an agent route", () => {
    const html = renderBand(
      [row({ id: "m1", title: "Draft itinerary" })],
      { selectedMilestoneId: "m1" },
    );
    expect(html).toContain("journey-planrow-detail");
    expect(html).toContain("od-run-permission");
    expect(html).toContain("od-execute-primary-action");
  });

  it("shows the proof form in place of the normal detail when the row's proof is active", () => {
    const html = renderBand(
      [row({ id: "m1", title: "Confirm the booking", human: true })],
      { selectedMilestoneId: "m1", activeProofId: "m1", onConfirmMilestone: async () => true },
    );
    expect(html).toContain("od-proof-form");
    expect(html).not.toContain("od-execute-primary-action");
  });

  it("disables the other rows while a proof draft is open", () => {
    const html = renderBand(
      [row({ id: "m1", title: "Confirm the booking", human: true }), row({ id: "m2", title: "Other work" })],
      { selectedMilestoneId: "m1", activeProofId: "m1", onConfirmMilestone: async () => true },
    );
    expect(html).toContain("disabled");
  });

  it("renders inline eval receipts (no primary action) for a completed row with evidence", () => {
    const done = row({ id: "m1", title: "Ship the fix", completed: true });
    done.evidence_count = 2;
    done.evaluator_results = [{
      evaluator: "manual_confirm",
      status: "passed",
      matched_evidence_ids: [],
      trust_score: 0.9,
      explanation: "Confirmed by you.",
      failure_reason: null,
      requires_human_confirmation: false,
    }] as AimProgressMilestoneRead["evaluator_results"];
    const html = renderBand([done], { selectedMilestoneId: "m1" });
    expect(html).toContain("od-eval-detail-section");
    expect(html).toContain("Confirmed by you.");
    expect(html).not.toContain("od-execute-primary-action");
  });

  it("marks only in-flight rows as live (pulsing dot), never completed ones", () => {
    const running = row({ id: "m1", title: "In flight", running: true });
    const idle = row({ id: "m2", title: "Waiting" });
    const done = row({ id: "m3", title: "Done", completed: true });
    expect(planRowIsLive(running, null)).toBe(true);
    expect(planRowIsLive(idle, null)).toBe(false);
    expect(planRowIsLive(done, null)).toBe(false);
    const html = renderBand([running, idle]);
    expect(html.split("od-journey-dot-active").length - 1).toBe(1);
  });
});

describe("JourneyView plan band mount", () => {
  it("renders the plan band for a planned goal, collapsed by default", () => {
    const html = render(progressOf([row({ id: "m1", title: "Book flights", human: true })]));
    expect(html).toContain("journey-plan-band");
    expect(html).not.toContain("journey-planrow-detail");
  });

  it("hides the plan band for a plan-less shell", () => {
    const html = render(progressOf([]));
    expect(html).not.toContain("journey-plan-band");
  });
});
