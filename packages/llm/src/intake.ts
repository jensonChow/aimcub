import type {
  AimIntakeQuestion,
  AimIntakeQuestionOption,
  AimIntakeReport,
} from "@core/domain";
import {
  CHOICE_SELECTION_REASONS,
  decideChoiceSelection,
  type ChoiceSelectionMode,
  type ChoiceSelectionReason,
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

interface GeneratedQuestion {
  source_question_id: string;
  question: string;
  why_high_impact: string;
  selection_mode: ChoiceSelectionMode;
  selection_mode_reason: ChoiceSelectionReason;
  options: AimIntakeQuestionOption[];
}

interface GeneratedOutput {
  questions: GeneratedQuestion[];
  receivedRows: number;
}

const MAX_QUESTION_COUNT = 6;
const MAX_MEMORY_CONTEXT_CHARS = 2_400;
const MAX_RESEARCH_CONTEXT_CHARS = 2_400;
const MAX_TOOL_CONTEXT_CHARS = 1_600;
const MAX_GAP_CONTEXT_CHARS = 3_600;

function clampQuestionLimit(value: number | undefined): number {
  const finiteValue = typeof value === "number" && Number.isFinite(value)
    ? Math.floor(value)
    : MAX_QUESTION_COUNT;
  return Math.max(1, Math.min(finiteValue, MAX_QUESTION_COUNT));
}

const AIM_INTAKE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    questions: {
      type: "array",
      minItems: 0,
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
            description: "Use single only for one mutually exclusive or explicitly primary choice; otherwise use multiple.",
          },
          selection_mode_reason: {
            type: "string",
            enum: CHOICE_SELECTION_REASONS,
            description: "The answer relationship that justifies the selection mode.",
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
        required: ["source_question_id", "question", "why_high_impact", "selection_mode", "selection_mode_reason", "options"],
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
  "- Ask one decision dimension per question. One internal gap may become several atomic questions",
  "  when audience, outcome, channel, constraints, evidence, or access need separate answers.",
  "- For product/app goals, cover real-world prerequisites such as account access, store distribution, payment, policy, content/source material, audience, and launch path only when relevant.",
  "- For domain-specific goals such as tarot, health, finance, education, legal, coaching, travel, or wellness, ask about the user's actual expertise/source material and what the agent must not invent.",
  "- Options are hypotheses, not labels for the category. They must be concrete and answerable.",
  "- Decide selection mode from the relationship between the answers, not from option count,",
  "  question category, or words such as 'which' / '\u54ea\u6761'. Test every option pair: if a",
  "  reasonable user could truthfully choose both in the same scope, use `multiple`.",
  "- Use `single` only when choosing one option logically rules out every other option, or",
  "  when the question explicitly asks for exactly one primary choice. If uncertain, use",
  "  `multiple` and `selection_mode_reason=unclear_defaults_multiple`.",
  "- Phrase every single-choice question so its one-current-state, exactly-one, primary,",
  "  default, or best-fit scope is explicit enough for the runtime to verify.",
  "- Examples: Summary vs Detailed as one output format is single/mutually_exclusive;",
  "  Introduction + Conclusion sections, local files + web research, multiple constraints,",
  "  evidence sources, capabilities, audiences, or compatible routes are multiple.",
  "- Set `selection_mode_reason` to `mutually_exclusive`, `primary_choice_requested`,",
  "  `compatible_options`, or `unclear_defaults_multiple`; it must agree with the mode.",
  "- If proposed options mix compatible and exclusive answers, rewrite or split the question.",
  "- Use the user's language. Keep questions concise.",
].join("\n");

function compactText(value: string | undefined, maxLength: number): string {
  const cleaned = (value ?? "").replace(/\s+/g, " ").trim();
  if (cleaned.length <= maxLength) return cleaned;
  return `${cleaned.slice(0, maxLength - 1).trim()}…`;
}

function compactBlock(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, Math.max(0, maxLength - 28)).trim()}\n… [section truncated]`;
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
  const questionLimit = clampQuestionLimit(input.maxQuestions);
  return [
    `Aim title: ${compactText(input.title, 600)}`,
    `Aim description: ${compactText(input.description, 1_600) || "(none provided)"}`,
    "",
    "Selected planning context:",
    compactBlock(renderPlanningContext(input.memories), MAX_MEMORY_CONTEXT_CHARS),
    "",
    "First-party research evidence:",
    compactBlock(renderResearch(input.research, input.researchRequired), MAX_RESEARCH_CONTEXT_CHARS),
    "",
    "Tool observations already attempted:",
    compactBlock(renderToolSignals(input.toolSignals), MAX_TOOL_CONTEXT_CHARS),
    "",
    "Internal gap signals to rewrite. These are not user-facing copy:",
    compactBlock(renderInternalGaps(input.intake), MAX_GAP_CONTEXT_CHARS),
    "",
    `Return at most ${questionLimit} atomic questions. Prefer fewer if they cover the real blockers.`,
    "A single internal gap may produce multiple questions, but each returned question resolves exactly one listed source_question_id.",
  ].join("\n");
}

function clean(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function generatedQuestionFrom(value: unknown): GeneratedQuestion | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const question = clean(row.question);
  const sourceId = clean(row.source_question_id);
  const why = clean(row.why_high_impact);
  if (!sourceId || !question || /^ask\b/i.test(question)) return null;
  const seenOptionLabels = new Set<string>();
  const options = Array.isArray(row.options)
    ? row.options.flatMap((option): AimIntakeQuestionOption[] => {
        if (!option || typeof option !== "object" || Array.isArray(option)) return [];
        const optionRow = option as Record<string, unknown>;
        const label = clean(optionRow.label);
        const tradeoff = clean(optionRow.tradeoff);
        const key = label.toLowerCase();
        if (!label || !tradeoff || seenOptionLabels.has(key)) return [];
        seenOptionLabels.add(key);
        return [{ label, tradeoff }];
      })
    : [];
  if (options.length < 2) return null;
  const decision = decideChoiceSelection({
    question,
    options: options.map((option) => ({ label: option.label, detail: option.tradeoff })),
    requestedMode: row.selection_mode,
    requestedReason: row.selection_mode_reason,
  });
  return {
    source_question_id: sourceId,
    question,
    why_high_impact: why || "This answer changes the decomposition before work starts.",
    selection_mode: decision.mode,
    selection_mode_reason: decision.reason,
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
  return { questions, receivedRows: Array.isArray(rows) ? rows.length : -1 };
}

function reportWithNoUnresolvedQuestions(report: AimIntakeReport): AimIntakeReport {
  return {
    ...report,
    readiness: "ready",
    score: 100,
    questions: [],
    loop: {
      ...report.loop,
      shouldContinue: false,
      nextStepId: null,
      stopCondition: "No unresolved high-impact user question remains; continue with decomposition and collect evidence during execution.",
    },
    nextActions: ["Proceed with decomposition using the collected context."],
  };
}

function applyGeneratedQuestions(
  report: AimIntakeReport,
  generated: GeneratedOutput,
  maxQuestions: number,
): AimIntakeReport | null {
  const byId = new Map(report.questions.map((question) => [question.id, question]));
  const next: AimIntakeQuestion[] = [];
  const seenRows = new Set<string>();
  const sourceCounts = new Map<string, number>();
  const usedIds = new Set<string>();
  for (const row of generated.questions) {
    if (next.length >= maxQuestions) break;
    const source = byId.get(row.source_question_id);
    if (!source) continue;
    const rowKey = `${row.source_question_id}\u0000${row.question.toLowerCase()}`;
    if (seenRows.has(rowKey)) continue;
    seenRows.add(rowKey);
    const sourceCount = (sourceCounts.get(source.id) ?? 0) + 1;
    sourceCounts.set(source.id, sourceCount);
    let questionId = sourceCount === 1 ? source.id : `${source.id}_${sourceCount}`;
    while (usedIds.has(questionId) || (questionId !== source.id && byId.has(questionId))) {
      questionId = `${questionId}_next`;
    }
    usedIds.add(questionId);
    next.push({
      ...source,
      id: questionId,
      prompt: row.question,
      whyHighImpact: row.why_high_impact,
      selectionMode: row.selection_mode,
      selectionModeReason: row.selection_mode_reason,
      options: row.options,
    });
  }
  if (next.length === 0 && generated.receivedRows === 0) return reportWithNoUnresolvedQuestions(report);
  if (next.length === 0 && report.questions.length > 0) return null;
  const highQuestions = next.filter((question) => question.priority === "high").length;
  const mediumQuestions = next.filter((question) => question.priority === "medium").length;
  const countAction = highQuestions > 0
    ? `Answer ${highQuestions} high-priority intake question${highQuestions === 1 ? "" : "s"} before accepting a plan.`
    : mediumQuestions > 0
      ? `Answer ${mediumQuestions} targeted intake question${mediumQuestions === 1 ? "" : "s"} if the answer would change scope or evidence.`
      : null;
  let replacedCountAction = false;
  const nextActions = report.nextActions.flatMap((action) => {
    if (!/^Answer \d+ (?:high-priority|targeted) intake questions?\b/.test(action)) return [action];
    if (!countAction || replacedCountAction) return [];
    replacedCountAction = true;
    return [countAction];
  });
  if (countAction && !replacedCountAction) nextActions.unshift(countAction);
  return {
    ...report,
    questions: next,
    // The loop remains source-acquisition metadata; only its user-facing card count changes.
    nextActions,
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
  const maxQuestions = clampQuestionLimit(input.maxQuestions);
  const report = applyGeneratedQuestions(input.intake, generated, maxQuestions);
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
