import type {
  AimIntakeQuestion,
  AimIntakeQuestionOption,
  AimIntakeReport,
} from "@core/domain";

import type { LlmGateway, LlmResponse, LlmUsage } from "./index";
import { renderPlanningContext, type PlanningMemory } from "./planning-context";
import type { ResearchBrief } from "./planning-tool-context";

export interface AimIntakeToolSignal {
  toolName: string;
  summary: string;
}

export interface GenerateAimIntakeQuestionsInput {
  title: string;
  description?: string;
  intake: AimIntakeReport;
  memories?: readonly PlanningMemory[];
  research?: ResearchBrief | null;
  researchRequired?: boolean;
  toolSignals?: readonly AimIntakeToolSignal[];
  maxQuestions?: number;
}

export interface AimIntakeQuestionGenerationValidation {
  ok: boolean;
  errors: string[];
}

export interface AimIntakeQuestionGenerationResult {
  report: AimIntakeReport | null;
  validation: AimIntakeQuestionGenerationValidation;
  usage: LlmUsage | null;
}

type SelectionMode = "single" | "multiple";

interface GeneratedQuestion {
  source_question_id: string;
  question: string;
  why_high_impact: string;
  selection_mode: SelectionMode;
  options: AimIntakeQuestionOption[];
}

interface GeneratedOutput {
  questions: GeneratedQuestion[];
}

const MAX_PROMPT_CONTEXT_CHARS = 8_000;
const MAX_QUESTION_COUNT = 6;

const AIM_INTAKE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    questions: {
      type: "array",
      minItems: 1,
      maxItems: MAX_QUESTION_COUNT,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          source_question_id: {
            type: "string",
            description: "The id of the internal intake gap this user-facing question resolves.",
          },
          question: {
            type: "string",
            description: "Specific user-facing question grounded in the aim and available context. Never starts with 'Ask'.",
          },
          why_high_impact: {
            type: "string",
            description: "Why this answer changes decomposition, routing, evidence, or research depth.",
          },
          selection_mode: {
            type: "string",
            enum: ["single", "multiple"],
            description: "Use multiple when several options can be true at once.",
          },
          options: {
            type: "array",
            minItems: 2,
            maxItems: 4,
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                label: { type: "string" },
                tradeoff: { type: "string" },
              },
              required: ["label", "tradeoff"],
            },
          },
        },
        required: ["source_question_id", "question", "why_high_impact", "selection_mode", "options"],
      },
    },
  },
  required: ["questions"],
} as const;

const SYSTEM_PROMPT = [
  "You generate Aimcub pre-decomposition intake questions.",
  "",
  "The deterministic intake report is only an internal gap signal. Do not copy its prompt text.",
  "Your job is to turn the gap signals plus collected context into concrete, high-ROI questions",
  "that a real user can answer before decomposition.",
  "",
  "Rules:",
  "- Ground every question in the aim title/description and the provided memory/local/web/tool evidence.",
  "- If research or local inspection was required but not available, ask for enabling/attaching that context rather than pretending facts are known.",
  "- Never output generic template instructions such as 'Ask for...', 'Ask whether...', or 'Ask what...'.",
  "- Prefer one precise question over broad bundles. It should be obvious why the answer changes the plan.",
  "- For product/app goals, cover real-world prerequisites such as account access, store distribution, payment, policy, content/source material, audience, and launch path only when relevant.",
  "- For domain-specific goals such as tarot, health, finance, education, legal, coaching, travel, or wellness, ask about the user's actual expertise/source material and what the agent must not invent.",
  "- Options are hypotheses, not labels for the category. They must be concrete and answerable.",
  "- Use the user's language. Keep questions concise.",
].join("\n");

function compactText(value: string | undefined, maxLength: number): string {
  const cleaned = (value ?? "").replace(/\s+/g, " ").trim();
  if (cleaned.length <= maxLength) return cleaned;
  return `${cleaned.slice(0, maxLength - 1).trim()}…`;
}

function renderResearch(research: ResearchBrief | null | undefined, required: boolean | undefined): string {
  if (!research) {
    return required
      ? "Research was required for this aim, but no first-party web research evidence was collected."
      : "No first-party web research evidence was collected.";
  }
  const lines = [
    `Research required: ${required ? "yes" : "not explicitly"}`,
    `Research question: ${compactText(research.question, 280)}`,
    `Coverage: ${research.sources.length} sources, ${research.fetchedSourceCount} fetched pages, ${research.searchResultCount} search results.`,
    "Findings:",
    ...research.findings.slice(0, 6).map((finding) => `- ${compactText(finding, 420)}`),
  ];
  if (research.uncertainties.length > 0) {
    lines.push("Uncertainties:");
    lines.push(...research.uncertainties.slice(0, 4).map((item) => `- ${compactText(item, 220)}`));
  }
  return lines.join("\n");
}

function renderToolSignals(signals: readonly AimIntakeToolSignal[] | undefined): string {
  if (!signals?.length) return "(no tool observations recorded)";
  return signals
    .slice(0, 12)
    .map((signal) => `- ${signal.toolName}: ${compactText(signal.summary, 360)}`)
    .join("\n");
}

function renderInternalGaps(report: AimIntakeReport): string {
  return report.questions.map((question) => [
    `- id: ${question.id}`,
    `category: ${question.category}`,
    `priority: ${question.priority}`,
    `source: ${question.source}`,
    `reason: ${question.reason}`,
    `internal prompt signal: ${compactText(question.prompt, 360)}`,
  ].join(" | ")).join("\n");
}

function buildPrompt(input: GenerateAimIntakeQuestionsInput): string {
  const body = [
    `Aim title: ${input.title}`,
    `Aim description: ${input.description?.trim() ? input.description.trim() : "(none provided)"}`,
    "",
    "Selected planning context:",
    renderPlanningContext(input.memories),
    "",
    "First-party research evidence:",
    renderResearch(input.research, input.researchRequired),
    "",
    "Tool observations already attempted:",
    renderToolSignals(input.toolSignals),
    "",
    "Internal gap signals to rewrite. These are not user-facing copy:",
    renderInternalGaps(input.intake),
    "",
    `Return at most ${Math.min(input.maxQuestions ?? MAX_QUESTION_COUNT, MAX_QUESTION_COUNT)} questions. Prefer fewer if they cover the real blockers.`,
  ].join("\n");
  return body.length <= MAX_PROMPT_CONTEXT_CHARS ? body : `${body.slice(0, MAX_PROMPT_CONTEXT_CHARS - 1)}…`;
}

function clean(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function validSelectionMode(value: unknown): value is SelectionMode {
  return value === "single" || value === "multiple";
}

function generatedQuestionFrom(value: unknown): GeneratedQuestion | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const question = clean(row.question);
  const sourceId = clean(row.source_question_id);
  const why = clean(row.why_high_impact);
  if (!sourceId || !question || /^ask\b/i.test(question)) return null;
  if (!validSelectionMode(row.selection_mode)) return null;
  const options = Array.isArray(row.options)
    ? row.options.flatMap((option): AimIntakeQuestionOption[] => {
        if (!option || typeof option !== "object" || Array.isArray(option)) return [];
        const optionRow = option as Record<string, unknown>;
        const label = clean(optionRow.label);
        const tradeoff = clean(optionRow.tradeoff);
        return label && tradeoff ? [{ label, tradeoff }] : [];
      })
    : [];
  if (options.length < 2) return null;
  return {
    source_question_id: sourceId,
    question,
    why_high_impact: why || "This answer changes the decomposition before work starts.",
    selection_mode: row.selection_mode,
    options: options.slice(0, 4),
  };
}

function parseGeneratedOutput(value: unknown): GeneratedOutput {
  const rows = value && typeof value === "object" && !Array.isArray(value)
    ? (value as { questions?: unknown }).questions
    : null;
  const questions = Array.isArray(rows) ? rows.flatMap((row): GeneratedQuestion[] => {
    const question = generatedQuestionFrom(row);
    return question ? [question] : [];
  }) : [];
  return { questions };
}

function applyGeneratedQuestions(
  report: AimIntakeReport,
  generated: GeneratedOutput,
): AimIntakeReport | null {
  const byId = new Map(report.questions.map((question) => [question.id, question]));
  const next: AimIntakeQuestion[] = [];
  const seen = new Set<string>();
  for (const row of generated.questions) {
    if (seen.has(row.source_question_id)) continue;
    const source = byId.get(row.source_question_id);
    if (!source) continue;
    seen.add(row.source_question_id);
    next.push({
      ...source,
      prompt: row.question,
      whyHighImpact: row.why_high_impact,
      selectionMode: row.selection_mode,
      options: row.options,
    });
  }
  if (next.length === 0 && report.questions.length > 0) return null;
  return {
    ...report,
    questions: next,
  };
}

export async function generateAimIntakeQuestions(
  gateway: LlmGateway,
  input: GenerateAimIntakeQuestionsInput,
): Promise<AimIntakeQuestionGenerationResult> {
  if (input.intake.questions.length === 0) {
    return { report: input.intake, validation: { ok: true, errors: [] }, usage: null };
  }

  let raw: LlmResponse<unknown>;
  try {
    raw = await gateway.completeStructured<unknown>({
      task: "classify",
      system: SYSTEM_PROMPT,
      prompt: buildPrompt(input),
      schema: AIM_INTAKE_SCHEMA,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      report: null,
      validation: { ok: false, errors: [`intake question model failed: ${message}`] },
      usage: null,
    };
  }

  const generated = parseGeneratedOutput(raw.output);
  const report = applyGeneratedQuestions(input.intake, generated);
  if (!report) {
    return {
      report: null,
      validation: { ok: false, errors: ["intake question model did not return any valid grounded questions"] },
      usage: raw.usage,
    };
  }

  return {
    report,
    validation: { ok: true, errors: [] },
    usage: raw.usage,
  };
}
