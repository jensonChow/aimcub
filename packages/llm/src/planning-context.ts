import { inferContextCategory } from "@aimcub/core";
import type { ContextCategory, MemoryKind } from "@aimcub/types";

export interface PlanningMemory {
  id?: string;
  memoryId?: string;
  content: string;
  kind?: MemoryKind | string;
  category?: ContextCategory | string;
  source?: string;
  confidence?: number;
  goalId?: string | null;
  goal_id?: string | null;
}

export interface SelectPlanningMemoriesInput {
  title: string;
  description?: string;
  memories?: readonly PlanningMemory[];
  currentGoalId?: string | null;
  limit?: number;
}

export type PlanningContextScope = "global" | "current_goal" | "related_goal" | "unrelated_goal";

export interface PlanningContextSelectionRow {
  memoryId?: string;
  content: string;
  category: ContextCategory;
  confidence?: number;
  goalId: string | null;
  scope: PlanningContextScope;
  score: number;
  reason: string;
  matchedTokens: string[];
}

export interface PlanningContextSelectionReport {
  total: number;
  limit: number;
  selected: PlanningContextSelectionRow[];
  ignored: PlanningContextSelectionRow[];
}

export interface PlanningContextSelectionResult {
  memories: PlanningMemory[];
  report: PlanningContextSelectionReport;
}

const CATEGORY_ORDER: readonly ContextCategory[] = [
  "constraint",
  "preference",
  "capability",
  "eval_signal",
  "procedure",
  "project_fact",
];

const CATEGORY_SET = new Set<string>(CATEGORY_ORDER);

const RELEVANCE_STOPWORDS = new Set([
  "about",
  "after",
  "again",
  "aim",
  "aimcub",
  "build",
  "context",
  "done",
  "from",
  "goal",
  "make",
  "need",
  "plan",
  "project",
  "that",
  "this",
  "user",
  "using",
  "want",
  "wants",
  "with",
  "work",
]);

export const PLANNING_CONTEXT_RULES = [
  "Use known context by category:",
  "- constraint: treat as hard limits; do not violate them. Reflect them in milestones, dependencies, and acceptance rules.",
  "- preference: shape scope, quality bar, interaction style, and default assumptions; do not re-ask stable preferences.",
  "- capability: use for routing and ownership hints; ask only when capability gaps would change the plan.",
  "- eval_signal: use as evidence of what this user considers done; sharpen acceptance rules accordingly.",
  "- procedure: preserve proven workflows and verification steps unless the new aim clearly requires a different path.",
  "- project_fact: treat as environment/tooling facts that should ground the plan.",
].join("\n");

export function planningMemoryCategory(memory: PlanningMemory): ContextCategory {
  if (typeof memory.category === "string" && CATEGORY_SET.has(memory.category)) {
    return memory.category as ContextCategory;
  }
  return inferContextCategory(memory.content, memory.kind === "procedural" ? "procedure" : "project_fact");
}

function memoryGoalId(memory: PlanningMemory): string | null {
  return memory.goalId ?? memory.goal_id ?? null;
}

function memoryId(memory: PlanningMemory): string | undefined {
  return memory.memoryId ?? memory.id;
}

function relevanceTokens(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9_./-]+/g, " ")
    .split(/\s+/)
    .map((token) => token.trim().replace(/^[./-]+|[./-]+$/g, ""))
    .filter((token) => token.length >= 3 && !RELEVANCE_STOPWORDS.has(token));
}

function uniqueTokens(value: string): string[] {
  return [...new Set(relevanceTokens(value))];
}

function categoryBaseScore(category: ContextCategory): number {
  switch (category) {
    case "constraint":
      return 80;
    case "preference":
      return 70;
    case "eval_signal":
      return 66;
    case "capability":
      return 62;
    case "procedure":
      return 58;
    case "project_fact":
      return 44;
  }
}

interface ScoredPlanningMemory {
  memory: PlanningMemory;
  index: number;
  row: PlanningContextSelectionRow;
}

function planningMemoryScope(goalId: string | null, currentGoalId: string | null): PlanningContextScope {
  if (!goalId) return "global";
  return currentGoalId && goalId === currentGoalId ? "current_goal" : "unrelated_goal";
}

function analyzePlanningMemory(input: {
  memory: PlanningMemory;
  index: number;
  title: string;
  description?: string;
  currentGoalId?: string | null;
}): ScoredPlanningMemory {
  const content = input.memory.content.trim();
  const category = planningMemoryCategory(input.memory);
  const goalId = memoryGoalId(input.memory);
  const currentGoalId = input.currentGoalId ?? null;
  const goalTokens = new Set(uniqueTokens(`${input.title} ${input.description ?? ""}`));
  const matchedTokens = uniqueTokens(content).filter((token) => goalTokens.has(token));
  const baseScope = planningMemoryScope(goalId, currentGoalId);
  const base = categoryBaseScore(category);
  const rowBase = {
    memoryId: memoryId(input.memory),
    content,
    category,
    confidence: input.memory.confidence,
    goalId,
    matchedTokens,
  };

  if (!content) {
    return {
      memory: input.memory,
      index: input.index,
      row: { ...rowBase, scope: baseScope, score: 0, reason: "empty_content" },
    };
  }

  if (typeof input.memory.confidence === "number" && input.memory.confidence < 0.6) {
    return {
      memory: input.memory,
      index: input.index,
      row: { ...rowBase, scope: baseScope, score: 0, reason: "low_confidence" },
    };
  }

  if (goalId && currentGoalId && goalId === currentGoalId) {
    return {
      memory: input.memory,
      index: input.index,
      row: { ...rowBase, scope: "current_goal", score: base + 30, reason: "current_goal_context" },
    };
  }

  if (!goalId) {
    return {
      memory: input.memory,
      index: input.index,
      row: {
        ...rowBase,
        scope: "global",
        score: base + matchedTokens.length * 8,
        reason: matchedTokens.length > 0 ? "global_context_with_goal_overlap" : "global_context",
      },
    };
  }

  if (matchedTokens.length > 0) {
    return {
      memory: input.memory,
      index: input.index,
      row: {
        ...rowBase,
        scope: "related_goal",
        score: Math.max(42, base - 22) + matchedTokens.length * 10,
        reason: "related_goal_context",
      },
    };
  }

  return {
    memory: input.memory,
    index: input.index,
    row: { ...rowBase, scope: "unrelated_goal", score: 0, reason: "unrelated_goal_context" },
  };
}

export function selectPlanningMemoriesWithTrace(input: SelectPlanningMemoriesInput): PlanningContextSelectionResult {
  const limit = Math.max(1, Math.min(24, Math.floor(input.limit ?? 12)));
  const rows = (input.memories ?? []).map((memory, index) =>
    analyzePlanningMemory({
      memory,
      index,
      title: input.title,
      description: input.description,
      currentGoalId: input.currentGoalId,
    }),
  );

  const relevant = rows
    .filter((row) => row.row.score > 0)
    .sort((a, b) => b.row.score - a.row.score || a.index - b.index);
  const selected = relevant.slice(0, limit);
  const selectedIndexes = new Set(selected.map((row) => row.index));
  const ignored = rows
    .filter((row) => !selectedIndexes.has(row.index))
    .map((row) =>
      row.row.score > 0
        ? { ...row.row, reason: "over_selection_limit" }
        : row.row,
    );

  return {
    memories: selected.map((row) => row.memory),
    report: {
      total: rows.length,
      limit,
      selected: selected.map((row) => row.row),
      ignored,
    },
  };
}

export function selectPlanningMemories(input: SelectPlanningMemoriesInput): PlanningMemory[] {
  return selectPlanningMemoriesWithTrace(input).memories;
}

function tagString(memory: PlanningMemory): string {
  return [memory.kind, memory.source, typeof memory.confidence === "number" ? `confidence=${memory.confidence}` : null]
    .filter(Boolean)
    .join(", ");
}

export function renderPlanningContext(memories: readonly PlanningMemory[] | undefined): string {
  const rows = (memories ?? [])
    .filter((memory) => memory.content.trim().length > 0)
    .slice(0, 12);
  if (rows.length === 0) return "(none yet)";

  const byCategory = new Map<ContextCategory, PlanningMemory[]>();
  for (const memory of rows) {
    const category = planningMemoryCategory(memory);
    byCategory.set(category, [...(byCategory.get(category) ?? []), memory]);
  }

  const lines: string[] = [];
  for (const category of CATEGORY_ORDER) {
    const group = byCategory.get(category);
    if (!group || group.length === 0) continue;
    lines.push(`${category}:`);
    for (const memory of group) {
      const tags = tagString(memory);
      lines.push(`- ${tags ? `[${tags}] ` : ""}${memory.content.trim()}`);
    }
  }
  return lines.join("\n");
}
