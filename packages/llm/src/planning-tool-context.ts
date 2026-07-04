import type {
  AimcubToolFailure,
  AimcubToolHandlerContext,
  AimcubToolName,
  AimcubToolObservation,
  ContextLinkedSourcesOutput,
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
  webQueryLimit?: number;
  webFetchLimit?: number;
  includeLocal?: boolean;
  workspaceRoot?: string;
  localScanMaxDepth?: number;
  localFilePaths?: string[];
  linkedSources?: ContextLinkedSourcesOutput["sources"];
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
  research: ResearchBrief | null;
}

export interface ResearchBriefSource {
  title: string;
  url: string;
  snippet?: string;
  source?: string;
  publishedAt?: string;
  status?: number;
  textExcerpt?: string;
  fetched: boolean;
  truncated?: boolean;
}

export interface ResearchBrief {
  question: string;
  queries: string[];
  findings: string[];
  uncertainties: string[];
  sources: ResearchBriefSource[];
  generatedAt: string;
  searchResultCount: number;
  fetchedSourceCount: number;
}

const DEFAULT_CONTEXT_LIMIT = 12;
const DEFAULT_WEB_SEARCH_LIMIT = 3;
const DEFAULT_WEB_QUERY_LIMIT = 3;
const DEFAULT_WEB_FETCH_LIMIT = 3;
const DEFAULT_LOCAL_MANIFEST_READ_LIMIT = 3;
const DEFAULT_LOCAL_MANIFEST_READ_LINES = 80;
const DEFAULT_LOCAL_MANIFEST_READ_BYTES = 16_000;

function queryForAim(input: PlanningToolContextInput): string {
  return [input.title, input.description].filter((part): part is string => Boolean(part?.trim())).join("\n");
}

function compactText(value: string, maxLength = 260): string {
  const cleaned = value.replace(/\s+/g, " ").trim();
  if (cleaned.length <= maxLength) return cleaned;
  return `${cleaned.slice(0, maxLength - 1).trim()}…`;
}

function uniqueNonEmpty(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const cleaned = compactText(value, 180);
    const key = cleaned.toLowerCase();
    if (!cleaned || seen.has(key)) continue;
    seen.add(key);
    out.push(cleaned);
  }
  return out;
}

function hasCjk(value: string): boolean {
  return /[\u3400-\u9fff]/.test(value);
}

function researchQueriesForAim(input: PlanningToolContextInput): string[] {
  const title = compactText(input.title, 120);
  const description = compactText(input.description ?? "", 160);
  const base = compactText([title, description].filter(Boolean).join(" "), 180);
  const text = `${title} ${description}`.toLowerCase();
  const chinese = hasCjk(`${title} ${description}`);
  const candidates = chinese
    ? [
        base,
        `${title} 最新 官方 要求 资料`,
        `${title} 对比 风险 成本 最佳实践`,
      ]
    : [
        base,
        `${title} current official requirements guidance`,
        `${title} comparison risks costs best practices`,
      ];
  if (/\b(api|sdk|library|framework|docs|documentation|code|software|app)\b/i.test(text) || /文档|接口|框架|代码|软件|应用/.test(text)) {
    candidates.push(chinese ? `${title} 官方文档 API 限制 实现` : `${title} official documentation API limits implementation`);
  }
  if (/\b(travel|visa|flight|hotel|trip|country|city)\b/i.test(text) || /旅行|旅游|签证|机票|航班|酒店|国家|城市/.test(text)) {
    candidates.push(chinese ? `${title} 签证 安全 交通 预算 官方` : `${title} visa safety transport budget official`);
  }
  return uniqueNonEmpty(candidates).slice(0, input.webQueryLimit ?? DEFAULT_WEB_QUERY_LIMIT);
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

function researchBriefToPlanningMemory(brief: ResearchBrief): PlanningMemory {
  return {
    id: `web.research:${brief.generatedAt}:${brief.question.slice(0, 40)}`,
    content: renderResearchBriefForPlanning(brief),
    kind: "semantic",
    category: "project_fact",
    source: "web.research",
    confidence: brief.fetchedSourceCount > 0 ? 0.78 : 0.66,
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

function webSearchData(observation: AimcubToolObservation<WebSearchOutput>): WebSearchOutput {
  return observation.data;
}

function webFetchData(observation: AimcubToolObservation<WebFetchOutput>): WebFetchOutput {
  return observation.data;
}

function mergeResearchSources(
  searchObservations: readonly AimcubToolObservation<WebSearchOutput>[],
  fetchObservations: readonly AimcubToolObservation<WebFetchOutput>[],
): ResearchBriefSource[] {
  const byUrl = new Map<string, ResearchBriefSource>();
  for (const observation of searchObservations) {
    for (const result of webSearchData(observation).results) {
      if (!result.url) continue;
      byUrl.set(result.url, {
        title: result.title || result.url,
        url: result.url,
        snippet: result.snippet,
        source: result.source,
        publishedAt: result.publishedAt,
        fetched: false,
      });
    }
  }
  for (const observation of fetchObservations) {
    const result = webFetchData(observation);
    const existing = byUrl.get(result.finalUrl);
    byUrl.set(result.finalUrl, {
      title: result.title || existing?.title || result.finalUrl,
      url: result.finalUrl,
      snippet: existing?.snippet,
      source: existing?.source,
      publishedAt: existing?.publishedAt,
      status: result.status,
      textExcerpt: result.text ? compactText(result.text, 420) : undefined,
      fetched: true,
      truncated: result.truncated,
    });
  }
  return [...byUrl.values()];
}

function renderFinding(source: ResearchBriefSource): string {
  const body = source.textExcerpt || source.snippet || "No extractable text was available.";
  return `${source.title}: ${compactText(body, 320)} Source: ${source.url}`;
}

function buildResearchBrief(input: {
  aim: PlanningToolContextInput;
  queries: readonly string[];
  searchObservations: readonly AimcubToolObservation<WebSearchOutput>[];
  fetchObservations: readonly AimcubToolObservation<WebFetchOutput>[];
  generatedAt: string;
}): ResearchBrief | null {
  const sources = mergeResearchSources(input.searchObservations, input.fetchObservations);
  if (sources.length === 0) return null;
  const fetchedSourceCount = sources.filter((source) => source.fetched).length;
  const searchResultCount = input.searchObservations.reduce((sum, observation) => sum + observation.data.results.length, 0);
  const uncertainties: string[] = [];
  if (sources.length < 3) uncertainties.push("Fewer than 3 independent web sources were available.");
  if (fetchedSourceCount === 0) uncertainties.push("No source pages were fetched; findings rely on search snippets only.");
  if (sources.some((source) => source.truncated)) uncertainties.push("Some fetched pages were truncated by runtime bounds.");
  return {
    question: queryForAim(input.aim),
    queries: [...input.queries],
    findings: sources.slice(0, 8).map(renderFinding),
    uncertainties,
    sources,
    generatedAt: input.generatedAt,
    searchResultCount,
    fetchedSourceCount,
  };
}

function renderResearchBriefForPlanning(brief: ResearchBrief): string {
  const lines = [
    `Research brief for aim: ${compactText(brief.question, 220)}`,
    `Queries: ${brief.queries.join(" | ")}`,
    `Sources: ${brief.sources.length} selected, ${brief.fetchedSourceCount} fetched pages, ${brief.searchResultCount} search results.`,
    "Findings:",
    ...brief.findings.map((finding) => `- ${finding}`),
  ];
  if (brief.uncertainties.length > 0) {
    lines.push("Uncertainties:");
    lines.push(...brief.uncertainties.map((uncertainty) => `- ${uncertainty}`));
  }
  return lines.join("\n");
}

function researchBriefObservation(brief: ResearchBrief): AimcubToolObservation<ResearchBrief> {
  return {
    summary: `Built research brief from ${brief.queries.length} queries, ${brief.sources.length} sources, and ${brief.fetchedSourceCount} fetched pages.`,
    data: brief,
    sources: brief.sources.map((source) => ({
      kind: "web" as const,
      title: source.title,
      url: source.url,
      observedAt: brief.generatedAt,
    })),
    ...(brief.uncertainties.length > 0 ? { warnings: brief.uncertainties } : {}),
  };
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

function linkedSourcesOutputToPlanningMemory(output: ContextLinkedSourcesOutput): PlanningMemory {
  const rows = output.sources
    .filter((source) => source.enabled)
    .slice(0, 12)
    .map((source) => {
      const location = source.path ?? source.uri ?? "";
      const status = source.status === "available" ? "available" : `requires ${source.status.replace("_", " ")}`;
      return `${source.kind}: ${source.label}${location ? ` (${location})` : ""} — ${status}`;
    });
  return {
    id: `context.linked_sources:${output.sources.length}:${output.availableCount}:${output.blockedCount}`,
    content: [
      `Linked context sources: ${output.availableCount} available, ${output.blockedCount} requiring connector/access.`,
      ...rows,
      ...output.planningHints.map((hint) => `Hint: ${hint}`),
    ].join("\n"),
    kind: "semantic",
    category: "project_fact",
    source: "context.linked_sources",
    confidence: output.availableCount > 0 ? 0.72 : 0.56,
    goalId: null,
    goal_id: null,
  };
}

function collectLinkedSourceData(observation: AimcubToolObservation<unknown>): PlanningMemory[] {
  const data = observation.data as Partial<ContextLinkedSourcesOutput> | undefined;
  if (!data || !Array.isArray(data.sources) || typeof data.availableCount !== "number" || typeof data.blockedCount !== "number") {
    return [];
  }
  return [linkedSourcesOutputToPlanningMemory(data as ContextLinkedSourcesOutput)];
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
  let research: ResearchBrief | null = null;
  const query = queryForAim(input);

  if (registry.has("context.linked_sources") && input.linkedSources && input.linkedSources.length > 0) {
    const linkedSourceObservation = addResult(
      "context.linked_sources",
      await registry.execute("context.linked_sources", { sources: input.linkedSources }, context),
      observations,
      observationEvents,
      failures,
    );
    if (linkedSourceObservation) planningMemories.push(...collectLinkedSourceData(linkedSourceObservation));
  }

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

  if (input.includeLocal && registry.has("local.read")) {
    const seenLocalFiles = new Set<string>();
    for (const localFilePath of input.localFilePaths ?? []) {
      if (seenLocalFiles.has(localFilePath)) continue;
      seenLocalFiles.add(localFilePath);
      const localReadObservation = addResult(
        "local.read",
        await registry.execute("local.read", {
          path: localFilePath,
          maxLines: DEFAULT_LOCAL_MANIFEST_READ_LINES * 2,
          maxBytes: DEFAULT_LOCAL_MANIFEST_READ_BYTES * 2,
        }, context),
        observations,
        observationEvents,
        failures,
      );
      if (localReadObservation) planningMemories.push(...collectLocalReadData(localReadObservation));
    }
  }

  if (input.includeWeb) {
    const webQueries = researchQueriesForAim(input);
    const webSearchObservations: AimcubToolObservation<WebSearchOutput>[] = [];
    const webFetchObservations: AimcubToolObservation<WebFetchOutput>[] = [];
    for (const webQuery of webQueries) {
      const searchResult = await registry.execute("web.search", {
        query: webQuery,
        limit: input.webSearchLimit ?? DEFAULT_WEB_SEARCH_LIMIT,
      }, context);
      const webSearchObservation = addResult(
        "web.search",
        searchResult,
        observations,
        observationEvents,
        failures,
      );
      if (webSearchObservation) {
        webSearchObservations.push(webSearchObservation);
        planningMemories.push(...collectWebSearchData(webSearchObservation));
      } else if (!searchResult.ok && (searchResult.error.code === "disabled" || searchResult.error.code === "permission_denied")) {
        break;
      }
    }
    if (webSearchObservations.length > 0) {
      const seenUrls = new Set<string>();
      const fetchUrls = webSearchObservations.flatMap((observation) => observation.data.results)
        .map((result) => result.url)
        .filter((url): url is string => {
          if (!url || seenUrls.has(url)) return false;
          seenUrls.add(url);
          return true;
        })
        .slice(0, input.webFetchLimit ?? DEFAULT_WEB_FETCH_LIMIT);
      if (input.fetchWebResults) {
        for (const url of fetchUrls) {
          const webFetchObservation = addResult(
            "web.fetch",
            await registry.execute("web.fetch", {
              url,
              maxBytes: 80_000,
              extractMode: "text",
            }, context),
            observations,
            observationEvents,
            failures,
          );
          if (webFetchObservation) {
            webFetchObservations.push(webFetchObservation);
            planningMemories.push(...collectWebFetchData(webFetchObservation));
          }
        }
      }
      research = buildResearchBrief({
        aim: input,
        queries: webQueries,
        searchObservations: webSearchObservations,
        fetchObservations: webFetchObservations,
        generatedAt: context.now().toISOString(),
      });
      if (research) {
        const observation = researchBriefObservation(research);
        observations.push(observation as AimcubToolObservation<unknown>);
        planningMemories.push(researchBriefToPlanningMemory(research));
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
    research,
  };
}
