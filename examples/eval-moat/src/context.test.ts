import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { BENCHMARK_AIMS } from "./aims.ts";
import { buildContextDiff, captureConditionContext, type ConditionCapture } from "./context.ts";
import { createJsonFileStore } from "./core.ts";
import { seedCondition } from "./seed.ts";
import type { BenchmarkAim, ConditionId } from "./types.ts";

const workDir = mkdtempSync(resolve(tmpdir(), "aimcub-eval-moat-context-"));
afterAll(() => rmSync(workDir, { recursive: true, force: true }));

async function capture(aim: BenchmarkAim, condition: ConditionId): Promise<ConditionCapture> {
  const dataDir = join(workDir, aim.id, condition);
  const seeded = await seedCondition(aim, condition, dataDir);
  const store = createJsonFileStore(dataDir);
  return captureConditionContext(store, aim, condition, seeded.goalId);
}

describe("context capture and diff", () => {
  it("injects nothing in the bare condition", async () => {
    const bare = await capture(BENCHMARK_AIMS[0]!, "bare");
    expect(bare.planningMemories).toHaveLength(0);
    expect(bare.captured.renderedBlock).toBe("(none yet)");
    expect(bare.captured.decomposition.completedMilestones).toBe(0);
    expect(bare.storeRows).toHaveLength(0);
  });

  it("produces a non-empty diff for every aim", async () => {
    for (const aim of BENCHMARK_AIMS) {
      const bare = await capture(aim, "bare");
      const contexted = await capture(aim, "contexted");
      const diff = buildContextDiff(aim, bare, contexted);

      expect(diff.nonEmpty).toBe(true);
      expect(diff.bareRows).toBe(0);
      expect(diff.injectedRows).toBeGreaterThan(3);
      expect(diff.injectedChars).toBeGreaterThan(diff.bareChars);
      // The block the prompt receives really carries the context, not just the report.
      expect(contexted.captured.renderedBlock).toContain(diff.injectedOnly[0]!.content);
      // Constraints are the category the product promises to honour; every persona has some.
      expect(diff.byCategory.some((row) => row.category === "constraint")).toBe(true);
    }
  });

  it("keeps pending, deprioritized, and low-confidence rows out of the prompt", async () => {
    const aim = BENCHMARK_AIMS[0]!;
    const diff = buildContextDiff(aim, await capture(aim, "bare"), await capture(aim, "contexted"));
    const injected = diff.injectedOnly.map((row) => row.content);

    for (const row of aim.context) {
      if ((row.status ?? "active") === "active" && (row.confidence ?? 1) >= 0.6) continue;
      expect(injected).not.toContain(row.content);
      expect(diff.withheld.some((withheld) => withheld.content === row.content)).toBe(true);
    }
    expect(diff.withheld.some((row) => row.reason === "low_confidence")).toBe(true);
    expect(diff.withheld.some((row) => row.reason.startsWith("not_active_context"))).toBe(true);
  });

  // Deliberate inversion: the first dry run admitted the unrelated marketing-site row on
  // "the"/"should", and every persona showed the same leak. The selector was fixed in @core, so
  // this expectation flipped from "the leak exists" to "the leak stays closed" — for all three
  // personas, not only the one that first showed it.
  it("admits no row from another aim on function-word overlap alone", async () => {
    for (const aim of BENCHMARK_AIMS) {
      const diff = buildContextDiff(aim, await capture(aim, "bare"), await capture(aim, "contexted"));
      expect(diff.weakMatches).toEqual([]);
    }
  });

  it("still admits another aim's context on a real content-word match", async () => {
    const aim = BENCHMARK_AIMS[0]!;
    const diff = buildContextDiff(aim, await capture(aim, "bare"), await capture(aim, "contexted"));
    // Closing the leak must not close the door: prior aims that share real vocabulary still reach
    // the plan, which is the whole point of accrued context.
    expect(diff.injectedOnly.some((row) => row.scope === "related_goal")).toBe(true);
  });

  it("reports the learning channels the contexted store adds", async () => {
    const aim = BENCHMARK_AIMS[0]!;
    const bare = await capture(aim, "bare");
    const contexted = await capture(aim, "contexted");
    const diff = buildContextDiff(aim, bare, contexted);

    expect(contexted.decompositionLearning.completedMilestones).toBeGreaterThan(0);
    expect(bare.decompositionLearning.completedMilestones).toBe(0);
    expect(diff.learningDelta.some((line) => line.startsWith("decomposition learning"))).toBe(true);
  });
});
