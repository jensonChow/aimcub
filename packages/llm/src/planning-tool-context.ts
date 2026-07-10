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

export type ResearchLaneId =
  | "aim_facts"
  | "authoritative_requirements"
  | "alternatives_market"
  | "risks_tradeoffs"
  | "user_audience";

export type ResearchSourceAuthority = "primary" | "secondary" | "unknown";
export type ResearchSourceFreshness = "current" | "dated" | "unknown";
export type ResearchSufficiencyLevel = "thin" | "useful" | "strong";

export interface ResearchQueryPlanItem {
  id: string;
  lanes: ResearchLaneId[];
  query: string;
  purpose: string;
  required: boolean;
}

export interface ResearchLaneCoverage {
  lane: ResearchLaneId;
  required: boolean;
  queryCount: number;
  searchResultCount: number;
  sourceCount: number;
  fetchedSourceCount: number;
  uniqueDomainCount: number;
  covered: boolean;
}

export interface ResearchConflictSignal {
  kind: "requirement" | "availability" | "direction";
  summary: string;
  sourceUrls: string[];
}

export interface ResearchCoverageReport {
  lanes: ResearchLaneCoverage[];
  requiredLaneCount: number;
  coveredLaneCount: number;
  uniqueDomainCount: number;
  primarySourceCount: number;
  secondarySourceCount: number;
  currentSourceCount: number;
  datedSourceCount: number;
  unknownFreshnessCount: number;
  timeSensitive: boolean;
  conflicts: ResearchConflictSignal[];
  gaps: string[];
}

export interface ResearchSufficiencySignal {
  level: ResearchSufficiencyLevel;
  score: number;
  sufficient: boolean;
  reasons: string[];
}

export interface ResearchBriefSource {
  title: string;
  url: string;
  domain: string;
  lanes: ResearchLaneId[];
  authority: ResearchSourceAuthority;
  freshness: ResearchSourceFreshness;
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
  queryPlan: ResearchQueryPlanItem[];
  findings: string[];
  uncertainties: string[];
  conflicts: ResearchConflictSignal[];
  coverage: ResearchCoverageReport;
  sufficiency: ResearchSufficiencySignal;
  sources: ResearchBriefSource[];
  generatedAt: string;
  searchResultCount: number;
  fetchedSourceCount: number;
}

const DEFAULT_CONTEXT_LIMIT = 12;
const DEFAULT_WEB_SEARCH_LIMIT = 3;
const DEFAULT_WEB_QUERY_LIMIT = 4;
const HARD_WEB_QUERY_LIMIT = 8;
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

function hasCjk(value: string): boolean {
  return /[\u3400-\u9fff]/.test(value);
}

function audienceEvidenceRelevant(value: string): boolean {
  return /\b(app|product|service|consumer|customer|user|audience|market|launch|onboarding|subscription|community|content|creator|game|travel|health|wellness|education|learning|coaching|finance|legal|tarot|astrology)\b/i.test(value) ||
    /应用|产品|服务|消费者|客户|用户|受众|市场|上线|发布|引导|订阅|社区|内容|创作|游戏|旅行|旅游|健康|疗愈|教育|学习|教练|咨询|财务|法律|塔罗|占星/.test(value);
}

function normalizeQueryPlanLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) return DEFAULT_WEB_QUERY_LIMIT;
  return Math.max(1, Math.min(HARD_WEB_QUERY_LIMIT, Math.floor(limit)));
}

function uniqueQueryPlan(rows: readonly ResearchQueryPlanItem[]): ResearchQueryPlanItem[] {
  const seen = new Set<string>();
  const out: ResearchQueryPlanItem[] = [];
  for (const row of rows) {
    const query = compactText(row.query, 220);
    const key = query.toLowerCase();
    if (!query || seen.has(key)) continue;
    seen.add(key);
    out.push({ ...row, query });
  }
  return out;
}

export function buildResearchQueryPlan(input: PlanningToolContextInput): ResearchQueryPlanItem[] {
  const title = compactText(input.title, 120);
  const description = compactText(input.description ?? "", 160);
  const base = compactText([title, description].filter(Boolean).join(" "), 180);
  const fullText = `${title} ${description}`;
  const chinese = hasCjk(fullText);
  const audienceRelevant = audienceEvidenceRelevant(fullText);
  const rows: ResearchQueryPlanItem[] = chinese
    ? [
        {
          id: "aim-facts",
          lanes: audienceRelevant ? ["aim_facts", "user_audience"] : ["aim_facts"],
          query: `${base} 现状 关键事实${audienceRelevant ? " 目标用户 需求 反馈 证据" : ""}`,
          purpose: "Establish the current situation and evidence that grounds the aim.",
          required: true,
        },
        {
          id: "authoritative-requirements",
          lanes: ["authoritative_requirements"],
          query: `${title} 最新 官方 要求 法规 标准 文档`,
          purpose: "Find primary or official requirements, standards, and current constraints.",
          required: true,
        },
        {
          id: "alternatives-market",
          lanes: ["alternatives_market"],
          query: `${title} 替代方案 竞品 市场 对比 差异`,
          purpose: "Compare realistic alternatives, market patterns, and competing approaches.",
          required: true,
        },
        {
          id: "risks-tradeoffs",
          lanes: ["risks_tradeoffs"],
          query: `${title} 风险 成本 限制 取舍 失败案例`,
          purpose: "Surface risks, costs, limitations, tradeoffs, and failure modes.",
          required: true,
        },
      ]
    : [
        {
          id: "aim-facts",
          lanes: audienceRelevant ? ["aim_facts", "user_audience"] : ["aim_facts"],
          query: `${base} current state key facts${audienceRelevant ? " target users needs reviews evidence" : ""}`,
          purpose: "Establish the current situation and evidence that grounds the aim.",
          required: true,
        },
        {
          id: "authoritative-requirements",
          lanes: ["authoritative_requirements"],
          query: `${title} current official requirements regulations standards documentation`,
          purpose: "Find primary or official requirements, standards, and current constraints.",
          required: true,
        },
        {
          id: "alternatives-market",
          lanes: ["alternatives_market"],
          query: `${title} alternatives competitors market comparison differences`,
          purpose: "Compare realistic alternatives, market patterns, and competing approaches.",
          required: true,
        },
        {
          id: "risks-tradeoffs",
          lanes: ["risks_tradeoffs"],
          query: `${title} risks costs limitations tradeoffs failure cases`,
          purpose: "Surface risks, costs, limitations, tradeoffs, and failure modes.",
          required: true,
        },
      ];
  return uniqueQueryPlan(rows).slice(0, normalizeQueryPlanLimit(input.webQueryLimit));
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

interface ResearchSearchObservation {
  plan: ResearchQueryPlanItem;
  observation: AimcubToolObservation<WebSearchOutput>;
}

interface ResearchFetchTarget {
  url: string;
  title: string;
  lanes: ResearchLaneId[];
  domain: string;
  authority: ResearchSourceAuthority;
  order: number;
}

interface ResearchFetchObservation {
  target: ResearchFetchTarget;
  observation: AimcubToolObservation<WebFetchOutput>;
}

function domainForUrl(value: string): string {
  try {
    return new URL(value).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

function uniqueLanes(values: readonly ResearchLaneId[]): ResearchLaneId[] {
  return [...new Set(values)];
}

function authorityRank(value: ResearchSourceAuthority): number {
  return value === "primary" ? 2 : value === "secondary" ? 1 : 0;
}

function strongerAuthority(
  left: ResearchSourceAuthority,
  right: ResearchSourceAuthority,
): ResearchSourceAuthority {
  return authorityRank(left) >= authorityRank(right) ? left : right;
}

function sourceAuthority(input: {
  url: string;
  title?: string;
  source?: string;
}): ResearchSourceAuthority {
  const domain = domainForUrl(input.url);
  if (!domain) return "unknown";
  const hostParts = domain.split(".");
  const metadata = `${input.title ?? ""} ${input.source ?? ""} ${domain}`;
  if (
    hostParts.includes("gov") ||
    hostParts.includes("edu") ||
    hostParts.includes("ac") ||
    /\b(official|government|ministry|regulator|standards? body|university|documentation)\b/i.test(metadata) ||
    /官方|政府|部委|监管|标准|大学|文档/.test(metadata)
  ) {
    return "primary";
  }
  return "secondary";
}

function sourceFreshness(publishedAt: string | undefined, generatedAt: string): ResearchSourceFreshness {
  const value = publishedAt?.trim();
  if (!value) return "unknown";
  const lower = value.toLowerCase();
  if (/\b(today|yesterday|\d+\s*(?:minute|hour|day|week|month)s?\s+ago)\b/.test(lower) || /今天|昨天|分钟前|小时前|天前|周前|月前/.test(value)) {
    return "current";
  }
  if (/\b\d+\s*years?\s+ago\b/.test(lower) || /年前/.test(value)) return "dated";
  const publishedMs = Date.parse(value);
  const generatedMs = Date.parse(generatedAt);
  if (!Number.isFinite(publishedMs) || !Number.isFinite(generatedMs)) return "unknown";
  const ageDays = Math.max(0, (generatedMs - publishedMs) / 86_400_000);
  return ageDays <= 400 ? "current" : "dated";
}

function freshnessRank(value: ResearchSourceFreshness): number {
  return value === "current" ? 2 : value === "dated" ? 1 : 0;
}

function fresherSource(
  left: ResearchSourceFreshness,
  right: ResearchSourceFreshness,
): ResearchSourceFreshness {
  return freshnessRank(left) >= freshnessRank(right) ? left : right;
}

function researchIsTimeSensitive(input: PlanningToolContextInput): boolean {
  const value = `${input.title} ${input.description ?? ""}`;
  return /\b(latest|current|recent|today|market|competitor|pricing|price|docs|documentation|api|regulation|law|legal|policy|guideline|travel|visa|flight|hotel|availability|release|version)\b/i.test(value) ||
    /最新|当前|现在|近期|市场|竞品|价格|文档|接口|法规|法律|政策|指南|旅行|旅游|签证|航班|酒店|可用性|发布|版本/.test(value);
}

function fetchTargetsForResearch(
  searchObservations: readonly ResearchSearchObservation[],
  limit: number,
): ResearchFetchTarget[] {
  if (limit <= 0) return [];
  const byUrl = new Map<string, ResearchFetchTarget>();
  let order = 0;
  for (const row of searchObservations) {
    for (const result of row.observation.data.results) {
      if (!result.url) continue;
      const existing = byUrl.get(result.url);
      const nextAuthority = sourceAuthority(result);
      if (existing) {
        existing.lanes = uniqueLanes([...existing.lanes, ...row.plan.lanes]);
        existing.authority = strongerAuthority(existing.authority, nextAuthority);
        continue;
      }
      byUrl.set(result.url, {
        url: result.url,
        title: result.title || result.url,
        lanes: [...row.plan.lanes],
        domain: domainForUrl(result.url),
        authority: nextAuthority,
        order: order++,
      });
    }
  }

  const candidates = [...byUrl.values()].sort((left, right) =>
    authorityRank(right.authority) - authorityRank(left.authority) || left.order - right.order,
  );
  const laneOrder = uniqueLanes(searchObservations.flatMap((row) => row.plan.lanes));
  const selected: ResearchFetchTarget[] = [];
  const selectedUrls = new Set<string>();
  const selectedDomains = new Set<string>();

  const fill = (requireNewDomain: boolean) => {
    let progressed = true;
    while (selected.length < limit && progressed) {
      progressed = false;
      for (const lane of laneOrder) {
        const candidate = candidates.find((item) =>
          !selectedUrls.has(item.url) &&
          item.lanes.includes(lane) &&
          (!requireNewDomain || !item.domain || !selectedDomains.has(item.domain)),
        );
        if (!candidate) continue;
        selected.push(candidate);
        selectedUrls.add(candidate.url);
        if (candidate.domain) selectedDomains.add(candidate.domain);
        progressed = true;
        if (selected.length >= limit) break;
      }
    }
  };

  fill(true);
  fill(false);
  return selected;
}

function mergeResearchSources(
  searchObservations: readonly ResearchSearchObservation[],
  fetchObservations: readonly ResearchFetchObservation[],
  generatedAt: string,
): ResearchBriefSource[] {
  const byUrl = new Map<string, ResearchBriefSource>();
  for (const row of searchObservations) {
    for (const result of webSearchData(row.observation).results) {
      if (!result.url) continue;
      const existing = byUrl.get(result.url);
      const authority = sourceAuthority(result);
      const freshness = sourceFreshness(result.publishedAt, generatedAt);
      byUrl.set(result.url, {
        title: result.title || existing?.title || result.url,
        url: result.url,
        domain: domainForUrl(result.url),
        lanes: uniqueLanes([...(existing?.lanes ?? []), ...row.plan.lanes]),
        authority: existing ? strongerAuthority(existing.authority, authority) : authority,
        freshness: existing ? fresherSource(existing.freshness, freshness) : freshness,
        snippet: result.snippet || existing?.snippet,
        source: result.source || existing?.source,
        publishedAt: result.publishedAt || existing?.publishedAt,
        fetched: existing?.fetched ?? false,
        status: existing?.status,
        textExcerpt: existing?.textExcerpt,
        truncated: existing?.truncated,
      });
    }
  }
  for (const row of fetchObservations) {
    const result = webFetchData(row.observation);
    const existing = byUrl.get(row.target.url) ?? byUrl.get(result.finalUrl);
    if (row.target.url !== result.finalUrl) byUrl.delete(row.target.url);
    const authority = sourceAuthority({ url: result.finalUrl, title: result.title || existing?.title });
    byUrl.set(result.finalUrl, {
      title: result.title || existing?.title || result.finalUrl,
      url: result.finalUrl,
      domain: domainForUrl(result.finalUrl),
      lanes: uniqueLanes([...(existing?.lanes ?? []), ...row.target.lanes]),
      authority: existing ? strongerAuthority(existing.authority, authority) : authority,
      freshness: existing?.freshness ?? "unknown",
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
  const tags = [...source.lanes, `authority=${source.authority}`, `freshness=${source.freshness}`].join(", ");
  return `[${tags}] ${source.title}: ${compactText(body, 320)} Source: ${source.url}`;
}

const CONFLICT_PATTERNS: Array<{
  kind: ResearchConflictSignal["kind"];
  positive: RegExp;
  negative: RegExp;
}> = [
  {
    kind: "requirement",
    positive: /\b(required|must|mandatory|shall)\b|必须|强制|务必/iu,
    negative: /\b(not required|no requirement|optional|voluntary)\b|无需|不需要|可选|自愿/iu,
  },
  {
    kind: "availability",
    positive: /\b(available|supported|allowed|permitted|eligible)\b|可用|支持|允许|符合资格/iu,
    negative: /\b(unavailable|unsupported|not allowed|prohibited|ineligible|discontinued)\b|不可用|不支持|禁止|不允许|不符合资格|停产/iu,
  },
  {
    kind: "direction",
    positive: /\b(increase|increased|rising|growth|grew)\b|上涨|增加|增长/iu,
    negative: /\b(decrease|decreased|declining|fell|drop)\b|下降|减少|下跌/iu,
  },
];

function detectResearchConflicts(sources: readonly ResearchBriefSource[]): ResearchConflictSignal[] {
  const conflicts: ResearchConflictSignal[] = [];
  for (const pattern of CONFLICT_PATTERNS) {
    const positive: ResearchBriefSource[] = [];
    const negative: ResearchBriefSource[] = [];
    for (const source of sources) {
      const text = `${source.title} ${source.textExcerpt ?? source.snippet ?? ""}`;
      const hasNegative = pattern.negative.test(text);
      if (hasNegative) negative.push(source);
      else if (pattern.positive.test(text)) positive.push(source);
    }
    if (positive.length === 0 || negative.length === 0) continue;
    const urls = [...new Set([...positive, ...negative].map((source) => source.url))];
    const domains = new Set([...positive, ...negative].map((source) => source.domain).filter(Boolean));
    if (domains.size < 2) continue;
    conflicts.push({
      kind: pattern.kind,
      summary: `Potentially conflicting ${pattern.kind} language appears across ${domains.size} independent domains.`,
      sourceUrls: urls,
    });
  }
  return conflicts;
}

function researchCoverage(input: {
  aim: PlanningToolContextInput;
  queryPlan: readonly ResearchQueryPlanItem[];
  searchObservations: readonly ResearchSearchObservation[];
  sources: readonly ResearchBriefSource[];
}): ResearchCoverageReport {
  const expectedQueryPlan = buildResearchQueryPlan({
    ...input.aim,
    webQueryLimit: HARD_WEB_QUERY_LIMIT,
  });
  const laneIds = uniqueLanes(expectedQueryPlan.flatMap((row) => row.lanes));
  const lanes = laneIds.map((lane): ResearchLaneCoverage => {
    const expectedPlans = expectedQueryPlan.filter((row) => row.lanes.includes(lane));
    const plans = input.queryPlan.filter((row) => row.lanes.includes(lane));
    const searchRows = input.searchObservations.filter((row) => row.plan.lanes.includes(lane));
    const laneSources = input.sources.filter((source) => source.lanes.includes(lane));
    const searchResultCount = searchRows.reduce((sum, row) => sum + row.observation.data.results.length, 0);
    return {
      lane,
      required: expectedPlans.some((row) => row.required),
      queryCount: plans.length,
      searchResultCount,
      sourceCount: laneSources.length,
      fetchedSourceCount: laneSources.filter((source) => source.fetched).length,
      uniqueDomainCount: new Set(laneSources.map((source) => source.domain).filter(Boolean)).size,
      covered: searchResultCount > 0,
    };
  });
  const conflicts = detectResearchConflicts(input.sources);
  const uniqueDomainCount = new Set(input.sources.map((source) => source.domain).filter(Boolean)).size;
  const primarySourceCount = input.sources.filter((source) => source.authority === "primary").length;
  const secondarySourceCount = input.sources.filter((source) => source.authority === "secondary").length;
  const currentSourceCount = input.sources.filter((source) => source.freshness === "current").length;
  const datedSourceCount = input.sources.filter((source) => source.freshness === "dated").length;
  const unknownFreshnessCount = input.sources.filter((source) => source.freshness === "unknown").length;
  const requiredLanes = lanes.filter((lane) => lane.required);
  const timeSensitive = researchIsTimeSensitive(input.aim);
  const gaps: string[] = [];
  for (const lane of requiredLanes.filter((row) => !row.covered)) {
    gaps.push(`No search results covered required research lane: ${lane.lane}.`);
  }
  if (uniqueDomainCount < 3) gaps.push("Fewer than 3 independent web sources were available.");
  const fetchedSourceCount = input.sources.filter((source) => source.fetched).length;
  if (fetchedSourceCount === 0) {
    gaps.push("No source pages were fetched; findings rely on search snippets only.");
  } else if (fetchedSourceCount < 2) {
    gaps.push("Only 1 source page was fetched; cross-source verification remains thin.");
  }
  if (primarySourceCount === 0) gaps.push("No primary or clearly official source was identified.");
  if (timeSensitive && currentSourceCount === 0) {
    gaps.push("Freshness could not be established for this time-sensitive aim.");
  }
  for (const conflict of conflicts) gaps.push(conflict.summary);
  return {
    lanes,
    requiredLaneCount: requiredLanes.length,
    coveredLaneCount: requiredLanes.filter((lane) => lane.covered).length,
    uniqueDomainCount,
    primarySourceCount,
    secondarySourceCount,
    currentSourceCount,
    datedSourceCount,
    unknownFreshnessCount,
    timeSensitive,
    conflicts,
    gaps: [...new Set(gaps)],
  };
}

function researchSufficiency(
  coverage: ResearchCoverageReport,
  fetchedSourceCount: number,
): ResearchSufficiencySignal {
  const laneRatio = coverage.requiredLaneCount > 0
    ? coverage.coveredLaneCount / coverage.requiredLaneCount
    : 1;
  const score = Math.max(0, Math.min(100, Math.round(
    laneRatio * 40 +
    Math.min(15, coverage.uniqueDomainCount * 5) +
    Math.min(15, fetchedSourceCount * 7.5) +
    (coverage.primarySourceCount > 0 ? 15 : 0) +
    (coverage.timeSensitive ? (coverage.currentSourceCount > 0 ? 10 : 0) : 10) +
    (coverage.conflicts.length === 0 ? 5 : 0),
  )));
  const sufficient = coverage.gaps.length === 0 && score >= 80;
  const level: ResearchSufficiencyLevel = sufficient
    ? "strong"
    : score >= 55
      ? "useful"
      : "thin";
  return {
    level,
    score,
    sufficient,
    reasons: coverage.gaps.length > 0
      ? [...coverage.gaps]
      : [`Covered ${coverage.coveredLaneCount}/${coverage.requiredLaneCount} required lanes across ${coverage.uniqueDomainCount} independent domains.`],
  };
}

function buildResearchBrief(input: {
  aim: PlanningToolContextInput;
  queryPlan: readonly ResearchQueryPlanItem[];
  searchObservations: readonly ResearchSearchObservation[];
  fetchObservations: readonly ResearchFetchObservation[];
  generatedAt: string;
}): ResearchBrief | null {
  const sources = mergeResearchSources(input.searchObservations, input.fetchObservations, input.generatedAt);
  if (sources.length === 0) return null;
  const fetchedSourceCount = sources.filter((source) => source.fetched).length;
  const searchResultCount = input.searchObservations.reduce((sum, row) => sum + row.observation.data.results.length, 0);
  const coverage = researchCoverage({
    aim: input.aim,
    queryPlan: input.queryPlan,
    searchObservations: input.searchObservations,
    sources,
  });
  const sufficiency = researchSufficiency(coverage, fetchedSourceCount);
  const uncertainties = [...coverage.gaps];
  if (sources.some((source) => source.truncated)) uncertainties.push("Some fetched pages were truncated by runtime bounds.");
  return {
    question: queryForAim(input.aim),
    queries: input.queryPlan.map((row) => row.query),
    queryPlan: input.queryPlan.map((row) => ({ ...row, lanes: [...row.lanes] })),
    findings: sources.slice(0, 8).map(renderFinding),
    uncertainties: [...new Set(uncertainties)],
    conflicts: coverage.conflicts,
    coverage,
    sufficiency,
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
    `Coverage: ${brief.coverage.coveredLaneCount}/${brief.coverage.requiredLaneCount} required lanes across ${brief.coverage.uniqueDomainCount} independent domains.`,
    `Authority: ${brief.coverage.primarySourceCount} primary, ${brief.coverage.secondarySourceCount} secondary.`,
    `Freshness: ${brief.coverage.currentSourceCount} current, ${brief.coverage.datedSourceCount} dated, ${brief.coverage.unknownFreshnessCount} unknown.`,
    `Research sufficiency: ${brief.sufficiency.level} (${brief.sufficiency.score}/100, sufficient=${brief.sufficiency.sufficient ? "yes" : "no"}).`,
    "Findings:",
    ...brief.findings.map((finding) => `- ${finding}`),
  ];
  if (brief.conflicts.length > 0) {
    lines.push("Potential conflicts:");
    lines.push(...brief.conflicts.map((conflict) => `- ${conflict.summary} Sources: ${conflict.sourceUrls.join(" | ")}`));
  }
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
    const queryPlan = buildResearchQueryPlan(input);
    const webSearchObservations: ResearchSearchObservation[] = [];
    const webFetchObservations: ResearchFetchObservation[] = [];
    for (const plan of queryPlan) {
      const searchResult = await registry.execute("web.search", {
        query: plan.query,
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
        webSearchObservations.push({ plan, observation: webSearchObservation });
        planningMemories.push(...collectWebSearchData(webSearchObservation));
      } else if (!searchResult.ok && (
        searchResult.error.code === "disabled" ||
        searchResult.error.code === "permission_denied" ||
        searchResult.error.code === "unavailable"
      )) {
        break;
      }
    }
    if (webSearchObservations.length > 0) {
      const requestedFetchLimit = input.webFetchLimit ?? DEFAULT_WEB_FETCH_LIMIT;
      const fetchLimit = Number.isFinite(requestedFetchLimit)
        ? Math.max(0, Math.floor(requestedFetchLimit))
        : DEFAULT_WEB_FETCH_LIMIT;
      const fetchTargets = fetchTargetsForResearch(webSearchObservations, fetchLimit);
      if (input.fetchWebResults) {
        for (const target of fetchTargets) {
          const webFetchObservation = addResult(
            "web.fetch",
            await registry.execute("web.fetch", {
              url: target.url,
              maxBytes: 80_000,
              extractMode: "text",
            }, context),
            observations,
            observationEvents,
            failures,
          );
          if (webFetchObservation) {
            webFetchObservations.push({ target, observation: webFetchObservation });
            planningMemories.push(...collectWebFetchData(webFetchObservation));
          }
        }
      }
      research = buildResearchBrief({
        aim: input,
        queryPlan,
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
