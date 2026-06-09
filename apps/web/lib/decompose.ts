/**
 * Local, deterministic goal decomposer used by the mock data layer.
 *
 * In production this is the @core/llm Claude Structured Output call that returns a
 * DecompositionOutput. Here we generate the same shape locally so the
 * "set a goal → see it decompose" flow is demoable with zero backend and zero API key.
 *
 * TODO(v1a-live): replace localDecompose() with the @core/llm decomposition call
 * (Anthropic Structured Output -> DecompositionOutput), keeping validatePlan() as the gate.
 */
import type { AcceptanceRule, DecompositionOutput, EstEffort, GoalDomain, PlanNode } from "@core/types";

export interface DecomposeRequest {
  title: string;
  description?: string;
  domain?: GoalDomain;
}

const EFFORT_CYCLE: EstEffort[] = ["s", "m", "m", "l", "m"];

/** A small library of generic software milestones to fan a goal title into a plan. */
const TEMPLATE_STEPS: ReadonlyArray<{ title: string; description: string; rule: () => AcceptanceRule }> = [
  {
    title: "Scaffold the project",
    description: "Initialize the repository, tooling, and a runnable skeleton.",
    rule: () => ({
      logic: "all",
      threshold: 1,
      completion_mode: "auto_then_confirm",
      clauses: [
        {
          evaluator: "commit_pattern",
          auto_verifiable: true,
          match: { message_pattern: "scaffold|init|setup", min_files: 1 },
        },
      ],
    }),
  },
  {
    title: "Implement the core feature",
    description: "Build the primary user-facing capability end to end.",
    rule: () => ({
      logic: "all",
      threshold: 1,
      completion_mode: "auto_then_confirm",
      clauses: [
        {
          evaluator: "commit_pattern",
          auto_verifiable: true,
          match: { path_glob: "src/**", min_files: 1, message_pattern: "feat" },
        },
      ],
    }),
  },
  {
    title: "Add automated tests",
    description: "Cover the core behavior with a passing test suite.",
    rule: () => ({
      logic: "any",
      threshold: 1,
      completion_mode: "auto_then_confirm",
      clauses: [
        { evaluator: "commit_pattern", auto_verifiable: true, match: { path_glob: "**/*.test.*", min_files: 1 } },
        { evaluator: "ci_status", auto_verifiable: true, match: { conclusion: "success" } },
      ],
    }),
  },
  {
    title: "Wire up CI",
    description: "Green continuous-integration pipeline on the default branch.",
    rule: () => ({
      logic: "all",
      threshold: 1,
      completion_mode: "auto_then_confirm",
      clauses: [{ evaluator: "ci_status", auto_verifiable: true, match: { workflow: "ci", conclusion: "success" } }],
    }),
  },
  {
    title: "Ship a release",
    description: "Tag and publish the first working release.",
    rule: () => ({
      logic: "all",
      threshold: 1,
      completion_mode: "auto_then_confirm",
      clauses: [
        {
          evaluator: "commit_pattern",
          auto_verifiable: true,
          match: { message_pattern: "release|v\\d", branch: "main" },
        },
      ],
    }),
  },
];

const XP_BY_EFFORT: Record<EstEffort, number> = { xs: 5, s: 10, m: 20, l: 40, xl: 80 };
const RARITY_BY_EFFORT: Record<EstEffort, PlanNode["rarity"]> = {
  xs: "common",
  s: "common",
  m: "uncommon",
  l: "rare",
  xl: "epic",
};

/**
 * Deterministically decompose a goal into a linear DecompositionOutput.
 * Same shape the LLM will return, so downstream code (validatePlan, materialization)
 * is identical for mock and live.
 */
export function localDecompose(req: DecomposeRequest): DecompositionOutput {
  const domain: GoalDomain = req.domain ?? "software";
  const nodes: PlanNode[] = TEMPLATE_STEPS.map((step, i) => {
    const effort = EFFORT_CYCLE[i % EFFORT_CYCLE.length] ?? "m";
    return {
      key: `n${i + 1}`,
      title: step.title,
      description: step.description,
      est_effort: effort,
      xp_reward: XP_BY_EFFORT[effort],
      rarity: RARITY_BY_EFFORT[effort],
      acceptance_rule: step.rule(),
    };
  });

  // Linear chain: each step depends on the previous one (from must complete before to).
  const edges = nodes.slice(1).map((node, i) => ({ from: nodes[i]!.key, to: node.key }));

  return {
    goal_summary: req.title,
    domain,
    rationale:
      "Deterministic local plan (mock). Production replaces this with a Claude Structured Output decomposition.",
    nodes,
    edges,
  };
}
