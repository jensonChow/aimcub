/**
 * What the pipeline actually injects, and the provider-free half of the benchmark.
 *
 * `captureConditionContext` calls the same four store-driven selectors the CLI calls before it
 * decomposes — planning context, context-lineage learning, decomposition learning, and the derived
 * strategy — so the captured block is the prompt the model really receives, not a reconstruction.
 * `buildContextDiff` is pure: it turns two captures into the difference a reader can check by hand.
 */
import {
  renderPlanningContext,
  reviewDecompositionStrategyForStore,
  selectPlanningContextForStore,
  summarizeContextLineageLearningForStore,
  summarizeDecompositionLearningForStore,
  type AimStore,
  type PlanningMemory,
} from "./core.ts";
import type {
  BenchmarkAim,
  CapturedPlanningContext,
  ConditionId,
  ContextDiff,
  WithheldContextRow,
} from "./types.ts";
import type {
  ContextLineageLearningReport,
  DecompositionLearningReport,
  DecompositionStrategyReport,
} from "./core.ts";

/** Everything one condition's store offers the decomposition prompt. */
export interface ConditionCapture {
  captured: CapturedPlanningContext;
  /** The selected rows in the shape `decompose` consumes. */
  planningMemories: PlanningMemory[];
  /** The learning channels, passed to `decompose` verbatim — the CLI passes the same four inputs. */
  lineageLearning: ContextLineageLearningReport;
  decompositionLearning: DecompositionLearningReport;
  decompositionStrategy: DecompositionStrategyReport;
  /** Every row the store holds, active or not — the denominator for "what was withheld". */
  storeRows: Array<{ id: string; content: string; category: string; status: string; goalId: string | null }>;
}

export async function captureConditionContext(
  store: AimStore,
  aim: BenchmarkAim,
  condition: ConditionId,
  goalId: string,
): Promise<ConditionCapture> {
  const planning = await selectPlanningContextForStore(store, {
    title: aim.title,
    description: aim.description,
    currentGoalId: goalId,
  });
  const lineage = await summarizeContextLineageLearningForStore(store);
  const decomposition = await summarizeDecompositionLearningForStore(store);
  const strategy = await reviewDecompositionStrategyForStore(store, aim.title, aim.description, decomposition);
  const history = await store.listMemoryHistory();

  return {
    planningMemories: planning.memories,
    lineageLearning: lineage,
    decompositionLearning: decomposition,
    decompositionStrategy: strategy,
    storeRows: history.map((row) => ({
      id: row.id,
      content: row.content,
      category: row.category,
      status: row.status,
      goalId: row.goal_id,
    })),
    captured: {
      condition,
      report: planning.report,
      renderedBlock: renderPlanningContext(planning.memories),
      memories: planning.memories.map((memory) => ({
        id: memory.memoryId ?? memory.id,
        content: memory.content,
        category: String(memory.category ?? "unknown"),
        goalId: memory.goalId ?? memory.goal_id ?? null,
      })),
      lineage: {
        totalQuestions: lineage.totalQuestions,
        totalCaptured: lineage.totalCaptured,
        totalImpacted: lineage.totalImpacted,
        guidance: [...lineage.guidance],
      },
      decomposition: {
        totalAims: decomposition.totalAims,
        totalMilestones: decomposition.totalMilestones,
        completedMilestones: decomposition.completedMilestones,
        guidance: [...decomposition.guidance],
      },
      strategy: {
        actionCount: strategy.actionCount,
        actions: strategy.actions.map((action) => `[${action.priority}] ${action.focus}: ${action.recommendation}`),
      },
    },
  };
}

function charsOf(rows: readonly { content: string }[]): number {
  return rows.reduce((total, row) => total + row.content.length, 0);
}

/**
 * Function words carry no topical signal. Context scoped to ANOTHER aim is admitted into planning
 * by token overlap with the new aim, so a row whose only overlap is on this list was admitted on
 * grammar rather than relevance. The harness reports those rows instead of quietly counting them as
 * a win: injecting more context is not the same as injecting the right context.
 */
const FUNCTION_WORDS = new Set([
  "and", "any", "are", "been", "before", "being", "but", "can", "could", "did", "does", "each",
  "every", "for", "had", "has", "have", "her", "his", "into", "its", "may", "might", "must",
  "not", "one", "our", "out", "over", "per", "should", "some", "such", "than", "the", "their",
  "them", "then", "there", "these", "they", "those", "was", "were", "when", "where", "which",
  "while", "who", "will", "would", "you", "your",
]);

function weakMatchRows(capture: ConditionCapture): ContextDiff["weakMatches"] {
  return capture.captured.report.selected
    .filter((row) =>
      row.scope === "related_goal" &&
      row.matchedTokens.length > 0 &&
      row.matchedTokens.every((token) => FUNCTION_WORDS.has(token)),
    )
    .map((row) => ({ content: row.content, category: row.category, matchedTokens: [...row.matchedTokens] }));
}

function withheldRows(capture: ConditionCapture): WithheldContextRow[] {
  const selectedIds = new Set(capture.captured.report.selected.map((row) => row.memoryId).filter(Boolean));
  const ignoredById = new Map(
    capture.captured.report.ignored
      .filter((row) => row.memoryId)
      .map((row) => [row.memoryId as string, row]),
  );

  return capture.storeRows
    .filter((row) => !selectedIds.has(row.id))
    .map((row) => {
      const ignored = ignoredById.get(row.id);
      if (ignored) {
        return { content: row.content, category: ignored.category, scope: ignored.scope, reason: ignored.reason };
      }
      // Not even a selection candidate: the store never offered it, because it is not active context.
      return {
        content: row.content,
        category: row.category,
        scope: row.goalId ? "aim_scoped" : "global",
        reason: `not_active_context:${row.status}`,
      };
    });
}

function learningDelta(bare: CapturedPlanningContext, contexted: CapturedPlanningContext): string[] {
  const lines: string[] = [];
  const aimDelta = contexted.decomposition.totalAims - bare.decomposition.totalAims;
  const milestoneDelta = contexted.decomposition.completedMilestones - bare.decomposition.completedMilestones;
  if (aimDelta !== 0 || milestoneDelta !== 0) {
    lines.push(
      `decomposition learning: ${aimDelta} more prior aim(s), ${milestoneDelta} more completed milestone(s) to learn from`,
    );
  }
  const strategyDelta = contexted.strategy.actionCount - bare.strategy.actionCount;
  if (strategyDelta !== 0) lines.push(`decomposition strategy: ${strategyDelta} more strategy action(s) derived`);
  for (const action of contexted.strategy.actions) {
    if (!bare.strategy.actions.includes(action)) lines.push(`strategy action only in contexted: ${action}`);
  }
  const lineageDelta = contexted.lineage.totalCaptured - bare.lineage.totalCaptured;
  if (lineageDelta !== 0) lines.push(`context lineage: ${lineageDelta} more captured context row(s) with traceable origin`);
  if (lines.length === 0) lines.push("no difference on the learning channels (planning context is the only delta)");
  return lines;
}

/** The dry-run deliverable: what the contexted store injects that the bare store cannot. */
export function buildContextDiff(
  aim: BenchmarkAim,
  bare: ConditionCapture,
  contexted: ConditionCapture,
): ContextDiff {
  const bareContents = new Set(bare.captured.memories.map((row) => row.content));
  const injectedOnly = contexted.captured.report.selected
    .filter((row) => !bareContents.has(row.content))
    .map((row) => ({
      content: row.content,
      category: row.category,
      scope: row.scope,
      reason: row.reason,
      score: row.score,
    }));

  const byCategory = [...injectedOnly.reduce((counts, row) => {
    counts.set(row.category, (counts.get(row.category) ?? 0) + 1);
    return counts;
  }, new Map<string, number>())]
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) => b.count - a.count || a.category.localeCompare(b.category));

  return {
    aimId: aim.id,
    injectedRows: contexted.captured.memories.length,
    injectedChars: charsOf(contexted.captured.memories),
    bareRows: bare.captured.memories.length,
    bareChars: charsOf(bare.captured.memories),
    byCategory,
    injectedOnly,
    weakMatches: weakMatchRows(contexted),
    withheld: withheldRows(contexted),
    learningDelta: learningDelta(bare.captured, contexted.captured),
    nonEmpty: injectedOnly.length > 0,
  };
}
