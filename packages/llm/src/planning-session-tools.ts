/**
 * Planning-session projected tools.
 *
 * These are the tools Aimcub projects to an EMBEDDED planning brain (a local agent
 * such as Claude Code or Codex driving the aim breakdown). They are still first-party
 * Aimcub tools — contracts, permissions, and validation stay Aimcub-owned — but they
 * are designed to be registered 1:1 on a per-session local MCP bridge, because an
 * external brain connects through the external boundary like any other agent.
 *
 * The session protocol that interprets calls to these tools lives in
 * `planning-session.ts`; this module only defines the surface (names, descriptions,
 * JSON schemas) so runtime shells can expose it without re-stating the contract.
 */
import { CHOICE_SELECTION_REASONS } from "@aimcub/core";

import { decompositionJsonSchema } from "./decomposition-schema";

export const PLANNING_SESSION_TOOL_NAMES = [
  "ask_user",
  "search_memory",
  "report_research",
  "propose_memory",
  "submit_plan",
] as const;

export type PlanningSessionToolName = (typeof PLANNING_SESSION_TOOL_NAMES)[number];

export function isPlanningSessionToolName(value: string): value is PlanningSessionToolName {
  return (PLANNING_SESSION_TOOL_NAMES as readonly string[]).includes(value);
}

/** Loose JSON-schema shape: MCP consumes plain JSON Schema objects. */
export type PlanningSessionJsonSchema = Record<string, unknown>;

export interface PlanningSessionToolDefinition {
  name: PlanningSessionToolName;
  description: string;
  inputSchema: PlanningSessionJsonSchema;
}

const askUserInputSchema: PlanningSessionJsonSchema = {
  type: "object",
  required: ["question"],
  additionalProperties: false,
  properties: {
    question: {
      type: "string",
      minLength: 1,
      description: "ONE high-impact question whose answer materially changes the plan.",
    },
    kind: {
      type: "string",
      enum: ["scope", "involvement", "assumption", "constraint", "capability"],
      description: "What kind of gap this question closes.",
    },
    why_high_impact: {
      type: "string",
      description: "Why answering this changes the plan most (shown to the user).",
    },
    options: {
      type: "array",
      maxItems: 6,
      description: "Hypothesis options with trade-offs. Omit for a free-text question.",
      items: {
        type: "object",
        required: ["label"],
        additionalProperties: false,
        properties: {
          label: { type: "string", minLength: 1 },
          tradeoff: { type: "string", description: "What picking this option implies." },
        },
      },
    },
    selection_mode: {
      type: "string",
      enum: ["single", "multiple"],
      description:
        "single ONLY when answers are mutually exclusive in the same scope or one primary choice is explicitly required; when any pair can be true together use multiple; uncertainty defaults to multiple.",
    },
    selection_mode_reason: { type: "string", enum: CHOICE_SELECTION_REASONS },
    capture_scope: {
      type: "string",
      enum: ["global", "current_aim", "none"],
      description: "Whether the answer should become durable global context, aim-local context, or neither.",
    },
  },
};

const searchMemoryInputSchema: PlanningSessionJsonSchema = {
  type: "object",
  required: ["query"],
  additionalProperties: false,
  properties: {
    query: { type: "string", minLength: 1, description: "Search query over the user's durable Aimcub memories." },
    scope: { type: "string", enum: ["global", "current_aim", "both"], default: "both" },
    limit: { type: "integer", minimum: 1, maximum: 50 },
  },
};

const reportResearchInputSchema: PlanningSessionJsonSchema = {
  type: "object",
  required: ["findings"],
  additionalProperties: false,
  properties: {
    findings: {
      type: "array",
      minItems: 1,
      maxItems: 12,
      items: {
        type: "object",
        required: ["summary"],
        additionalProperties: false,
        properties: {
          summary: { type: "string", minLength: 1, description: "One concrete, source-grounded finding." },
          source_urls: {
            type: "array",
            items: { type: "string" },
            description: "Full URLs backing this finding. Empty means the finding is unverified.",
          },
          lane: {
            type: "string",
            enum: [
              "aim_facts",
              "authoritative_requirements",
              "alternatives_market",
              "risks_tradeoffs",
              "user_audience",
              "local_context",
            ],
            description: "Which research lane this finding covers.",
          },
        },
      },
    },
    gaps: {
      type: "array",
      items: { type: "string" },
      description: "Research you could NOT perform (for example no web access). Report gaps honestly instead of inventing facts.",
    },
  },
};

const proposeMemoryInputSchema: PlanningSessionJsonSchema = {
  type: "object",
  required: ["content", "category", "scope"],
  additionalProperties: false,
  properties: {
    content: { type: "string", minLength: 1, description: "Durable, reusable context fact worth remembering." },
    category: { type: "string", minLength: 1, description: "Context category, for example preference, constraint, capability." },
    scope: { type: "string", enum: ["global", "current_aim"] },
  },
};

const submitPlanInputSchema: PlanningSessionJsonSchema = {
  type: "object",
  required: ["plan"],
  additionalProperties: false,
  properties: {
    plan: decompositionJsonSchema as unknown as PlanningSessionJsonSchema,
    assumptions: {
      type: "array",
      maxItems: 12,
      description: "Low-impact unknowns you DEFAULTED rather than asked about (default-and-disclose).",
      items: {
        type: "object",
        required: ["statement", "default_value"],
        additionalProperties: false,
        properties: {
          statement: { type: "string", minLength: 1 },
          default_value: { type: "string" },
        },
      },
    },
    research_summary: {
      type: "string",
      description: "Short summary of the research that shaped this plan.",
    },
    open_questions: {
      type: "array",
      items: { type: "string" },
      description: "Unresolved questions that could still change the plan.",
    },
  },
};

export const PLANNING_SESSION_TOOL_DEFINITIONS: readonly PlanningSessionToolDefinition[] = [
  {
    name: "ask_user",
    description: [
      "Ask the user ONE high-impact question and wait for the answer.",
      "Use only when the answer can change decomposition, routing, research direction, risk controls, evidence, or the definition of done.",
      "Prefer options-with-tradeoffs over open questions; a free-text escape hatch is always added for you.",
      "This call blocks until the user answers. The reply may also carry user chat notes and directives — read them.",
    ].join(" "),
    inputSchema: askUserInputSchema,
  },
  {
    name: "search_memory",
    description:
      "Search the user's durable Aimcub memories (preferences, constraints, capabilities, eval standards from prior aims). Use before asking the user something they may have already told Aimcub.",
    inputSchema: searchMemoryInputSchema,
  },
  {
    name: "report_research",
    description: [
      "Record research findings as you work, with full source URLs, so the user can see and audit the research live.",
      "Also record explicit gaps for research you could not perform. Never fabricate findings.",
    ].join(" "),
    inputSchema: reportResearchInputSchema,
  },
  {
    name: "propose_memory",
    description:
      "Propose one durable context fact discovered during this session as a PENDING memory candidate. The user reviews it later; it never becomes active memory silently.",
    inputSchema: proposeMemoryInputSchema,
  },
  {
    name: "submit_plan",
    description: [
      "Submit the final decomposition draft for validation.",
      "If the reply reports validation errors or quality critique, fix them and submit again.",
      "The session ends when a submission is accepted.",
    ].join(" "),
    inputSchema: submitPlanInputSchema,
  },
] as const;

export function getPlanningSessionToolDefinition(name: PlanningSessionToolName): PlanningSessionToolDefinition {
  const found = PLANNING_SESSION_TOOL_DEFINITIONS.find((tool) => tool.name === name);
  if (!found) throw new Error(`unknown planning-session tool: ${name}`);
  return found;
}
