/**
 * JSON Schema for the goal-decomposition Structured Output.
 *
 * This is the schema we hand to Claude via `output_config.format` so the model is
 * constrained to emit a valid {@link import("@core/types").DecompositionOutput}.
 *
 * Why a hand-written schema instead of zod-to-json-schema:
 *  - Anthropic Structured Outputs does NOT support recursive schemas, which is exactly
 *    why the domain model uses a FLAT `nodes[] + edges[]` graph (no nested self-refs).
 *    A hand-written, recursion-free schema keeps that contract explicit and auditable.
 *  - Several zod refinements (`.min`/`.max` on arrays, `.positive()` on numbers,
 *    `.min(1)` on strings) are NOT enforceable by the structured-output engine. We omit
 *    them from the schema and re-validate everything with the zod `DecompositionOutput`
 *    parser + `validatePlan` after the model responds. The schema below therefore
 *    describes the SHAPE; the zod layer enforces the CONSTRAINTS.
 *
 * Evaluators surfaced to the model are limited to the v1 set (`commit_pattern`,
 * `ci_status`); the reserved v3 evaluators are intentionally not offered here.
 */

const estEffortEnum = ["xs", "s", "m", "l", "xl"] as const;
const rarityEnum = ["common", "uncommon", "rare", "epic", "legendary"] as const;
const goalDomainEnum = ["software", "career", "learning", "health", "creative", "custom"] as const;
const logicEnum = ["any", "all", "weighted"] as const;
const completionModeEnum = ["auto", "manual", "auto_then_confirm"] as const;
const ciConclusionEnum = ["success", "failure", "cancelled", "timed_out", "skipped"] as const;

/** A `commit_pattern` acceptance clause (v1 auto-verifiable evaluator). */
const commitPatternClause = {
  type: "object",
  additionalProperties: false,
  properties: {
    evaluator: { type: "string", enum: ["commit_pattern"] },
    auto_verifiable: { type: "boolean" },
    weight: { type: "number" },
    match: {
      type: "object",
      additionalProperties: false,
      properties: {
        path_glob: { type: "string" },
        min_files: { type: "integer" },
        message_pattern: { type: "string" },
        branch: { type: "string" },
      },
      required: [],
    },
  },
  required: ["evaluator", "match"],
} as const;

/** A `ci_status` acceptance clause (v1 auto-verifiable evaluator). */
const ciStatusClause = {
  type: "object",
  additionalProperties: false,
  properties: {
    evaluator: { type: "string", enum: ["ci_status"] },
    auto_verifiable: { type: "boolean" },
    weight: { type: "number" },
    match: {
      type: "object",
      additionalProperties: false,
      properties: {
        workflow: { type: "string" },
        conclusion: { type: "string", enum: ciConclusionEnum },
      },
      required: [],
    },
  },
  required: ["evaluator", "match"],
} as const;

const acceptanceRuleSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    logic: { type: "string", enum: logicEnum },
    clauses: {
      type: "array",
      items: { anyOf: [commitPatternClause, ciStatusClause] },
    },
    threshold: { type: "number" },
    completion_mode: { type: "string", enum: completionModeEnum },
  },
  required: ["clauses"],
} as const;

const planNodeSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    key: { type: "string", description: "Stable local id for this node, unique within the plan." },
    title: { type: "string" },
    description: { type: "string" },
    est_effort: { type: "string", enum: estEffortEnum },
    xp_reward: { type: "integer", description: "Positive XP awarded on completion." },
    rarity: { type: "string", enum: rarityEnum },
    acceptance_rule: acceptanceRuleSchema,
  },
  required: ["key", "title", "acceptance_rule"],
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
    goal_summary: { type: "string", description: "One-sentence restatement of the goal." },
    domain: { type: "string", enum: goalDomainEnum },
    rationale: { type: "string", description: "Brief reasoning for the chosen breakdown." },
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
  required: ["nodes"],
} as const;

export type DecompositionJsonSchema = typeof decompositionJsonSchema;
