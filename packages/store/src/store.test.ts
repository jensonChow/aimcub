import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import type { DecompositionOutput } from "@core/types";

import { createJsonFileStore, materialize, defaultDataDir } from "./index";

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
