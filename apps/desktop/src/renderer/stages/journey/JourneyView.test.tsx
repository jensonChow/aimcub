import type { AimProgressMilestoneRead, AimProgressReadModel, Goal } from "@core/domain";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { I18nProvider } from "../../i18n";
import { JourneyView } from "./JourneyView";

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

function render(progress: AimProgressReadModel | null): string {
  return renderToStaticMarkup(
    <I18nProvider>
      <JourneyView goal={goal} progress={progress} onOpenStage={noop} onRunAgent={noop} onNewAim={noop} />
    </I18nProvider>,
  );
}

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
});
