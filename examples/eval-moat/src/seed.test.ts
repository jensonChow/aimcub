import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { BENCHMARK_AIMS, benchmarkAim, groundTruthContext } from "./aims.ts";
import { createJsonFileStore } from "./core.ts";
import { buildConditionSnapshot, seedCondition } from "./seed.ts";

const workDir = mkdtempSync(resolve(tmpdir(), "aimcub-eval-moat-test-"));
afterAll(() => rmSync(workDir, { recursive: true, force: true }));

describe("fixtures", () => {
  it("keeps the aim text identical across conditions — only the store differs", async () => {
    for (const aim of BENCHMARK_AIMS) {
      const bare = await buildConditionSnapshot(aim, "bare");
      const contexted = await buildConditionSnapshot(aim, "contexted");
      const bareGoal = bare.snapshot.goals.find((goal) => goal.id === bare.goalId);
      const contextedGoal = contexted.snapshot.goals.find((goal) => goal.id === contexted.goalId);
      expect(bareGoal?.title).toBe(aim.title);
      expect(contextedGoal?.title).toBe(aim.title);
      expect(bareGoal?.description).toBe(contextedGoal?.description);
    }
  });

  it("never leaks a fixture context row into the aim text", () => {
    for (const aim of BENCHMARK_AIMS) {
      const aimText = `${aim.title} ${aim.description}`.toLowerCase();
      for (const row of aim.context) {
        // A whole context row appearing verbatim in the aim would hand the bare condition the answer.
        expect(aimText.includes(row.content.toLowerCase())).toBe(false);
      }
    }
  });

  it("counts only active rows as ground truth", () => {
    const aim = benchmarkAim("receipt-scanning");
    expect(aim).not.toBeNull();
    const truth = groundTruthContext(aim!);
    const inactive = aim!.context.filter((row) => (row.status ?? "active") !== "active");
    expect(inactive.length).toBeGreaterThan(0);
    for (const row of inactive) {
      expect(truth.some((item) => item.content === row.content)).toBe(false);
    }
  });
});

describe("seeding", () => {
  it("is deterministic: the same fixture produces the same snapshot", async () => {
    const first = await buildConditionSnapshot(BENCHMARK_AIMS[0]!, "contexted");
    const second = await buildConditionSnapshot(BENCHMARK_AIMS[0]!, "contexted");
    expect(first.goalId).toBe(second.goalId);
    expect(JSON.stringify(first.snapshot)).toBe(JSON.stringify(second.snapshot));
  });

  it("writes identical bytes to two different data directories", async () => {
    const aim = BENCHMARK_AIMS[1]!;
    const dirA = join(workDir, "bytes-a");
    const dirB = join(workDir, "bytes-b");
    await seedCondition(aim, "contexted", dirA);
    await seedCondition(aim, "contexted", dirB);
    expect(readFileSync(join(dirA, "store.json"), "utf8")).toBe(readFileSync(join(dirB, "store.json"), "utf8"));
  });

  it("gives the bare condition the aim and nothing else", async () => {
    const aim = BENCHMARK_AIMS[0]!;
    const dataDir = join(workDir, "bare");
    const seeded = await seedCondition(aim, "bare", dataDir);
    const store = createJsonFileStore(dataDir);

    expect(seeded.counts.goals).toBe(1);
    expect(await store.listMemories()).toHaveLength(0);
    expect(await store.listMemoryCandidates()).toHaveLength(0);
    expect(await store.listEvidence(seeded.goalId)).toHaveLength(0);
    const got = await store.getGoal(seeded.goalId);
    expect(got?.milestones).toHaveLength(0);
  });

  it("accrues the contexted condition through the product's own path", async () => {
    const aim = BENCHMARK_AIMS[0]!;
    const dataDir = join(workDir, "contexted");
    const seeded = await seedCondition(aim, "contexted", dataDir);
    const store = createJsonFileStore(dataDir);

    // Prior work exists, was proven by evidence, and completion was derived — never written.
    expect(seeded.counts.completions).toBeGreaterThan(0);
    expect(seeded.counts.evidence).toBeGreaterThan(0);

    const history = await store.listMemoryHistory();
    const active = await store.listMemories();
    const pending = await store.listMemoryCandidates();
    expect(active.length).toBeGreaterThan(0);
    expect(pending.length).toBeGreaterThan(0);
    expect(history.some((row) => row.status === "deprioritized")).toBe(true);

    // Global promotion and aim-scoped context both exist, as they would in a real store.
    expect(active.some((row) => row.goal_id === null)).toBe(true);
    expect(active.some((row) => row.goal_id !== null)).toBe(true);

    // The aim under test carries no context of its own; everything sits behind it.
    expect(active.some((row) => row.goal_id === seeded.goalId)).toBe(false);
  });
});
