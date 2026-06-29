import { mkdtempSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import type { DecompositionOutput } from "@core/types";

import {
  createJsonFileStore,
  materialize,
  mergeMilestones,
  defaultDataDir,
  loadSettings,
  saveSettings,
  settingsPath,
  type ProviderSettings,
} from "./index";

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
    const { goal } = await store.createGoal({ title: "Build a CLI todo app", plan: PLAN });

    const updated = await store.updateGoal({ id: goal.id, description: "now with a release step", plan: REPLAN });
    expect(updated).not.toBeNull();
    expect(updated!.goal.description).toBe("now with a release step");
    expect(updated!.goal.plan_json).toEqual(REPLAN);
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

  it("drops empty-content memories", async () => {
    const store = freshStore();
    const { goal } = await store.createGoal({ title: "x", plan: PLAN, memories: [{ content: "  " }] });
    // No assertion on memories via the public API (none exposed yet); just ensure no throw + goal created.
    expect(goal.id).toBeTruthy();
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
      model: "deepseek/deepseek-chat",
      baseURL: "https://openrouter.ai/api/v1",
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
    writeFileSync(settingsPath(dir), JSON.stringify({ provider: "gemini", apiKey: "k" }), "utf8");
    expect(loadSettings(dir)).toBeNull();
  });
});
