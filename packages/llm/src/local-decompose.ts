/**
 * Deterministic, offline goal decomposer — the no-API-key fallback for {@link decompose}.
 *
 * Generates the same `DecompositionOutput` shape the LLM returns, so downstream code
 * (validatePlan, materialization) is identical whether the plan came from Claude or
 * from here. Lives in `@aimcub/llm` (next to `decompose`) so Desktop and CLI share
 * one fallback. Pure — depends only on `@aimcub/types`.
 */
import type { AcceptanceRule, DecompositionContract, DecompositionOutput, EstEffort, GoalDomain, PlanNode } from "@aimcub/types";

export interface DecomposeRequest {
  title: string;
  description?: string;
  domain?: GoalDomain | null;
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

function fallbackContract(step: { title: string; description: string }, index: number): DecompositionContract {
  const owner: DecompositionContract["likely_owner"] = index === 2 || index === 3 ? "agent" : "either";
  return {
    why: `This milestone turns "${step.title}" into a separately verifiable outcome instead of hiding it inside a broad aim.`,
    definition_of_done: step.description,
    required_evidence: [
      index === 3 ? "A successful CI status event." : "A trusted commit or CI event that matches the acceptance rule.",
    ],
    likely_owner: owner,
    context_gaps: [
      {
        category: "eval_signal",
        question: "What would make this milestone count as genuinely complete for this aim?",
        reason: "offline_fallback_missing_personalized_eval",
      },
    ],
    eval_signal: "The milestone is complete when its acceptance rule proves the stated outcome without relying only on manual judgment.",
  };
}

/**
 * Deterministically decompose a goal into a linear DecompositionOutput.
 * Same shape the LLM returns, so downstream code is identical for offline and live.
 */
export function localDecompose(req: DecomposeRequest): DecompositionOutput {
  // The offline template has no basis to classify the aim: pass the caller's domain through
  // or stay honestly null (never stamp a guess).
  const domain: GoalDomain | null = req.domain ?? null;
  const nodes: PlanNode[] = TEMPLATE_STEPS.map((step, i) => {
    const effort = EFFORT_CYCLE[i % EFFORT_CYCLE.length] ?? "m";
    return {
      key: `n${i + 1}`,
      title: step.title,
      description: step.description,
      est_effort: effort,
      xp_reward: XP_BY_EFFORT[effort],
      acceptance_rule: step.rule(),
      decomposition_contract: fallbackContract(step, i),
      routing_override: null,
    };
  });

  // Linear chain: each step depends on the previous one (from must complete before to).
  const edges = nodes.slice(1).map((node, i) => ({ from: nodes[i]!.key, to: node.key }));

  return {
    goal_summary: req.title,
    domain,
    rationale:
      "Deterministic local plan (offline fallback). Production replaces this with a Claude Structured Output decomposition.",
    nodes,
    edges,
  };
}
