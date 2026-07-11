import type { AimProgressMilestoneRead, AimProgressReadModel, Evidence, Memory, Run, RunEvent } from "@core/domain";
import { describe, expect, it } from "vitest";

import type { I18n } from "../../i18n";
import {
  buildJourneyAmbient,
  buildJourneyJournal,
  buildJourneyStationSheet,
  buildJourneyStations,
  buildJourneyTurns,
  buildJourneyYourMove,
} from "./index";

const OWNER = "owner-1";

// A stub `t` that echoes the key (+ vars) so assertions can target keys, not copy.
const t = ((key: string, vars?: Record<string, string | number>) =>
  vars ? `${key}:${JSON.stringify(vars)}` : key) as unknown as I18n["t"];

interface RowOverride {
  id: string;
  title: string;
  status?: string;
  completed?: boolean;
  blocked?: boolean;
  human?: boolean;
  running?: boolean;
  evalPassed?: boolean;
  nextAction?: string;
  evidence?: AimProgressMilestoneRead["evidence"];
  evidenceCount?: number;
}

function mkRow(o: RowOverride): AimProgressMilestoneRead {
  return {
    milestone: {
      id: o.id,
      goal_id: "g1",
      owner_id: OWNER,
      title: o.title,
      description: "",
      status: (o.status ?? (o.completed ? "completed" : "pending")) as never,
      order_index: 0,
      depends_on_id: null,
      acceptance_rule: { logic: "all", clauses: [], threshold: 1, completion_mode: "manual" },
      xp_reward: 10,
      completed_at: null,
      metadata: {},
    },
    assignment: o.human
      ? { id: `a-${o.id}`, owner_id: OWNER, goal_id: "g1", milestone_id: o.id, actor_kind: "human", actor_id: null, status: "assigned", source: "routing", reason: "", capability_tags: [] }
      : { id: `a-${o.id}`, owner_id: OWNER, goal_id: "g1", milestone_id: o.id, actor_kind: "agent", actor_id: null, status: "assigned", source: "routing", reason: "", capability_tags: [] },
    latest_run: o.running ? mkRun({ id: `r-${o.id}`, milestoneId: o.id, status: "running" }) : null,
    child_relations: [],
    eval_review: { passed: Boolean(o.evalPassed), matched_evidence_ids: [], trust_score: 0, reason: "", next_action: o.nextAction ?? "" },
    evaluator_results: [],
    evidence: o.evidence ?? [],
    evidence_count: o.evidenceCount ?? (o.evidence?.length ?? 0),
    completed: Boolean(o.completed),
    blocked: Boolean(o.blocked),
    next_action: o.nextAction ?? "",
  } as AimProgressMilestoneRead;
}

function mkRun(o: { id: string; milestoneId: string; status: string; summary?: string; startedAt?: string; finishedAt?: string; actorKind?: "agent" | "human" }): Run {
  return {
    id: o.id,
    owner_id: OWNER,
    goal_id: "g1",
    milestone_id: o.milestoneId,
    assignment_id: null,
    actor_kind: (o.actorKind ?? "agent") as never,
    actor_id: null,
    kind: (o.actorKind ?? "agent") as never,
    status: o.status as never,
    attempt: 1,
    workspace_root: null,
    sandbox: null,
    network_enabled: false,
    model: null,
    reasoning: null,
    summary: o.summary ?? "",
    error: null,
    started_at: o.startedAt ?? null,
    finished_at: o.finishedAt ?? null,
  } as Run;
}

function mkRunEvent(o: { id: string; runId: string; type: string; summary?: string; at: string }): RunEvent {
  return {
    id: o.id,
    owner_id: OWNER,
    run_id: o.runId,
    type: o.type as never,
    summary: o.summary ?? "",
    payload: {},
    created_at: o.at,
  } as RunEvent;
}

function mkMemory(o: { id: string; content: string; category?: string; goalId?: string | null; status?: string }): Memory {
  return {
    id: o.id,
    owner_id: OWNER,
    goal_id: o.goalId ?? null,
    kind: "semantic",
    category: (o.category ?? "project_fact") as never,
    content: o.content,
    confidence: 1,
    source: "user_stated",
    status: (o.status ?? "active") as never,
    superseded_by: null,
  } as Memory;
}

function mkEvidence(o: { id: string; kind: string; summary: string; at: string }): AimProgressMilestoneRead["evidence"][number] {
  return {
    evidence: {
      id: o.id,
      owner_id: OWNER,
      goal_id: "g1",
      milestone_id: "m1",
      emitter_id: null,
      kind: o.kind as never,
      source_event_id: null,
      occurred_at: o.at,
      summary: o.summary,
      payload: {},
      trust_score: 0.6,
    } as Evidence,
    rule_matches: [],
    status: "unmatched",
    review_note: "",
  };
}

function mkProgress(rows: AimProgressMilestoneRead[], extra: Partial<AimProgressReadModel> = {}): AimProgressReadModel {
  const total = rows.length;
  const completed = rows.filter((r) => r.completed).length;
  const runs = rows.map((r) => r.latest_run).filter((r): r is Run => Boolean(r));
  return {
    goal: { id: "g1", owner_id: OWNER, title: "Ship the thing", description: "with care", domain: "software", status: "active", target_date: null, plan_json: null, metadata: {} },
    milestones: rows,
    actors: [],
    assignments: [],
    runs,
    sub_aim_relations: [],
    context_candidates: [],
    completion_recap: null,
    completed_milestones: completed,
    total_milestones: total,
    blocked_count: rows.filter((r) => r.blocked).length,
    next_action: "",
    ...extra,
  } as AimProgressReadModel;
}

describe("buildJourneyStations", () => {
  it("marks aim done and later stations not-started when no plan exists", () => {
    const stations = buildJourneyStations(mkProgress([]));
    expect(stations.map((s) => s.id)).toEqual(["aim", "research", "context", "plan", "run", "eval"]);
    expect(stations[0]).toMatchObject({ id: "aim", kind: "done" });
    expect(stations[1]).toMatchObject({ id: "research", kind: "up" });
    expect(stations[3]).toMatchObject({ id: "plan", kind: "active", lineKey: "planPending" });
    expect(stations[4]).toMatchObject({ id: "run", kind: "up" });
    expect(stations[5]).toMatchObject({ id: "eval", kind: "up" });
  });

  it("derives active run and partial eval mid-flight", () => {
    const rows = [
      mkRow({ id: "m1", title: "A", completed: true }),
      mkRow({ id: "m2", title: "B", running: true }),
    ];
    const stations = buildJourneyStations(mkProgress(rows));
    expect(stations[3]).toMatchObject({ id: "plan", kind: "done", lineKey: "planSummary", lineVars: { n: 2 } });
    expect(stations[4]).toMatchObject({ id: "run", kind: "active", lineKey: "runActive", lineVars: { n: 1 } });
    expect(stations[5]).toMatchObject({ id: "eval", kind: "partial", lineVars: { done: 1, total: 2 } });
  });

  it("derives a real research signal from gathered memories", () => {
    const memories = [mkMemory({ id: "mem1", content: "User is on macOS" })];
    const gathering = buildJourneyStations(mkProgress([]), memories);
    expect(gathering[1]).toMatchObject({ id: "research", kind: "living", lineKey: "researchGathering", lineVars: { n: 1 } });

    const ready = buildJourneyStations(mkProgress([mkRow({ id: "m1", title: "A" })]), memories);
    expect(ready[1]).toMatchObject({ id: "research", kind: "done", lineKey: "researchReady", lineVars: { n: 1 } });
  });

  it("keeps research folded when a plan exists but no distinct memory was gathered", () => {
    const stations = buildJourneyStations(mkProgress([mkRow({ id: "m1", title: "A" })]));
    expect(stations[1]).toMatchObject({ id: "research", kind: "done", lineKey: "researchFolded" });
  });

  it("marks run and eval done when the completion recap is complete", () => {
    const rows = [mkRow({ id: "m1", title: "A", completed: true })];
    const progress = mkProgress(rows, { completion_recap: { complete: true, final_outcome: "", completed_sub_aims: [], passing_evidence: [], eval_results: [], learned_context: [], evidence_empty_reason: "", context_empty_reason: "" } });
    const stations = buildJourneyStations(progress);
    expect(stations[4]).toMatchObject({ id: "run", kind: "done", lineKey: "runDone" });
    expect(stations[5]).toMatchObject({ id: "eval", kind: "done" });
  });
});

describe("buildJourneyYourMove / Ambient", () => {
  it("returns a submit_proof move for a human-routed incomplete milestone", () => {
    const rows = [mkRow({ id: "m1", title: "Book the flight", human: true })];
    const move = buildJourneyYourMove(mkProgress(rows), t);
    expect(move).toMatchObject({ kind: "submit_proof", milestoneId: "m1", tagKey: "glass.move.tagProof", title: "Book the flight" });
  });

  it("returns a run_agent move for an agent-routed milestone that is not running", () => {
    const rows = [mkRow({ id: "m1", title: "Draft copy" })];
    const move = buildJourneyYourMove(mkProgress(rows), t);
    expect(move).toMatchObject({ kind: "run_agent", tagKey: "glass.move.tagRun" });
  });

  it("skips work an agent is actively running (that is ambient, not a move)", () => {
    const rows = [mkRow({ id: "m1", title: "Running", running: true })];
    expect(buildJourneyYourMove(mkProgress(rows), t)).toBeNull();
  });

  it("returns null when everything is complete", () => {
    const rows = [mkRow({ id: "m1", title: "Done", completed: true, evalPassed: true })];
    expect(buildJourneyYourMove(mkProgress(rows), t)).toBeNull();
  });

  it("ambient reports working while a run is active, idle otherwise", () => {
    expect(buildJourneyAmbient(mkProgress([mkRow({ id: "m1", title: "x", running: true })])).titleKey).toBe("glass.ambient.working");
    expect(buildJourneyAmbient(mkProgress([])).titleKey).toBe("glass.ambient.idle");
  });
});

describe("buildJourneyTurns", () => {
  it("summarizes the human's waiting count and lists running agents with relative age", () => {
    const now = Date.parse("2026-07-11T14:10:00.000Z");
    const agentRow = mkRow({ id: "m2", title: "Agent task", running: true });
    // give the running agent a start time 6 minutes ago
    agentRow.latest_run = mkRun({ id: "r2", milestoneId: "m2", status: "running", summary: "drafting", startedAt: "2026-07-11T14:04:00.000Z" });
    const rows = [mkRow({ id: "m1", title: "Human task", human: true }), agentRow];
    const turns = buildJourneyTurns(mkProgress(rows), t, now);
    expect(turns[0]).toMatchObject({ who: "you", doing: 'glass.turns.waiting:{"n":1}' });
    expect(turns[1]).toMatchObject({ who: "agent", doing: "drafting", since: 'glass.turns.minutes:{"n":6}' });
  });

  it("reports the human idle when no human turns are waiting", () => {
    const turns = buildJourneyTurns(mkProgress([mkRow({ id: "m1", title: "x" })]), t, 0);
    expect(turns[0]?.doing).toBe("glass.turns.idle");
  });
});

describe("buildJourneyJournal", () => {
  it("merges evidence and run-lifecycle events newest-first and drops timestampless rows", () => {
    const rows = [mkRow({ id: "m1", title: "A", evidence: [
      mkEvidence({ id: "e1", kind: "manual_check", summary: "you confirmed", at: "2026-07-11T13:00:00.000Z" }),
      mkEvidence({ id: "e2", kind: "mcp_report", summary: "agent report", at: "2026-07-11T14:00:00.000Z" }),
    ] })];
    const progress = mkProgress(rows);
    progress.runs = [mkRun({ id: "r1", milestoneId: "m1", status: "completed", summary: "run done" })];
    const events = [
      mkRunEvent({ id: "rev1", runId: "r1", type: "run.completed", summary: "run done", at: "2026-07-11T13:30:00.000Z" }),
    ];
    const journal = buildJourneyJournal(progress, events);
    expect(journal.map((e) => e.id)).toEqual(["ev:e2", "rev:rev1", "ev:e1"]);
    expect(journal[0]).toMatchObject({ who: "agent", stationId: "eval" });
    expect(journal[1]).toMatchObject({ who: "agent", stationId: "run", what: "run done" });
  });

  it("keeps only product-facing lifecycle events (drops queued / log / tool traces)", () => {
    const progress = mkProgress([mkRow({ id: "m1", title: "A" })]);
    progress.runs = [mkRun({ id: "r1", milestoneId: "m1", status: "running", actorKind: "human" })];
    const events = [
      mkRunEvent({ id: "q", runId: "r1", type: "run.queued", at: "2026-07-11T10:00:00.000Z" }),
      mkRunEvent({ id: "l", runId: "r1", type: "run.log", summary: "chatter", at: "2026-07-11T10:01:00.000Z" }),
      mkRunEvent({ id: "t", runId: "r1", type: "tool.started", at: "2026-07-11T10:02:00.000Z" }),
      mkRunEvent({ id: "s", runId: "r1", type: "run.started", at: "2026-07-11T10:03:00.000Z" }),
    ];
    const journal = buildJourneyJournal(progress, events);
    expect(journal.map((e) => e.id)).toEqual(["rev:s"]);
    // No summary on the started event → the component falls back to detailKey; `who` from the human run.
    expect(journal[0]).toMatchObject({ who: "you", what: "", detailKey: "started", stationId: "run" });
  });

  it("falls back to the neutral cub actor when a run event has no matching run", () => {
    const progress = mkProgress([mkRow({ id: "m1", title: "A" })]);
    progress.runs = [];
    const journal = buildJourneyJournal(progress, [
      mkRunEvent({ id: "orphan", runId: "gone", type: "run.failed", at: "2026-07-11T10:00:00.000Z" }),
    ]);
    expect(journal[0]).toMatchObject({ who: "cub", detailKey: "failed" });
  });
});

describe("buildJourneyStationSheet", () => {
  it("maps plan rows with owner chips and points the CTA at the contracts stage", () => {
    const rows = [
      mkRow({ id: "m1", title: "Human bit", human: true, completed: true }),
      mkRow({ id: "m2", title: "Agent bit" }),
    ];
    const sheet = buildJourneyStationSheet("plan", mkProgress(rows));
    expect(sheet.actionStage).toBe("contracts");
    expect(sheet.rows[0]).toMatchObject({ chip: "owner.you", text: "Human bit", meta: "done" });
    expect(sheet.rows[1]).toMatchObject({ chip: "owner.agent", text: "Agent bit" });
  });

  it("fills the read-only research station with gathered context memories", () => {
    const memories = [mkMemory({ id: "mem1", content: "Prefers CLI tools", category: "preference" })];
    const sheet = buildJourneyStationSheet("research", mkProgress([mkRow({ id: "m1", title: "x" })]), memories);
    expect(sheet.actionStage).toBeNull();
    expect(sheet.rows).toEqual([{ chip: "context", text: "Prefers CLI tools", meta: "preference" }]);
  });

  it("shows an empty read-only research station when nothing was gathered", () => {
    const sheet = buildJourneyStationSheet("research", mkProgress([mkRow({ id: "m1", title: "x" })]));
    expect(sheet.actionStage).toBeNull();
    expect(sheet.rows).toEqual([]);
  });

  it("shows eval rows with met/open chips", () => {
    const rows = [
      mkRow({ id: "m1", title: "Passed", evalPassed: true }),
      mkRow({ id: "m2", title: "Pending", nextAction: "run it" }),
    ];
    const sheet = buildJourneyStationSheet("eval", mkProgress(rows));
    expect(sheet.rows[0]).toMatchObject({ chip: "eval.met" });
    expect(sheet.rows[1]).toMatchObject({ chip: "eval.open", meta: "run it" });
  });
});
