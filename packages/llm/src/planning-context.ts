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

/**
 * Words that must never carry a relevance match.
 *
 * Two groups, one rule: a token here says nothing about what a row is *about*.
 *
 * - Closed-class English function words — determiners, pronouns, prepositions, conjunctions,
 *   auxiliaries, degree adverbs. The class is finite and enumerable, which is exactly why a list
 *   is the right instrument for it; content vocabulary is not.
 * - Aimcub's own planning vocabulary, which appears in almost every aim and every memory row.
 *
 * Without this, a memory scoped to a completely unrelated aim could be pulled into a plan because
 * both texts contain "the" and "should". That leak was found by `examples/eval-moat`, which
 * reproduced it on all three benchmark personas.
 */
const RELEVANCE_STOPWORDS = new Set([
  "about",
  "above",
  "across",
  "after",
  "again",
  "against",
  "aim",
  "aimcub",
  "all",
  "along",
  "already",
  "also",
  "although",
  "among",
  "and",
  "another",
  "any",
  "anything",
  "are",
  "around",
  "because",
  "been",
  "before",
  "behind",
  "being",
  "below",
  "beside",
  "besides",
  "between",
  "beyond",
  "both",
  "build",
  "but",
  "can",
  "cannot",
  "context",
  "could",
  "despite",
  "did",
  "does",
  "done",
  "during",
  "each",
  "either",
  "enough",
  "even",
  "ever",
  "every",
  "everything",
  "except",
  "few",
  "for",
  "from",
  "goal",
  "had",
  "has",
  "have",
  "her",
  "here",
  "hers",
  "him",
  "his",
  "how",
  "however",
  "inside",
  "instead",
  "into",
  "its",
  "itself",
  "just",
  "make",
  "many",
  "may",
  "might",
  "mine",
  "more",
  "most",
  "much",
  "must",
  "need",
  "neither",
  "never",
  "none",
  "nor",
  "not",
  "nothing",
  "now",
  "off",
  "often",
  "once",
  "one",
  "only",
  "onto",
  "other",
  "others",
  "ought",
  "our",
  "ours",
  "out",
  "outside",
  "over",
  "own",
  "per",
  "perhaps",
  "plan",
  "project",
  "quite",
  "rather",
  "really",
  "same",
  "several",
  "shall",
  "she",
  "should",
  "since",
  "some",
  "something",
  "still",
  "such",
  "than",
  "that",
  "the",
  "their",
  "theirs",
  "them",
  "themselves",
  "then",
  "there",
  "therefore",
  "these",
  "they",
  "this",
  "those",
  "though",
  "through",
  "throughout",
  "thus",
  "too",
  "toward",
  "towards",
  "under",
  "unless",
  "until",
  "upon",
  "user",
  "using",
  "usually",
  "very",
  "via",
  "want",
  "wants",
  "was",
  "were",
  "what",
  "whatever",
  "when",
  "whenever",
  "where",
  "whereas",
  "wherever",
  "whether",
  "which",
  "while",
  "who",
  "whom",
  "whose",
  "why",
  "will",
  "with",
  "within",
  "without",
  "work",
  "would",
  "yet",
  "you",
  "your",
  "yours",
]);

/**
 * The minimum topical signal a row scoped to ANOTHER aim must show before it is admitted into this
 * plan. One real content word is enough — "sqlite", "kiln", "waiver" — because a single shared
 * domain term is a genuine link between two aims. Grammar is not: see `RELEVANCE_STOPWORDS`.
 */
const MIN_CROSS_AIM_CONTENT_MATCHES = 1;

/**
 * A content token carries topic. Independently of the stopword list, a match must be carried by a
 * word: a bare figure shared by two texts ("500", "1.4") is a coincidence, not a subject.
 */
function isContentToken(token: string): boolean {
  return /[a-z]{3,}/.test(token) && !RELEVANCE_STOPWORDS.has(token);
}

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
    .filter((token) => token.length >= 3 && isContentToken(token));
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

  // A row scoped to another aim starts from "presumed irrelevant": it is admitted only on real
  // topical signal, never on grammar. `matchedTokens` is already content-only by construction
  // (`relevanceTokens`), and the threshold is stated here so the admission rule is inspectable.
  if (matchedTokens.length >= MIN_CROSS_AIM_CONTENT_MATCHES) {
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
