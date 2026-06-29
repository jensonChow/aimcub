/**
 * JSON Schema for the clarifying-questions Structured Output (the feedback step).
 *
 * Same hardening rules as `decomposition-schema.ts` (found empirically against the
 * live API, 2026-06):
 *  - NO optional properties — every key is `required`; optionality is `type: [T,"null"]`
 *    / `anyOf [.., null]`. Optionals across nesting levels make the grammar compiler
 *    hang ("Schema is too complex").
 *  - NO `anyOf` unions of object variants — questions/options are uniform flat objects.
 *  - NO recursion — a flat `questions[]` (each with a flat `options[]`) + `assumptions[]`.
 *
 * The schema describes the SHAPE; `clarify()`'s `validateClarify` enforces the
 * CONSTRAINTS (>= 2 options per question, unique ids, non-empty text, max count).
 */

const nullableString = (description?: string) =>
  description ? { type: ["string", "null"], description } : { type: ["string", "null"] };

const nullableEnum = (values: readonly string[], description?: string) => ({
  anyOf: [{ type: "string", enum: values }, { type: "null" }],
  ...(description ? { description } : {}),
});

const questionKindEnum = ["scope", "involvement", "assumption", "constraint"] as const;

/** One option the user can pick — a hypothesis the planner proposes, with its trade-off. */
const optionSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    label: { type: "string", description: "A concrete candidate answer (a hypothesis), not a blank." },
    tradeoff: nullableString("The consequence of choosing this option."),
  },
  required: ["label", "tradeoff"],
} as const;

const questionSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    id: { type: "string", description: "Stable id (e.g. q1, scope), unique within the set." },
    question: { type: "string" },
    why_high_impact: {
      type: "string",
      description: "How the answer most changes the plan (value-of-information).",
    },
    kind: nullableEnum(questionKindEnum, "What the question pins down."),
    allow_other: { type: ["boolean", "null"], description: "Free-text is always allowed; set true." },
    options: { type: "array", description: ">= 2 hypothesis options with trade-offs.", items: optionSchema },
  },
  required: ["id", "question", "why_high_impact", "kind", "allow_other", "options"],
} as const;

/** A low-impact unknown we DEFAULTED rather than asked about (default-and-disclose). */
const assumptionSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    statement: { type: "string", description: "What we assumed (so the user can correct it)." },
    default_value: nullableString("The value we defaulted to."),
  },
  required: ["statement", "default_value"],
} as const;

/** Full schema handed to `output_config.format`. Plain JSON object for the Anthropic SDK. */
export const clarifyJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    questions: {
      type: "array",
      description: "Only the few high-impact questions worth asking (0-5). Fewer is better.",
      items: questionSchema,
    },
    assumptions: {
      type: "array",
      description: "Low-impact unknowns defaulted rather than asked (default-and-disclose).",
      items: assumptionSchema,
    },
  },
  required: ["questions", "assumptions"],
} as const;

export type ClarifyJsonSchema = typeof clarifyJsonSchema;
