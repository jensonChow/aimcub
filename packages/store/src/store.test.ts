import { mkdtempSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { movePlanNode, splitPlanNode, updatePlanNode } from "@aimcub/core";
import type { DecompositionOutput } from "@aimcub/types";

import {
  createJsonFileStore,
  contextSourceSettingsPath,
  materialize,
  mergeMilestones,
  defaultDataDir,
  loadContextSourceSettings,
  loadSettings,
  loadWebResearchSettings,
  saveContextSourceSettings,
  saveSettings,
  saveWebResearchSettings,
  settingsPath,
  webResearchSettingsPath,
  type ProviderSettings,
  type ContextSourceSettings,
  type WebResearchSettings,
} from "./index";
import {
  LOCAL_ALPHA_DEMO_GOAL_TITLE,
  resolveLocalAlphaDemoTarget,
  seedLocalAlphaDemo,
} from "./local-alpha-demo";

const CONTRACT = {
  why: "Scaffolding creates a runnable base before feature work starts.",
  definition_of_done: "The project has an initialized runnable skeleton.",
  required_evidence: ["A trusted init commit."],
  likely_owner: "agent",
  context_gaps: [],
  eval_signal: "The milestone is done when the repository can run from its scaffold.",
};

/** A small, semantically valid plan (passes validatePlan: unique keys, acyclic, edges ref nodes). */
const PLAN = {
  goal_summary: "Build a CLI todo app",
  domain: "software",
  rationale: "scaffold then implement",
  nodes: [
    {
      key: "m1",
      title: "Scaffold",
      description: "Init the project.",
      est_effort: "s",
      xp_reward: 10,
      decomposition_contract: CONTRACT,
      acceptance_rule: {
        logic: "all",
        threshold: 1,
        completion_mode: "auto_then_confirm",
        clauses: [{ evaluator: "commit_pattern", auto_verifiable: true, match: { message_pattern: "init", min_files: 1 } }],
      },
    },
    {
      key: "m2",
      title: "Implement",
      description: "Core feature.",
      est_effort: "m",
      xp_reward: 20,
      acceptance_rule: {
        logic: "all",
        threshold: 1,
        completion_mode: "auto_then_confirm",
        clauses: [{ evaluator: "ci_status", auto_verifiable: true, match: { conclusion: "success" } }],
      },
    },
  ],
  edges: [{ from: "m1", to: "m2" }],
} as unknown as DecompositionOutput;

/** A re-plan of PLAN: keeps "Scaffold" (changed desc), drops "Implement", adds "Polish". Keys differ on purpose (the LLM regenerates them). */
const REPLAN = {
  goal_summary: "Build a CLI todo app",
  domain: "software",
  rationale: "re-plan",
  nodes: [
    {
      key: "a",
      title: "Scaffold",
      description: "Init the project (revised).",
      est_effort: "s",
      xp_reward: 10,
      acceptance_rule: {
        logic: "all",
        threshold: 1,
        completion_mode: "auto_then_confirm",
        clauses: [{ evaluator: "commit_pattern", auto_verifiable: true, match: { message_pattern: "init", min_files: 1 } }],
      },
    },
    {
      key: "b",
      title: "Polish",
      description: "Docs + release.",
      est_effort: "m",
      xp_reward: 15,
      acceptance_rule: {
        logic: "all",
        threshold: 1,
        completion_mode: "auto_then_confirm",
        clauses: [{ evaluator: "ci_status", auto_verifiable: true, match: { conclusion: "success" } }],
      },
    },
  ],
  edges: [{ from: "a", to: "b" }],
} as unknown as DecompositionOutput;

const MANUAL_PLAN = {
  goal_summary: "Manual proof aim",
  domain: "software",
  rationale: "human proof",
  nodes: [
    {
      key: "manual",
      title: "Approve release",
      description: "Human approval is required.",
      est_effort: "s",
      xp_reward: 10,
      decomposition_contract: {
        why: "The user owns approval.",
        definition_of_done: "The user approves the release.",
        required_evidence: ["Approval note."],
        likely_owner: "human",
        context_gaps: [],
        eval_signal: "Done means the user confirms approval.",
      },
      acceptance_rule: {
        logic: "all",
        threshold: 1,
        completion_mode: "manual",
        clauses: [{ evaluator: "manual_confirm", auto_verifiable: false, match: {} }],
      },
    },
  ],
  edges: [],
} as unknown as DecompositionOutput;

const ROUTING_OVERRIDE = {
  owner: "agent",
  agent_id: "codex",
  agent_label: "Codex CLI",
  run_mode: "local_cli",
  model: "gpt-5",
  model_label: "GPT-5",
  reason: "User selected Codex CLI.",
} as const;

const ROUTED_PLAN = {
  ...PLAN,
  nodes: [
    { ...PLAN.nodes[0]!, routing_override: ROUTING_OVERRIDE },
    PLAN.nodes[1]!,
  ],
} as DecompositionOutput;

type PlanAcceptanceRule = DecompositionOutput["nodes"][number]["acceptance_rule"];
type PlanContract = NonNullable<DecompositionOutput["nodes"][number]["decomposition_contract"]>;
type PlanNode = DecompositionOutput["nodes"][number];

function commitRule(messagePattern: string, minFiles = 1): PlanAcceptanceRule {
  return {
    logic: "all",
    threshold: 1,
    completion_mode: "auto_then_confirm",
    clauses: [{ evaluator: "commit_pattern", auto_verifiable: true, match: { message_pattern: messagePattern, min_files: minFiles } }],
  };
}

function manualRule(): PlanAcceptanceRule {
  return {
    logic: "all",
    threshold: 1,
    completion_mode: "manual",
    clauses: [{ evaluator: "manual_confirm", auto_verifiable: false, match: {} }],
  };
}

function localAlphaContract(input: {
  why: string;
  definitionOfDone: string;
  requiredEvidence: string[];
  likelyOwner: PlanContract["likely_owner"];
  evalSignal: string;
}): PlanContract {
  return {
    why: input.why,
    definition_of_done: input.definitionOfDone,
    required_evidence: input.requiredEvidence,
    likely_owner: input.likelyOwner,
    context_gaps: [],
    eval_signal: input.evalSignal,
  };
}

function localAlphaNode(input: {
  key: string;
  title: string;
  description: string;
  acceptanceRule: PlanAcceptanceRule;
  contract: PlanContract;
  effort?: PlanNode["est_effort"];
  xp?: number;
}): PlanNode {
  return {
    key: input.key,
    title: input.title,
    description: input.description,
    est_effort: input.effort ?? "m",
    xp_reward: input.xp ?? 10,
    acceptance_rule: input.acceptanceRule,
    decomposition_contract: input.contract,
    routing_override: null,
  };
}

function localAlphaPlan(): DecompositionOutput {
  return {
    goal_summary: "Ship the local alpha contract and proof loop",
    domain: "software",
    rationale: "First lock the docs and tests, then require human scope approval.",
    nodes: [
      localAlphaNode({
        key: "lock-loop",
        title: "Lock the local alpha golden loop",
        description: "Update docs and tests that prove the local alpha loop.",
        acceptanceRule: commitRule("local alpha", 2),
        contract: localAlphaContract({
          why: "Docs and tests are local, digital work that a local agent can produce.",
          definitionOfDone: "The local alpha contract exists and core/store tests cover the golden loop.",
          requiredEvidence: ["Trusted commit touching docs and tests."],
          likelyOwner: "agent",
          evalSignal: "Done means trusted code evidence proves the local alpha loop is locked.",
        }),
      }),
      localAlphaNode({
        key: "approve-scope",
        title: "Approve local alpha scope",
        description: "Confirm the alpha non-goals and proof are acceptable.",
        acceptanceRule: manualRule(),
        contract: localAlphaContract({
          why: "The final scope call depends on human judgment.",
          definitionOfDone: "The user approves the alpha contract, non-goals, and proof.",
          requiredEvidence: ["Approval note."],
          likelyOwner: "human",
          evalSignal: "Done means human approval is recorded as manual proof.",
        }),
      }),
    ],
    edges: [{ from: "lock-loop", to: "approve-scope" }],
  };
}

function freshStore() {
  const dir = mkdtempSync(join(tmpdir(), "aimcub-store-"));
  return createJsonFileStore(dir);
}

describe("defaultDataDir", () => {
  it("honors AIMCUB_HOME when set", () => {
    const prev = process.env.AIMCUB_HOME;
    process.env.AIMCUB_HOME = "/tmp/custom-aimcub";
    expect(defaultDataDir()).toBe("/tmp/custom-aimcub");
    if (prev === undefined) delete process.env.AIMCUB_HOME;
    else process.env.AIMCUB_HOME = prev;
  });

  it("defaults to a ~/.aimcub path otherwise", () => {
    const prev = process.env.AIMCUB_HOME;
    delete process.env.AIMCUB_HOME;
    expect(defaultDataDir().endsWith(".aimcub")).toBe(true);
    if (prev !== undefined) process.env.AIMCUB_HOME = prev;
  });
});

describe("materialize", () => {
  it("turns a plan into a linear milestone chain", () => {
    const ms = materialize(PLAN, "goal-1", "owner-1");
    expect(ms).toHaveLength(2);
    expect(ms[0]!.depends_on_id).toBeNull();
    expect(ms[1]!.depends_on_id).toBe(ms[0]!.id);
    expect(ms[0]!.goal_id).toBe("goal-1");
    expect(ms[0]!.metadata.decomposition_contract).toEqual(CONTRACT);
  });
});

describe("mergeMilestones · re-plan invariants", () => {
  it("freezes a completed milestone, skips a dropped one, adds a new one", () => {
    const existing = materialize(PLAN, "g", "o");
    // m1 "Scaffold" is done; m2 "Implement" is still pending.
    existing[0]!.status = "completed";
    existing[0]!.completed_at = "2026-06-29T00:00:00.000Z";

    const merged = mergeMilestones(existing, "g", "o", REPLAN);
    const byTitle = (t: string) => merged.find((m) => m.title === t);

    expect(merged).toHaveLength(3); // Scaffold (freeze) + Polish (add) + Implement (skip)

    const scaffold = byTitle("Scaffold")!;
    expect(scaffold.id).toBe(existing[0]!.id); // stable id
    expect(scaffold.status).toBe("completed"); // frozen
    expect(scaffold.completed_at).toBe("2026-06-29T00:00:00.000Z");
    expect(scaffold.description).toBe("Init the project."); // content NOT overwritten by the new node
    expect(scaffold.order_index).toBe(0);

    const polish = byTitle("Polish")!;
    expect(polish.status).toBe("pending");
    expect(polish.id).not.toBe(existing[1]!.id);
    expect(polish.depends_on_id).toBe(scaffold.id); // edge a->b rethreaded onto stable ids

    const implement = byTitle("Implement")!;
    expect(implement.id).toBe(existing[1]!.id); // soft-deleted, not physically removed
    expect(implement.status).toBe("skipped");
    expect(implement.depends_on_id).toBeNull();
  });

  it("updates an unfinished matched milestone in place (new content, stable id)", () => {
    const existing = materialize(PLAN, "g", "o"); // both pending
    const merged = mergeMilestones(existing, "g", "o", REPLAN);
    const scaffold = merged.find((m) => m.title === "Scaffold")!;
    expect(scaffold.id).toBe(existing[0]!.id); // reused id
    expect(scaffold.status).toBe("pending");
    expect(scaffold.description).toBe("Init the project (revised)."); // refreshed from the new node
  });

  it("throws on a semantically invalid plan (edge to an unknown node)", () => {
    const bad = { ...PLAN, edges: [{ from: "m1", to: "ghost" }] } as unknown as DecompositionOutput;
    expect(() => mergeMilestones([], "g", "o", bad)).toThrow(/invalid decomposition/);
  });

  it("rejects a schema-invalid plan (node missing acceptance_rule) — the store gate, not a raw crash", () => {
    const noRule = {
      goal_summary: "x",
      domain: "software",
      rationale: "",
      nodes: [{ key: "a", title: "A", est_effort: "s", xp_reward: 10 }],
      edges: [],
    } as unknown as DecompositionOutput;
    expect(() => mergeMilestones([], "g", "o", noRule)).toThrow(/invalid decomposition/);
  });

  it("rejects junk JSON shapes with a clean error, not a TypeError", () => {
    expect(() => mergeMilestones([], "g", "o", {} as unknown as DecompositionOutput)).toThrow(/invalid decomposition/);
    expect(() => mergeMilestones([], "g", "o", { nodes: "oops" } as unknown as DecompositionOutput)).toThrow(
      /invalid decomposition/,
    );
  });
});

describe("createJsonFileStore · updateGoal", () => {
  it("re-plans a saved aim and persists the new plan", async () => {
    const store = freshStore();
    const { goal } = await store.createGoal({
      title: "Build a CLI todo app",
      plan: PLAN,
      metadata: { source: "test" },
    });

    const updated = await store.updateGoal({
      id: goal.id,
      description: "now with a release step",
      plan: REPLAN,
      metadata: { plan_quality: { grade: "pass", score: 100, issues: [] } },
    });
    expect(updated).not.toBeNull();
    expect(updated!.goal.description).toBe("now with a release step");
    expect(updated!.goal.plan_json).toEqual(REPLAN);
    expect(updated!.goal.metadata).toMatchObject({
      source: "test",
      plan_quality: { grade: "pass", score: 100 },
    });
    expect(updated!.milestones.map((m) => m.title).sort()).toEqual(["Implement", "Polish", "Scaffold"]);
    expect(updated!.milestones.find((m) => m.title === "Implement")!.status).toBe("skipped");

    const reread = await store.getGoal(goal.id);
    expect(reread!.goal.plan_json).toEqual(REPLAN);
  });

  it("returns null for an unknown id", async () => {
    const store = freshStore();
    expect(await store.updateGoal({ id: "nope", plan: PLAN })).toBeNull();
  });
});

describe("createJsonFileStore · createAimShell", () => {
  it("persists a plan-less shell (plan_json null, zero milestones) the read model tolerates", async () => {
    const store = freshStore();
    const { goal, milestones } = await store.createAimShell({
      title: "Plan a launch",
      description: "goal-first shell",
      metadata: { source: "test" },
    });

    expect(goal.plan_json).toBeNull();
    expect(goal.status).toBe("active");
    expect(milestones).toEqual([]);

    // Read paths must not crash on a plan-less goal.
    const reread = await store.getGoal(goal.id);
    expect(reread!.goal.plan_json).toBeNull();
    expect(reread!.milestones).toEqual([]);

    const progress = await store.getAimProgress(goal.id);
    expect(progress).not.toBeNull();
    expect(progress!.total_milestones).toBe(0);
    expect(progress!.completed_milestones).toBe(0);

    const [summary] = await store.listAimProgressSummaries();
    expect(summary!.status).toBe("planning");
  });

  it("lands the first plan on the same shell via updateGoal (no fork)", async () => {
    const store = freshStore();
    const { goal } = await store.createAimShell({ title: "Plan a launch" });

    const updated = await store.updateGoal({ id: goal.id, plan: PLAN });
    expect(updated).not.toBeNull();
    expect(updated!.goal.id).toBe(goal.id);
    expect(updated!.goal.plan_json).toEqual(PLAN);
    expect(updated!.milestones.length).toBe(PLAN.nodes.length);

    // Still exactly one goal — the shell was updated in place, not forked.
    expect((await store.listGoals()).length).toBe(1);
  });

  it("links a sub-aim relation when a shell is created with a parent (goal-first breakdown)", async () => {
    const store = freshStore();
    const { goal: parent, milestones: parentMilestones } = await store.createGoal({
      title: "Parent aim",
      plan: PLAN,
    });

    const { goal: child } = await store.createAimShell({
      title: "Child shell",
      description: "Break this sub-aim down.",
      parentGoalId: parent.id,
      parentMilestoneId: parentMilestones[0]!.id,
    });

    // The child is a plan-less shell (planning happens in-Journey), yet the parent link is recorded.
    expect(child.plan_json).toBeNull();
    const relations = await store.listSubAimRelations(parent.id);
    expect(relations).toHaveLength(1);
    expect(relations[0]!.child_goal_id).toBe(child.id);
    expect(relations[0]!.parent_goal_id).toBe(parent.id);
    expect(relations[0]!.parent_milestone_id).toBe(parentMilestones[0]!.id);
  });
});

describe("createJsonFileStore · renameGoal", () => {
  it("renames a plan-less shell's title/description without materializing a plan", async () => {
    const store = freshStore();
    const { goal } = await store.createAimShell({ title: "Old title", description: "old" });

    const updated = await store.renameGoal({ id: goal.id, title: "New title", description: "new" });
    expect(updated).not.toBeNull();
    expect(updated!.goal.title).toBe("New title");
    expect(updated!.goal.description).toBe("new");

    const reread = await store.getGoal(goal.id);
    expect(reread!.goal.title).toBe("New title");
    expect(reread!.goal.plan_json).toBeNull();
    expect(reread!.milestones).toEqual([]);
  });

  it("keeps the current title when the new title is blank, and clears description with an empty string", async () => {
    const store = freshStore();
    const { goal } = await store.createGoal({ title: "Kept title", description: "keep me", plan: PLAN });

    const updated = await store.renameGoal({ id: goal.id, title: "   ", description: "" });
    expect(updated!.goal.title).toBe("Kept title");
    expect(updated!.goal.description).toBe("");
    // Plan/milestones are untouched by a rename.
    expect((await store.getGoal(goal.id))!.milestones.length).toBe(PLAN.nodes.length);
  });

  it("returns null for an unknown aim", async () => {
    expect(await freshStore().renameGoal({ id: "missing", title: "x" })).toBeNull();
  });
});

describe("createJsonFileStore · round-trip", () => {
  it("creates, lists, gets, and deletes a goal", async () => {
    const store = freshStore();

    expect(await store.listGoals()).toEqual([]);

    const { goal, milestones } = await store.createGoal({
      title: "Build a CLI todo app",
      description: "small",
      plan: PLAN,
      memories: [{ content: "scope → production" }, { content: "" }],
    });
    expect(milestones).toHaveLength(2);
    expect(goal.title).toBe("Build a CLI todo app");
    expect(goal.metadata).toEqual({});

    const list = await store.listGoals();
    expect(list).toHaveLength(1);
    expect(list[0]!.id).toBe(goal.id);

    const got = await store.getGoal(goal.id);
    expect(got?.goal.id).toBe(goal.id);
    expect(got?.milestones).toHaveLength(2);

    await store.deleteGoal(goal.id);
    expect(await store.listGoals()).toEqual([]);
    expect(await store.getGoal(goal.id)).toBeNull();
  });

  it("persists across store instances pointed at the same dir", async () => {
    const dir = mkdtempSync(join(tmpdir(), "aimcub-store-"));
    const a = createJsonFileStore(dir);
    const { goal } = await a.createGoal({ title: "Persisted aim", plan: PLAN });

    const b = createJsonFileStore(dir); // a second "face" on the same data dir
    const list = await b.listGoals();
    expect(list.map((g) => g.id)).toContain(goal.id);
  });

  it("persists recoverable aim drafts separately from saved aims", async () => {
    const dir = mkdtempSync(join(tmpdir(), "aimcub-store-"));
    const a = createJsonFileStore(dir);
    const draft = await a.upsertAimDraft({
      title: "Recover desktop draft",
      description: "Keep the local-first promise.",
      currentStage: "context",
      aimSurface: "summary",
      phase: "intake",
      status: "context_needed",
      contextNote: "The user already supplied context before leaving.",
      intakeQuestions: [{
        id: "intake_scope",
        question: "What should survive navigation?",
        why_high_impact: "It decides the draft recovery path.",
        kind: "constraint",
        source_dimension: "context_fit",
        allow_other: true,
        selection_mode: "multiple",
        selection_mode_reason: "compatible_options",
        options: [{ label: "Title", tradeoff: "The draft row can be named." }],
      }],
      intakeAnswers: [{
        question_id: "intake_scope",
        selected_label: "Title",
        selected_labels: ["Title"],
        other_text: "Also keep the context note.",
      }],
    });

    expect(await a.listGoals()).toEqual([]);

    const b = createJsonFileStore(dir);
    const drafts = await b.listAimDrafts();
    expect(drafts.map((row) => row.id)).toEqual([draft.id]);
    expect(drafts[0]).toMatchObject({
      title: "Recover desktop draft",
      status: "context_needed",
      current_stage: "context",
      aim_surface: "summary",
      phase: "intake",
      context_note: "The user already supplied context before leaving.",
    });
    expect((await b.getAimDraft(draft.id))?.intake_answers[0]?.other_text).toBe("Also keep the context note.");
  });

  it("replaces a persisted composer with the submitted summary before restart", async () => {
    const dir = mkdtempSync(join(tmpdir(), "aimcub-store-"));
    const first = createJsonFileStore(dir);
    const draft = await first.upsertAimDraft({
      title: "Keep this Aim readable",
      currentStage: "aim",
      aimSurface: "compose",
      status: "draft",
    });

    await first.upsertAimDraft({
      id: draft.id,
      description: "Submitted and checkpointed before the UI changes.",
      aimSurface: "summary",
    });

    const second = createJsonFileStore(dir);
    expect((await second.getAimDraft(draft.id))?.aim_surface).toBe("summary");
  });

  it("normalizes legacy Aim drafts without a persisted surface", async () => {
    const dir = mkdtempSync(join(tmpdir(), "aimcub-store-"));
    writeFileSync(join(dir, "store.json"), JSON.stringify({
      aimDrafts: [{
        id: "00000000-0000-4000-8000-000000000099",
        owner_id: "00000000-0000-4000-8000-000000000001",
        title: "Legacy captured aim",
      }],
    }), "utf8");

    const [legacy] = await createJsonFileStore(dir).listAimDrafts();
    expect(legacy?.aim_surface).toBeNull();
  });

  it("keeps generated plans and save-blocked state recoverable until explicit discard", async () => {
    const store = freshStore();
    const draft = await store.upsertAimDraft({
      title: "Blocked plan draft",
      currentStage: "contracts",
      phase: "post_draft",
      status: "save_blocked",
      draftPlan: PLAN,
      finalPlan: PLAN,
      saveBlock: {
        title: "Aim needs a plan repair",
        message: "One sub-aim needs an executable acceptance rule.",
        recovery: "Edit the contract, then save again.",
        issues: ["Acceptance rule needs repair."],
      },
    });

    expect(await store.listGoals()).toEqual([]);
    const recovered = await store.getAimDraft(draft.id);
    expect(recovered?.final_plan?.nodes.map((node) => node.title)).toEqual(PLAN.nodes.map((node) => node.title));
    expect(recovered?.save_block?.message).toBe("One sub-aim needs an executable acceptance rule.");

    await store.discardAimDraft(draft.id);
    expect(await store.listAimDrafts()).toEqual([]);
  });

  it("carries planning_session state across upserts that do not touch it", async () => {
    const store = freshStore();
    const draft = await store.upsertAimDraft({
      title: "Session draft",
      planningSession: {
        agent_id: "claude",
        phase: "researching",
        updated_at: "2026-07-24T10:00:00.000Z",
        transcript: [{ at: "2026-07-24T10:00:00.000Z", kind: "user_message", text: "budget 200", delivered: true }],
        research_findings: [{ summary: "finding", source_urls: ["https://a.example"] }],
        research_gaps: ["no web"],
        research_summary: "",
        assumptions: [],
        open_questions: [],
        memory_candidates: [],
      },
    });
    expect(draft.planning_session?.agent_id).toBe("claude");

    // An unrelated field update must not clobber the session state to null.
    const renamed = await store.upsertAimDraft({ id: draft.id, title: "Renamed session draft" });
    expect(renamed.planning_session?.transcript).toHaveLength(1);
    expect(renamed.planning_session?.research_gaps).toEqual(["no web"]);

    // Explicit null clears it.
    const cleared = await store.upsertAimDraft({ id: draft.id, planningSession: null });
    expect(cleared.planning_session).toBeNull();
  });

  it("keeps child breakdown drafts recoverable with parent references", async () => {
    const store = freshStore();
    const { goal, milestones } = await store.createGoal({ title: "Parent aim", plan: PLAN });
    const draft = await store.upsertAimDraft({
      title: milestones[0]!.title,
      description: "Break this sub-aim down.",
      parentGoalId: goal.id,
      parentMilestoneId: milestones[0]!.id,
      currentStage: "aim",
      status: "draft",
    });

    expect((await store.getAimDraft(draft.id))?.parent_goal_id).toBe(goal.id);
    expect((await store.getAimDraft(draft.id))?.parent_milestone_id).toBe(milestones[0]!.id);

    await store.deleteGoal(goal.id);
    expect(await store.getAimDraft(draft.id)).toBeNull();
  });

  it("drops empty-content memories", async () => {
    const store = freshStore();
    const { goal } = await store.createGoal({ title: "x", plan: PLAN, memories: [{ content: "  " }] });
    expect(goal.id).toBeTruthy();
    expect(await store.listMemories(goal.id)).toEqual([]);
  });

  it("saves an edited pre-save plan payload into plan JSON and milestones", async () => {
    const store = freshStore();
    const manualRule: DecompositionOutput["nodes"][number]["acceptance_rule"] = {
      logic: "all",
      threshold: 1,
      completion_mode: "manual",
      clauses: [{ evaluator: "manual_confirm", auto_verifiable: false, match: {} }],
    };
    const editedTitlePlan = updatePlanNode(PLAN, "m1", {
      title: "Scope edited release",
      description: "Capture the exact edited release scope.",
      acceptance_rule: manualRule,
    });
    const splitPlan = splitPlanNode(editedTitlePlan, "m2", {
      first: { title: "Implement edited release" },
      second: {
        title: "Verify edited release",
        description: "Confirm the saved payload drives the final milestone.",
      },
    });
    const edited = movePlanNode(splitPlan, "m2-split", 1);

    const { goal, milestones } = await store.createGoal({
      title: "Edited plan aim",
      plan: edited,
    });

    expect(goal.plan_json).toEqual(edited);
    expect(milestones.map((milestone) => milestone.title)).toEqual([
      "Scope edited release",
      "Verify edited release",
      "Implement edited release",
    ]);
    expect(milestones[0]!.description).toBe("Capture the exact edited release scope.");
    expect(milestones[0]!.acceptance_rule).toEqual(manualRule);
    expect(milestones[1]!.depends_on_id).toBe(milestones[0]!.id);
    expect(milestones[2]!.depends_on_id).toBe(milestones[1]!.id);
    expect(milestones[1]!.metadata.plan_key).toBe("m2-split");
  });

  it("persists routing overrides into the plan, milestone metadata, and assignments", async () => {
    const store = freshStore();
    const { goal, milestones } = await store.createGoal({
      title: "Build a CLI todo app",
      plan: ROUTED_PLAN,
    });

    const savedPlan = goal.plan_json as DecompositionOutput;
    expect(savedPlan.nodes[0]?.routing_override).toEqual(ROUTING_OVERRIDE);
    expect(milestones[0]?.metadata.routing_override).toEqual(ROUTING_OVERRIDE);

    const assignments = await store.listAssignments(goal.id);
    const routed = assignments.find((assignment) => assignment.milestone_id === milestones[0]?.id);
    expect(routed).toMatchObject({
      actor_kind: "agent",
      source: "user_override",
    });
    expect(routed?.reason).toContain("Codex CLI / GPT-5");
    expect(routed?.capability_tags).toContain("agent:codex");
    expect(routed?.capability_tags).toContain("model:gpt-5");
  });
});

describe("createJsonFileStore · memories/context", () => {
  it("lists memories globally and per aim, newest first", async () => {
    const store = freshStore();
    const { goal } = await store.createGoal({
      title: "Context aim",
      plan: PLAN,
      memories: [{ content: "User prefers production-ready plans.", kind: "semantic", confidence: 0.9 }],
    });
    await store.addMemory({ content: "User works on macOS.", kind: "semantic", goalId: null });

    const all = await store.listMemories();
    expect(all.map((m) => m.content)).toContain("User works on macOS.");
    expect(all.map((m) => m.content)).toContain("User prefers production-ready plans.");

    const scoped = await store.listMemories(goal.id);
    expect(scoped).toHaveLength(1);
    expect(scoped[0]!.confidence).toBe(0.9);
    expect(scoped[0]!.category).toBe("project_fact");
  });

  it("rejects empty memory content", async () => {
    const store = freshStore();
    await expect(store.addMemory({ content: "  " })).rejects.toThrow(/required/i);
  });

  it("keeps inferred context pending until the user accepts it", async () => {
    const store = freshStore();
    const { goal } = await store.createGoal({ title: "Context aim", plan: PLAN });

    const candidate = await store.addMemoryCandidate({
      goalId: goal.id,
      content: "Preference: User prefers CLI-first workflows.",
      kind: "semantic",
      category: "preference",
      source: "evidence_derived",
      confidence: 0.8,
    });

    expect(await store.listMemories()).toEqual([]);
    expect(await store.listMemoryCandidates(goal.id)).toHaveLength(1);

    const accepted = await store.acceptMemoryCandidate({ id: candidate.id, content: "Preference: CLI-first tools." });
    expect(accepted?.status).toBe("active");
    expect(accepted?.category).toBe("preference");
    expect(accepted?.confidence).toBe(0.9);
    expect((await store.listMemoryCandidates()).map((m) => m.id)).not.toContain(candidate.id);
    expect((await store.listMemories()).map((m) => m.content)).toContain("Preference: CLI-first tools.");
  });

  it("keeps explicit confidence when accepting a context candidate", async () => {
    const store = freshStore();
    const candidate = await store.addMemoryCandidate({
      content: "Eval signal: User wants tests and screenshots before calling UI work done.",
      confidence: 0.6,
    });

    const accepted = await store.acceptMemoryCandidate({ id: candidate.id, confidence: 0.75 });

    expect(accepted?.status).toBe("active");
    expect(accepted?.confidence).toBe(0.75);
  });

  it("requires prompt-like context candidates to be edited into actual answers", async () => {
    const store = freshStore();
    const candidate = await store.addMemoryCandidate({
      content:
        'Eval signal: For "Context aim", pending answer needed: Ask what would make this aim count as genuinely complete.',
      category: "eval_signal",
      confidence: 0.6,
    });

    await expect(store.acceptMemoryCandidate({ id: candidate.id })).rejects.toThrow(/actual answer/i);
    expect((await store.listMemoryCandidates()).map((m) => m.id)).toContain(candidate.id);

    const accepted = await store.acceptMemoryCandidate({
      id: candidate.id,
      content: "Eval signal: Done means tests pass and screenshots prove the flow.",
    });

    expect(accepted?.status).toBe("active");
    expect(accepted?.confidence).toBe(0.9);
    expect(accepted?.content).toBe("Eval signal: Done means tests pass and screenshots prove the flow.");
  });

  it("requires unapplied-context review prompts to be edited before accept", async () => {
    const store = freshStore();
    const candidate = await store.addMemoryCandidate({
      content:
        'Eval signal: For "Context aim", confirm whether this constraint context should shape the aim: Keep @core pure.',
      category: "eval_signal",
      confidence: 0.6,
    });

    await expect(store.acceptMemoryCandidate({ id: candidate.id })).rejects.toThrow(/actual answer/i);
    expect((await store.listMemoryCandidates()).map((m) => m.id)).toContain(candidate.id);
  });

  it("can promote a scoped context candidate to global context on accept", async () => {
    const store = freshStore();
    const { goal } = await store.createGoal({ title: "Context aim", plan: PLAN });
    const candidate = await store.addMemoryCandidate({
      goalId: goal.id,
      content: "Preference: User prefers CLI-first workflows.",
    });

    const accepted = await store.acceptMemoryCandidate({ id: candidate.id, goalId: null });

    expect(accepted?.status).toBe("active");
    expect(accepted?.goal_id).toBeNull();
    expect(await store.listMemories(goal.id)).toEqual([]);
    expect((await store.listMemories()).map((m) => m.id)).toContain(candidate.id);
  });

  it("dedupes a promoted candidate against existing global context", async () => {
    const store = freshStore();
    const { goal } = await store.createGoal({ title: "Context aim", plan: PLAN });
    const global = await store.addMemory({ content: "Preference: CLI first", goalId: null });
    const candidate = await store.addMemoryCandidate({ goalId: goal.id, content: "Preference: CLI first" });

    const accepted = await store.acceptMemoryCandidate({ id: candidate.id, goalId: null });
    const snapshot = await store.exportData();

    expect(accepted?.id).toBe(global.id);
    expect(snapshot.memories.find((m) => m.id === candidate.id)?.status).toBe("deleted");
    expect(snapshot.memories.find((m) => m.id === candidate.id)?.superseded_by).toBe(global.id);
    expect((await store.listMemories()).filter((m) => m.content === "Preference: CLI first")).toHaveLength(1);
  });

  it("strengthens existing active context when accepting a duplicate candidate", async () => {
    const store = freshStore();
    const { goal } = await store.createGoal({ title: "Context aim", plan: PLAN });
    const global = await store.addMemory({
      content: "Eval signal: Done means tests pass and the user can inspect the result.",
      goalId: null,
      confidence: 0.55,
    });
    const candidate = await store.addMemoryCandidate({
      content: "Eval signal: Done means tests pass and the user can inspect the result.",
      goalId: goal.id,
      confidence: 0.6,
    });

    const accepted = await store.acceptMemoryCandidate({ id: candidate.id, goalId: null });
    const snapshot = await store.exportData();

    expect(accepted?.id).toBe(global.id);
    expect(accepted?.confidence).toBe(0.9);
    expect(snapshot.memories.find((m) => m.id === candidate.id)?.status).toBe("deleted");
    expect(snapshot.memories.find((m) => m.id === candidate.id)?.superseded_by).toBe(global.id);
  });

  it("rejects pending context candidates without deleting active memories", async () => {
    const store = freshStore();
    const candidate = await store.addMemoryCandidate({ content: "Eval signal: User verified the CLI." });
    await store.addMemory({ content: "User works on macOS." });

    const rejected = await store.rejectMemoryCandidate(candidate.id);
    expect(rejected?.status).toBe("deleted");
    expect(await store.listMemoryCandidates()).toEqual([]);
    expect((await store.listMemories()).map((m) => m.content)).toEqual(["User works on macOS."]);
  });

  it("dedupes pending and active memories by normalized content", async () => {
    const store = freshStore();
    const first = await store.addMemoryCandidate({ content: "Preference: CLI first" });
    const second = await store.addMemoryCandidate({ content: " Preference:  CLI first " });
    expect(second.id).toBe(first.id);

    const active = await store.addMemory({ content: "Preference: CLI first" });
    expect(active.id).toBe(first.id);
    expect(active.status).toBe("active");
    expect(active.category).toBe("preference");
    expect(await store.listMemoryCandidates()).toEqual([]);
  });

  it("archives active memories without touching pending candidates", async () => {
    const store = freshStore();
    const active = await store.addMemory({ content: "Project fact: Old setup used Stripe." });
    const candidate = await store.addMemoryCandidate({ content: "Preference: CLI first" });

    const archived = await store.archiveMemory(active.id);
    const snapshot = await store.exportData();

    expect(archived?.status).toBe("deleted");
    expect((await store.listMemories()).map((m) => m.id)).not.toContain(active.id);
    expect((await store.listMemoryCandidates()).map((m) => m.id)).toContain(candidate.id);
    expect(snapshot.memories.find((m) => m.id === active.id)?.status).toBe("deleted");
  });

  it("deprioritizes active memories without deleting their history", async () => {
    const store = freshStore();
    const memory = await store.addMemory({ content: "Preference: Verbose reports.", confidence: 0.9 });

    await expect(store.deprioritizeMemory({ id: memory.id, confidence: 2 })).rejects.toThrow(/0 to 1/);
    const updated = await store.deprioritizeMemory({ id: memory.id });

    const snapshot = await store.exportData();
    expect(updated?.status).toBe("deprioritized");
    expect(updated?.confidence).toBe(0.5);
    expect((await store.listMemories()).map((m) => m.id)).not.toContain(memory.id);
    expect(snapshot.memories.find((m) => m.id === memory.id)?.status).toBe("deprioritized");
  });

  it("lists memory history across context review outcomes", async () => {
    const store = freshStore();
    const acceptedCandidate = await store.addMemoryCandidate({ content: "Procedure: Run pnpm test." });
    const rejectedCandidate = await store.addMemoryCandidate({ content: "Constraint: No budget constraint." });
    const deprioritized = await store.addMemory({ content: "Preference: Verbose reports.", confidence: 0.9 });

    await store.acceptMemoryCandidate({ id: acceptedCandidate.id });
    await store.rejectMemoryCandidate(rejectedCandidate.id);
    await store.deprioritizeMemory({ id: deprioritized.id });

    expect((await store.listMemoryCandidates()).map((m) => m.id)).toEqual([]);
    expect((await store.listMemories()).map((m) => m.content)).toEqual(["Procedure: Run pnpm test."]);
    expect((await store.listMemoryHistory()).map((m) => m.status).sort()).toEqual(["active", "deleted", "deprioritized"]);
  });

  it("reactivates deprioritized duplicates when the user states them again", async () => {
    const store = freshStore();
    const memory = await store.addMemory({ content: "Preference: Verbose reports.", confidence: 0.9 });
    await store.deprioritizeMemory({ id: memory.id });

    const active = await store.addMemory({ content: "Preference: Verbose reports.", confidence: 1 });

    expect(active.id).toBe(memory.id);
    expect(active.status).toBe("active");
    expect(active.confidence).toBe(1);
    expect((await store.listMemories()).map((m) => m.id)).toContain(memory.id);
  });
});

describe("createJsonFileStore · local alpha golden loop", () => {
  it("replays one local aim from context intake through reusable memory", async () => {
    const store = freshStore();
    const agent = await store.addActor({
      kind: "agent",
      displayName: "Codex CLI",
      capabilities: ["software"],
      model: "gpt-5",
    });
    const human = await store.addActor({
      kind: "human",
      displayName: "Jenson",
      capabilities: ["human_judgment"],
    });

    const trace = await store.recordToolTrace({
      toolName: "local.scan_workspace",
      status: "succeeded",
      summary: "Read local alpha docs and core/store surfaces.",
      sources: [{ path: "docs/v1-spec.md" }, { path: "packages/store/src/index.ts" }],
    });
    const intake = await store.createContextIntakeSession({
      aimTitle: "Ship local alpha contract",
      aimDescription: "Make the open-source alpha loop explicit and tested.",
      readiness: "ready",
      toolTraceIds: [trace.id],
    });

    expect(intake.status).toBe("ready");
    expect(intake.can_continue).toBe(true);
    expect(intake.tool_trace_ids).toEqual([trace.id]);

    const { goal, milestones } = await store.createGoal({
      title: "Ship local alpha contract",
      description: "Make the open-source local alpha contract explicit and tested.",
      plan: localAlphaPlan(),
      memories: [{
        content: "Constraint: Local alpha must not depend on hosted sync or vector memory.",
        category: "constraint",
      }],
    });
    const [agentMilestone, humanMilestone] = milestones;
    expect(agentMilestone?.metadata.decomposition_contract).toMatchObject({
      required_evidence: ["Trusted commit touching docs and tests."],
      likely_owner: "agent",
    });
    expect(humanMilestone?.metadata.decomposition_contract).toMatchObject({
      required_evidence: ["Approval note."],
      likely_owner: "human",
    });

    const assignments = await store.listAssignments(goal.id);
    const agentAssignment = assignments.find((row) => row.milestone_id === agentMilestone?.id);
    const humanAssignment = assignments.find((row) => row.milestone_id === humanMilestone?.id);
    expect(agentAssignment).toMatchObject({
      actor_kind: "agent",
      actor_id: agent.id,
      source: "routing",
    });
    expect(humanAssignment).toMatchObject({
      actor_kind: "human",
      actor_id: human.id,
      source: "routing",
    });

    const run = await store.createRun({
      goalId: goal.id,
      milestoneId: agentMilestone!.id,
      assignmentId: agentAssignment!.id,
      actorKind: "agent",
      actorId: agent.id,
      status: "running",
      sandbox: "workspace-write",
      model: "gpt-5",
      summary: "Codex is updating docs and tests.",
    });
    await store.appendRunEvent({
      runId: run.id,
      type: "tool.finished",
      summary: "Narrow alpha tests completed.",
      payload: { command: "pnpm --filter @aimcub/store test" },
    });
    await store.finishRun({
      runId: run.id,
      status: "completed",
      summary: "Updated the local alpha contract and golden-loop tests.",
    });
    const auto = await store.addEvidence({
      goalId: goal.id,
      milestoneId: agentMilestone!.id,
      emitterId: "00000000-0000-4000-8000-0000000000aa",
      kind: "git_commit",
      sourceEventId: "local-alpha-proof",
      summary: "local alpha docs and tests",
      payload: {
        sha: "local-alpha-proof",
        message: "local alpha docs and tests",
        files: ["docs/local-alpha.md", "packages/store/src/store.test.ts"],
      },
      trustScore: 1,
      runId: run.id,
      assignmentId: agentAssignment!.id,
    });

    expect(auto.deduped).toBe(false);
    expect(auto.completions).toMatchObject([{ milestone_id: agentMilestone!.id, decided_by: "rule_auto" }]);

    const afterAgent = await store.getAimProgress(goal.id);
    const agentRow = afterAgent?.milestones.find((row) => row.milestone.id === agentMilestone!.id);
    expect(afterAgent?.next_action).toBe("Collect human proof and confirm completion.");
    expect(agentRow?.evidence[0]).toMatchObject({
      evidence: { id: auto.evidence.id, summary: "local alpha docs and tests" },
      status: "matched",
      rule_matches: [{ clause_index: 0, evaluator: "commit_pattern" }],
    });

    const manual = await store.confirmMilestone({
      goalId: goal.id,
      milestoneId: humanMilestone!.id,
      proofNote: "Reviewed and approved the local alpha contract, non-goals, and proof loop.",
      requiredEvidence: [{ text: "Approval note.", satisfied: true }],
    });
    const saved = await store.getGoal(goal.id);

    expect(manual?.evidence?.kind).toBe("manual_check");
    expect(manual?.completion).toMatchObject({ milestone_id: humanMilestone!.id, decided_by: "user_confirm" });
    expect(saved?.milestones.every((milestone) => milestone.status === "completed")).toBe(true);

    const candidates = await store.sedimentContextFromGoal(goal.id);
    expect(candidates).toEqual(expect.arrayContaining([
      expect.objectContaining({ status: "pending", category: "eval_signal" }),
      expect.objectContaining({ status: "pending", category: "procedure", goal_id: goal.id }),
    ]));

    const withCandidates = await store.getAimProgress(goal.id);
    expect(withCandidates?.context_candidates.length).toBeGreaterThanOrEqual(2);

    const reusable = candidates.find((candidate) => candidate.goal_id === null && candidate.category === "eval_signal")!;
    const scopedProcedure = candidates.find((candidate) => candidate.goal_id === goal.id && candidate.category === "procedure")!;
    const acceptedGlobal = await store.acceptMemoryCandidate({
      id: reusable.id,
      content: "Eval signal: Local alpha work is complete only when docs, tests, and human proof agree.",
      goalId: null,
    });
    const acceptedProcedure = await store.acceptMemoryCandidate({
      id: scopedProcedure.id,
      content: "Procedure: For local alpha changes, update docs and golden-loop tests before handoff.",
      goalId: goal.id,
    });
    const complete = await store.getAimProgress(goal.id);

    expect(await store.listMemories()).toContainEqual(expect.objectContaining({
      id: acceptedGlobal!.id,
      goal_id: null,
      status: "active",
    }));
    expect(complete?.next_action).toBe("Aim is complete.");
    expect(complete?.completion_recap?.learned_context).toContainEqual(expect.objectContaining({
      id: acceptedProcedure!.id,
      status: "active",
      scope: "aim",
    }));
  });
});

describe("local alpha demo seed", () => {
  function seededDir(): string {
    return mkdtempSync(join(tmpdir(), "aimcub-local-alpha-demo-test-"));
  }

  it("seeds a deterministic isolated store and can be repeated idempotently", async () => {
    const dir = seededDir();
    const first = await seedLocalAlphaDemo(dir);
    const store = createJsonFileStore(dir);
    const firstSnapshot = await store.exportData();

    const second = await seedLocalAlphaDemo(dir);
    const secondSnapshot = await createJsonFileStore(dir).exportData();

    expect(first.title).toBe(LOCAL_ALPHA_DEMO_GOAL_TITLE);
    expect(second.goalId).toBe(first.goalId);
    expect(second.imported).toMatchObject({
      goals: 1,
      milestones: 4,
      evidence: 2,
      completions: 1,
    });
    expect(secondSnapshot).toEqual(firstSnapshot);
    expect((await store.listGoals()).map((goal) => goal.title)).toEqual([LOCAL_ALPHA_DEMO_GOAL_TITLE]);
    expect(firstSnapshot.contextIntakeSessions).toContainEqual(expect.objectContaining({
      goal_id: first.goalId,
      status: "ready",
      can_continue: true,
    }));
  });

  it("covers routing, evidence trust, context candidates, and Execute/Eval read-model states", async () => {
    const dir = seededDir();
    const result = await seedLocalAlphaDemo(dir);
    const store = createJsonFileStore(dir);
    const progress = await store.getAimProgress(result.goalId);

    expect(progress).not.toBeNull();
    expect(progress!.total_milestones).toBe(4);
    expect(progress!.completed_milestones).toBe(1);
    expect(progress!.completion_recap).toBeNull();
    expect(progress!.assignments.map((assignment) => assignment.actor_kind)).toEqual(expect.arrayContaining(["agent", "human"]));

    const row = (key: string) => {
      const found = progress!.milestones.find((item) => item.milestone.metadata.plan_key === key);
      if (!found) throw new Error(`Missing seeded row ${key}`);
      return found;
    };
    const completed = row("context-contract");
    const agentIncomplete = row("agent-seed-fixture");
    const humanIncomplete = row("human-demo-review");
    const lowTrust = row("low-trust-proof-review");

    expect(completed.completed).toBe(true);
    expect(completed.assignment).toMatchObject({ actor_kind: "agent", status: "completed" });
    expect(completed.evidence).toContainEqual(expect.objectContaining({
      status: "matched",
      rule_matches: [{ clause_index: 0, evaluator: "commit_pattern" }],
    }));
    expect(completed.eval_review).toMatchObject({ passed: true, trust_score: 1 });

    expect(agentIncomplete.completed).toBe(false);
    expect(agentIncomplete.assignment).toMatchObject({ actor_kind: "agent" });
    expect(agentIncomplete.evidence_count).toBe(0);
    expect(agentIncomplete.eval_review.reason).toBe("No evidence has been recorded for this sub-aim yet.");
    expect(agentIncomplete.next_action).toBe("Run the assigned agent.");

    expect(humanIncomplete.completed).toBe(false);
    expect(humanIncomplete.assignment).toMatchObject({ actor_kind: "human" });
    expect(humanIncomplete.evidence_count).toBe(0);
    expect(humanIncomplete.next_action).toBe("Collect human proof and confirm completion.");

    expect(lowTrust.completed).toBe(false);
    expect(lowTrust.assignment).toMatchObject({ actor_kind: "agent" });
    expect(lowTrust.latest_run).toMatchObject({ status: "completed", model: "gpt-5" });
    expect(lowTrust.evidence).toContainEqual(expect.objectContaining({
      status: "low_trust",
      evidence: expect.objectContaining({
        kind: "mcp_report",
        trust_score: 0.55,
      }),
    }));
    expect(lowTrust.eval_review.reason).toContain("trust floor");
    expect(lowTrust.eval_review.next_action).toContain("Add trusted");

    expect(progress!.context_candidates).toContainEqual(expect.objectContaining({
      status: "pending",
      category: "procedure",
    }));
    expect(await store.listMemories(result.goalId)).toContainEqual(expect.objectContaining({
      status: "active",
      category: "eval_signal",
      content: "Eval signal: Demo readiness requires trusted proof, low-trust review, and visible no-evidence gaps.",
    }));
    expect(await store.listMemories()).toContainEqual(expect.objectContaining({
      status: "active",
      category: "constraint",
      goal_id: null,
    }));
  });

  it("requires an explicit safe target and refuses the real home store by default", () => {
    expect(() => resolveLocalAlphaDemoTarget({
      env: {},
      cwd: "/tmp",
      homeDir: "/Users/example",
    })).toThrow(/--target/);
    expect(() => resolveLocalAlphaDemoTarget({
      targetDir: "/Users/example/.aimcub",
      cwd: "/tmp",
      homeDir: "/Users/example",
    })).toThrow(/dangerous/);
    expect(() => resolveLocalAlphaDemoTarget({
      targetDir: "/Users/example/.aimcub/demo",
      cwd: "/tmp",
      homeDir: "/Users/example",
    })).toThrow(/dangerous/);
    expect(resolveLocalAlphaDemoTarget({
      targetDir: "aimcub-demo",
      cwd: "/tmp",
      homeDir: "/Users/example",
    })).toBe("/tmp/aimcub-demo");
    expect(resolveLocalAlphaDemoTarget({
      env: { AIMCUB_HOME: "/tmp/aimcub-demo-env" },
      cwd: "/tmp",
      homeDir: "/Users/example",
    })).toBe("/tmp/aimcub-demo-env");
  });
});

describe("createJsonFileStore · evidence and confirmations", () => {
  it("creates durable routing assignments when an aim is saved", async () => {
    const store = freshStore();
    const { goal, milestones } = await store.createGoal({ title: "Build a CLI todo app", plan: PLAN });

    const assignments = await store.listAssignments(goal.id);

    expect(assignments).toHaveLength(milestones.length);
    expect(assignments[0]!.actor_kind).toBe("agent");
    expect(assignments[0]!.source).toBe("routing");
  });

  it("appends trusted evidence and auto-completes matching milestones", async () => {
    const store = freshStore();
    const { goal, milestones } = await store.createGoal({ title: "Build a CLI todo app", plan: PLAN });

    const result = await store.addEvidence({
      goalId: goal.id,
      milestoneId: milestones[0]!.id,
      emitterId: "00000000-0000-4000-8000-0000000000aa",
      kind: "git_commit",
      sourceEventId: "sha-1",
      summary: "init",
      payload: { sha: "sha-1", message: "init project", files: ["src/index.ts"] },
      trustScore: 1,
    });

    expect(result.deduped).toBe(false);
    expect(result.completions).toHaveLength(1);
    expect(result.completions[0]!.decided_by).toBe("rule_auto");
    expect((await store.listAssignments(goal.id)).find((assignment) => assignment.milestone_id === milestones[0]!.id)?.status).toBe("completed");
    const got = await store.getGoal(goal.id);
    expect(got!.milestones[0]!.status).toBe("completed");
  });

  it("records agent run evidence attribution without letting low-trust self-reports complete", async () => {
    const store = freshStore();
    const { goal, milestones } = await store.createGoal({ title: "Build a CLI todo app", plan: PLAN });
    const assignment = (await store.listAssignments(goal.id)).find((row) => row.milestone_id === milestones[0]!.id)!;
    const run = await store.createRun({
      goalId: goal.id,
      milestoneId: milestones[0]!.id,
      assignmentId: assignment.id,
      actorKind: "agent",
      status: "running",
      sandbox: "read-only",
      summary: "Codex started.",
    });
    await store.finishRun({ runId: run.id, status: "completed", summary: "Codex reported scaffold work." });

    const result = await store.addEvidence({
      goalId: goal.id,
      milestoneId: milestones[0]!.id,
      kind: "mcp_report",
      sourceEventId: "agent-run-1",
      summary: "Agent says the scaffold is done.",
      payload: { ok: true },
      trustScore: 0.6,
      runId: run.id,
      assignmentId: assignment.id,
    });
    const snapshot = await store.exportData();
    const progress = await store.getAimProgress(goal.id);

    expect(result.completions).toHaveLength(0);
    expect(snapshot.evidenceAttributions[0]).toMatchObject({
      evidence_id: result.evidence.id,
      run_id: run.id,
      assignment_id: assignment.id,
      actor_kind: "agent",
      trust_score: 0.6,
    });
    expect(progress?.milestones[0]?.completed).toBe(false);
    expect(progress?.milestones[0]?.evidence_count).toBe(1);
    expect(progress?.milestones[0]?.eval_review.reason).toContain("trust floor");
    expect(progress?.milestones[0]?.evidence[0]).toMatchObject({
      evidence: { id: result.evidence.id, summary: "Agent says the scaffold is done.", trust_score: 0.6 },
      status: "low_trust",
      rule_matches: [],
    });
  });

  it("dedupes evidence by emitter/source event", async () => {
    const store = freshStore();
    const { goal, milestones } = await store.createGoal({ title: "Build a CLI todo app", plan: PLAN });
    const input = {
      goalId: goal.id,
      milestoneId: milestones[0]!.id,
      emitterId: "00000000-0000-4000-8000-0000000000aa",
      kind: "git_commit" as const,
      sourceEventId: "sha-1",
      payload: { sha: "sha-1", message: "init", files: ["a.ts"] },
      trustScore: 1,
    };

    const first = await store.addEvidence(input);
    const second = await store.addEvidence(input);
    expect(second.deduped).toBe(true);
    expect(second.evidence.id).toBe(first.evidence.id);
    expect(await store.listEvidence(goal.id)).toHaveLength(1);
  });

  it("manual confirmation creates user_confirm completion for an auto_then_confirm milestone", async () => {
    const store = freshStore();
    const { goal, milestones } = await store.createGoal({ title: "Build a CLI todo app", plan: PLAN });

    const result = await store.confirmMilestone({
      goalId: goal.id,
      milestoneId: milestones[1]!.id,
      proofNote: "Verified implementation with a passing CI run.",
    });
    expect(result).not.toBeNull();
    expect(result!.evidence?.kind).toBe("manual_check");
    expect(result!.completion?.decided_by).toBe("user_confirm");

    const got = await store.getGoal(goal.id);
    expect(got!.milestones[1]!.status).toBe("completed");
  });

  it("manual proof stores note, URLs, file references, and required evidence mapping", async () => {
    const store = freshStore();
    const { goal, milestones } = await store.createGoal({ title: "Manual proof", plan: MANUAL_PLAN });

    const result = await store.confirmMilestone({
      goalId: goal.id,
      milestoneId: milestones[0]!.id,
      proofNote: "Reviewed the release approval in the signed note.",
      urls: ["https://example.com/approval"],
      filePaths: ["/tmp/approval-note.pdf"],
      requiredEvidence: [{ text: "Approval note.", satisfied: true }],
    });
    const progress = await store.getAimProgress(goal.id);

    expect(result!.evidence?.payload).toMatchObject({
      confirmed: true,
      milestone_id: milestones[0]!.id,
      proof_note: "Reviewed the release approval in the signed note.",
      urls: ["https://example.com/approval"],
      file_paths: ["/tmp/approval-note.pdf"],
      required_evidence: [{ text: "Approval note.", satisfied: true }],
    });
    expect(progress?.milestones[0]?.evidence[0]?.evidence.id).toBe(result!.evidence?.id);
    expect(progress?.milestones[0]?.evaluator_results[0]?.matched_evidence_ids).toContain(result!.evidence?.id);
  });

  it("validates manual proof before appending evidence", async () => {
    const store = freshStore();
    const { goal, milestones } = await store.createGoal({ title: "Manual proof", plan: MANUAL_PLAN });
    const milestoneId = milestones[0]!.id;

    await expect(store.confirmMilestone({ goalId: goal.id, milestoneId })).rejects.toThrow(/note, URL, or file/i);
    await expect(store.confirmMilestone({
      goalId: goal.id,
      milestoneId,
      proofNote: "Reviewed the approval.",
      urls: ["not-a-url"],
      requiredEvidence: [{ text: "Approval note.", satisfied: true }],
    })).rejects.toThrow(/URL is invalid/i);
    await expect(store.confirmMilestone({
      goalId: goal.id,
      milestoneId,
      proofNote: "Reviewed the approval.",
      requiredEvidence: [{ text: "Approval note.", satisfied: false }],
    })).rejects.toThrow(/at least one required evidence/i);
    await expect(store.confirmMilestone({
      goalId: goal.id,
      milestoneId,
      proofNote: "Reviewed the approval.",
      requiredEvidence: [{ text: "Different evidence.", satisfied: true }],
    })).rejects.toThrow(/does not belong/i);
    expect(await store.listEvidence(goal.id)).toHaveLength(0);
  });

  it("human proof sedimentation creates pending durable context", async () => {
    const store = freshStore();
    const { goal, milestones } = await store.createGoal({ title: "Manual proof", plan: MANUAL_PLAN });

    await store.confirmMilestone({
      goalId: goal.id,
      milestoneId: milestones[0]!.id,
      proofNote: "Confirmed release approval.",
      urls: ["https://example.com/release-approval"],
      filePaths: ["/tmp/release-approval.txt"],
      requiredEvidence: [{ text: "Approval note.", satisfied: true }],
    });
    const candidates = await store.sedimentContextFromGoal(goal.id);

    expect(candidates.some((candidate) => candidate.status === "pending" && candidate.category === "eval_signal")).toBe(true);
    expect((await store.listMemories()).map((memory) => memory.id)).not.toContain(candidates[0]!.id);
  });

  it("includes accepted aim context in the completion recap", async () => {
    const store = freshStore();
    const { goal, milestones } = await store.createGoal({ title: "Manual proof", plan: MANUAL_PLAN });

    await store.confirmMilestone({
      goalId: goal.id,
      milestoneId: milestones[0]!.id,
      proofNote: "Confirmed release approval.",
      requiredEvidence: [{ text: "Approval note.", satisfied: true }],
    });
    const candidates = await store.sedimentContextFromGoal(goal.id);
    const accepted = await store.acceptMemoryCandidate({
      id: candidates[0]!.id,
      content: "Eval signal: Release approval is complete when the user confirms it.",
      goalId: goal.id,
    });
    const progress = await store.getAimProgress(goal.id);

    expect(accepted?.status).toBe("active");
    expect(progress?.completion_recap?.complete).toBe(true);
    expect(progress?.completion_recap?.learned_context).toContainEqual(expect.objectContaining({
      id: accepted!.id,
      status: "active",
      scope: "aim",
    }));
  });

  it("manual sub-aim decomposition creates a relation that the cockpit can roll up", async () => {
    const store = freshStore();
    const { goal: parent, milestones: parentMilestones } = await store.createGoal({
      title: "Parent aim",
      plan: MANUAL_PLAN,
    });
    const { goal: child, milestones: childMilestones } = await store.createGoal({
      title: "Child aim",
      plan: MANUAL_PLAN,
      parentGoalId: parent.id,
      parentMilestoneId: parentMilestones[0]!.id,
    });

    await store.confirmMilestone({
      goalId: child.id,
      milestoneId: childMilestones[0]!.id,
      proofNote: "Child aim proof was reviewed.",
      requiredEvidence: [{ text: "Approval note.", satisfied: true }],
    });
    const relations = await store.listSubAimRelations(parent.id);
    const progress = await store.getAimProgress(parent.id);

    expect(relations).toHaveLength(1);
    expect(relations[0]!.child_goal_id).toBe(child.id);
    expect(progress?.milestones[0]?.child_relations[0]?.status).toBe("completed");
    expect(progress?.milestones[0]?.next_action).toMatch(/child aim/i);
  });

  it("persists context intake sessions with explicit continue or pause state", async () => {
    const store = freshStore();
    const trace = await store.recordToolTrace({
      toolName: "local.scan_workspace",
      status: "blocked",
      summary: "Workspace permission required.",
      error: "Workspace permission required.",
    });
    const session = await store.createContextIntakeSession({
      aimTitle: "Build CLI",
      missingQuestions: ["What evidence proves done?"],
      toolTraceIds: [trace.id],
    });

    expect(session.status).toBe("blocked");
    expect(session.should_pause).toBe(true);
    expect(session.can_continue).toBe(false);
    expect(session.tool_trace_ids).toEqual([trace.id]);
  });
});

describe("createJsonFileStore · export/import", () => {
  it("exports and merges a snapshot", async () => {
    const a = freshStore();
    const { goal } = await a.createGoal({ title: "Portable aim", plan: PLAN });
    const draft = await a.upsertAimDraft({ title: "Portable draft", currentStage: "context", status: "context_needed" });
    const snapshot = await a.exportData();

    const b = freshStore();
    const result = await b.importData(snapshot);
    expect(result.goals).toBe(1);
    expect(result.aimDrafts).toBe(1);
    expect((await b.getGoal(goal.id))?.goal.title).toBe("Portable aim");
    expect((await b.getAimDraft(draft.id))?.title).toBe("Portable draft");

    const second = await b.importData(snapshot);
    expect(second.goals).toBe(0);
    expect(second.aimDrafts).toBe(0);
  });
});

describe("provider settings (settings.json shared by desktop + CLI)", () => {
  const freshDir = (): string => mkdtempSync(join(tmpdir(), "aimcub-settings-"));

  it("returns null when nothing is on file", () => {
    expect(loadSettings(freshDir())).toBeNull();
  });

  it("round-trips an openai-compatible config", () => {
    const dir = freshDir();
    const cfg: ProviderSettings = {
      provider: "openai-compatible",
      apiKey: "sk-file",
      model: "custom-chat-model",
      baseURL: "https://openrouter.ai/api/v1",
    };
    saveSettings(cfg, dir);
    expect(loadSettings(dir)).toEqual(cfg);
  });

  it("round-trips a built-in direct provider config", () => {
    const dir = freshDir();
    const cfg: ProviderSettings = {
      provider: "deepseek",
      apiKey: "sk-file",
      model: "deepseek-v4-pro",
      baseURL: "https://api.deepseek.com",
    };
    saveSettings(cfg, dir);
    expect(loadSettings(dir)).toEqual(cfg);
  });

  it("writes settings.json with owner-only (0600) perms — it holds a key", () => {
    const dir = freshDir();
    saveSettings({ provider: "anthropic", apiKey: "sk-ant" }, dir);
    const mode = statSync(settingsPath(dir)).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it("migrates the legacy { anthropicApiKey } blob", () => {
    const dir = freshDir();
    writeFileSync(settingsPath(dir), JSON.stringify({ anthropicApiKey: "sk-legacy" }), "utf8");
    expect(loadSettings(dir)).toEqual({ provider: "anthropic", apiKey: "sk-legacy" });
  });

  it("returns null for an unknown provider on file", () => {
    const dir = freshDir();
    writeFileSync(settingsPath(dir), JSON.stringify({ provider: "unknown-ai", apiKey: "k" }), "utf8");
    expect(loadSettings(dir)).toBeNull();
  });
});

describe("web research settings (web-settings.json)", () => {
  const freshDir = (): string => mkdtempSync(join(tmpdir(), "aimcub-web-settings-"));

  it("returns null when no web research settings are on file", () => {
    expect(loadWebResearchSettings(freshDir())).toBeNull();
  });

  it("round-trips a Brave search config", () => {
    const dir = freshDir();
    const cfg: WebResearchSettings = {
      provider: "brave",
      apiKey: "brave-key",
      enabled: true,
      fetchPages: true,
    };
    saveWebResearchSettings(cfg, dir);
    expect(loadWebResearchSettings(dir)).toEqual(cfg);
  });

  it("writes web-settings.json with owner-only (0600) perms", () => {
    const dir = freshDir();
    saveWebResearchSettings({ provider: "brave", apiKey: "brave-key", enabled: true, fetchPages: true }, dir);
    const mode = statSync(webResearchSettingsPath(dir)).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it("returns null for an unknown web research provider", () => {
    const dir = freshDir();
    writeFileSync(webResearchSettingsPath(dir), JSON.stringify({ provider: "unknown", apiKey: "k" }), "utf8");
    expect(loadWebResearchSettings(dir)).toBeNull();
  });
});

describe("context source settings (context-sources.json)", () => {
  const freshDir = (): string => mkdtempSync(join(tmpdir(), "aimcub-context-sources-"));

  it("returns defaults when no context source settings are on file", () => {
    expect(loadContextSourceSettings(freshDir())).toMatchObject({
      version: 1,
      local: { enabled: false, filePaths: [] },
      online: { enabled: false, sources: [] },
      research: { webEnabled: true, deepResearch: true },
      userSession: { enabled: true },
      questionnaire: { enabled: true },
    });
  });

  it("round-trips local files, online sources, research, session, and questionnaire controls", () => {
    const dir = freshDir();
    const cfg: ContextSourceSettings = {
      version: 1,
      local: {
        enabled: true,
        workspaceRoot: "/workspace/aimcub",
        filePaths: ["/workspace/aimcub/docs/prd.md", "/workspace/aimcub/docs/prd.md"],
      },
      online: {
        enabled: true,
        sources: [{
          id: "notion-1",
          provider: "notion",
          label: "Product wiki",
          reference: "notion://workspace/product",
          enabled: true,
        }],
      },
      research: { webEnabled: true, deepResearch: false },
      userSession: { enabled: true },
      questionnaire: { enabled: false },
    };

    const saved = saveContextSourceSettings(cfg, dir);

    expect(saved.local.filePaths).toEqual(["/workspace/aimcub/docs/prd.md"]);
    expect(loadContextSourceSettings(dir)).toEqual(saved);
  });

  it("writes context-sources.json with owner-only (0600) perms because paths can be sensitive", () => {
    const dir = freshDir();
    saveContextSourceSettings({
      version: 1,
      local: { enabled: true, workspaceRoot: "/workspace/private", filePaths: [] },
      online: { enabled: false, sources: [] },
      research: { webEnabled: true, deepResearch: true },
      userSession: { enabled: true },
      questionnaire: { enabled: true },
    }, dir);
    const mode = statSync(contextSourceSettingsPath(dir)).mode & 0o777;
    expect(mode).toBe(0o600);
  });
});

describe("createJsonFileStore · run journal + progress summaries", () => {
  it("lists an aim's run-lifecycle events oldest-first, scoped by goal", async () => {
    // A monotonic clock gives every event a distinct, ascending created_at so the assertion
    // exercises the sort comparator (a reversed sort would flip started/completed and fail),
    // not merely insertion order.
    let tick = 0;
    const now = () => `2026-07-11T09:00:00.${String(tick++).padStart(3, "0")}Z`;
    const store = createJsonFileStore(mkdtempSync(join(tmpdir(), "aimcub-store-")), { now });
    const { goal, milestones } = await store.createGoal({ title: "Journal aim", plan: PLAN });
    const other = await store.createGoal({ title: "Other aim", plan: PLAN });

    const run = await store.createRun({ goalId: goal.id, milestoneId: milestones[0]!.id, actorKind: "agent", status: "running", summary: "started" });
    await store.finishRun({ runId: run.id, status: "completed", summary: "done" });
    // A run on a different aim must never leak into this aim's journal.
    await store.createRun({ goalId: other.goal.id, milestoneId: other.milestones[0]!.id, actorKind: "agent", status: "running", summary: "other" });

    const events = await store.listRunEvents(goal.id);
    expect(events.every((event) => event.run_id === run.id)).toBe(true);
    expect(events.map((event) => event.type)).toEqual(["run.started", "run.completed"]);
  });

  it("summarizes each aim coarsely in one pass", async () => {
    const store = freshStore();
    const { goal, milestones } = await store.createGoal({ title: "Summary aim", plan: PLAN });

    const [pending] = await store.listAimProgressSummaries();
    expect(pending).toMatchObject({ goal_id: goal.id, status: "needs_you", total: 2, completed: 0, running: 0 });

    await store.createRun({ goalId: goal.id, milestoneId: milestones[0]!.id, actorKind: "agent", status: "running", summary: "x" });
    const [running] = await store.listAimProgressSummaries();
    expect(running).toMatchObject({ status: "running", running: 1 });
  });
});
