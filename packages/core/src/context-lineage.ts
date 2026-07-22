import type { ContextCategory, DecompositionContract, Goal, Memory, Milestone, MilestoneStatus } from "@aimcub/types";
import { contextCaptureFulfillmentFromMetadata, type ContextCaptureFulfillmentReport, type ContextCaptureFulfillmentRow } from "./context-capture";
import type { ContextCaptureOrigin } from "./aim-intake";

export interface ContextLineageNodeRef {
  key: string;
  title: string;
  milestoneId?: string;
  status?: MilestoneStatus;
  contract?: Pick<DecompositionContract, "definition_of_done" | "required_evidence" | "eval_signal" | "likely_owner">;
}

export interface ContextLineagePendingContext {
  memoryId?: string;
  category: ContextCategory;
  content: string;
  source: Memory["source"];
  confidence?: number;
}

export type ContextLineageContextOutcomeStatus = "accepted" | "pending" | "rejected" | "deprioritized" | "superseded";

export interface ContextLineageContextOutcome extends ContextLineagePendingContext {
  status: ContextLineageContextOutcomeStatus;
  supersededBy?: string | null;
}

export interface ContextLineageRow {
  questionId: string;
  question: string;
  answer: string | null;
  category: ContextCategory;
  captureStatus: ContextCaptureFulfillmentRow["status"];
  captureScope?: ContextCaptureFulfillmentRow["capture"]["scope"];
  capturePurpose: ContextCaptureFulfillmentRow["capture"]["purpose"];
  improvesDimension: ContextCaptureFulfillmentRow["capture"]["improvesDimension"];
  source: ContextCaptureOrigin["source"] | "unknown";
  reason: string;
  origin?: ContextCaptureOrigin;
  originNode?: ContextLineageNodeRef;
  affectedNodes: ContextLineageNodeRef[];
  memoryContent: string | null;
  memoryCaptured: boolean;
  impactedPlan: boolean;
  pendingContext: ContextLineagePendingContext[];
  contextOutcomes?: ContextLineageContextOutcome[];
  acceptedContextCount?: number;
  rejectedContextCount?: number;
  deprioritizedContextCount?: number;
  signals: string[];
  nextAction: string;
}

export interface ContextLineageReport {
  version: 1;
  goalId: string;
  title: string;
  total: number;
  answeredCount: number;
  memoryCapturedCount: number;
  impactedCount: number;
  pendingContextCount: number;
  acceptedContextCount?: number;
  rejectedContextCount?: number;
  deprioritizedContextCount?: number;
  rows: ContextLineageRow[];
  nextActions: string[];
}

export type ContextLineageLearningRecommendation =
  | "reuse_pattern"
  | "ask_selectively"
  | "fix_capture"
  | "resolve_pending";

export interface ContextLineageLearningRow {
  source: ContextLineageRow["source"];
  gapSource?: ContextCaptureOrigin["gapSource"];
  category: ContextCategory;
  capturePurpose: ContextLineageRow["capturePurpose"];
  improvesDimension: ContextLineageRow["improvesDimension"];
  askedCount: number;
  answeredCount: number;
  memoryCapturedCount: number;
  impactedCount: number;
  pendingContextCount: number;
  acceptedContextCount?: number;
  rejectedContextCount?: number;
  deprioritizedContextCount?: number;
  answerRate: number;
  captureRate: number;
  impactRate: number;
  recommendation: ContextLineageLearningRecommendation;
  exampleQuestion: string;
  exampleAnswer?: string;
  exampleNodeTitle?: string;
  signals: string[];
}

export interface ContextLineageLearningReport {
  version: 1;
  totalQuestions: number;
  totalAnswered: number;
  totalCaptured: number;
  totalImpacted: number;
  totalPending: number;
  totalAccepted?: number;
  totalRejected?: number;
  totalDeprioritized?: number;
  rows: ContextLineageLearningRow[];
  guidance: string[];
}

export interface ReviewContextLineageInput {
  goal: Pick<Goal, "id" | "title" | "metadata">;
  milestones?: readonly Pick<Milestone, "id" | "title" | "status" | "metadata">[];
  pendingContext?: readonly Pick<Memory, "id" | "goal_id" | "content" | "category" | "source" | "confidence" | "status">[];
  contextOutcomes?: readonly Pick<Memory, "id" | "goal_id" | "content" | "category" | "source" | "confidence" | "status" | "superseded_by">[];
}

interface ClarifyImpactLike {
  questionId: string;
  memoryContent: string;
  affectedNodeKeys: string[];
  signals: string[];
}

function cleanText(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function textTokens(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9_/-]+/g, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3);
}

function contractFromMetadata(metadata: Record<string, unknown> | undefined): ContextLineageNodeRef["contract"] | undefined {
  const contract = asRecord(metadata?.decomposition_contract);
  if (!contract) return undefined;
  const definitionOfDone = cleanText(contract.definition_of_done);
  const evalSignal = cleanText(contract.eval_signal);
  const requiredEvidence = Array.isArray(contract.required_evidence)
    ? contract.required_evidence.map(cleanText).filter(Boolean)
    : [];
  if (!definitionOfDone || !evalSignal || requiredEvidence.length === 0) return undefined;
  const likelyOwner = contract.likely_owner === "human" ||
    contract.likely_owner === "agent" ||
    contract.likely_owner === "either" ||
    contract.likely_owner === "mixed"
    ? contract.likely_owner
    : "either";
  return {
    definition_of_done: definitionOfDone,
    required_evidence: requiredEvidence,
    eval_signal: evalSignal,
    likely_owner: likelyOwner,
  };
}

function planKeyFromMilestone(milestone: Pick<Milestone, "title" | "metadata">): string {
  return cleanText(milestone.metadata?.plan_key) || cleanText(milestone.title);
}

function nodeRefForMilestone(milestone: Pick<Milestone, "id" | "title" | "status" | "metadata">, key: string): ContextLineageNodeRef {
  const contract = contractFromMetadata(milestone.metadata);
  return {
    key,
    title: milestone.title,
    milestoneId: milestone.id,
    status: milestone.status,
    ...(contract ? { contract } : {}),
  };
}

function nodeRefForOrigin(origin: ContextCaptureOrigin | undefined, byKey: Map<string, ContextLineageNodeRef>): ContextLineageNodeRef | undefined {
  if (!origin?.nodeKey) return undefined;
  return byKey.get(origin.nodeKey) ?? {
    key: origin.nodeKey,
    title: origin.nodeTitle ?? origin.nodeKey,
  };
}

function impactRowsFromMetadata(metadata: Record<string, unknown> | undefined): ClarifyImpactLike[] {
  const report = asRecord(metadata?.clarify_answer_impact);
  if (!report || report.version !== 1 || !Array.isArray(report.rows)) return [];
  return report.rows.flatMap((item): ClarifyImpactLike[] => {
    const row = asRecord(item);
    const questionId = cleanText(row?.question_id);
    if (!row || !questionId) return [];
    return [{
      questionId,
      memoryContent: cleanText(row.memory_content),
      affectedNodeKeys: Array.isArray(row.affected_node_keys)
        ? row.affected_node_keys.map(cleanText).filter(Boolean)
        : [],
      signals: Array.isArray(row.signals)
        ? row.signals.map(cleanText).filter(Boolean)
        : [],
    }];
  });
}

function memoryMatchesRow(
  memory: Pick<Memory, "goal_id" | "content" | "category">,
  goalId: string,
  row: ContextCaptureFulfillmentRow,
): boolean {
  if (memory.goal_id !== goalId && memory.goal_id !== null) return false;
  if (memory.category !== row.capture.category) return false;
  const content = cleanText(memory.content).toLowerCase();
  if (!content) return false;
  const answer = cleanText(row.answer).toLowerCase();
  if (answer && (content.includes(answer) || answer.includes(content))) return true;
  const questionTokens = new Set(textTokens(row.question));
  return textTokens(memory.content).some((token) => questionTokens.has(token));
}

function contextOutcomeStatus(
  memory: Pick<Memory, "status" | "superseded_by">,
): ContextLineageContextOutcomeStatus | null {
  if (memory.status === "active") return "accepted";
  if (memory.status === "pending") return "pending";
  if (memory.status === "deprioritized") return "deprioritized";
  if (memory.status === "deleted") return memory.superseded_by ? "superseded" : "rejected";
  return null;
}

function supersededBy(value: unknown): string | null {
  const row = asRecord(value);
  return typeof row?.superseded_by === "string" && row.superseded_by ? row.superseded_by : null;
}

function contextOutcomesForRow(
  contextOutcomes: ReviewContextLineageInput["contextOutcomes"] | ReviewContextLineageInput["pendingContext"],
  goalId: string,
  row: ContextCaptureFulfillmentRow,
): ContextLineageContextOutcome[] {
  return (contextOutcomes ?? [])
    .filter((memory) => memoryMatchesRow(memory, goalId, row))
    .flatMap((memory): ContextLineageContextOutcome[] => {
      const superseded = supersededBy(memory);
      const status = contextOutcomeStatus({
        status: memory.status,
        superseded_by: superseded,
      });
      if (!status) return [];
      return [{
        memoryId: memory.id,
        category: memory.category,
        content: cleanText(memory.content),
        source: memory.source,
        confidence: memory.confidence,
        status,
        ...(superseded ? { supersededBy: superseded } : {}),
      }];
    });
}

function pendingContextForRow(
  outcomes: readonly ContextLineageContextOutcome[],
): ContextLineagePendingContext[] {
  return outcomes
    .filter((memory) => memory.status === "pending")
    .map((memory) => ({
      memoryId: memory.memoryId,
      category: memory.category,
      content: memory.content,
      source: memory.source,
      confidence: memory.confidence,
    }));
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values.map(cleanText).filter(Boolean))];
}

function rate(numerator: number, denominator: number): number {
  return denominator > 0 ? Number((numerator / denominator).toFixed(2)) : 0;
}

function nextActionForRow(input: {
  row: ContextCaptureFulfillmentRow;
  pendingContextCount: number;
  acceptedContextCount: number;
  rejectedContextCount: number;
  deprioritizedContextCount: number;
}): string {
  if (!input.row.answered) return "Answer this context question before trusting the decomposition.";
  if (input.rejectedContextCount > 0 || input.deprioritizedContextCount > 0) {
    return "Rephrase or stop asking this context pattern because the user rejected or deprioritized its candidate.";
  }
  if (input.acceptedContextCount > 0 && !input.row.impactedPlan) {
    return "Reuse the accepted context, but check whether it should change future milestone contracts.";
  }
  if (!input.row.memoryCaptured) return "Turn the answer into durable memory so future aims can reuse it.";
  if (input.pendingContextCount > 0) return "Review the pending context candidate linked to this answer.";
  if (!input.row.impactedPlan) return "Check whether the captured context should refine the affected milestone contract.";
  return "Reuse this captured context as a future decomposition and eval signal.";
}

function reportNextActions(rows: readonly ContextLineageRow[]): string[] {
  const actions: string[] = [];
  const unanswered = rows.filter((row) => row.captureStatus === "unanswered").length;
  const uncaptured = rows.filter((row) => row.answer && !row.memoryCaptured).length;
  const pending = rows.reduce((sum, row) => sum + row.pendingContext.length, 0);
  const rejected = rows.reduce((sum, row) => sum + (row.rejectedContextCount ?? 0), 0);
  const deprioritized = rows.reduce((sum, row) => sum + (row.deprioritizedContextCount ?? 0), 0);
  const capturedNoImpact = rows.filter((row) => row.memoryCaptured && !row.impactedPlan).length;
  if (unanswered > 0) actions.push(`Answer ${unanswered} unresolved context question${unanswered === 1 ? "" : "s"}.`);
  if (uncaptured > 0) actions.push(`Promote ${uncaptured} answered context item${uncaptured === 1 ? "" : "s"} into durable memory.`);
  if (pending > 0) actions.push(`Review ${pending} pending context candidate${pending === 1 ? "" : "s"} linked to this aim.`);
  if (rejected + deprioritized > 0) actions.push(`Revise ${rejected + deprioritized} rejected or deprioritized context pattern${rejected + deprioritized === 1 ? "" : "s"} before asking it again.`);
  if (capturedNoImpact > 0) actions.push(`Revisit ${capturedNoImpact} captured context signal${capturedNoImpact === 1 ? "" : "s"} that did not affect the plan.`);
  if (actions.length === 0 && rows.length > 0) actions.push("Use impacted context rows as examples for future aim decomposition.");
  return actions;
}

export function reviewContextLineage(input: ReviewContextLineageInput): ContextLineageReport {
  const fulfillment = contextCaptureFulfillmentFromMetadata(input.goal.metadata);
  const impacts = new Map(impactRowsFromMetadata(input.goal.metadata).map((row) => [row.questionId, row]));
  const nodesByKey = new Map<string, ContextLineageNodeRef>();
  for (const milestone of input.milestones ?? []) {
    const key = planKeyFromMilestone(milestone);
    if (key) nodesByKey.set(key, nodeRefForMilestone(milestone, key));
  }

  const rows = (fulfillment?.rows ?? []).map((row): ContextLineageRow => {
    const impact = impacts.get(row.questionId);
    const originNode = nodeRefForOrigin(row.capture.origin, nodesByKey);
    const affectedKeys = uniqueStrings([...(row.affectedNodeKeys ?? []), ...(impact?.affectedNodeKeys ?? [])]);
    const affectedNodes = affectedKeys.map((key) => nodesByKey.get(key) ?? { key, title: key });
    const contextOutcomes = contextOutcomesForRow(input.contextOutcomes ?? input.pendingContext, input.goal.id, row);
    const pendingContext = pendingContextForRow(contextOutcomes);
    const acceptedContextCount = contextOutcomes.filter((memory) => memory.status === "accepted" || memory.status === "superseded").length;
    const rejectedContextCount = contextOutcomes.filter((memory) => memory.status === "rejected").length;
    const deprioritizedContextCount = contextOutcomes.filter((memory) => memory.status === "deprioritized").length;
    const acceptedContext = contextOutcomes.find((memory) => memory.status === "accepted" || memory.status === "superseded");
    const memoryCaptured = row.memoryCaptured || acceptedContextCount > 0;
    const signals = uniqueStrings([
      ...row.signals,
      ...(impact?.signals ?? []),
      ...(row.capture.origin?.roiSignals ?? []),
      ...(row.capture.origin?.issueCodes ?? []),
    ]);
    return {
      questionId: row.questionId,
      question: row.question,
      answer: row.answer,
      category: row.capture.category,
      captureStatus: row.status,
      captureScope: row.capture.scope,
      capturePurpose: row.capture.purpose,
      improvesDimension: row.capture.improvesDimension,
      source: row.capture.origin?.source ?? "unknown",
      reason: row.capture.origin?.reason ?? row.capture.reason,
      ...(row.capture.origin ? { origin: row.capture.origin } : {}),
      ...(originNode ? { originNode } : {}),
      affectedNodes,
      memoryContent: impact?.memoryContent || acceptedContext?.content || (row.memoryCaptured ? row.answer : null),
      memoryCaptured,
      impactedPlan: row.impactedPlan,
      pendingContext,
      contextOutcomes,
      acceptedContextCount,
      rejectedContextCount,
      deprioritizedContextCount,
      signals,
      nextAction: nextActionForRow({
        row,
        pendingContextCount: pendingContext.length,
        acceptedContextCount,
        rejectedContextCount,
        deprioritizedContextCount,
      }),
    };
  });

  return {
    version: 1,
    goalId: input.goal.id,
    title: input.goal.title,
    total: rows.length,
    answeredCount: rows.filter((row) => row.answer).length,
    memoryCapturedCount: rows.filter((row) => row.memoryCaptured).length,
    impactedCount: rows.filter((row) => row.impactedPlan).length,
    pendingContextCount: rows.reduce((sum, row) => sum + row.pendingContext.length, 0),
    acceptedContextCount: rows.reduce((sum, row) => sum + (row.acceptedContextCount ?? 0), 0),
    rejectedContextCount: rows.reduce((sum, row) => sum + (row.rejectedContextCount ?? 0), 0),
    deprioritizedContextCount: rows.reduce((sum, row) => sum + (row.deprioritizedContextCount ?? 0), 0),
    rows,
    nextActions: reportNextActions(rows),
  };
}

export function contextCaptureFulfillmentFromLineage(
  report: ContextLineageReport | null | undefined,
): ContextCaptureFulfillmentReport | null {
  if (!report) return null;
  const rows = report.rows.map((row): ContextCaptureFulfillmentRow => {
    const answered = Boolean(row.answer);
    const memoryCaptured = row.memoryCaptured;
    const impactedPlan = row.impactedPlan;
    return {
      questionId: row.questionId,
      question: row.question,
      capture: {
        category: row.category,
        scope: row.captureScope ?? (row.capturePurpose === "document_procedure" || row.category === "project_fact" ? "aim" : "global"),
        purpose: row.capturePurpose,
        improvesDimension: row.improvesDimension,
        reason: row.reason,
        ...(row.origin ? { origin: row.origin } : {}),
      },
      answer: row.answer,
      answered,
      memoryCaptured,
      impactedPlan,
      affectedNodeKeys: row.affectedNodes.map((node) => node.key),
      signals: row.signals,
      status: !answered
        ? "unanswered"
        : !memoryCaptured
          ? "answered_without_memory"
          : impactedPlan
            ? "captured_and_impacted"
            : "captured",
    };
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

function lineageLearningKey(row: ContextLineageRow): string {
  return [
    row.source,
    row.origin?.gapSource ?? "",
    row.category,
    row.capturePurpose,
    row.improvesDimension,
  ].join("\u0000");
}

function lineageLearningRecommendation(input: {
  answered: number;
  captured: number;
  impacted: number;
  pending: number;
  accepted: number;
  rejected: number;
  deprioritized: number;
  captureRate: number;
  impactRate: number;
}): ContextLineageLearningRecommendation {
  const negative = input.rejected + input.deprioritized;
  if (negative > 0 && negative >= Math.max(1, input.accepted + input.impacted)) return "fix_capture";
  if (input.pending > 0 && input.impacted === 0) return "resolve_pending";
  if (input.answered > 0 && input.captureRate < 0.5) return "fix_capture";
  if (input.impacted > 0 && input.impactRate >= 0.5) return "reuse_pattern";
  return "ask_selectively";
}

function lineageLearningGuidance(row: ContextLineageLearningRow): string {
  const category = row.category.replace("_", "-");
  const dimension = row.improvesDimension.replace("_", "-");
  const source = row.gapSource?.replace("_", "-") ?? row.source.replace("_", "-");
  if (row.recommendation === "reuse_pattern") {
    return `Reuse ${category} ${dimension} questions from ${source}; ${row.impactedCount}/${row.memoryCapturedCount} captured answers improved plans.`;
  }
  if (row.recommendation === "fix_capture") {
    const rejected = (row.rejectedContextCount ?? 0) + (row.deprioritizedContextCount ?? 0);
    if (rejected > 0) {
      return `Tighten ${category} questions from ${source}; ${rejected} context candidate${rejected === 1 ? "" : "s"} were rejected or deprioritized.`;
    }
    return `Tighten ${category} questions from ${source}; users answer them but they often fail to become durable memory.`;
  }
  if (row.recommendation === "resolve_pending") {
    return `Resolve pending ${category} context from ${source} before relying on it in milestone contracts.`;
  }
  return `Ask ${category} ${dimension} questions selectively when the current aim exposes the same source.`;
}

export function summarizeContextLineageLearning(
  reports: readonly (ContextLineageReport | null | undefined)[],
): ContextLineageLearningReport {
  const stats = new Map<string, {
    source: ContextLineageRow["source"];
    gapSource?: ContextCaptureOrigin["gapSource"];
    category: ContextCategory;
    capturePurpose: ContextLineageRow["capturePurpose"];
    improvesDimension: ContextLineageRow["improvesDimension"];
    asked: number;
    answered: number;
    captured: number;
    impacted: number;
    pending: number;
    accepted: number;
    rejected: number;
    deprioritized: number;
    exampleQuestion: string;
    exampleAnswer?: string;
    exampleNodeTitle?: string;
    signals: Set<string>;
  }>();

  for (const report of reports) {
    if (!report) continue;
    for (const row of report.rows) {
      const key = lineageLearningKey(row);
      const current = stats.get(key) ?? {
        source: row.source,
        ...(row.origin?.gapSource ? { gapSource: row.origin.gapSource } : {}),
        category: row.category,
        capturePurpose: row.capturePurpose,
        improvesDimension: row.improvesDimension,
        asked: 0,
        answered: 0,
        captured: 0,
        impacted: 0,
        pending: 0,
        accepted: 0,
        rejected: 0,
        deprioritized: 0,
        exampleQuestion: row.question,
        ...(row.answer ? { exampleAnswer: row.answer } : {}),
        ...(row.originNode?.title ? { exampleNodeTitle: row.originNode.title } : {}),
        signals: new Set<string>(),
      };
      current.asked += 1;
      if (row.answer) current.answered += 1;
      if (row.memoryCaptured) current.captured += 1;
      if (row.impactedPlan) current.impacted += 1;
      current.pending += row.pendingContext.length;
      current.accepted += row.acceptedContextCount ?? 0;
      current.rejected += row.rejectedContextCount ?? 0;
      current.deprioritized += row.deprioritizedContextCount ?? 0;
      if (!current.exampleAnswer && row.answer) current.exampleAnswer = row.answer;
      if (!current.exampleNodeTitle && row.originNode?.title) current.exampleNodeTitle = row.originNode.title;
      for (const signal of row.signals) current.signals.add(signal);
      stats.set(key, current);
    }
  }

  const rows = [...stats.values()].map((stat) => {
    const answerRate = rate(stat.answered, stat.asked);
    const captureRate = rate(stat.captured, stat.answered);
    const impactRate = rate(stat.impacted, stat.captured);
    return {
      source: stat.source,
      ...(stat.gapSource ? { gapSource: stat.gapSource } : {}),
      category: stat.category,
      capturePurpose: stat.capturePurpose,
      improvesDimension: stat.improvesDimension,
      askedCount: stat.asked,
      answeredCount: stat.answered,
      memoryCapturedCount: stat.captured,
      impactedCount: stat.impacted,
      pendingContextCount: stat.pending,
      acceptedContextCount: stat.accepted,
      rejectedContextCount: stat.rejected,
      deprioritizedContextCount: stat.deprioritized,
      answerRate,
      captureRate,
      impactRate,
      recommendation: lineageLearningRecommendation({
        answered: stat.answered,
        captured: stat.captured,
        impacted: stat.impacted,
        pending: stat.pending,
        accepted: stat.accepted,
        rejected: stat.rejected,
        deprioritized: stat.deprioritized,
        captureRate,
        impactRate,
      }),
      exampleQuestion: stat.exampleQuestion,
      ...(stat.exampleAnswer ? { exampleAnswer: stat.exampleAnswer } : {}),
      ...(stat.exampleNodeTitle ? { exampleNodeTitle: stat.exampleNodeTitle } : {}),
      signals: [...stat.signals],
    } satisfies ContextLineageLearningRow;
  }).sort((a, b) =>
    b.impactedCount - a.impactedCount ||
    b.memoryCapturedCount - a.memoryCapturedCount ||
    b.answeredCount - a.answeredCount ||
    b.pendingContextCount - a.pendingContextCount ||
    a.category.localeCompare(b.category),
  );

  const activeRows = rows.filter((row) => row.askedCount > 0);
  return {
    version: 1,
    totalQuestions: activeRows.reduce((sum, row) => sum + row.askedCount, 0),
    totalAnswered: activeRows.reduce((sum, row) => sum + row.answeredCount, 0),
    totalCaptured: activeRows.reduce((sum, row) => sum + row.memoryCapturedCount, 0),
    totalImpacted: activeRows.reduce((sum, row) => sum + row.impactedCount, 0),
    totalPending: activeRows.reduce((sum, row) => sum + row.pendingContextCount, 0),
    totalAccepted: activeRows.reduce((sum, row) => sum + (row.acceptedContextCount ?? 0), 0),
    totalRejected: activeRows.reduce((sum, row) => sum + (row.rejectedContextCount ?? 0), 0),
    totalDeprioritized: activeRows.reduce((sum, row) => sum + (row.deprioritizedContextCount ?? 0), 0),
    rows,
    guidance: activeRows.slice(0, 6).map(lineageLearningGuidance),
  };
}
