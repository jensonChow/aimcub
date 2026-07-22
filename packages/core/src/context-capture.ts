import type { ContextCategory } from "@aimcub/types";
import type { ContextCaptureContract, ContextCaptureOrigin } from "./aim-intake";

export type ContextCaptureFulfillmentStatus =
  | "unanswered"
  | "answered_without_memory"
  | "captured"
  | "captured_and_impacted";

export interface ContextCaptureQuestion {
  id: string;
  question?: string;
  prompt?: string;
  capture?: ContextCaptureContract;
}

export interface ContextCaptureAnswer {
  question_id: string;
  selected_label?: string | null;
  selected_labels?: string[] | null;
  other_text?: string | null;
}

export interface ContextCaptureMemory {
  content: string;
  category?: ContextCategory | string;
}

export interface ContextCaptureImpact {
  question_id: string;
  affected_node_keys?: readonly string[];
  signals?: readonly string[];
}

export interface ContextCaptureFulfillmentRow {
  questionId: string;
  question: string;
  capture: ContextCaptureContract;
  answer: string | null;
  answered: boolean;
  memoryCaptured: boolean;
  impactedPlan: boolean;
  affectedNodeKeys: string[];
  signals: string[];
  status: ContextCaptureFulfillmentStatus;
}

export interface ContextCaptureFulfillmentReport {
  version: 1;
  total: number;
  answeredCount: number;
  memoryCapturedCount: number;
  impactedCount: number;
  rows: ContextCaptureFulfillmentRow[];
}

export type ContextCaptureLearningRecommendation = "ask_more" | "ask_selectively" | "ask_less" | "fix_capture";

export interface ContextCaptureLearningRow {
  category: ContextCategory;
  scope: ContextCaptureContract["scope"];
  purpose: ContextCaptureContract["purpose"];
  improvesDimension: ContextCaptureContract["improvesDimension"];
  askedCount: number;
  answeredCount: number;
  memoryCapturedCount: number;
  impactedCount: number;
  answerRate: number;
  captureRate: number;
  impactRate: number;
  recommendation: ContextCaptureLearningRecommendation;
}

export interface ContextCaptureOriginLearningRow {
  source: ContextCaptureOrigin["source"];
  gapSource?: ContextCaptureOrigin["gapSource"];
  nodeKey?: string;
  nodeTitle?: string;
  category: ContextCategory;
  scope: ContextCaptureContract["scope"];
  purpose: ContextCaptureContract["purpose"];
  improvesDimension: ContextCaptureContract["improvesDimension"];
  askedCount: number;
  answeredCount: number;
  memoryCapturedCount: number;
  impactedCount: number;
  answerRate: number;
  captureRate: number;
  impactRate: number;
  avgRoiScore?: number;
  roiSignals: NonNullable<ContextCaptureOrigin["roiSignals"]>;
  issueCodes: NonNullable<ContextCaptureOrigin["issueCodes"]>;
  recommendation: ContextCaptureLearningRecommendation;
}

export interface ContextCaptureLearningReport {
  version: 1;
  totalAsked: number;
  totalAnswered: number;
  totalCaptured: number;
  totalImpacted: number;
  rows: ContextCaptureLearningRow[];
  originRows?: ContextCaptureOriginLearningRow[];
  guidance: string[];
}

export interface ReviewContextCaptureFulfillmentInput {
  questions: readonly ContextCaptureQuestion[];
  answers?: readonly ContextCaptureAnswer[];
  memories?: readonly ContextCaptureMemory[];
  impacts?: readonly ContextCaptureImpact[];
}

function cleanText(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function normalizeText(value: string): string {
  return cleanText(value).toLowerCase();
}

function answerText(answer: ContextCaptureAnswer | undefined): string | null {
  if (!Array.isArray(answer?.selected_labels) || answer.selected_labels.length === 0) {
    const legacy = cleanText(answer?.other_text) || cleanText(answer?.selected_label);
    return legacy.length > 0 ? legacy : null;
  }
  const selected = answer.selected_labels.map((label) => cleanText(label)).filter(Boolean).join("; ");
  const text = [selected, cleanText(answer?.other_text)].filter(Boolean).join(selected ? "; " : "");
  return text.length > 0 ? text : null;
}

function memoryCaptured(input: {
  answer: string | null;
  capture: ContextCaptureContract;
  memories: readonly ContextCaptureMemory[];
}): boolean {
  if (!input.answer) return false;
  const answer = normalizeText(input.answer);
  if (!answer) return false;
  return input.memories.some((memory) => {
    if (memory.category && memory.category !== input.capture.category) return false;
    return normalizeText(memory.content).includes(answer);
  });
}

function impactSignals(impact: ContextCaptureImpact | undefined): { impacted: boolean; affectedNodeKeys: string[]; signals: string[] } {
  const affectedNodeKeys = [...(impact?.affected_node_keys ?? [])].filter((key) => cleanText(key).length > 0);
  const signals = [...(impact?.signals ?? [])].filter((signal) => cleanText(signal).length > 0);
  return {
    affectedNodeKeys,
    signals,
    impacted: affectedNodeKeys.length > 0 || signals.includes("quality_dimension_improved"),
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function isCategory(value: unknown): value is ContextCategory {
  return value === "preference" ||
    value === "constraint" ||
    value === "capability" ||
    value === "eval_signal" ||
    value === "project_fact" ||
    value === "procedure";
}

function isOriginSource(value: unknown): value is ContextCaptureOrigin["source"] {
  return value === "aim_text" ||
    value === "context_profile" ||
    value === "planning_context" ||
    value === "draft_review" ||
    value === "clarify" ||
    value === "review_gap" ||
    value === "decomposition_strategy";
}

function isRoiSignal(value: string): value is NonNullable<ContextCaptureOrigin["roiSignals"]>[number] {
  return value === "high_priority" ||
    value === "medium_priority" ||
    value === "low_priority" ||
    value === "decomposition_contract" ||
    value === "missing_context" ||
    value === "node_specific" ||
    value === "quality_issue_linked" ||
    value === "lineage_learning" ||
    value === "eval_signal" ||
    value === "procedure" ||
    value === "constraint" ||
    value === "capability";
}

function isIssueCode(value: string): value is NonNullable<ContextCaptureOrigin["issueCodes"]>[number] {
  return value === "missing_decomposition_contract" ||
    value === "missing_contract_evidence" ||
    value === "missing_contract_eval_signal" ||
    value === "missing_context_application" ||
    value === "missing_eval_acceptance_signal" ||
    value === "manual_only_verification" ||
    value === "orphan_verification_milestone" ||
    value === "duplicate_acceptance_rule" ||
    value === "indistinct_acceptance_rule" ||
    value === "oversized_milestone" ||
    value === "compound_milestone" ||
    value === "unsupported_auto_evaluator" ||
    value === "weak_commit_pattern" ||
    value === "empty_commit_pattern" ||
    value === "missing_dependency_shape";
}

function normalizeStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && cleanText(item).length > 0)
    : [];
}

function normalizeCaptureOrigin(value: unknown): ContextCaptureOrigin | undefined {
  const origin = asRecord(value);
  if (!origin || !isOriginSource(origin.source)) return undefined;
  const reason = cleanText(origin.reason);
  const normalized: ContextCaptureOrigin = {
    source: origin.source,
    reason: reason || "question_answer",
  };
  const prompt = cleanText(origin.prompt);
  if (prompt) normalized.prompt = prompt;
  if (origin.gapSource === "missing_context" || origin.gapSource === "decomposition_contract") {
    normalized.gapSource = origin.gapSource;
  }
  const nodeKey = cleanText(origin.nodeKey);
  if (nodeKey) normalized.nodeKey = nodeKey;
  const nodeTitle = cleanText(origin.nodeTitle);
  if (nodeTitle) normalized.nodeTitle = nodeTitle;
  if (typeof origin.roiScore === "number" && Number.isFinite(origin.roiScore)) normalized.roiScore = origin.roiScore;
  const roiSignals = normalizeStringArray(origin.roiSignals).filter(isRoiSignal);
  if (roiSignals.length > 0) normalized.roiSignals = roiSignals;
  const issueCodes = normalizeStringArray(origin.issueCodes).filter(isIssueCode);
  if (issueCodes.length > 0) normalized.issueCodes = issueCodes;
  return normalized;
}

function normalizeFulfillmentRows(value: unknown): ContextCaptureFulfillmentRow[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item): ContextCaptureFulfillmentRow[] => {
    const row = asRecord(item);
    const capture = asRecord(row?.capture);
    if (!row || !capture || !isCategory(capture.category)) return [];
    if (capture.scope !== "aim" && capture.scope !== "global") return [];
    if (
      capture.purpose !== "shape_plan" &&
      capture.purpose !== "define_eval" &&
      capture.purpose !== "route_work" &&
      capture.purpose !== "reuse_preference" &&
      capture.purpose !== "document_procedure"
    ) return [];
    if (
      capture.improvesDimension !== "verifiability" &&
      capture.improvesDimension !== "granularity" &&
      capture.improvesDimension !== "distinctness" &&
      capture.improvesDimension !== "context_fit"
    ) return [];
    const questionId = cleanText(row.questionId);
    if (!questionId) return [];
    const origin = normalizeCaptureOrigin(capture.origin);
    return [{
      questionId,
      question: cleanText(row.question) || questionId,
      capture: {
        category: capture.category,
        scope: capture.scope,
        purpose: capture.purpose,
        improvesDimension: capture.improvesDimension,
        reason: cleanText(capture.reason) || "question_answer",
        ...(origin ? { origin } : {}),
      },
      answer: cleanText(row.answer) || null,
      answered: row.answered === true,
      memoryCaptured: row.memoryCaptured === true,
      impactedPlan: row.impactedPlan === true,
      affectedNodeKeys: Array.isArray(row.affectedNodeKeys)
        ? row.affectedNodeKeys.filter((key): key is string => typeof key === "string" && cleanText(key).length > 0)
        : [],
      signals: Array.isArray(row.signals)
        ? row.signals.filter((signal): signal is string => typeof signal === "string" && cleanText(signal).length > 0)
        : [],
      status: row.status === "unanswered" ||
        row.status === "answered_without_memory" ||
        row.status === "captured" ||
        row.status === "captured_and_impacted"
        ? row.status
        : fulfillmentStatus({
            answered: row.answered === true,
            memoryCaptured: row.memoryCaptured === true,
            impactedPlan: row.impactedPlan === true,
          }),
    }];
  });
}

export function contextCaptureFulfillmentFromMetadata(
  metadata: Record<string, unknown> | undefined,
): ContextCaptureFulfillmentReport | null {
  const report = asRecord(metadata?.context_capture_fulfillment);
  if (!report || report.version !== 1) return null;
  const rows = normalizeFulfillmentRows(report.rows);
  return {
    version: 1,
    total: asNumber(report.total, rows.length),
    answeredCount: asNumber(report.answeredCount, rows.filter((row) => row.answered).length),
    memoryCapturedCount: asNumber(report.memoryCapturedCount, rows.filter((row) => row.memoryCaptured).length),
    impactedCount: asNumber(report.impactedCount, rows.filter((row) => row.impactedPlan).length),
    rows,
  };
}

function learningKey(capture: ContextCaptureContract): string {
  return [capture.scope, capture.category, capture.purpose, capture.improvesDimension].join("\u0000");
}

function originLearningKey(capture: ContextCaptureContract): string | null {
  const origin = capture.origin;
  if (!origin) return null;
  return [
    learningKey(capture),
    origin.source,
    origin.gapSource ?? "",
    origin.nodeKey ?? "",
  ].join("\u0000");
}

function rate(numerator: number, denominator: number): number {
  return denominator > 0 ? Number((numerator / denominator).toFixed(2)) : 0;
}

function learningRecommendation(input: {
  asked: number;
  answered: number;
  captured: number;
  impacted: number;
  answerRate: number;
  captureRate: number;
  impactRate: number;
}): ContextCaptureLearningRecommendation {
  if (input.answered > 0 && input.captureRate < 0.5) return "fix_capture";
  if (input.asked >= 2 && input.answerRate < 0.35) return "ask_less";
  if (input.captured >= 2 && input.impactRate < 0.25) return "ask_less";
  if (input.impacted > 0 && input.impactRate >= 0.5) return "ask_more";
  return "ask_selectively";
}

function learningGuidance(row: ContextCaptureLearningRow): string {
  const category = row.category.replace("_", "-");
  const dimension = row.improvesDimension.replace("_", "-");
  if (row.recommendation === "fix_capture") {
    return `Revise ${category} ${row.purpose.replace("_", "-")} questions: users answer them, but answers often fail to become memory.`;
  }
  if (row.recommendation === "ask_less") {
    return `Ask fewer ${category} questions for ${dimension} unless current review gaps demand them.`;
  }
  if (row.recommendation === "ask_more") {
    return `Prefer ${category} questions for ${dimension}; captured answers often impact plans.`;
  }
  return `Ask ${category} questions selectively when the current aim exposes a matching gap.`;
}

function originLearningGuidance(row: ContextCaptureOriginLearningRow): string {
  const category = row.category.replace("_", "-");
  const dimension = row.improvesDimension.replace("_", "-");
  const source = row.gapSource?.replace("_", "-") ?? row.source.replace("_", "-");
  const target = row.nodeKey
    ? `${row.nodeKey}${row.nodeTitle ? ` (${row.nodeTitle})` : ""}`
    : source;
  if (row.recommendation === "fix_capture") {
    return `For ${target}, revise ${category} questions from ${source}: users answer them, but answers often fail to become memory.`;
  }
  if (row.recommendation === "ask_less") {
    return `For ${target}, ask fewer ${category} questions for ${dimension} unless a new high-ROI gap appears.`;
  }
  if (row.recommendation === "ask_more") {
    return `For ${target}, prefer ${category} questions from ${source}; captured answers often improve the plan.`;
  }
  return `For ${target}, ask ${category} questions selectively when the current gap matches this origin.`;
}

export function summarizeContextCaptureLearning(
  reports: readonly (ContextCaptureFulfillmentReport | null | undefined)[],
): ContextCaptureLearningReport {
  const stats = new Map<string, {
    capture: ContextCaptureContract;
    asked: number;
    answered: number;
    captured: number;
    impacted: number;
  }>();
  const originStats = new Map<string, {
    capture: ContextCaptureContract;
    origin: ContextCaptureOrigin;
    asked: number;
    answered: number;
    captured: number;
    impacted: number;
    roiTotal: number;
    roiCount: number;
    roiSignals: Set<NonNullable<ContextCaptureOrigin["roiSignals"]>[number]>;
    issueCodes: Set<NonNullable<ContextCaptureOrigin["issueCodes"]>[number]>;
  }>();

  for (const report of reports) {
    if (!report) continue;
    for (const row of report.rows) {
      const key = learningKey(row.capture);
      const current = stats.get(key) ?? { capture: row.capture, asked: 0, answered: 0, captured: 0, impacted: 0 };
      current.asked += 1;
      if (row.answered) current.answered += 1;
      if (row.memoryCaptured) current.captured += 1;
      if (row.impactedPlan) current.impacted += 1;
      stats.set(key, current);

      const originKey = originLearningKey(row.capture);
      if (!originKey || !row.capture.origin) continue;
      const originCurrent = originStats.get(originKey) ?? {
        capture: row.capture,
        origin: row.capture.origin,
        asked: 0,
        answered: 0,
        captured: 0,
        impacted: 0,
        roiTotal: 0,
        roiCount: 0,
        roiSignals: new Set<NonNullable<ContextCaptureOrigin["roiSignals"]>[number]>(),
        issueCodes: new Set<NonNullable<ContextCaptureOrigin["issueCodes"]>[number]>(),
      };
      originCurrent.asked += 1;
      if (row.answered) originCurrent.answered += 1;
      if (row.memoryCaptured) originCurrent.captured += 1;
      if (row.impactedPlan) originCurrent.impacted += 1;
      if (typeof row.capture.origin.roiScore === "number" && Number.isFinite(row.capture.origin.roiScore)) {
        originCurrent.roiTotal += row.capture.origin.roiScore;
        originCurrent.roiCount += 1;
      }
      for (const signal of row.capture.origin.roiSignals ?? []) originCurrent.roiSignals.add(signal);
      for (const code of row.capture.origin.issueCodes ?? []) originCurrent.issueCodes.add(code);
      originStats.set(originKey, originCurrent);
    }
  }

  const rows = [...stats.values()].map((stat) => {
    const answerRate = rate(stat.answered, stat.asked);
    const captureRate = rate(stat.captured, stat.answered);
    const impactRate = rate(stat.impacted, stat.captured);
    return {
      category: stat.capture.category,
      scope: stat.capture.scope,
      purpose: stat.capture.purpose,
      improvesDimension: stat.capture.improvesDimension,
      askedCount: stat.asked,
      answeredCount: stat.answered,
      memoryCapturedCount: stat.captured,
      impactedCount: stat.impacted,
      answerRate,
      captureRate,
      impactRate,
      recommendation: learningRecommendation({
        asked: stat.asked,
        answered: stat.answered,
        captured: stat.captured,
        impacted: stat.impacted,
        answerRate,
        captureRate,
        impactRate,
      }),
    } satisfies ContextCaptureLearningRow;
  }).sort((a, b) =>
    b.impactedCount - a.impactedCount ||
    b.memoryCapturedCount - a.memoryCapturedCount ||
    b.answeredCount - a.answeredCount ||
    a.category.localeCompare(b.category),
  );

  const originRows = [...originStats.values()].map((stat) => {
    const answerRate = rate(stat.answered, stat.asked);
    const captureRate = rate(stat.captured, stat.answered);
    const impactRate = rate(stat.impacted, stat.captured);
    const avgRoiScore = stat.roiCount > 0 ? Number((stat.roiTotal / stat.roiCount).toFixed(1)) : undefined;
    return {
      source: stat.origin.source,
      ...(stat.origin.gapSource ? { gapSource: stat.origin.gapSource } : {}),
      ...(stat.origin.nodeKey ? { nodeKey: stat.origin.nodeKey } : {}),
      ...(stat.origin.nodeTitle ? { nodeTitle: stat.origin.nodeTitle } : {}),
      category: stat.capture.category,
      scope: stat.capture.scope,
      purpose: stat.capture.purpose,
      improvesDimension: stat.capture.improvesDimension,
      askedCount: stat.asked,
      answeredCount: stat.answered,
      memoryCapturedCount: stat.captured,
      impactedCount: stat.impacted,
      answerRate,
      captureRate,
      impactRate,
      ...(avgRoiScore !== undefined ? { avgRoiScore } : {}),
      roiSignals: [...stat.roiSignals],
      issueCodes: [...stat.issueCodes],
      recommendation: learningRecommendation({
        asked: stat.asked,
        answered: stat.answered,
        captured: stat.captured,
        impacted: stat.impacted,
        answerRate,
        captureRate,
        impactRate,
      }),
    } satisfies ContextCaptureOriginLearningRow;
  }).sort((a, b) =>
    b.impactedCount - a.impactedCount ||
    b.memoryCapturedCount - a.memoryCapturedCount ||
    b.answeredCount - a.answeredCount ||
    (b.avgRoiScore ?? 0) - (a.avgRoiScore ?? 0) ||
    (a.nodeKey ?? "").localeCompare(b.nodeKey ?? "") ||
    a.category.localeCompare(b.category),
  );

  const activeRows = rows.filter((row) => row.askedCount > 0);
  const activeOriginRows = originRows.filter((row) => row.askedCount > 0);
  return {
    version: 1,
    totalAsked: activeRows.reduce((sum, row) => sum + row.askedCount, 0),
    totalAnswered: activeRows.reduce((sum, row) => sum + row.answeredCount, 0),
    totalCaptured: activeRows.reduce((sum, row) => sum + row.memoryCapturedCount, 0),
    totalImpacted: activeRows.reduce((sum, row) => sum + row.impactedCount, 0),
    rows,
    originRows,
    guidance: [
      ...activeRows.slice(0, 5).map(learningGuidance),
      ...activeOriginRows.slice(0, 3).map(originLearningGuidance),
    ].slice(0, 8),
  };
}
function fulfillmentStatus(input: {
  answered: boolean;
  memoryCaptured: boolean;
  impactedPlan: boolean;
}): ContextCaptureFulfillmentStatus {
  if (!input.answered) return "unanswered";
  if (!input.memoryCaptured) return "answered_without_memory";
  return input.impactedPlan ? "captured_and_impacted" : "captured";
}

export function reviewContextCaptureFulfillment(
  input: ReviewContextCaptureFulfillmentInput,
): ContextCaptureFulfillmentReport {
  const answersByQuestion = new Map((input.answers ?? []).map((answer) => [answer.question_id, answer]));
  const impactsByQuestion = new Map((input.impacts ?? []).map((impact) => [impact.question_id, impact]));
  const rows = input.questions.flatMap((question): ContextCaptureFulfillmentRow[] => {
    if (!question.capture) return [];
    const answer = answerText(answersByQuestion.get(question.id));
    const captured = memoryCaptured({
      answer,
      capture: question.capture,
      memories: input.memories ?? [],
    });
    const impact = impactSignals(impactsByQuestion.get(question.id));
    return [{
      questionId: question.id,
      question: cleanText(question.question) || cleanText(question.prompt) || question.id,
      capture: question.capture,
      answer,
      answered: answer !== null,
      memoryCaptured: captured,
      impactedPlan: impact.impacted,
      affectedNodeKeys: impact.affectedNodeKeys,
      signals: impact.signals,
      status: fulfillmentStatus({
        answered: answer !== null,
        memoryCaptured: captured,
        impactedPlan: impact.impacted,
      }),
    }];
  });

  return {
    version: 1,
    total: rows.length,
    answeredCount: rows.filter((row) => row.answered).length,
    memoryCapturedCount: rows.filter((row) => row.memoryCaptured).length,
    impactedCount: rows.filter((row) => row.impactedPlan).length,
    rows,
  };
}
