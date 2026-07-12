import { describe, expect, it } from "vitest";
import { DecompositionOutput } from "@core/types";
import {
  mergePlanNodes,
  movePlanNode,
  planMerge,
  splitPlanNode,
  updatePlanNode,
  validateExecutablePlan,
  validatePlan,
  type ExistingMilestone,
} from "./plan";

function mkNode(key: string, title: string) {
  return {
    key,
    title,
    acceptance_rule: { clauses: [{ evaluator: "manual_confirm", match: {} }] },
  };
}

function mkCiNode(key: string, title: string) {
  return {
    key,
    title,
    description: "Verify with CI.",
    acceptance_rule: {
      clauses: [{ evaluator: "ci_status", match: { conclusion: "success" } }],
    },
  };
}

type TestNode = ReturnType<typeof mkNode> | ReturnType<typeof mkCiNode>;

function plan(nodes: TestNode[], edges: { from: string; to: string }[] = []) {
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

describe("plan editing transformations", () => {
  it("edits sub-aim text and acceptance rules while keeping the plan executable", () => {
    const base = plan([mkNode("a", "Draft"), mkCiNode("b", "Verify")], [{ from: "a", to: "b" }]);
    const nextRule = base.nodes[1]!.acceptance_rule;
    const edited = updatePlanNode(base, "a", {
      title: "Draft launch checklist",
      description: "Create the concrete checklist the release will use.",
      acceptance_rule: nextRule,
    });

    expect(edited.nodes[0]).toMatchObject({
      key: "a",
      title: "Draft launch checklist",
      description: "Create the concrete checklist the release will use.",
    });
    expect(edited.nodes[0]!.acceptance_rule.clauses[0]!.evaluator).toBe("ci_status");
    expect(validateExecutablePlan(edited)).toEqual({ ok: true, errors: [] });
  });

  it("merges two sub-aims and combines their eval rules into one executable node", () => {
    const base = plan([mkNode("a", "Draft"), mkCiNode("b", "Verify")], [{ from: "a", to: "b" }]);

    const merged = mergePlanNodes(base, "a", "b");

    expect(merged.nodes).toHaveLength(1);
    expect(merged.nodes[0]!.title).toBe("Draft + Verify");
    expect(merged.nodes[0]!.acceptance_rule.logic).toBe("all");
    expect(merged.nodes[0]!.acceptance_rule.clauses.map((clause) => clause.evaluator)).toEqual([
      "manual_confirm",
      "ci_status",
    ]);
    expect(merged.edges).toEqual([]);
    expect(validateExecutablePlan(merged)).toEqual({ ok: true, errors: [] });
  });

  it("splits one sub-aim into two sequential executable nodes", () => {
    const base = plan([mkNode("a", "Draft"), mkCiNode("b", "Verify")], [{ from: "a", to: "b" }]);

    const split = splitPlanNode(base, "a", {
      first: { title: "Draft outline" },
      second: {
        title: "Draft final checklist",
        description: "Turn the outline into the final checklist.",
      },
    });

    expect(split.nodes.map((node) => node.title)).toEqual(["Draft outline", "Draft final checklist", "Verify"]);
    expect(split.nodes[1]!.key).toBe("a-split");
    expect(split.edges).toEqual([
      { from: "a", to: "a-split" },
      { from: "a-split", to: "b" },
    ]);
    expect(validateExecutablePlan(split)).toEqual({ ok: true, errors: [] });
  });

  it("reorders sub-aims and rewrites dependencies to match the new order", () => {
    const base = plan([mkNode("a", "Draft"), mkCiNode("b", "Verify")], [{ from: "a", to: "b" }]);

    const moved = movePlanNode(base, "b", 0);

    expect(moved.nodes.map((node) => node.key)).toEqual(["b", "a"]);
    expect(moved.edges).toEqual([{ from: "b", to: "a" }]);
    expect(validateExecutablePlan(moved)).toEqual({ ok: true, errors: [] });
  });

  it("reports schema errors for edited payloads that are not saveable plans", () => {
    const base = plan([mkNode("a", "Draft")]);
    const invalid = updatePlanNode(base, "a", { title: "" });

    const validation = validateExecutablePlan(invalid);

    expect(validation.ok).toBe(false);
    expect(validation.errors.some((error) => error.includes("nodes.0.title"))).toBe(true);
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

  it("matches by node key so an in-place rename updates the same milestone (no skip+add)", () => {
    // Same node key "k2", new title → an in-place edit rename. Without key matching this would
    // skip the old milestone and add a fresh one (churning the id + orphaning evidence).
    const keyed: ExistingMilestone[] = [
      { id: "1", title: "Design schema", status: "completed", key: "k1" },
      { id: "2", title: "Write API", status: "pending", key: "k2" },
    ];
    const next = plan([mkNode("k1", "Design schema"), mkNode("k2", "Write the API (renamed)")]);
    const merged = planMerge(keyed, next);

    const renamed = merged.find((m) => m.nodeKey === "k2");
    expect(renamed).toMatchObject({ action: "update", existingId: "2", title: "Write the API (renamed)" });
    // No skip/add churn for the rename — only the two keyed rows survive.
    expect(merged.filter((m) => m.action === "skip")).toHaveLength(0);
    expect(merged.filter((m) => m.action === "add")).toHaveLength(0);
    expect(merged).toHaveLength(2);
  });

  it("falls back to title matching when node keys don't correspond (LLM re-plan)", () => {
    // Existing rows carry keys, but the LLM's fresh nodes use different keys → title fallback,
    // exactly the pre-existing behavior.
    const keyed: ExistingMilestone[] = [{ id: "2", title: "Write API", status: "pending", key: "old-key" }];
    const next = plan([mkNode("fresh-key", "write api")]);
    const merged = planMerge(keyed, next);
    expect(merged.find((m) => m.existingId === "2")).toMatchObject({ action: "update" });
  });
});
