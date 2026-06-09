import { describe, expect, it } from "vitest";
import { DecompositionOutput } from "@core/types";
import { planMerge, validatePlan, type ExistingMilestone } from "./plan";

function mkNode(key: string, title: string) {
  return {
    key,
    title,
    acceptance_rule: { clauses: [{ evaluator: "manual_confirm", match: {} }] },
  };
}

function plan(nodes: ReturnType<typeof mkNode>[], edges: { from: string; to: string }[] = []) {
  return DecompositionOutput.parse({ nodes, edges });
}

describe("validatePlan", () => {
  it("accepts a valid linear plan", () => {
    const p = plan([mkNode("a", "A"), mkNode("b", "B")], [{ from: "a", to: "b" }]);
    expect(validatePlan(p)).toEqual({ ok: true, errors: [] });
  });

  it("rejects duplicate keys", () => {
    const p = plan([mkNode("a", "A"), mkNode("a", "A2")]);
    expect(validatePlan(p).ok).toBe(false);
    expect(validatePlan(p).errors).toContain("duplicate node keys");
  });

  it("rejects edges referencing unknown nodes", () => {
    const p = plan([mkNode("a", "A")], [{ from: "a", to: "ghost" }]);
    expect(validatePlan(p).errors.some((e) => e.includes("ghost"))).toBe(true);
  });

  it("detects dependency cycles", () => {
    const p = plan(
      [mkNode("a", "A"), mkNode("b", "B")],
      [
        { from: "a", to: "b" },
        { from: "b", to: "a" },
      ],
    );
    expect(validatePlan(p).errors).toContain("dependency cycle detected");
  });
});

describe("planMerge · re-plan preserves completed nodes", () => {
  const existing: ExistingMilestone[] = [
    { id: "1", title: "Design schema", status: "completed" },
    { id: "2", title: "Write API", status: "pending" },
  ];

  it("freezes completed, updates matched, adds new, skips dropped", () => {
    const next = plan([mkNode("n1", "design schema"), mkNode("n3", "Deploy")]);
    const merged = planMerge(existing, next);

    const byTitle = (t: string) => merged.find((m) => m.title.toLowerCase() === t.toLowerCase());

    // Completed "Design schema" → freeze; reuse stable id "1"; title is not overwritten by the new decomposition
    expect(byTitle("Design schema")).toMatchObject({ action: "freeze", existingId: "1" });
    // New node Deploy → add
    expect(byTitle("Deploy")).toMatchObject({ action: "add", existingId: null });
    // Unfinished and dropped "Write API" → skip (soft delete)
    expect(byTitle("Write API")).toMatchObject({ action: "skip", existingId: "2" });
  });

  it("keeps a completed node even when the new plan drops it entirely", () => {
    const next = plan([mkNode("n9", "Totally new thing")]);
    const merged = planMerge(existing, next);
    expect(merged.find((m) => m.existingId === "1")).toMatchObject({ action: "freeze" });
  });
});
