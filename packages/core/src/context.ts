import type {
  ContextCategory,
  Evidence,
  Goal,
  Memory,
  MemoryKind,
  Milestone,
  MilestoneCompletion,
} from "@aimcub/types";
import type { PlanContextUse, PlanReviewReport } from "./plan-quality";

export interface ContextCandidate {
  content: string;
  kind: MemoryKind;
  category: ContextCategory;
  source: Memory["source"];
  confidence: number;
  reason: string;
}

export type ContextScope = "aim" | "global";

export interface ContextScopeRecommendation {
  scope: ContextScope;
  reason: string;
}

export interface ExtractMemoryCandidatesInput {
  goal: Pick<Goal, "id" | "title">;
  milestones?: readonly Pick<Milestone, "id" | "title">[];
  evidence: Evidence;
  completions?: readonly Pick<MilestoneCompletion, "decided_by" | "milestone_id">[];
}

export interface ExtractMemoryCandidatesFromReviewInput {
  goal: Pick<Goal, "id" | "title">;
  review: Pick<PlanReviewReport, "actions" | "context">;
}

export interface ContextAssumption {
  statement: string;
  default_value?: string | null;
}

export interface ExtractMemoryCandidatesFromAssumptionsInput {
  goal: Pick<Goal, "id" | "title">;
  assumptions: readonly ContextAssumption[];
}

export type ContextHealthAction = "keep" | "review" | "deprioritize" | "archive_candidate";

export interface ContextTraceRow {
  memoryId?: string;
  content: string;
  category?: ContextCategory | string;
  confidence?: number;
  goalId?: string | null;
  reason: string;
}

export interface PlanningContextTrace {
  selected?: readonly ContextTraceRow[];
  ignored?: readonly ContextTraceRow[];
}

export interface ReviewContextHealthInput {
  memories: readonly Pick<Memory, "id" | "content" | "category" | "confidence" | "goal_id" | "status">[];
  traces: readonly PlanningContextTrace[];
  minObservations?: number;
}

export interface ContextHealthRow {
  memoryId: string;
  content: string;
  category: ContextCategory;
  confidence: number;
  goalId: string | null;
  selectedCount: number;
  ignoredCount: number;
  lowConfidenceCount: number;
  unrelatedCount: number;
  overLimitCount: number;
  lastReasons: string[];
  action: ContextHealthAction;
  reason: string;
}

export type ContextProfileStrength = "strong" | "ready" | "thin" | "missing";

export interface ContextProfileCategoryRow {
  category: ContextCategory;
  activeCount: number;
  pendingCount: number;
  highConfidenceCount: number;
  globalCount: number;
  aimScopedCount: number;
  averageConfidence: number | null;
  strength: ContextProfileStrength;
  recommendation: string;
}

export interface ContextProfileReport {
  totalActive: number;
  totalPending: number;
  highConfidenceActive: number;
  coverageScore: number;
  rows: ContextProfileCategoryRow[];
  gaps: ContextProfileCategoryRow[];
}

const CONTEXT_PROFILE_CATEGORIES: readonly ContextCategory[] = [
  "eval_signal",
  "procedure",
  "capability",
  "constraint",
  "preference",
  "project_fact",
];

const PAYLOAD_KEYS: Record<string, { label: string; kind: MemoryKind; category: ContextCategory; confidence: number }> = {
  memory: { label: "Context", kind: "semantic", category: "project_fact", confidence: 0.85 },
  memories: { label: "Context", kind: "semantic", category: "project_fact", confidence: 0.85 },
  context: { label: "Context", kind: "semantic", category: "project_fact", confidence: 0.85 },
  contexts: { label: "Context", kind: "semantic", category: "project_fact", confidence: 0.85 },
  project_fact: { label: "Project fact", kind: "semantic", category: "project_fact", confidence: 0.85 },
  project_facts: { label: "Project fact", kind: "semantic", category: "project_fact", confidence: 0.85 },
  preference: { label: "Preference", kind: "semantic", category: "preference", confidence: 0.9 },
  preferences: { label: "Preference", kind: "semantic", category: "preference", confidence: 0.9 },
  constraint: { label: "Constraint", kind: "semantic", category: "constraint", confidence: 0.9 },
  constraints: { label: "Constraint", kind: "semantic", category: "constraint", confidence: 0.9 },
  capability: { label: "Capability", kind: "semantic", category: "capability", confidence: 0.8 },
  capabilities: { label: "Capability", kind: "semantic", category: "capability", confidence: 0.8 },
  procedure: { label: "Procedure", kind: "procedural", category: "procedure", confidence: 0.8 },
  procedures: { label: "Procedure", kind: "procedural", category: "procedure", confidence: 0.8 },
  eval_signal: { label: "Eval signal", kind: "semantic", category: "eval_signal", confidence: 0.75 },
  eval_signals: { label: "Eval signal", kind: "semantic", category: "eval_signal", confidence: 0.75 },
  evaluation: { label: "Eval signal", kind: "semantic", category: "eval_signal", confidence: 0.75 },
  evaluations: { label: "Eval signal", kind: "semantic", category: "eval_signal", confidence: 0.75 },
};

function cleanText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export function isPromptLikeContextCandidate(content: string): boolean {
  const normalized = cleanText(content).toLowerCase();
  return normalized.includes("pending answer needed:") ||
    /confirm whether this [a-z_]+ context should shape the aim:/.test(normalized);
}

function memoryMatchKey(input: { content: string; category?: string | null; goalId?: string | null }): string {
  return [
    cleanText(input.content).toLowerCase(),
    input.category ?? "",
    input.goalId ?? "",
  ].join("\u0000");
}

function payloadStrings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(payloadStrings);
  if (value && typeof value === "object") {
    const row = value as Record<string, unknown>;
    return payloadStrings(row.content ?? row.text ?? row.statement ?? row.value);
  }
  return [];
}

function labelStatement(label: string, text: string): string {
  const cleaned = cleanText(text);
  if (!cleaned) return "";
  const prefix = `${label}:`;
  return cleaned.toLowerCase().startsWith(prefix.toLowerCase()) ? cleaned : `${prefix} ${cleaned}`;
}

function addUnique(candidates: ContextCandidate[], candidate: ContextCandidate): void {
  const content = cleanText(candidate.content);
  if (!content) return;
  const key = content.toLowerCase();
  if (candidates.some((c) => c.content.toLowerCase() === key)) return;
  candidates.push({ ...candidate, content });
}

function unlabeledContext(content: string): string {
  return cleanText(content).replace(/^[a-z_ ]+:\s*/i, "");
}

function isHighImpactContext(row: PlanContextUse): boolean {
  return row.category === "constraint" || row.category === "procedure" || row.category === "eval_signal";
}

function isExistingContextAssumption(assumption: ContextAssumption): boolean {
  return cleanText(assumption.statement).toLowerCase().startsWith("answered from known ");
}

function labelForCategory(category: ContextCategory): string {
  switch (category) {
    case "eval_signal":
      return "Eval signal";
    case "project_fact":
      return "Project fact";
    default:
      return category.charAt(0).toUpperCase() + category.slice(1).replace(/_/g, " ");
  }
}

export function recommendContextScope(input: Pick<Memory, "category" | "goal_id">): ContextScopeRecommendation {
  if (!input.goal_id) {
    return { scope: "global", reason: "already_global" };
  }

  switch (input.category) {
    case "preference":
      return { scope: "global", reason: "stable_preference" };
    case "constraint":
      return { scope: "global", reason: "stable_constraint" };
    case "capability":
      return { scope: "global", reason: "reusable_capability" };
    case "eval_signal":
      return { scope: "global", reason: "personalized_eval" };
    case "procedure":
      return { scope: "aim", reason: "procedure_may_be_project_specific" };
    case "project_fact":
      return { scope: "aim", reason: "project_fact_is_aim_scoped" };
  }
}

export function inferContextCategory(content: string, fallback: ContextCategory = "project_fact"): ContextCategory {
  const lower = cleanText(content).toLowerCase();
  if (lower.startsWith("preference:")) return "preference";
  if (lower.startsWith("constraint:")) return "constraint";
  if (lower.startsWith("capability:")) return "capability";
  if (lower.startsWith("procedure:")) return "procedure";
  if (lower.startsWith("eval signal:")) return "eval_signal";
  if (lower.startsWith("project fact:") || lower.startsWith("context:")) return "project_fact";
  return fallback;
}

export function extractMemoryCandidatesFromEvidence(input: ExtractMemoryCandidatesInput): ContextCandidate[] {
  const candidates: ContextCandidate[] = [];
  const payload = input.evidence.payload ?? {};

  for (const [key, config] of Object.entries(PAYLOAD_KEYS)) {
    for (const text of payloadStrings(payload[key])) {
      addUnique(candidates, {
        content: labelStatement(config.label, text),
        kind: config.kind,
        category: config.category,
        source: "evidence_derived",
        confidence: config.confidence,
        reason: `payload.${key}`,
      });
    }
  }

  const completedByUser = (input.completions ?? []).some(
    (c) => c.decided_by === "user_confirm" && (!input.evidence.milestone_id || c.milestone_id === input.evidence.milestone_id),
  );
  if (input.evidence.kind === "manual_check" && (completedByUser || input.evidence.summary.trim().length > 0)) {
    const milestone = input.milestones?.find((m) => m.id === input.evidence.milestone_id);
    const subject = milestone ? `"${milestone.title}"` : `"${input.goal.title}"`;
    const summary = cleanText(input.evidence.summary);
    addUnique(candidates, {
      content: summary
        ? `Eval signal: User considered ${subject} complete after: ${summary}`
        : `Eval signal: User considered ${subject} complete.`,
      kind: "semantic",
      category: "eval_signal",
      source: "evidence_derived",
      confidence: 0.65,
      reason: "manual_check",
    });
  }

  return candidates;
}

export function extractMemoryCandidatesFromReview(input: ExtractMemoryCandidatesFromReviewInput): ContextCandidate[] {
  const shouldReviewUnapplied = input.review.actions.some((action) => action.code === "refine_with_unapplied_context");
  const candidates: ContextCandidate[] = [];

  if (shouldReviewUnapplied) {
    for (const row of input.review.context.unapplied) {
      if (!isHighImpactContext(row)) continue;
      if (typeof row.confidence === "number" && row.confidence < 0.6) continue;
      addUnique(candidates, {
        content: `Eval signal: For "${input.goal.title}", confirm whether this ${row.category} context should shape the aim: ${unlabeledContext(row.content)}`,
        kind: "semantic",
        category: "eval_signal",
        source: "agent_inferred",
        confidence: 0.6,
        reason: "plan_review.unapplied_context",
      });
    }
  }

  for (const gap of input.review.context.gaps ?? []) {
    if (gap.priority === "low") continue;
    const label = labelForCategory(gap.category);
    addUnique(candidates, {
      content: `${label}: For "${input.goal.title}", pending answer needed: ${gap.prompt}`,
      kind: gap.category === "procedure" ? "procedural" : "semantic",
      category: gap.category,
      source: "agent_inferred",
      confidence: 0.6,
      reason: "plan_review.context_gap",
    });
  }

  return candidates;
}

export function extractMemoryCandidatesFromAssumptions(input: ExtractMemoryCandidatesFromAssumptionsInput): ContextCandidate[] {
  const candidates: ContextCandidate[] = [];
  for (const assumption of input.assumptions) {
    const statement = cleanText(assumption.statement);
    if (!statement || isExistingContextAssumption(assumption)) continue;
    const defaultValue = cleanText(assumption.default_value ?? "");
    // The content is the assumption itself, nothing more: category, source, and the owning
    // aim are structured fields the review surface renders as provenance. The old composed
    // prefix ("Project fact: Planning assumption for "<aim>": …") duplicated all three into
    // the durable text and followed it into accepted memory (founder, 2026-08-09).
    addUnique(candidates, {
      content: defaultValue ? `${statement} (${defaultValue})` : statement,
      kind: "semantic",
      category: "project_fact",
      source: "agent_inferred",
      confidence: 0.65,
      reason: "clarify.assumption",
    });
  }
  return candidates;
}

/** Matches the legacy machine-composed assumption prefix (any category label, any aim title). */
const LEGACY_ASSUMPTION_PREFIX =
  /^(?:Capability|Constraint|Eval signal|Preference|Procedure|Project fact):\s*Planning assumption for "[^"]*":\s*/;

/**
 * Display form of a stored candidate: rows written before 2026-08-09 carry the composed
 * provenance prefix above. Provenance is chrome, not content — presentation strips it, and
 * because the review surface accepts what it presents, an accepted legacy row is stored
 * clean. Already-clean content passes through unchanged.
 */
export function presentContextCandidateContent(content: string): string {
  const cleaned = cleanText(content);
  return cleaned.replace(LEGACY_ASSUMPTION_PREFIX, "") || cleaned;
}

export function reviewContextHealth(input: ReviewContextHealthInput): ContextHealthRow[] {
  const minObservations = Math.max(1, Math.floor(input.minObservations ?? 2));
  const active = input.memories.filter((memory) => memory.status === "active");
  const byId = new Map(active.map((memory) => [memory.id, memory]));
  const byKey = new Map(active.map((memory) => [
    memoryMatchKey({ content: memory.content, category: memory.category, goalId: memory.goal_id }),
    memory,
  ]));
  const stats = new Map<string, {
    selectedCount: number;
    ignoredCount: number;
    lowConfidenceCount: number;
    unrelatedCount: number;
    overLimitCount: number;
    reasons: string[];
  }>();

  function statFor(id: string) {
    const existing = stats.get(id);
    if (existing) return existing;
    const created = {
      selectedCount: 0,
      ignoredCount: 0,
      lowConfidenceCount: 0,
      unrelatedCount: 0,
      overLimitCount: 0,
      reasons: [] as string[],
    };
    stats.set(id, created);
    return created;
  }

  function resolveMemory(row: ContextTraceRow) {
    if (row.memoryId) {
      const byMemoryId = byId.get(row.memoryId);
      if (byMemoryId) return byMemoryId;
    }
    return byKey.get(memoryMatchKey({ content: row.content, category: row.category, goalId: row.goalId }));
  }

  function recordReason(reasons: string[], reason: string): void {
    if (reasons[reasons.length - 1] !== reason) reasons.push(reason);
    if (reasons.length > 5) reasons.shift();
  }

  for (const trace of input.traces) {
    for (const row of trace.selected ?? []) {
      const memory = resolveMemory(row);
      if (!memory) continue;
      const stat = statFor(memory.id);
      stat.selectedCount += 1;
      recordReason(stat.reasons, row.reason);
    }
    for (const row of trace.ignored ?? []) {
      const memory = resolveMemory(row);
      if (!memory) continue;
      const stat = statFor(memory.id);
      stat.ignoredCount += 1;
      if (row.reason === "low_confidence") stat.lowConfidenceCount += 1;
      if (row.reason === "unrelated_goal_context") stat.unrelatedCount += 1;
      if (row.reason === "over_selection_limit") stat.overLimitCount += 1;
      recordReason(stat.reasons, row.reason);
    }
  }

  return active
    .map((memory) => {
      const stat = stats.get(memory.id) ?? {
        selectedCount: 0,
        ignoredCount: 0,
        lowConfidenceCount: 0,
        unrelatedCount: 0,
        overLimitCount: 0,
        reasons: [] as string[],
      };
      const observations = stat.selectedCount + stat.ignoredCount;
      let action: ContextHealthAction = "keep";
      let reason = observations === 0 ? "no_trace_yet" : "selected_or_not_enough_signal";

      if (cleanText(memory.content).length === 0) {
        action = "archive_candidate";
        reason = "empty_memory";
      } else if (memory.confidence < 0.6) {
        action = "review";
        reason = "memory_confidence_below_planning_threshold";
      } else if (observations >= minObservations && stat.selectedCount === 0 && stat.lowConfidenceCount === observations) {
        action = "review";
        reason = "always_ignored_low_confidence";
      } else if (observations >= minObservations && stat.selectedCount === 0 && stat.unrelatedCount === observations) {
        action = memory.goal_id ? "archive_candidate" : "review";
        reason = memory.goal_id ? "aim_scoped_context_repeatedly_unrelated" : "global_context_repeatedly_unrelated";
      } else if (observations >= minObservations && stat.selectedCount === 0) {
        action = "deprioritize";
        reason = "ignored_without_selection";
      }

      return {
        memoryId: memory.id,
        content: memory.content,
        category: memory.category,
        confidence: memory.confidence,
        goalId: memory.goal_id,
        selectedCount: stat.selectedCount,
        ignoredCount: stat.ignoredCount,
        lowConfidenceCount: stat.lowConfidenceCount,
        unrelatedCount: stat.unrelatedCount,
        overLimitCount: stat.overLimitCount,
        lastReasons: stat.reasons,
        action,
        reason,
      };
    })
    .sort((a, b) => {
      const priority: Record<ContextHealthAction, number> = {
        archive_candidate: 0,
        review: 1,
        deprioritize: 2,
        keep: 3,
      };
      return priority[a.action] - priority[b.action] || b.ignoredCount - a.ignoredCount || a.content.localeCompare(b.content);
    });
}

function categoryRecommendation(category: ContextCategory, strength: ContextProfileStrength, pendingCount: number): string {
  if (pendingCount > 0 && strength !== "strong") return "review_pending_candidates";
  if (strength === "strong") return "keep_collecting_from_work";
  switch (category) {
    case "eval_signal":
      return "capture_completion_criteria";
    case "procedure":
      return "capture_workflows_and_verification_steps";
    case "capability":
      return "capture_routing_capabilities";
    case "constraint":
      return "capture_scope_boundaries";
    case "preference":
      return "capture_stable_preferences";
    case "project_fact":
      return "capture_project_environment_facts";
  }
}

function contextProfileStrength(input: {
  activeCount: number;
  pendingCount: number;
  highConfidenceCount: number;
}): ContextProfileStrength {
  if (input.highConfidenceCount >= 2 || (input.highConfidenceCount >= 1 && input.activeCount >= 2)) return "strong";
  if (input.highConfidenceCount >= 1) return "ready";
  if (input.activeCount > 0 || input.pendingCount > 0) return "thin";
  return "missing";
}

function strengthScore(strength: ContextProfileStrength): number {
  switch (strength) {
    case "strong":
      return 100;
    case "ready":
      return 75;
    case "thin":
      return 35;
    case "missing":
      return 0;
  }
}

export function reviewContextProfile(input: {
  memories: readonly Pick<Memory, "content" | "category" | "confidence" | "goal_id" | "status">[];
}): ContextProfileReport {
  const rows = CONTEXT_PROFILE_CATEGORIES.map((category) => {
    const active = input.memories.filter((memory) =>
      memory.status === "active" && memory.category === category && cleanText(memory.content).length > 0,
    );
    const pending = input.memories.filter((memory) =>
      memory.status === "pending" && memory.category === category && cleanText(memory.content).length > 0,
    );
    const highConfidence = active.filter((memory) => memory.confidence >= 0.75);
    const globalCount = active.filter((memory) => !memory.goal_id).length;
    const aimScopedCount = active.length - globalCount;
    const averageConfidence = active.length > 0
      ? Number((active.reduce((sum, memory) => sum + memory.confidence, 0) / active.length).toFixed(2))
      : null;
    const strength = contextProfileStrength({
      activeCount: active.length,
      pendingCount: pending.length,
      highConfidenceCount: highConfidence.length,
    });
    return {
      category,
      activeCount: active.length,
      pendingCount: pending.length,
      highConfidenceCount: highConfidence.length,
      globalCount,
      aimScopedCount,
      averageConfidence,
      strength,
      recommendation: categoryRecommendation(category, strength, pending.length),
    };
  });
  const totalActive = input.memories.filter((memory) => memory.status === "active").length;
  const totalPending = input.memories.filter((memory) => memory.status === "pending").length;
  const highConfidenceActive = input.memories.filter((memory) => memory.status === "active" && memory.confidence >= 0.75).length;
  return {
    totalActive,
    totalPending,
    highConfidenceActive,
    coverageScore: Math.round(rows.reduce((sum, row) => sum + strengthScore(row.strength), 0) / rows.length),
    rows,
    gaps: rows.filter((row) => row.strength === "missing" || row.strength === "thin"),
  };
}
