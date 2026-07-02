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
import { critiquePlan, reviewPlan, validatePlan, type ContextLineageLearningReport, type DecompositionLearningReport, type DecompositionStrategyReport, type PlanQualityReport, type PlanReviewReport, type PlanValidation } from "@core/domain";

import type { LlmGateway, LlmResponse, LlmUsage } from "./index";
import { decompositionJsonSchema } from "./decomposition-schema";
import { PLANNING_CONTEXT_RULES, renderPlanningContext } from "./planning-context";
import type { PlanningMemory } from "./planning-context";

/** Input to {@link decompose}: the user's raw goal plus its domain. */
export interface DecomposeInput {
  title: string;
  description?: string;
  /** Defaults to `software` (the only MVP domain). */
  domain?: GoalDomain;
  /** Relevant user/org context from prior aims. Used to avoid re-asking and sharpen plans. */
  memories?: readonly PlanningMemory[];
  /** Historical question → memory → plan-impact lineage. Used to write better contracts and gaps on the first pass. */
  lineageLearning?: ContextLineageLearningReport | null;
  /** Historical decomposition outcomes. Used to reuse proven contract patterns and avoid prior split/verification mistakes. */
  decompositionLearning?: DecompositionLearningReport | null;
  /** Current decomposition strategy derived from the aim and historical decomposition learning. */
  decompositionStrategy?: DecompositionStrategyReport | null;
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

export interface DecomposeWithQualityResult extends DecomposeResult {
  /** Quality report for the selected output, or null when no valid plan was produced. */
  quality: PlanQualityReport | null;
  /** Whether a second pass was attempted because the first valid plan had actionable issues. */
  retried: boolean;
  /** Number of model attempts made. */
  attempts: number;
  /** The first pass quality report, useful for showing what the retry tried to fix. */
  firstQuality: PlanQualityReport | null;
}

export interface PlanQualityRetryMetadata extends Record<string, unknown> {
  retried: boolean;
  attempts: number;
  first_quality: PlanQualityReport | null;
}

export interface PlanQualityMetadata extends Record<string, unknown> {
  plan_quality: PlanQualityReport | null;
  plan_quality_retry: PlanQualityRetryMetadata;
  plan_review?: PlanReviewReport;
}

/** Persistable metadata for the selected decomposition and its quality retry loop. */
export function planQualityMetadata(
  result: Pick<DecomposeWithQualityResult, "quality" | "retried" | "attempts" | "firstQuality">,
  review?: PlanReviewReport | null,
): PlanQualityMetadata {
  const metadata: PlanQualityMetadata = {
    plan_quality: result.quality,
    plan_quality_retry: {
      retried: result.retried,
      attempts: result.attempts,
      first_quality: result.firstQuality,
    },
  };
  if (review) metadata.plan_review = review;
  return metadata;
}

/** System prompt: frozen instructions. Kept stable so it stays cache-friendly. */
const SYSTEM_PROMPT = [
  "You are Aimcub's planning engine. You break a user's goal into a concrete, ordered set",
  "of milestones that a software developer can verify automatically from their own activity.",
  "",
  "Rules:",
  "- Produce between 1 and 15 milestones. Fewer, meaningful milestones beat many trivial ones.",
  "- Prefer 3 to 7 milestones unless the goal explicitly requires more. Do not use 15 milestones by default.",
  "- Keep JSON compact: node titles under 60 characters; descriptions, contract fields, and eval signals under 180 characters each.",
  "- Return a FLAT graph: a `nodes` array plus an `edges` array. Never nest nodes inside nodes.",
  "- Each edge {from, to} means the `from` milestone must be completed before `to` can start.",
  "  The dependency graph MUST be acyclic. Every edge endpoint must reference an existing node key.",
  "- Give every node a unique, stable `key` (e.g. `m1`, `setup-repo`).",
  "- For each milestone, write a `decomposition_contract` that explains:",
  "    * `why` this milestone exists as its own unit.",
  "    * `definition_of_done` in concrete user-facing terms.",
  "    * `required_evidence` as the artifacts/events that should prove completion.",
  "    * `likely_owner` as human|agent|either|mixed. Humans and agents are both routing options.",
  "    * `context_gaps` as missing context questions that would materially change this milestone.",
  "    * `eval_signal` as the personalized standard this milestone satisfies.",
  "- Ownership routing standard:",
  "    * Default to `agent` for digital work an agent can perform with tools: code changes,",
  "      tests, repo/file inspection, documentation, data cleanup, web research, API/library",
  "      comparison, synthesis, drafting, and repeatable verification.",
  "    * Use `human` only for work that must happen in the physical world, requires personal",
  "      taste/judgment as the deliverable, legal/financial/account authority, secrets the",
  "      user must personally provide, or final approval that cannot be delegated.",
  "    * Use `mixed` when the human supplies access/approval/physical input and the agent",
  "      performs the digital execution. Use `either` only when ownership truly does not",
  "      affect the plan.",
  "- If missing information could be gathered by an agent through local context scanning or",
  "  web research, prefer an agent-owned discovery/research milestone or a context gap that",
  "  names the needed tool. Do not ask the human to manually summarize web/local information",
  "  that an agent should collect.",
  "- For each milestone, write an `acceptance_rule` whose clauses use ONLY these evaluators:",
  "    * `commit_pattern` — matches commits by file path glob, message pattern, branch, or min file count.",
  "    * `ci_status` — matches a CI workflow conclusion (default conclusion: success).",
  "  Prefer `commit_pattern` for 'work was done' milestones and `ci_status` for 'it passes' milestones.",
  "- `acceptance_rule.completion_mode` is ONLY `auto`, `manual`, or `auto_then_confirm`.",
  "  Never put `mixed` there; `mixed` is valid only for `decomposition_contract.likely_owner`.",
  "- Only set a `ci_status` clause's `workflow` when the goal explicitly names a CI workflow;",
  "  otherwise leave it null and match on the conclusion alone. Workflow names are matched by",
  "  name, so a guessed name that doesn't exist means the milestone can never light up.",
  "- Make every `message_pattern` specific enough not to fire on unrelated commits: anchor it to",
  "  the milestone's own vocabulary (e.g. prefer `release|v\\d+\\.\\d+` over `v\\d` — a loose",
  "  pattern marks milestones complete on commits that merely mention a version).",
  "- Use the provided known user context when it is relevant. Do NOT ask for or ignore facts",
  "  already present in context; turn stable preferences/constraints into better milestones",
  "  and acceptance rules.",
  PLANNING_CONTEXT_RULES,
  "- `est_effort` is one of xs|s|m|l|xl. `xp_reward` is a positive integer effort/contribution weight; scale it with effort.",
  "- Keep titles short and imperative. Keep descriptions to one or two sentences.",
  "- The output schema marks every field required: set any field that does not apply to null",
  "  (e.g. a commit_pattern clause sets workflow/conclusion to null, and vice versa).",
].join("\n");

/** Build the per-goal user prompt. */
function renderLineageLearning(learning: ContextLineageLearningReport | null | undefined): string {
  if (!learning || learning.totalQuestions === 0) return "(none yet)";
  const lines = [
    `Past context lineage: ${learning.totalQuestions} questions · ${learning.totalCaptured} captured · ${learning.totalImpacted} impacted · ${learning.totalPending} pending`,
  ];
  for (const row of learning.rows.filter((item) => item.askedCount > 0).slice(0, 5)) {
    const source = row.gapSource ?? row.source;
    const example = row.exampleNodeTitle ? ` · example node: ${row.exampleNodeTitle}` : "";
    const accepted = row.acceptedContextCount ? `, accepted ${row.acceptedContextCount}` : "";
    const rejected = row.rejectedContextCount || row.deprioritizedContextCount
      ? `, rejected/deprioritized ${(row.rejectedContextCount ?? 0) + (row.deprioritizedContextCount ?? 0)}`
      : "";
    lines.push(
      `- ${source}/${row.category} · ${row.capturePurpose} · improves ${row.improvesDimension}: ${row.recommendation}, answered ${row.answeredCount}/${row.askedCount}, captured ${row.memoryCapturedCount}, impacted ${row.impactedCount}, pending ${row.pendingContextCount}${accepted}${rejected}${example}`,
    );
  }
  for (const line of learning.guidance.slice(0, 4)) lines.push(`- ${line}`);
  return lines.join("\n");
}

function renderDecompositionLearning(learning: DecompositionLearningReport | null | undefined): string {
  if (!learning || learning.rows.length === 0) return "(none yet)";
  const lines = [
    `Past decomposition learning: ${learning.totalAims} aims · ${learning.completedMilestones}/${learning.totalMilestones} milestones completed · ${learning.qualityIssueCount} quality issues · ${learning.contextOutcomeCount} context outcomes · ${learning.evidenceAttributionCount} evidence attributions`,
  ];
  for (const row of learning.rows.slice(0, 6)) {
    const node = row.nodeTitle ? ` · node: ${row.nodeTitle}` : "";
    const category = row.category ? ` · category: ${row.category}` : "";
    const dimension = row.dimension ? ` · dimension: ${row.dimension}` : "";
    const issues = row.issueCodes?.length ? ` · issues: ${row.issueCodes.join(", ")}` : "";
    const context = row.acceptedContextCount || row.rejectedContextCount || row.deprioritizedContextCount
      ? ` · context accepted ${row.acceptedContextCount ?? 0}, rejected/deprioritized ${(row.rejectedContextCount ?? 0) + (row.deprioritizedContextCount ?? 0)}`
      : "";
    const evidence = row.evidenceKinds?.length
      ? ` · evidence ${row.evidenceKinds.join(", ")} via ${row.evaluatorKinds?.join(", ") || "unknown evaluator"}`
      : "";
    const trust = typeof row.minimumTrustScore === "number" ? ` · min trust ${row.minimumTrustScore}` : "";
    lines.push(
      `- ${row.recommendation} from ${row.source}${node}${category}${dimension}${issues}${context}${evidence}${trust}: ${row.reason} — ${row.example}`,
    );
  }
  for (const line of learning.guidance.slice(0, 4)) lines.push(`- ${line}`);
  return lines.join("\n");
}

function renderDecompositionStrategy(strategy: DecompositionStrategyReport | null | undefined): string {
  if (!strategy || strategy.actions.length === 0) return "(none yet)";
  const lines = [
    `Strategy for "${strategy.title}": ${strategy.actionCount} actions`,
  ];
  for (const action of strategy.actions.slice(0, 6)) {
    lines.push(
      `- [${action.priority}] ${action.focus} · ${action.sourceRows} source rows: ${action.recommendation} Reason: ${action.reason}`,
    );
  }
  for (const line of strategy.guidance.slice(0, 5)) lines.push(`- ${line}`);
  return lines.join("\n");
}

function buildUserPrompt(input: DecomposeInput): string {
  const domain = input.domain ?? "software";
  const description = input.description?.trim() ? input.description.trim() : "(no description provided)";
  return [
    `Goal title: ${input.title}`,
    `Goal domain: ${domain}`,
    `Goal description: ${description}`,
    "",
    "Known user context from previous aims:",
    renderPlanningContext(input.memories),
    "",
    "Historical context lineage learning:",
    renderLineageLearning(input.lineageLearning),
    "",
    "Historical decomposition learning:",
    renderDecompositionLearning(input.decompositionLearning),
    "",
    "Current decomposition strategy:",
    renderDecompositionStrategy(input.decompositionStrategy),
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
  const parsed = DecompositionOutput.safeParse(normalizeRawPlan(raw.output));
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

function shouldRetryForQuality(report: PlanQualityReport): boolean {
  return report.issues.some((issue) => issue.severity === "error" || issue.severity === "warning");
}

function qualityRank(grade: PlanQualityReport["grade"]): number {
  switch (grade) {
    case "pass":
      return 3;
    case "warn":
      return 2;
    case "fail":
      return 1;
  }
}

function betterOrEqualQuality(next: PlanQualityReport, prev: PlanQualityReport): boolean {
  const gradeDelta = qualityRank(next.grade) - qualityRank(prev.grade);
  if (gradeDelta !== 0) return gradeDelta > 0;
  return next.score >= prev.score;
}

function qualityDimensionFeedback(report: PlanQualityReport): string[] {
  const dimensions = (report.dimensions ?? []).filter((dimension) =>
    dimension.grade !== "pass" || dimension.issueCount > 0,
  );
  if (dimensions.length === 0) return [];
  return [
    "",
    "Scorecard dimensions to improve:",
    "Fix order: verifiability first, then granularity, distinctness, and context_fit.",
    ...dimensions.map((dimension) => {
      const issueCodes = dimension.issueCodes.length > 0 ? dimension.issueCodes.join(", ") : "none";
      return `- ${dimension.dimension}: ${dimension.grade} (${dimension.score}/100, ${dimension.issueCount} issue${dimension.issueCount === 1 ? "" : "s"}: ${issueCodes})`;
    }),
  ];
}

function qualityFeedbackDescription(
  description: string | undefined,
  report: PlanQualityReport,
  review?: Pick<PlanReviewReport, "actions">,
): string {
  const original = description?.trim() ? description.trim() : "(no description provided)";
  const issues = report.issues
    .filter((issue) => issue.severity !== "info")
    .slice(0, 6)
    .map((issue, index) => {
      const target = issue.nodeKey ? ` on node ${issue.nodeKey}` : issue.contextCategory ? ` for ${issue.contextCategory} context` : "";
      return `${index + 1}. [${issue.severity}]${target} ${issue.message}`;
    });
  const actionPrompts = (review?.actions ?? [])
    .map((action) => action.refinePrompt)
    .filter((prompt): prompt is string => Boolean(prompt?.trim()))
    .slice(0, 3);
  return [
    original,
    "",
    "Aimcub quality critique from the previous decomposition attempt:",
    `Overall: ${report.grade} (${report.score}/100).`,
    ...qualityDimensionFeedback(report),
    ...issues,
    ...(actionPrompts.length > 0
      ? [
          "",
          "Actionable refinement instructions:",
          ...actionPrompts,
        ]
      : []),
    "",
    "Revise the decomposition to fix these issues. Preserve the user's aim, apply known context, and make acceptance rules evidence-backed and specific.",
  ].join("\n");
}

/**
 * Decompose, critique, and (once) retry when the first valid plan has actionable
 * quality issues. The retry is accepted only if its quality is better or equal;
 * otherwise the first valid plan is kept.
 */
export async function decomposeWithQuality(
  gateway: LlmGateway,
  input: DecomposeInput,
): Promise<DecomposeWithQualityResult> {
  const first = await decompose(gateway, input);
  if (!first.output) {
    return { ...first, quality: null, retried: false, attempts: 1, firstQuality: null };
  }

  const firstQuality = critiquePlan({ plan: first.output, context: input.memories });
  if (!shouldRetryForQuality(firstQuality)) {
    return { ...first, quality: firstQuality, retried: false, attempts: 1, firstQuality };
  }

  const firstReview = reviewPlan({ plan: first.output, context: input.memories, quality: firstQuality });
  const retry = await decompose(gateway, {
    ...input,
    description: qualityFeedbackDescription(input.description, firstQuality, firstReview),
  });
  if (!retry.output) {
    return { ...first, quality: firstQuality, retried: true, attempts: 2, firstQuality };
  }

  const retryQuality = critiquePlan({ plan: retry.output, context: input.memories });
  if (!betterOrEqualQuality(retryQuality, firstQuality)) {
    return { ...first, quality: firstQuality, retried: true, attempts: 2, firstQuality };
  }

  return { ...retry, quality: retryQuality, retried: true, attempts: 2, firstQuality };
}

function formatZodIssue(issue: { path: (string | number)[]; message: string }): string {
  const path = issue.path.length > 0 ? issue.path.join(".") : "(root)";
  return `${path}: ${issue.message}`;
}

// ──────────────────────────────────────────────────────────────────────────
// Raw-plan normalization: the structured-output schema is all-required +
// nullable with FLAT clauses (see decomposition-schema.ts for why). Bring the
// model's output back into the domain shape before the zod gate.
// ──────────────────────────────────────────────────────────────────────────

const COMMIT_MATCH_KEYS = ["path_glob", "min_files", "message_pattern", "branch"] as const;
const CI_MATCH_KEYS = ["workflow", "conclusion"] as const;
const ALL_MATCH_KEYS: readonly string[] = [...COMMIT_MATCH_KEYS, ...CI_MATCH_KEYS];
const DEFAULT_COMPLETION_MODE = "auto_then_confirm";

/** Recursively drop null values (the schema expresses optionality as `T | null`). */
function stripNulls(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripNulls);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      if (v !== null) out[k] = stripNulls(v);
    }
    return out;
  }
  return value;
}

/** Re-nest a flat clause into the domain's `{evaluator, match}` shape (idempotent). */
function nestClause(clause: Record<string, unknown>): Record<string, unknown> {
  if (clause.match && typeof clause.match === "object") return clause;
  const matchKeys: readonly string[] =
    clause.evaluator === "ci_status" ? CI_MATCH_KEYS : COMMIT_MATCH_KEYS;
  const match: Record<string, unknown> = {};
  const rest: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(clause)) {
    if (matchKeys.includes(k)) match[k] = v;
    else if (!ALL_MATCH_KEYS.includes(k)) rest[k] = v; // drop the other evaluator's strays
  }
  return { ...rest, match };
}

function normalizeCompletionMode(value: unknown): unknown {
  // Some providers confuse owner routing (`likely_owner: mixed`) with completion mode.
  // Keep the plan usable while preserving the conservative user-confirmation default.
  return value === "mixed" ? DEFAULT_COMPLETION_MODE : value;
}

/** Strip nulls + re-nest clauses so the raw model output parses against `DecompositionOutput`. */
export function normalizeRawPlan(raw: unknown): unknown {
  const cleaned = stripNulls(raw);
  if (!cleaned || typeof cleaned !== "object" || Array.isArray(cleaned)) return cleaned;
  const plan = cleaned as Record<string, unknown>;
  if (Array.isArray(plan.nodes)) {
    plan.nodes = plan.nodes.map((node) => {
      if (!node || typeof node !== "object" || Array.isArray(node)) return node;
      const n = node as Record<string, unknown>;
      const rule = n.acceptance_rule;
      if (rule && typeof rule === "object" && !Array.isArray(rule)) {
        const r = rule as Record<string, unknown>;
        if ("completion_mode" in r) r.completion_mode = normalizeCompletionMode(r.completion_mode);
        if (Array.isArray(r.clauses)) {
          r.clauses = r.clauses.map((c) =>
            c && typeof c === "object" && !Array.isArray(c)
              ? nestClause(c as Record<string, unknown>)
              : c,
          );
        }
      }
      return n;
    });
  }
  return plan;
}
