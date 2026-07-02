/**
 * JSON Schema for the goal-decomposition Structured Output.
 *
 * This is the schema we hand to Claude via `output_config.format` so the model is
 * constrained to emit a plan that normalizes into {@link import("@core/types").DecompositionOutput}.
 *
 * Shape rules — found empirically against the live API (2026-06):
 *  - NO optional properties. The structured-output grammar compiler's cost explodes
 *    combinatorially with optional keys across nesting levels: our previous schema
 *    (a handful of optionals on 3 levels) HUNG the API for 90s+ and returned
 *    "Schema is too complex". Every property is `required`, and optionality is
 *    expressed as `type: [T, "null"]` / `anyOf [.., null]` — that compiles in seconds.
 *  - NO `anyOf` unions of object variants (discriminated clause types). The clause is
 *    ONE flat object carrying the union of both evaluators' fields; `decompose()`
 *    re-nests them into the domain's `{evaluator, match}` shape and strips nulls
 *    before the zod gate. The schema describes the SHAPE; zod + `validatePlan`
 *    enforce the strict CONSTRAINTS.
 *  - NO recursion (the domain model is a flat `nodes[] + edges[]` graph by design).
 *
 * Evaluators surfaced to the model are limited to the v1 set (`commit_pattern`,
 * `ci_status`); reserved v3 evaluators and the `weighted` logic are not offered.
 */

const nullableString = (description?: string) =>
  description ? { type: ["string", "null"], description } : { type: ["string", "null"] };

const nullableEnum = (values: readonly string[], description?: string) => ({
  anyOf: [{ type: "string", enum: values }, { type: "null" }],
  ...(description ? { description } : {}),
});

const estEffortEnum = ["xs", "s", "m", "l", "xl"] as const;
const goalDomainEnum = ["software", "career", "learning", "health", "creative", "custom"] as const;
const contextCategoryEnum = ["preference", "constraint", "capability", "eval_signal", "project_fact", "procedure"] as const;
const decompositionOwnerEnum = ["human", "agent", "either", "mixed"] as const;
const logicEnum = ["any", "all"] as const;
const completionModeEnum = ["auto", "manual", "auto_then_confirm"] as const;
const ciConclusionEnum = ["success", "failure", "cancelled", "timed_out", "skipped"] as const;

/**
 * One acceptance clause, FLAT: which fields apply depends on `evaluator`; every
 * inapplicable field must be null. `decompose()` re-nests these into `match`.
 */
const acceptanceClauseSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    evaluator: {
      type: "string",
      enum: ["commit_pattern", "ci_status"],
      description:
        "commit_pattern matches commits (path_glob / min_files / message_pattern / branch); " +
        "ci_status matches a CI run (workflow / conclusion). Set the other evaluator's fields to null.",
    },
    auto_verifiable: { type: ["boolean", "null"] },
    path_glob: nullableString("commit_pattern: glob over changed file paths."),
    min_files: { type: ["integer", "null"], description: "commit_pattern: minimum matching files." },
    message_pattern: nullableString("commit_pattern: regex over the commit message."),
    branch: nullableString("commit_pattern: restrict to a branch."),
    workflow: nullableString("ci_status: workflow name."),
    conclusion: nullableEnum(ciConclusionEnum, "ci_status: required conclusion."),
  },
  required: [
    "evaluator",
    "auto_verifiable",
    "path_glob",
    "min_files",
    "message_pattern",
    "branch",
    "workflow",
    "conclusion",
  ],
} as const;

const acceptanceRuleSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    logic: nullableEnum(logicEnum),
    clauses: { type: "array", items: acceptanceClauseSchema },
    completion_mode: nullableEnum(
      completionModeEnum,
      "How completion is finalized. Use only auto, manual, or auto_then_confirm; never use mixed here.",
    ),
  },
  required: ["logic", "clauses", "completion_mode"],
} as const;

const decompositionContextGapSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    category: { type: "string", enum: contextCategoryEnum },
    question: { type: "string", description: "The precise user/context question that would change this milestone." },
    reason: { type: "string", description: "Why this missing context matters for this milestone." },
  },
  required: ["category", "question", "reason"],
} as const;

const decompositionContractSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    why: { type: "string", description: "Why this milestone exists as a separate unit in the aim decomposition." },
    definition_of_done: { type: "string", description: "Concrete done state for this milestone, in user-facing terms." },
    required_evidence: {
      type: "array",
      minItems: 1,
      description: "Evidence artifacts/events that should prove this milestone complete.",
      items: { type: "string" },
    },
    likely_owner: {
      type: "string",
      enum: decompositionOwnerEnum,
      description: "Who is most likely to advance this milestone: human, agent, either, or mixed.",
    },
    context_gaps: {
      type: "array",
      description: "Missing context that would materially change this milestone. Empty array when none is needed.",
      items: decompositionContextGapSchema,
    },
    eval_signal: { type: "string", description: "The personalized evaluation signal this milestone is trying to satisfy." },
  },
  required: ["why", "definition_of_done", "required_evidence", "likely_owner", "context_gaps", "eval_signal"],
} as const;

const planNodeSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    key: { type: "string", description: "Stable local id for this node, unique within the plan." },
    title: { type: "string" },
    description: nullableString(),
    est_effort: nullableEnum(estEffortEnum),
    xp_reward: { type: ["integer", "null"], description: "Positive effort/contribution weight credited on completion." },
    acceptance_rule: acceptanceRuleSchema,
    decomposition_contract: decompositionContractSchema,
  },
  required: ["key", "title", "description", "est_effort", "xp_reward", "acceptance_rule", "decomposition_contract"],
} as const;

const planEdgeSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    from: { type: "string", description: "Node key that must complete first." },
    to: { type: "string", description: "Node key that depends on `from`." },
  },
  required: ["from", "to"],
} as const;

/**
 * The full JSON Schema passed to `output_config.format`. Plain JSON object so it can be
 * handed verbatim to the Anthropic SDK (`JSONOutputFormat.schema`).
 */
export const decompositionJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    goal_summary: nullableString("One-sentence restatement of the goal."),
    domain: nullableEnum(goalDomainEnum),
    rationale: nullableString("Brief reasoning for the chosen breakdown."),
    nodes: {
      type: "array",
      description: "1..15 milestones as a flat list (no nesting).",
      items: planNodeSchema,
    },
    edges: {
      type: "array",
      description: "Dependency edges; {from,to} means `to` depends on `from`. Must be acyclic.",
      items: planEdgeSchema,
    },
  },
  required: ["goal_summary", "domain", "rationale", "nodes", "edges"],
} as const;

export type DecompositionJsonSchema = typeof decompositionJsonSchema;
