import type {
  AimcubToolFailure,
  AimcubToolHandlerContext,
  AimcubToolName,
  AimcubToolObservation,
  ContextDistillOutput,
  LocalReadOutput,
  LocalScanWorkspaceOutput,
  MemorySearchOutput,
  WebFetchOutput,
  WebSearchOutput,
} from "./tool-contract";
import type { AimcubToolRegistry } from "./tool-registry";
import {
  selectPlanningMemoriesWithTrace,
  type PlanningContextSelectionReport,
  type PlanningMemory,
} from "./planning-context";

export interface PlanningToolContextInput {
  title: string;
  description?: string;
  currentAimId?: string | null;
  memoryLimit?: number;
  includeWeb?: boolean;
  fetchWebResults?: boolean;
  webSearchLimit?: number;
  includeLocal?: boolean;
  workspaceRoot?: string;
  localScanMaxDepth?: number;
  writeDistilledMemoryCandidates?: boolean;
  askMissingQuestions?: boolean;
}

export interface PlanningToolFailure {
  toolName: AimcubToolName;
  error: AimcubToolFailure;
}

export interface PlanningToolObservationEvent {
  toolName: AimcubToolName;
  observation: AimcubToolObservation<unknown>;
}

export interface PlanningToolContextResult {
  memories: PlanningMemory[];
  report: PlanningContextSelectionReport;
  observations: Array<AimcubToolObservation<unknown>>;
  observationEvents: PlanningToolObservationEvent[];
  failures: PlanningToolFailure[];
  distillation: ContextDistillOutput | null;
}

const DEFAULT_CONTEXT_LIMIT = 12;
const DEFAULT_WEB_SEARCH_LIMIT = 3;
const DEFAULT_LOCAL_MANIFEST_READ_LIMIT = 3;
const DEFAULT_LOCAL_MANIFEST_READ_LINES = 80;
const DEFAULT_LOCAL_MANIFEST_READ_BYTES = 16_000;

function queryForAim(input: PlanningToolContextInput): string {
  return [input.title, input.description].filter((part): part is string => Boolean(part?.trim())).join("\n");
}

function memorySearchOutputToPlanningMemory(memory: MemorySearchOutput["memories"][number]): PlanningMemory {
  return {
    id: memory.id,
    memoryId: memory.id,
    content: memory.content,
    kind: memory.kind,
    category: memory.category,
    source: "memory.search",
    confidence: memory.confidence,
    goalId: memory.goalId ?? null,
    goal_id: memory.goalId ?? null,
  };
}

function webSearchOutputToPlanningMemories(output: WebSearchOutput): PlanningMemory[] {
  return output.results.map((result, index) => ({
    id: `web.search:${index}:${result.url}`,
    content: [
      `Web search result: ${result.title}`,
      result.snippet,
      `Source: ${result.url}`,
    ].filter(Boolean).join(" — "),
    kind: "semantic",
    category: "project_fact",
    source: "web.search",
    confidence: 0.65,
    goalId: null,
    goal_id: null,
  }));
}

function webFetchOutputToPlanningMemory(output: WebFetchOutput): PlanningMemory {
  return {
    id: `web.fetch:${output.finalUrl}`,
    content: [
      `Fetched web page: ${output.title ?? output.finalUrl}`,
      output.text?.slice(0, 1_200),
      `Source: ${output.finalUrl}`,
    ].filter(Boolean).join(" — "),
    kind: "semantic",
    category: "project_fact",
    source: "web.fetch",
    confidence: 0.62,
    goalId: null,
    goal_id: null,
  };
}

function localScanOutputToPlanningMemory(output: LocalScanWorkspaceOutput): PlanningMemory {
  const manifests = output.manifests.slice(0, 8).map((manifest) => `${manifest.kind}: ${manifest.path}`);
  return {
    id: `local.scan_workspace:${output.root}`,
    content: [
      `Workspace scan: ${output.root}`,
      `${output.fileCount} files and ${output.directoryCount} directories`,
      output.likelyProjectTypes.length > 0 ? `Likely project types: ${output.likelyProjectTypes.join(", ")}` : undefined,
      manifests.length > 0 ? `Manifests: ${manifests.join("; ")}` : undefined,
      output.sensitivePathsExcluded.length > 0 ? `${output.sensitivePathsExcluded.length} sensitive paths excluded` : undefined,
    ].filter(Boolean).join(" — "),
    kind: "semantic",
    category: "project_fact",
    source: "local.scan_workspace",
    confidence: 0.72,
    goalId: null,
    goal_id: null,
  };
}

function localReadOutputToPlanningMemory(output: LocalReadOutput): PlanningMemory {
  const body = output.lines
    .map((line) => `${line.line}: ${line.text}`)
    .join("\n")
    .slice(0, 2_400);
  return {
    id: `local.read:${output.path}`,
    content: [
      `Local file: ${output.path}`,
      body,
      output.truncated ? "File content was truncated." : undefined,
    ].filter(Boolean).join("\n"),
    kind: "semantic",
    category: "project_fact",
    source: "local.read",
    confidence: 0.74,
    goalId: null,
    goal_id: null,
  };
}

function distillationCandidatesToPlanningMemories(
  output: ContextDistillOutput,
  currentAimId: string | null | undefined,
): PlanningMemory[] {
  return output.durableMemoryCandidates.map((candidate, index) => {
    const goalId = candidate.scope === "current_aim" ? currentAimId ?? null : null;
    return {
      id: `context.distill:${candidate.scope}:${candidate.category}:${index}`,
      content: candidate.content,
      kind: candidate.category === "procedure" ? "procedural" : "semantic",
      category: candidate.category,
      source: "context.distill",
      confidence: candidate.scope === "current_aim" ? 0.78 : 0.72,
      goalId,
      goal_id: goalId,
    };
  });
}

function collectMemoryData(observation: AimcubToolObservation<unknown>): PlanningMemory[] {
  const data = observation.data as Partial<MemorySearchOutput> | undefined;
  if (!data || !Array.isArray(data.memories)) return [];
  return data.memories.map(memorySearchOutputToPlanningMemory);
}

function collectWebSearchData(observation: AimcubToolObservation<unknown>): PlanningMemory[] {
  const data = observation.data as Partial<WebSearchOutput> | undefined;
  if (!data || !Array.isArray(data.results)) return [];
  return webSearchOutputToPlanningMemories({ results: data.results as WebSearchOutput["results"] });
}

function collectWebFetchData(observation: AimcubToolObservation<unknown>): PlanningMemory[] {
  const data = observation.data as Partial<WebFetchOutput> | undefined;
  if (!data || typeof data.finalUrl !== "string" || typeof data.status !== "number") return [];
  return [webFetchOutputToPlanningMemory(data as WebFetchOutput)];
}

function collectLocalScanData(observation: AimcubToolObservation<unknown>): PlanningMemory[] {
  const data = observation.data as Partial<LocalScanWorkspaceOutput> | undefined;
  if (!data || typeof data.root !== "string" || typeof data.fileCount !== "number" || typeof data.directoryCount !== "number") {
    return [];
  }
  return [localScanOutputToPlanningMemory(data as LocalScanWorkspaceOutput)];
}

function collectLocalReadData(observation: AimcubToolObservation<unknown>): PlanningMemory[] {
  const data = observation.data as Partial<LocalReadOutput> | undefined;
  if (!data || typeof data.path !== "string" || !Array.isArray(data.lines)) return [];
  return [localReadOutputToPlanningMemory(data as LocalReadOutput)];
}

function manifestPathsFromScan(observation: AimcubToolObservation<LocalScanWorkspaceOutput>): string[] {
  const seen = new Set<string>();
  const paths: string[] = [];
  for (const manifest of observation.data.manifests) {
    if (seen.has(manifest.path)) continue;
    seen.add(manifest.path);
    paths.push(manifest.path);
    if (paths.length >= DEFAULT_LOCAL_MANIFEST_READ_LIMIT) break;
  }
  return paths;
}

function addResult<T>(
  toolName: AimcubToolName,
  result: { ok: true; observation: AimcubToolObservation<T> } | { ok: false; error: AimcubToolFailure },
  observations: Array<AimcubToolObservation<unknown>>,
  observationEvents: PlanningToolObservationEvent[],
  failures: PlanningToolFailure[],
): AimcubToolObservation<T> | null {
  if (result.ok) {
    observations.push(result.observation as AimcubToolObservation<unknown>);
    observationEvents.push({ toolName, observation: result.observation as AimcubToolObservation<unknown> });
    return result.observation;
  }
  failures.push({ toolName, error: result.error });
  return null;
}

export async function collectPlanningToolContext(
  registry: AimcubToolRegistry,
  context: AimcubToolHandlerContext,
  input: PlanningToolContextInput,
): Promise<PlanningToolContextResult> {
  const observations: Array<AimcubToolObservation<unknown>> = [];
  const observationEvents: PlanningToolObservationEvent[] = [];
  const failures: PlanningToolFailure[] = [];
  const planningMemories: PlanningMemory[] = [];
  const query = queryForAim(input);

  const memoryObservation = addResult(
    "memory.search",
    await registry.execute("memory.search", {
      query,
      aimId: input.currentAimId ?? undefined,
      scope: "both",
      limit: input.memoryLimit ?? DEFAULT_CONTEXT_LIMIT,
    }, context),
    observations,
    observationEvents,
    failures,
  );
  if (memoryObservation) planningMemories.push(...collectMemoryData(memoryObservation));

  if (input.includeLocal && registry.has("local.scan_workspace")) {
    const localScanRoot = input.workspaceRoot ?? context.workspaceRoot ?? ".";
    const localScanObservation = addResult(
      "local.scan_workspace",
      await registry.execute("local.scan_workspace", {
        root: localScanRoot,
        maxDepth: input.localScanMaxDepth,
        includeHidden: false,
      }, context),
      observations,
      observationEvents,
      failures,
    );
    if (localScanObservation) {
      planningMemories.push(...collectLocalScanData(localScanObservation));
      if (registry.has("local.read")) {
        for (const manifestPath of manifestPathsFromScan(localScanObservation)) {
          const localReadObservation = addResult(
            "local.read",
            await registry.execute("local.read", {
              path: manifestPath,
              maxLines: DEFAULT_LOCAL_MANIFEST_READ_LINES,
              maxBytes: DEFAULT_LOCAL_MANIFEST_READ_BYTES,
            }, context),
            observations,
            observationEvents,
            failures,
          );
          if (localReadObservation) planningMemories.push(...collectLocalReadData(localReadObservation));
        }
      }
    }
  }

  if (input.includeWeb) {
    const webSearchObservation = addResult(
      "web.search",
      await registry.execute("web.search", {
        query,
        limit: input.webSearchLimit ?? DEFAULT_WEB_SEARCH_LIMIT,
      }, context),
      observations,
      observationEvents,
      failures,
    );
    if (webSearchObservation) {
      planningMemories.push(...collectWebSearchData(webSearchObservation));
      const firstUrl = (webSearchObservation.data as WebSearchOutput).results[0]?.url;
      if (input.fetchWebResults && firstUrl) {
        const webFetchObservation = addResult(
          "web.fetch",
          await registry.execute("web.fetch", {
            url: firstUrl,
            maxBytes: 80_000,
            extractMode: "text",
          }, context),
          observations,
          observationEvents,
          failures,
        );
        if (webFetchObservation) planningMemories.push(...collectWebFetchData(webFetchObservation));
      }
    }
  }

  let distillation: ContextDistillOutput | null = null;
  if (registry.has("context.distill")) {
    const distillObservation = addResult(
      "context.distill",
      await registry.execute("context.distill", {
        aimTitle: input.title,
        aimDescription: input.description,
        observations,
      }, context),
      observations,
      observationEvents,
      failures,
    );
    distillation = distillObservation ? distillObservation.data : null;
    if (distillation) {
      planningMemories.push(...distillationCandidatesToPlanningMemories(distillation, input.currentAimId));
    }
  }

  if (input.askMissingQuestions && distillation?.missingQuestions.length && registry.has("context.ask_user")) {
    addResult(
      "context.ask_user",
      await registry.execute("context.ask_user", {
        questions: distillation.missingQuestions.slice(0, 5).map((question) => ({
          id: question.id,
          question: question.question,
          ...(question.category ? { category: question.category } : {}),
          captureScope: "current_aim",
        })),
      }, context),
      observations,
      observationEvents,
      failures,
    );
  }

  if (input.writeDistilledMemoryCandidates && distillation && registry.has("memory.write_candidate")) {
    for (const candidate of distillation.durableMemoryCandidates) {
      if (candidate.scope === "current_aim" && !input.currentAimId) continue;
      addResult(
        "memory.write_candidate",
        await registry.execute("memory.write_candidate", {
          content: candidate.content,
          category: candidate.category,
          scope: candidate.scope,
          aimId: candidate.scope === "current_aim" ? input.currentAimId ?? undefined : undefined,
          sourceToolCallId: "context.distill",
        }, context),
        observations,
        observationEvents,
        failures,
      );
    }
  }

  const selection = selectPlanningMemoriesWithTrace({
    title: input.title,
    description: input.description,
    currentGoalId: input.currentAimId ?? undefined,
    limit: input.memoryLimit ?? DEFAULT_CONTEXT_LIMIT,
    memories: planningMemories,
  });

  return {
    memories: selection.memories,
    report: selection.report,
    observations,
    observationEvents,
    failures,
    distillation,
  };
}
