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
import { DecompositionOutput, type GoalDomain } from "@aimcub/types";
import {
  buildLocalHandoffManifest,
  buildPlanHandoffReport,
  critiquePlan,
  reviewPlan,
  validatePlan,
  type ContextLineageLearningReport,
  type ContextSedimentationAimContext,
  type ContextSedimentationMemoryCandidate,
  type ContextSedimentationReport,
  type DecompositionLearningReport,
  type DecompositionStrategyReport,
  type LocalHandoffManifest,
  type PlanHandoffReport,
  type PlanQualityReport,
  type PlanQualityContext,
  type PlanQualityResearchEvidence,
  type PlanReviewReport,
  type PlanValidation,
} from "@aimcub/core";

import type { LlmGateway, LlmResponse, LlmUsage } from "./index";
import { decompositionJsonSchema } from "./decomposition-schema";
import type { AimOutputLanguage } from "./language";
import { PLANNING_CONTEXT_RULES, renderPlanningContext } from "./planning-context";
import type { PlanningMemory } from "./planning-context";
import type { ResearchBrief } from "./planning-tool-context";

/** Input to {@link decompose}: the user's raw goal plus its domain. */
export interface DecomposeInput {
  title: string;
  description?: string;
  /** Defaults to `software` (the only MVP domain). */
  domain?: GoalDomain | null;
  /** Relevant user/org context from prior aims. Used to avoid re-asking and sharpen plans. */
  memories?: readonly PlanningMemory[];
  /** Historical question → memory → plan-impact lineage. Used to write better contracts and gaps on the first pass. */
  lineageLearning?: ContextLineageLearningReport | null;
  /** Historical decomposition outcomes. Used to reuse proven contract patterns and avoid prior split/verification mistakes. */
  decompositionLearning?: DecompositionLearningReport | null;
  /** Current decomposition strategy derived from the aim and historical decomposition learning. */
  decompositionStrategy?: DecompositionStrategyReport | null;
  /** First-party web research evidence collected for this aim before decomposition. */
  research?: ResearchBrief | null;
  /** True when the original aim requires current/external facts even if the model output hides those terms. */
  researchRequired?: boolean;
  /** User-facing output language inferred from the aim text. Schema enum values stay unchanged. */
  outputLanguage?: AimOutputLanguage;
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
  plan_handoff?: PlanHandoffReport;
  local_handoff_manifest?: LocalHandoffManifest;
}

export interface PlanQualityMetadataOptions {
  /** Context that shaped decomposition and should travel with future local-agent handoff jobs. */
  selectedContext?: readonly PlanQualityContext[];
  /** Aim-scoped context collected during the current intake loop. */
  aimContext?: readonly ContextSedimentationAimContext[];
  /** Pending durable context collected during the current intake loop. */
  durableMemoryCandidates?: readonly ContextSedimentationMemoryCandidate[];
  /** Current intake-loop readiness so future local-agent handoff can respect unresolved context. */
  contextSedimentation?: Pick<ContextSedimentationReport, "readyForDecomposition" | "shouldIterate" | "pendingSteps" | "nextActions"> | null;
}

/** Persistable metadata for the selected decomposition and its quality retry loop. */
export function planQualityMetadata(
  result: Pick<DecomposeWithQualityResult, "quality" | "retried" | "attempts" | "firstQuality"> & {
    output?: DecompositionOutput | null;
  },
  review?: PlanReviewReport | null,
  options?: PlanQualityMetadataOptions,
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
  if (result.output) {
    const handoff = buildPlanHandoffReport({ plan: result.output });
    metadata.plan_handoff = handoff;
    metadata.local_handoff_manifest = buildLocalHandoffManifest({
      plan: result.output,
      handoff,
      aimContext: options?.aimContext,
      durableMemoryCandidates: options?.durableMemoryCandidates,
      contextSedimentation: options?.contextSedimentation,
      selectedContext: options?.selectedContext,
    });
  }
  return metadata;
}

/**
 * The plan-shape rules, shared verbatim between the structured-output funnel
 * (this module's SYSTEM_PROMPT) and the embedded planning-session prompt
 * (`planning-session-prompt.ts`), so both paths target one validation contract.
 */
export const DECOMPOSITION_PLAN_RULES = [
  "- Produce between 1 and 15 milestones. Fewer, meaningful milestones beat many trivial ones.",
  "- Prefer 3 to 7 milestones unless the goal explicitly requires more. Do not use 15 milestones by default.",
  "- Keep JSON compact: node titles under 60 characters; descriptions, contract fields, and eval signals under 180 characters each.",
  "- Write goal_summary as a concise navigation label, not a copy of the user's framing: 4 to 10 English words or roughly 8 to 20 Chinese characters, preserving the intended outcome.",
  "- Return a FLAT graph: a `nodes` array plus an `edges` array. Never nest nodes inside nodes.",
  "- Each edge {from, to} means the `from` milestone must be completed before `to` can start.",
  "  The dependency graph MUST be acyclic. Every edge endpoint must reference an existing node key.",
  "- Sequencing standard — decide parallel vs sequential deliberately:",
  "    * Add an edge ONLY for a genuine constraint: `to` needs an output, artifact, decision,",
  "      account, or access that `from` produces. If you cannot name what `to` consumes from",
  "      `from`, there is no edge.",
  "    * Do NOT add edges to express a preferred order, a narrative reading order, or the order",
  "      you happened to list the nodes in. Milestones with no path between them are understood",
  "      to run AT THE SAME TIME, and inventing sequence needlessly serializes the whole plan.",
  "    * Independent research, per-item investigation, per-platform or per-channel work, and",
  "      drafting separate deliverables are usually parallel; a synthesis, comparison, review,",
  "      or launch milestone usually depends on ALL of the branches it consumes — give it one",
  "      edge from each, not just from the last one.",
  "    * A plan where every milestone sits in one straight chain should be rare. Before emitting",
  "      a pure chain, check each edge and drop the ones you cannot justify.",
  "- Give every node a unique, stable `key` (e.g. `m1`, `setup-repo`).",
  "- For each milestone, write a `decomposition_contract` that explains:",
  "    * `why` this milestone exists as its own unit.",
  "    * `definition_of_done` in concrete user-facing terms.",
  "    * `required_evidence` as the artifacts/events that should prove completion.",
  "    * `likely_owner` as human|agent|either|mixed. Humans and agents are both routing options.",
  "    * `context_gaps` as missing context questions that would materially change this milestone.",
  "    * `eval_signal` as the personalized standard this milestone satisfies.",
  "- Reality-modeling standard:",
  "    * Do not reduce goals to a developer checklist. Before splitting, model the real",
  "      situation around the goal: target user and use case, distribution channel, required",
  "      accounts/access/permissions, legal or store-policy constraints, budget/time limits,",
  "      source materials, domain expertise, owner authority, and final trust/eval standard.",
  "    * For app/product goals, look beyond platform and feature lists. Consider app store",
  "      accounts and review (for example Apple Developer or Google Play access),",
  "      payment/subscription setup, privacy/data handling, content or domain source",
  "      quality, target audience, onboarding, launch channel, support burden, and whether",
  "      the user already has the real-world prerequisites.",
  "    * For domain-specific products or advice-like experiences such as tarot, health,",
  "      finance, education, coaching, travel, or legal workflows, surface the user's own",
  "      domain experience, source material, acceptable tone/ethics, and research needs as",
  "      context gaps or discovery milestones before implementation milestones.",
  "    * If missing real-world context would materially change the plan, put it in",
  "      `context_gaps` or create an explicit discovery/access milestone before execution.",
  "- Ownership routing standard:",
  "    * Default to `agent` for digital work an agent can perform with tools: code changes,",
  "      tests, repo/file inspection, documentation, data cleanup, web research, API/library",
  "      comparison, synthesis, drafting, and repeatable verification.",
  "    * Agent-owned milestones must be handoff-ready: name the input context, the tool or",
  "      work surface the agent should use, the expected artifact, and the evidence/eval",
  "      that proves the artifact satisfies the aim.",
  "    * Use `human` only for work that must happen in the physical world, requires personal",
  "      taste/judgment as the deliverable, legal/financial/account authority, secrets the",
  "      user must personally provide, or final approval that cannot be delegated.",
  "    * Human-owned milestones should be explicit decisions, approvals, access grants,",
  "      purchases, or real-world actions. Do not hide agent-executable research or drafting",
  "      inside a human-owned milestone.",
  "    * Use `mixed` when the human supplies access/approval/physical input and the agent",
  "      performs the digital execution. Use `either` only when ownership truly does not",
  "      affect the plan.",
  "    * When a mixed milestone contains two independently verifiable parts, split it into",
  "      a human-enables milestone and an agent-delivers milestone with a dependency edge.",
  "    * `likely_owner` must agree with `required_evidence` and `acceptance_rule`: agent",
  "      work needs digital evidence, human work needs explicit confirmation/approval, and",
  "      mixed work should name the handoff point.",
  "- If missing information could be gathered by an agent through local context scanning or",
  "  web research, prefer an agent-owned discovery/research milestone or a context gap that",
  "  names the needed tool. Do not ask the human to manually summarize web/local information",
  "  that an agent should collect.",
  "- When first-party research evidence is provided, use it to make the decomposition deeper:",
  "  include external constraints, current facts, source-backed risks, and unresolved",
  "  uncertainties in milestone contracts or context gaps. Do not invent current facts that",
  "  are not supported by the research brief.",
  "- For each milestone, write an `acceptance_rule` whose clauses use ONLY these evaluators:",
  "    * `commit_pattern` — matches commits by file path glob, message pattern, branch, or min file count.",
  "    * `ci_status` — matches a CI workflow conclusion (default conclusion: success).",
  "    * `manual_confirm` — explicit human confirmation for real-world prerequisites,",
  "      account/access grants, personal judgment, physical-world actions, or final approval.",
  "  Prefer `commit_pattern` for 'work was done' milestones and `ci_status` for 'it passes' milestones.",
  "  Prefer `manual_confirm` only when no first-party digital evidence can honestly prove the milestone.",
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

/** System prompt: frozen instructions. Kept stable so it stays cache-friendly. */
const SYSTEM_PROMPT = [
  "You are Aimcub's planning engine. You break a user's goal into a concrete DEPENDENCY GRAPH",
  "of milestones that humans and agents can execute and verify from real evidence. The graph is",
  "not a checklist: what must wait, and what can proceed at the same time, are both part of the",
  "answer.",
  "",
  "Rules:",
  DECOMPOSITION_PLAN_RULES,
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

function renderResearchEvidence(research: ResearchBrief | null | undefined, required: boolean | undefined): string {
  if (!research) return required ? "Research required: yes. No first-party web evidence was collected." : "(none collected)";
  const lines = [
    `Research required: ${required ? "yes" : "not explicitly"}`,
    `Research question: ${research.question}`,
    `Queries: ${research.queries.join(" | ")}`,
    `Coverage: ${research.coverage.coveredLaneCount}/${research.coverage.requiredLaneCount} required lanes · ${research.coverage.uniqueDomainCount} independent domains · ${research.sources.length} sources · ${research.fetchedSourceCount} fetched pages · ${research.searchResultCount} search results`,
    `Authority and freshness: ${research.coverage.primarySourceCount} primary · ${research.coverage.currentSourceCount} current · ${research.coverage.unknownFreshnessCount} freshness unknown`,
    `Research sufficiency: ${research.sufficiency.level} (${research.sufficiency.score}/100, sufficient=${research.sufficiency.sufficient ? "yes" : "no"})`,
    "Findings:",
    ...research.findings.slice(0, 8).map((finding) => `- ${finding}`),
  ];
  if (research.conflicts.length > 0) {
    lines.push("Potential conflicts:");
    lines.push(...research.conflicts.map((conflict) => `- ${conflict.summary} Sources: ${conflict.sourceUrls.join(" | ")}`));
  }
  if (research.uncertainties.length > 0) {
    lines.push("Uncertainties:");
    lines.push(...research.uncertainties.map((uncertainty) => `- ${uncertainty}`));
  }
  return lines.join("\n");
}

export function renderOutputLanguageInstruction(language: AimOutputLanguage | undefined): string {
  if (language === "simplified_chinese") {
    return [
      "Output language: Simplified Chinese.",
      "Write every user-facing JSON string in Simplified Chinese: goal_summary, rationale, node titles/descriptions, contract text, context gap questions, and freeform acceptance text.",
      "Do not translate schema enum values, evaluator names, file globs, commands, branch names, API names, URLs, or code identifiers.",
    ].join("\n");
  }
  return [
    "Output language: English unless the user's aim is clearly written in another language.",
    "Do not translate schema enum values, evaluator names, file globs, commands, branch names, API names, URLs, or code identifiers.",
  ].join("\n");
}

function buildUserPrompt(input: DecomposeInput): string {
  const description = input.description?.trim() ? input.description.trim() : "(no description provided)";
  return [
    `Goal title: ${input.title}`,
    // Never state a guessed domain: a wrong label skews decomposition worse than no label.
    `Goal domain: ${input.domain ?? "(not set — infer from the goal itself and record it in the output's domain field)"}`,
    `Goal description: ${description}`,
    "",
    renderOutputLanguageInstruction(input.outputLanguage),
    "",
    "Known user context from previous aims:",
    renderPlanningContext(input.memories),
    "",
    "First-party web research evidence:",
    renderResearchEvidence(input.research, input.researchRequired),
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

function researchEvidenceForQuality(input: DecomposeInput): PlanQualityResearchEvidence | null {
  if (input.research) {
    return {
      required: input.researchRequired,
      sourceCount: input.research.sources.length,
      fetchedSourceCount: input.research.fetchedSourceCount,
      searchResultCount: input.research.searchResultCount,
      sources: input.research.sources,
      uncertainties: input.research.uncertainties,
    };
  }
  return input.researchRequired ? { required: true, sourceCount: 0, fetchedSourceCount: 0, searchResultCount: 0 } : null;
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

  const researchEvidence = researchEvidenceForQuality(input);
  const firstQuality = critiquePlan({ plan: first.output, context: input.memories, research: researchEvidence });
  if (!shouldRetryForQuality(firstQuality)) {
    return { ...first, quality: firstQuality, retried: false, attempts: 1, firstQuality };
  }

  const firstReview = reviewPlan({ plan: first.output, context: input.memories, quality: firstQuality, research: researchEvidence });
  const retry = await decompose(gateway, {
    ...input,
    description: qualityFeedbackDescription(input.description, firstQuality, firstReview),
  });
  if (!retry.output) {
    return { ...first, quality: firstQuality, retried: true, attempts: 2, firstQuality };
  }

  const retryQuality = critiquePlan({ plan: retry.output, context: input.memories, research: researchEvidence });
  if (!betterOrEqualQuality(retryQuality, firstQuality)) {
    return { ...first, quality: firstQuality, retried: true, attempts: 2, firstQuality };
  }

  return { ...retry, quality: retryQuality, retried: true, attempts: 2, firstQuality };
}

function formatZodIssue(issue: { path: PropertyKey[]; message: string }): string {
  const path = issue.path.length > 0 ? issue.path.map(String).join(".") : "(root)";
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

function normalizeMatchValue(key: string, value: unknown): unknown {
  if (key === "min_files" && typeof value === "string") {
    const trimmed = value.trim();
    if (/^[1-9]\d*$/.test(trimmed)) return Number(trimmed);
  }
  return value;
}

function normalizeMatchRecord(match: Record<string, unknown>): Record<string, unknown> {
  const normalized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(match)) {
    normalized[key] = normalizeMatchValue(key, value);
  }
  return normalized;
}

/** Re-nest a flat clause into the domain's `{evaluator, match}` shape (idempotent). */
function nestClause(clause: Record<string, unknown>): Record<string, unknown> {
  if (clause.match && typeof clause.match === "object" && !Array.isArray(clause.match)) {
    return { ...clause, match: normalizeMatchRecord(clause.match as Record<string, unknown>) };
  }
  const matchKeys: readonly string[] =
    clause.evaluator === "ci_status" ? CI_MATCH_KEYS :
      clause.evaluator === "manual_confirm" ? [] :
        COMMIT_MATCH_KEYS;
  const match: Record<string, unknown> = {};
  const rest: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(clause)) {
    if (matchKeys.includes(k)) match[k] = normalizeMatchValue(k, v);
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
