import type {
  ContextCategory,
  DecompositionOutput,
  GoalDomain,
  MemoryKind,
  PlanQualityReport,
  PlanningContextSelectionReport,
} from "./core.ts";

/** The two store states the benchmark compares. */
export type ConditionId = "bare" | "contexted";

export const CONDITION_IDS: readonly ConditionId[] = ["bare", "contexted"];

/** How a fixture context row sits in the store — mirrors `Memory.status`. */
export type FixtureContextStatus = "active" | "pending" | "deprioritized";

/**
 * One context row of the persona's accrued context. `priorAim` is the fixture key of the prior
 * aim it sedimented from; `null` means the row was promoted to global context during review, which
 * is what the product does when a candidate is accepted with `goalId: null`.
 */
export interface FixtureContext {
  content: string;
  category: ContextCategory;
  kind?: MemoryKind;
  confidence?: number;
  source?: "agent_inferred" | "user_stated" | "evidence_derived";
  priorAim?: string | null;
  status?: FixtureContextStatus;
  /** Why this row exists in the fixture. Documentation only — never seeded, never prompted. */
  note?: string;
}

/** A milestone of a prior aim, plus how it was proven (or left unproven). */
export interface FixturePriorMilestone {
  key: string;
  title: string;
  description: string;
  why: string;
  definitionOfDone: string;
  requiredEvidence: string[];
  owner: "human" | "agent" | "either" | "mixed";
  evalSignal: string;
  /** `commit` and `manual` complete the milestone through `evaluate()`; `open` leaves it pending. */
  proof: FixturePriorProof;
}

export type FixturePriorProof =
  | { kind: "commit"; messagePattern: string; pathGlob: string; sha: string; message: string; files: string[] }
  | { kind: "manual"; summary: string; proofNote: string }
  | { kind: "open" };

/**
 * A separate aim the persona also has open. It carries no plan and no evidence — it exists so that
 * context scoped to unrelated work has a real aim to hang from, the way it does in a live store.
 */
export interface FixtureOtherAim {
  key: string;
  title: string;
  description: string;
}

/** A completed piece of the persona's history. Seeded only in the `contexted` condition. */
export interface FixturePriorAim {
  key: string;
  title: string;
  description: string;
  domain: GoalDomain;
  rationale: string;
  summary: string;
  milestones: FixturePriorMilestone[];
}

/** One benchmark cell source: the same aim text, with and without the persona's history behind it. */
export interface BenchmarkAim {
  id: string;
  label: string;
  domain: GoalDomain;
  /** Exactly what the user types. Identical in both conditions — the only difference is the store. */
  title: string;
  description: string;
  /** One line naming the person, shown to the judge as ground truth for both plans. */
  persona: string;
  priorAims: FixturePriorAim[];
  otherAims: FixtureOtherAim[];
  context: FixtureContext[];
}

/** What a seeded condition looks like once it is on disk. */
export interface SeededCondition {
  condition: ConditionId;
  dataDir: string;
  /** The plan-less shell aim under test. Present in both conditions. */
  goalId: string;
  counts: { goals: number; memories: number; evidence: number; completions: number };
}

/** Everything the pipeline injected for one cell, captured before the provider call. */
export interface CapturedPlanningContext {
  condition: ConditionId;
  report: PlanningContextSelectionReport;
  /** The exact `Known user context` block the decompose prompt receives. */
  renderedBlock: string;
  memories: Array<{ id?: string; content: string; category: string; goalId: string | null }>;
  lineage: { totalQuestions: number; totalCaptured: number; totalImpacted: number; guidance: string[] };
  decomposition: { totalAims: number; totalMilestones: number; completedMilestones: number; guidance: string[] };
  strategy: { actionCount: number; actions: string[] };
}

export interface WithheldContextRow {
  content: string;
  category: string;
  scope: string;
  reason: string;
}

/** The provider-free deliverable: what the contexted store can inject that the bare store cannot. */
export interface ContextDiff {
  aimId: string;
  injectedRows: number;
  injectedChars: number;
  bareRows: number;
  bareChars: number;
  byCategory: Array<{ category: string; count: number }>;
  injectedOnly: Array<{ content: string; category: string; scope: string; reason: string; score: number }>;
  /** Rows from another aim admitted purely on function-word overlap — noise, not relevance. */
  weakMatches: Array<{ content: string; category: string; matchedTokens: string[] }>;
  withheld: WithheldContextRow[];
  learningDelta: string[];
  /** False means the contexted condition injected nothing extra — a failed fixture, not a finding. */
  nonEmpty: boolean;
}

/** One decomposition cell: aim x condition x repetition. */
export interface PlanCell {
  aimId: string;
  condition: ConditionId;
  repetition: number;
  ok: boolean;
  errors: string[];
  plan: DecompositionOutput | null;
  /** `critiquePlan` against the persona's full ground-truth context — same yardstick for both. */
  groundTruthQuality: PlanQualityReport | null;
  nodeCount: number;
  manualOnlyNodes: number;
  ownerMix: Record<string, number>;
  usage: { model: string; inputTokens: number; outputTokens: number } | null;
}

export interface JudgeCriterionScore {
  criterion: string;
  score: number;
  justification: string;
}

/** A judge verdict for one aim x repetition, still in blind A/B space. */
export interface JudgeVerdict {
  scores: Array<{ label: "A" | "B"; criteria: JudgeCriterionScore[] }>;
  notes: string;
}

/** The same verdict after the blind labels are mapped back to conditions. */
export interface ResolvedJudgement {
  aimId: string;
  repetition: number;
  labelMap: Record<"A" | "B", ConditionId>;
  byCondition: Record<ConditionId, JudgeCriterionScore[]>;
  notes: string;
}

export interface BenchmarkRun {
  mode: "dry-run" | "live";
  startedAt: string;
  seed: string;
  repeat: number;
  provider: string | null;
  model: string | null;
  providerCalls: number;
  aims: string[];
  diffs: ContextDiff[];
  cells: PlanCell[];
  judgements: ResolvedJudgement[];
  /** Anything that went wrong and must not be silently swallowed. */
  warnings: string[];
}
