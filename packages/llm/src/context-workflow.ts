import {
  contextCaptureFulfillmentFromLineage,
  extractMemoryCandidatesFromAssumptions,
  extractMemoryCandidatesFromReview,
  reviewAimIntake,
  reviewContextLineage,
  reviewDecompositionStrategy,
  summarizeContextCaptureLearning,
  summarizeContextLineageLearning,
  summarizeDecompositionLearning,
  type AimIntakeReport,
  type ContextAssumption,
  type ContextCandidate,
  type ContextLineageLearningReport,
  type ContextSedimentationReport,
  type DecompositionLearningReport,
  type DecompositionStrategyReport,
  type PlanReviewReport,
} from "@core/domain";
import type { Evidence, Goal, Memory, MemoryKind, Milestone, MilestoneCompletion } from "@core/types";

import { clarifyImpactReportFromMetadata, summarizeClarifyLearning, type ClarifyLearningReport } from "./clarify";
import {
  selectPlanningMemoriesWithTrace,
  type PlanningContextSelectionReport,
  type PlanningMemory,
} from "./planning-context";

export interface ContextWorkflowSnapshot {
  goals: Goal[];
  evidence: Evidence[];
  completions: MilestoneCompletion[];
}

export interface ContextWorkflowStore {
  listGoals(): Promise<Goal[]>;
  getGoal(id: string): Promise<{ goal: Goal; milestones: Milestone[] } | null>;
  listMemories(goalId?: string | null): Promise<Memory[]>;
  listMemoryHistory(goalId?: string | null): Promise<Memory[]>;
  exportData(): Promise<ContextWorkflowSnapshot>;
  addMemoryCandidate(input: {
    goalId?: string | null;
    content: string;
    kind?: MemoryKind;
    category?: Memory["category"];
    source?: Memory["source"];
    confidence?: number;
  }): Promise<Memory>;
}

export interface PlanningContextForAim {
  memories: PlanningMemory[];
  report: PlanningContextSelectionReport;
  sourceMemories: Memory[];
}

export async function selectPlanningContextForStore(
  store: Pick<ContextWorkflowStore, "listMemories">,
  input: {
    title: string;
    description?: string;
    currentGoalId?: string | null;
    limit?: number;
  },
): Promise<PlanningContextForAim> {
  const memories = await store.listMemories();
  const rows = memories.map((memory) => ({
    id: memory.id,
    content: memory.content,
    kind: memory.kind,
    category: memory.category,
    source: memory.source,
    confidence: memory.confidence,
    goalId: memory.goal_id,
  }));
  const selection = selectPlanningMemoriesWithTrace({
    title: input.title,
    description: input.description,
    currentGoalId: input.currentGoalId,
    limit: input.limit ?? 12,
    memories: rows,
  });
  return { ...selection, sourceMemories: memories };
}

export function planningContextReportsFromGoals(goals: readonly Goal[]): PlanningContextSelectionReport[] {
  return goals.flatMap((goal) => {
    const report = goal.metadata?.planning_context as Partial<PlanningContextSelectionReport> | undefined;
    if (!report || !Array.isArray(report.selected) || !Array.isArray(report.ignored)) return [];
    return [{
      total: typeof report.total === "number" ? report.total : report.selected.length + report.ignored.length,
      limit: typeof report.limit === "number" ? report.limit : report.selected.length,
      selected: report.selected as PlanningContextSelectionReport["selected"],
      ignored: report.ignored as PlanningContextSelectionReport["ignored"],
    }];
  });
}

export function buildAimIntakeReport(input: {
  title: string;
  description?: string;
  planning: PlanningContextForAim;
  draftReview?: PlanReviewReport | null;
  lineageLearning?: ContextLineageLearningReport | null;
}): AimIntakeReport {
  return reviewAimIntake({
    title: input.title,
    description: input.description,
    memories: input.planning.sourceMemories,
    selectedContext: input.planning.memories,
    draftReview: input.draftReview ?? null,
    lineageLearning: input.lineageLearning,
  });
}

async function contextLineageReportsForStore(
  store: Pick<ContextWorkflowStore, "getGoal" | "listGoals" | "listMemoryHistory">,
) {
  const [goals, contextOutcomes] = await Promise.all([store.listGoals(), store.listMemoryHistory()]);
  const hydrated = await Promise.all(goals.map((goal) => store.getGoal(goal.id)));
  return hydrated.flatMap((got) =>
    got
      ? [reviewContextLineage({
          goal: got.goal,
          milestones: got.milestones,
          contextOutcomes,
        })]
      : [],
  );
}

export async function summarizeClarifyLearningForStore(
  store: Pick<ContextWorkflowStore, "listGoals">,
): Promise<ClarifyLearningReport> {
  const goals = await store.listGoals();
  return summarizeClarifyLearning(goals.map((goal) => clarifyImpactReportFromMetadata(goal.metadata)));
}

export async function summarizeContextCaptureLearningForStore(
  store: Pick<ContextWorkflowStore, "getGoal" | "listGoals" | "listMemoryHistory">,
) {
  const lineageReports = await contextLineageReportsForStore(store);
  return summarizeContextCaptureLearning(lineageReports.map(contextCaptureFulfillmentFromLineage));
}

export async function summarizeContextLineageLearningForStore(
  store: Pick<ContextWorkflowStore, "getGoal" | "listGoals" | "listMemoryHistory">,
): Promise<ContextLineageLearningReport> {
  return summarizeContextLineageLearning(await contextLineageReportsForStore(store));
}

export async function summarizeDecompositionLearningForStore(
  store: Pick<ContextWorkflowStore, "exportData" | "getGoal" | "listMemoryHistory">,
): Promise<DecompositionLearningReport> {
  const [snapshot, contextOutcomes] = await Promise.all([store.exportData(), store.listMemoryHistory()]);
  const hydrated = await Promise.all(snapshot.goals.map((goal) => store.getGoal(goal.id)));
  return summarizeDecompositionLearning(hydrated.flatMap((got) =>
    got
      ? [{
          goal: got.goal,
          milestones: got.milestones,
          evidence: snapshot.evidence.filter((item) => item.goal_id === got.goal.id),
          completions: snapshot.completions.filter((completion) =>
            got.milestones.some((milestone) => milestone.id === completion.milestone_id),
          ),
          lineage: reviewContextLineage({
            goal: got.goal,
            milestones: got.milestones,
            contextOutcomes,
          }),
        }]
      : [],
  ));
}

export async function reviewDecompositionStrategyForStore(
  store: Pick<ContextWorkflowStore, "exportData" | "getGoal" | "listMemoryHistory">,
  title: string,
  description?: string,
  learning?: DecompositionLearningReport | null,
): Promise<DecompositionStrategyReport> {
  return reviewDecompositionStrategy({
    title,
    description,
    learning: learning === undefined ? await summarizeDecompositionLearningForStore(store) : learning,
  });
}

async function recordContextCandidates(
  store: Pick<ContextWorkflowStore, "addMemoryCandidate">,
  goal: Goal,
  candidates: readonly ContextCandidate[],
): Promise<Memory[]> {
  const saved: Memory[] = [];
  for (const candidate of candidates) {
    const memory = await store.addMemoryCandidate({
      goalId: goal.id,
      content: candidate.content,
      kind: candidate.kind,
      category: candidate.category,
      source: candidate.source,
      confidence: candidate.confidence,
    });
    if (memory.status === "pending") saved.push(memory);
  }
  return saved;
}

export async function recordReviewContextCandidatesForStore(
  store: Pick<ContextWorkflowStore, "addMemoryCandidate">,
  goal: Goal,
  review: PlanReviewReport | null | undefined,
): Promise<Memory[]> {
  if (!review) return [];
  return recordContextCandidates(store, goal, extractMemoryCandidatesFromReview({ goal, review }));
}

export async function recordAssumptionContextCandidatesForStore(
  store: Pick<ContextWorkflowStore, "addMemoryCandidate">,
  goal: Goal,
  assumptions: readonly ContextAssumption[],
): Promise<Memory[]> {
  return recordContextCandidates(store, goal, extractMemoryCandidatesFromAssumptions({ goal, assumptions }));
}

export async function recordSedimentationMemoryCandidatesForStore(
  store: Pick<ContextWorkflowStore, "addMemoryCandidate">,
  sedimentation: ContextSedimentationReport | null | undefined,
): Promise<Memory[]> {
  const saved: Memory[] = [];
  for (const candidate of sedimentation?.durableMemoryCandidates ?? []) {
    const memory = await store.addMemoryCandidate({
      goalId: null,
      content: candidate.content,
      kind: candidate.kind,
      category: candidate.category,
      source: candidate.source,
      confidence: candidate.confidence,
    });
    if (memory.status === "pending") saved.push(memory);
  }
  return saved;
}
