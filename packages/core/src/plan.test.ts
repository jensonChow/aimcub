import { describe, expect, it } from "vitest";
import { DecompositionOutput } from "@aimcub/types";
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

  it("reorders independent sub-aims without touching the dependency graph", () => {
    // c is independent of a and b, so it may be presented anywhere.
    const base = plan(
      [mkNode("a", "Draft"), mkCiNode("b", "Verify"), mkNode("c", "Announce")],
      [{ from: "a", to: "b" }],
    );

    const moved = movePlanNode(base, "c", 0);

    expect(moved.nodes.map((node) => node.key)).toEqual(["c", "a", "b"]);
    expect(moved.edges).toEqual([{ from: "a", to: "b" }]); // dependencies are facts, not order
    expect(validateExecutablePlan(moved)).toEqual({ ok: true, errors: [] });
  });

  it("refuses to express an order its dependencies forbid, instead of rewriting them", () => {
    // Dragging "Verify" above the "Draft" it depends on cannot change what must happen first
    // (that was the old behaviour, which silently destroyed the plan's real shape).
    const base = plan([mkNode("a", "Draft"), mkCiNode("b", "Verify")], [{ from: "a", to: "b" }]);

    const moved = movePlanNode(base, "b", 0);

    expect(moved.nodes.map((node) => node.key)).toEqual(["a", "b"]);
    expect(moved.edges).toEqual([{ from: "a", to: "b" }]);
    expect(validateExecutablePlan(moved)).toEqual({ ok: true, errors: [] });
  });

  it("keeps parallel branches parallel across merge and split", () => {
    // Diamond: two independent branches between a root and a join.
    const base = plan(
      [mkNode("root", "Set up"), mkNode("x", "Branch A"), mkNode("y", "Branch B"), mkCiNode("join", "Verify both")],
      [{ from: "root", to: "x" }, { from: "root", to: "y" }, { from: "x", to: "join" }, { from: "y", to: "join" }],
    );

    // Splitting one branch keeps the OTHER branch independent of it.
    const split = splitPlanNode(base, "x");
    expect(split.edges).toContainEqual({ from: "x", to: "x-split" });
    expect(split.edges).toContainEqual({ from: "x-split", to: "join" });
    expect(split.edges).toContainEqual({ from: "root", to: "y" });
    expect(split.edges).not.toContainEqual({ from: "y", to: "x" });
    expect(validateExecutablePlan(split)).toEqual({ ok: true, errors: [] });

    // Merging the two branches yields ONE branch that still sits between root and join.
    const merged = mergePlanNodes(base, "x", "y");
    expect(merged.nodes.map((node) => node.key)).toEqual(["root", "x", "join"]);
    expect(merged.edges).toEqual([{ from: "root", to: "x" }, { from: "x", to: "join" }]);
    expect(validateExecutablePlan(merged)).toEqual({ ok: true, errors: [] });
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
