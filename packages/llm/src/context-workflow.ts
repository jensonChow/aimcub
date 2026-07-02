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
  type ContextIntakeProgressSignal,
  type ContextLineageLearningReport,
  type ContextSedimentationReport,
  type DecompositionLearningReport,
  type DecompositionStrategyReport,
  type PlanReviewReport,
} from "@core/domain";
import type { ContextCategory, Evidence, Goal, Memory, MemoryKind, Milestone, MilestoneCompletion } from "@core/types";

import { clarifyImpactReportFromMetadata, summarizeClarifyLearning, type ClarifyLearningReport } from "./clarify";
import {
  selectPlanningMemoriesWithTrace,
  type PlanningContextSelectionReport,
  type PlanningMemory,
} from "./planning-context";
import type { PlanningToolObservationEvent } from "./planning-tool-context";
import type {
  ContextAskUserOutput,
  ContextDistillOutput,
  LocalGlobOutput,
  LocalReadOutput,
  LocalScanWorkspaceOutput,
  LocalSearchOutput,
  MemorySearchOutput,
  WebFetchOutput,
  WebSearchOutput,
} from "./tool-contract";

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isContextCategory(value: unknown): value is ContextCategory {
  return value === "preference" ||
    value === "constraint" ||
    value === "capability" ||
    value === "eval_signal" ||
    value === "project_fact" ||
    value === "procedure";
}

function scopeForCaptureScope(value: string | undefined): ContextIntakeProgressSignal["scope"] | undefined {
  if (value === "global") return "global";
  if (value === "current_aim") return "aim";
  return undefined;
}

function scopeForMemoryScope(value: string | undefined): ContextIntakeProgressSignal["scope"] | undefined {
  if (value === "global") return "global";
  if (value === "current_aim") return "aim";
  return undefined;
}

function channelForToolName(toolName: string): ContextIntakeProgressSignal["channel"] | undefined {
  if (toolName.startsWith("local.")) return "local_workspace";
  if (toolName.startsWith("web.")) return "web_research";
  if (toolName === "memory.search") return "personal_database";
  if (toolName === "memory.write_candidate") return undefined;
  if (toolName === "context.ask_user") return "questionnaire";
  return undefined;
}

function isContextAskUserOutput(value: unknown): value is ContextAskUserOutput {
  return isRecord(value) && typeof value.requestId === "string" && Array.isArray(value.questions);
}

function isContextDistillOutput(value: unknown): value is ContextDistillOutput {
  return isRecord(value) && Array.isArray(value.durableMemoryCandidates) && Array.isArray(value.missingQuestions);
}

function isMemorySearchOutput(value: unknown): value is MemorySearchOutput {
  return isRecord(value) && Array.isArray(value.memories);
}

function isWebSearchOutput(value: unknown): value is WebSearchOutput {
  return isRecord(value) && Array.isArray(value.results);
}

function isWebFetchOutput(value: unknown): value is WebFetchOutput {
  return isRecord(value) && typeof value.finalUrl === "string" && typeof value.status === "number";
}

function isLocalReadOutput(value: unknown): value is LocalReadOutput {
  return isRecord(value) && typeof value.path === "string" && Array.isArray(value.lines);
}

function isLocalSearchOutput(value: unknown): value is LocalSearchOutput {
  return isRecord(value) && Array.isArray(value.matches);
}

function isLocalGlobOutput(value: unknown): value is LocalGlobOutput {
  return isRecord(value) && Array.isArray(value.paths);
}

function isLocalScanWorkspaceOutput(value: unknown): value is LocalScanWorkspaceOutput {
  return isRecord(value) &&
    typeof value.root === "string" &&
    typeof value.fileCount === "number" &&
    typeof value.directoryCount === "number" &&
    Array.isArray(value.likelyProjectTypes);
}

function cleanText(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function webSearchSummary(output: WebSearchOutput, fallback: string | undefined): string {
  const results = output.results.slice(0, 3).map((result) =>
    [result.title, result.snippet, result.url].map(cleanText).filter(Boolean).join(" — "),
  ).filter(Boolean);
  return results.join("\n") || cleanText(fallback);
}

function webFetchSummary(output: WebFetchOutput, fallback: string | undefined): string {
  return [
    output.title ? `Fetched web page: ${output.title}` : "Fetched web page",
    output.text?.slice(0, 1_000),
    `Source: ${output.finalUrl}`,
  ].map(cleanText).filter(Boolean).join(" — ") || cleanText(fallback);
}

function localObservationSummary(value: unknown, fallback: string | undefined): string {
  if (isLocalScanWorkspaceOutput(value)) {
    return [
      `Workspace scan: ${value.root}`,
      `${value.fileCount} files and ${value.directoryCount} directories`,
      value.likelyProjectTypes.length ? `Likely project types: ${value.likelyProjectTypes.join(", ")}` : undefined,
    ].map(cleanText).filter(Boolean).join(" — ");
  }
  if (isLocalReadOutput(value)) {
    const body = value.lines
      .slice(0, 40)
      .map((line) => `${line.line}: ${line.text}`)
      .join("\n")
      .slice(0, 1_200);
    return [
      `Read local file: ${value.path}`,
      body,
      value.truncated ? "File content was truncated." : undefined,
    ].map(cleanText).filter(Boolean).join(" — ");
  }
  if (isLocalSearchOutput(value)) {
    return `Local search found ${value.matches.length} match${value.matches.length === 1 ? "" : "es"}.`;
  }
  if (isLocalGlobOutput(value)) {
    return `Local glob found ${value.paths.length} path${value.paths.length === 1 ? "" : "s"}.`;
  }
  return cleanText(fallback);
}

export function contextIntakeSignalsFromPlanningToolEvents(
  events: readonly PlanningToolObservationEvent[],
): ContextIntakeProgressSignal[] {
  const signals: ContextIntakeProgressSignal[] = [];

  for (const event of events) {
    const data = event.observation.data;
    if (event.toolName === "context.ask_user" && isContextAskUserOutput(data)) {
      for (const question of data.questions) {
        signals.push({
          source: "user_request",
          toolName: event.toolName,
          channel: "questionnaire",
          category: isContextCategory(question.category) ? question.category : undefined,
          scope: scopeForCaptureScope(question.captureScope),
          questionId: question.id,
          summary: question.question,
        });
      }
      continue;
    }

    if (event.toolName === "context.distill" && isContextDistillOutput(data)) {
      for (const candidate of data.durableMemoryCandidates) {
        signals.push({
          source: "memory_candidate",
          toolName: event.toolName,
          category: isContextCategory(candidate.category) ? candidate.category : undefined,
          scope: scopeForCaptureScope(candidate.scope),
          summary: candidate.content,
        });
      }
      continue;
    }

    if (event.toolName === "memory.search" && isMemorySearchOutput(data)) {
      for (const memory of data.memories) {
        const scope = scopeForMemoryScope(memory.scope);
        if (!scope) continue;
        signals.push({
          source: "tool_observation",
          toolName: event.toolName,
          channel: "personal_database",
          category: isContextCategory(memory.category) ? memory.category : undefined,
          scope,
          questionId: memory.id,
          summary: memory.content,
        });
      }
      continue;
    }

    if (event.toolName === "web.fetch" && isWebFetchOutput(data)) {
      signals.push({
        source: "tool_observation",
        toolName: event.toolName,
        channel: "web_research",
        category: "project_fact",
        scope: "aim",
        summary: webFetchSummary(data, event.observation.summary),
      });
      continue;
    }

    if (event.toolName === "web.search" && isWebSearchOutput(data)) {
      signals.push({
        source: "tool_observation",
        toolName: event.toolName,
        channel: "web_research",
        category: "project_fact",
        scope: "aim",
        summary: webSearchSummary(data, event.observation.summary),
      });
      continue;
    }

    if (event.toolName.startsWith("local.")) {
      signals.push({
        source: "tool_observation",
        toolName: event.toolName,
        channel: "local_workspace",
        category: "project_fact",
        scope: "aim",
        summary: localObservationSummary(data, event.observation.summary),
      });
      continue;
    }

    signals.push({
      source: event.toolName === "memory.write_candidate" ? "memory_candidate" : "tool_observation",
      toolName: event.toolName,
      channel: channelForToolName(event.toolName),
      summary: event.observation.summary,
    });
  }

  return signals;
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

function memoryKindForCategory(category: ContextCategory): MemoryKind {
  return category === "procedure" ? "procedural" : "semantic";
}

function memorySourceForAimContext(
  source: ContextSedimentationReport["aimContext"][number]["source"],
): Memory["source"] {
  return source === "user_answer" ? "user_stated" : "agent_inferred";
}

export async function recordSedimentationAimContextForStore(
  store: Pick<ContextWorkflowStore, "addMemoryCandidate">,
  goal: Goal,
  sedimentation: ContextSedimentationReport | null | undefined,
): Promise<Memory[]> {
  const saved: Memory[] = [];
  for (const context of sedimentation?.aimContext ?? []) {
    const memory = await store.addMemoryCandidate({
      goalId: goal.id,
      content: context.content,
      kind: memoryKindForCategory(context.category),
      category: context.category,
      source: memorySourceForAimContext(context.source),
      confidence: context.source === "user_answer" ? 0.82 : 0.7,
    });
    if (memory.status === "pending") saved.push(memory);
  }
  return saved;
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
