/**
 * Goal-decomposition pipeline.
 *
 * Given a goal (title / description / domain), ask Claude — through any `LlmGateway` —
 * to break it into 1..15 milestones expressed as a FLAT `nodes[] + edges[]` graph, then:
 *   1. parse the model output with the zod `DecompositionOutput` schema (shape + constraints), and
 *   2. run `validatePlan` for the semantic invariants the grammar cannot enforce
 *      (acyclic, unique keys, count range, edge references).
 *
 * The function never throws on bad model output: a malformed response or a plan that
 * fails validation is returned as `{ ok: false, errors }` so the caller (an Edge Function)
 * can decide whether to re-prompt, surface the error, or fall back.
 */
import { DecompositionOutput, type GoalDomain } from "@core/types";
import { validatePlan, type PlanValidation } from "@core/domain";

import type { LlmGateway, LlmResponse, LlmUsage } from "./index";
import { decompositionJsonSchema } from "./decomposition-schema";

/** Input to {@link decompose}: the user's raw goal plus its domain. */
export interface DecomposeInput {
  title: string;
  description?: string;
  /** Defaults to `software` (the only MVP domain). */
  domain?: GoalDomain;
}

/** Result of {@link decompose}. `validation.ok === false` ⇒ `output` may be null. */
export interface DecomposeResult {
  /** The parsed + validated plan, or `null` when parsing/validation failed. */
  output: DecompositionOutput | null;
  /** Aggregated validation outcome (zod parse + `validatePlan`). */
  validation: PlanValidation;
  /** Token usage for metering. Present whenever the gateway returned a response. */
  usage: LlmUsage | null;
}

/** System prompt: frozen instructions. Kept stable so it stays cache-friendly. */
const SYSTEM_PROMPT = [
  "You are Aimcub's planning engine. You break a user's goal into a concrete, ordered set",
  "of milestones that a software developer can verify automatically from their own activity.",
  "",
  "Rules:",
  "- Produce between 1 and 15 milestones. Fewer, meaningful milestones beat many trivial ones.",
  "- Return a FLAT graph: a `nodes` array plus an `edges` array. Never nest nodes inside nodes.",
  "- Each edge {from, to} means the `from` milestone must be completed before `to` can start.",
  "  The dependency graph MUST be acyclic. Every edge endpoint must reference an existing node key.",
  "- Give every node a unique, stable `key` (e.g. `m1`, `setup-repo`).",
  "- For each milestone, write an `acceptance_rule` whose clauses use ONLY these evaluators:",
  "    * `commit_pattern` — matches commits by file path glob, message pattern, branch, or min file count.",
  "    * `ci_status` — matches a CI workflow conclusion (default conclusion: success).",
  "  Prefer `commit_pattern` for 'work was done' milestones and `ci_status` for 'it passes' milestones.",
  "- `est_effort` is one of xs|s|m|l|xl. `rarity` is one of common|uncommon|rare|epic|legendary;",
  "  scale rarity with difficulty. `xp_reward` is a positive integer; scale it with effort.",
  "- Keep titles short and imperative. Keep descriptions to one or two sentences.",
].join("\n");

/** Build the per-goal user prompt. */
function buildUserPrompt(input: DecomposeInput): string {
  const domain = input.domain ?? "software";
  const description = input.description?.trim() ? input.description.trim() : "(no description provided)";
  return [
    `Goal title: ${input.title}`,
    `Goal domain: ${domain}`,
    `Goal description: ${description}`,
    "",
    "Break this goal into milestones following the rules and the provided JSON schema.",
  ].join("\n");
}

/**
 * Decompose a goal into a validated milestone plan.
 *
 * @param gateway any `LlmGateway` (the real Anthropic gateway in production, a mock in tests).
 * @param input the goal to decompose.
 */
export async function decompose(gateway: LlmGateway, input: DecomposeInput): Promise<DecomposeResult> {
  let raw: LlmResponse<unknown>;
  try {
    raw = await gateway.completeStructured<unknown>({
      task: "decompose",
      system: SYSTEM_PROMPT,
      prompt: buildUserPrompt(input),
      schema: decompositionJsonSchema,
    });
  } catch (err) {
    // A transport/model failure is reported, not thrown — keep the pipeline total.
    const message = err instanceof Error ? err.message : String(err);
    return {
      output: null,
      validation: { ok: false, errors: [`llm request failed: ${message}`] },
      usage: null,
    };
  }

  // Parse + apply zod constraints (string min length, array 1..15, positive xp, etc.).
  const parsed = DecompositionOutput.safeParse(raw.output);
  if (!parsed.success) {
    return {
      output: null,
      validation: { ok: false, errors: parsed.error.issues.map(formatZodIssue) },
      usage: raw.usage,
    };
  }

  // Semantic invariants the grammar/zod cannot express: acyclic, unique keys, edge refs.
  const validation = validatePlan(parsed.data);
  return {
    output: validation.ok ? parsed.data : null,
    validation,
    usage: raw.usage,
  };
}

function formatZodIssue(issue: { path: (string | number)[]; message: string }): string {
  const path = issue.path.length > 0 ? issue.path.join(".") : "(root)";
  return `${path}: ${issue.message}`;
}
