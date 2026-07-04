import {
  collectPlanningToolContext,
  createAimcubToolRegistry,
  createContextAskUserHandler,
  createContextDistillHandler,
  createContextLinkedSourcesHandler,
  createLocalReadOnlyToolHandlers,
  createMemorySearchHandler,
  createMemoryWriteCandidateHandler,
  type ContextLinkedSource,
  type AimcubToolHandlerContext,
  type AimcubToolObservation,
  type ContextDistillOutput,
  type PlanningContextForAim,
  type PlanningToolFailure,
  type PlanningToolObservationEvent,
  type ResearchBrief,
} from "@core/llm";
import path from "node:path";

import type { DraftRequest } from "../shared/ipc";
import { aimStore, LOCAL_OWNER } from "./store";
import { resolveContextSourceConfig } from "./context-source-settings";
import { createDesktopWebResearchRuntime, resolveWebResearchConfig, webResearchDisabledBySettings } from "./web-research-settings";

export interface DesktopPlanningContext extends PlanningContextForAim {
  toolObservations: Array<AimcubToolObservation<unknown>>;
  toolObservationEvents: PlanningToolObservationEvent[];
  toolFailures: PlanningToolFailure[];
  toolDistillation: ContextDistillOutput | null;
  research: ResearchBrief | null;
  researchRequired: boolean;
}

function flagEnabled(value: string | undefined): boolean {
  return value === "1" || value?.toLowerCase() === "true" || value?.toLowerCase() === "yes";
}

function envFlag(name: string): boolean | null {
  const value = process.env[name];
  if (value === undefined || value.trim() === "") return null;
  return flagEnabled(value);
}

function webResearchEnabled(): boolean {
  return resolveWebResearchConfig().enabled;
}

function fetchWebResultsEnabled(): boolean {
  return resolveWebResearchConfig().fetchPages && resolveContextSourceConfig().research.deepResearch;
}

function writeContextCandidatesEnabled(): boolean {
  return flagEnabled(process.env.AIMCUB_WRITE_CONTEXT_CANDIDATES);
}

function localContextRoot(): string | undefined {
  const context = resolveContextSourceConfig();
  const root = context.local.resolvedWorkspaceRoot ?? commonAncestor(context.local.resolvedFilePaths);
  return context.local.enabled && root?.trim() ? root.trim() : undefined;
}

function localContextFiles(): string[] {
  const context = resolveContextSourceConfig();
  return context.local.enabled ? context.local.resolvedFilePaths : [];
}

function commonAncestor(paths: readonly string[]): string | undefined {
  const dirs = paths
    .filter((item) => item.trim().length > 0)
    .map((item) => path.resolve(path.dirname(item)));
  if (dirs.length === 0) return undefined;
  const [first, ...rest] = dirs.map((dir) => dir.split(path.sep).filter(Boolean));
  if (!first) return undefined;
  const parts: string[] = [];
  for (let index = 0; index < first.length; index += 1) {
    const part = first[index]!;
    if (rest.every((segments) => segments[index] === part)) {
      parts.push(part);
      continue;
    }
    break;
  }
  const prefix = path.isAbsolute(dirs[0]!) ? path.sep : "";
  return parts.length > 0 ? path.join(prefix, ...parts) : path.parse(dirs[0]!).root;
}

function onlineSourceKind(provider: string): ContextLinkedSource["kind"] {
  switch (provider) {
    case "notion":
    case "obsidian":
    case "database":
    case "url":
      return provider;
    case "google-drive":
      return "online_folder";
    case "supabase":
      return "database";
    default:
      return "other";
  }
}

function linkedContextSources(): ContextLinkedSource[] {
  const context = resolveContextSourceConfig();
  const sources: ContextLinkedSource[] = [];
  const root = localContextRoot();
  if (context.local.enabled && root) {
    sources.push({
      id: "local_workspace",
      kind: "local_folder",
      label: "Local workspace",
      enabled: true,
      status: "available",
      path: root,
    });
  }
  for (const filePath of localContextFiles()) {
    sources.push({
      id: `local_file:${filePath}`,
      kind: "local_file",
      label: path.basename(filePath),
      enabled: true,
      status: "available",
      path: filePath,
    });
  }
  if (context.online.enabled) {
    for (const source of context.online.sources) {
      sources.push({
        id: source.id,
        kind: onlineSourceKind(source.provider),
        label: source.label,
        enabled: source.enabled,
        status: source.provider === "url" ? "available" : "needs_connector",
        uri: source.reference,
        note: source.provider,
      });
    }
  }
  return sources;
}

function aimLikelyNeedsWeb(req: DraftRequest): boolean {
  const text = [req.title, req.description].filter(Boolean).join(" ").toLowerCase();
  return /\b(latest|current|today|recent|research|search|web|online|compare|market|competitor|pricing|docs|api|regulation|law|policy|guideline|app store|play store|apple developer|developer account|store review|distribution|travel|visa|flight|hotel|tarot|astrology|wellness|health|finance|education|coaching)\b/i.test(text)
    || /最新|当前|现在|近期|调研|搜索|联网|网页|在线|对比|市场|竞品|价格|文档|api|法规|法律|政策|指南|应用商店|苹果开发者|开发者账号|上架|审核|分发|旅行|旅游|签证|机票|航班|酒店|塔罗|占星|疗愈|健康|财务|教育|学习|教练|咨询/.test(text);
}

function aimRequiresWebResearch(req: DraftRequest): boolean {
  const context = resolveContextSourceConfig();
  return envFlag("AIMCUB_ENABLE_WEB_RESEARCH") === true || (context.research.webEnabled && (context.research.deepResearch || aimLikelyNeedsWeb(req)));
}

function shouldAttemptWebResearch(req: DraftRequest): boolean {
  const resolved = resolveWebResearchConfig();
  const context = resolveContextSourceConfig();
  const explicit = envFlag("AIMCUB_ENABLE_WEB_RESEARCH");
  if (explicit === false) return false;
  if (!context.research.webEnabled && explicit !== true) return false;
  if (explicit !== true && webResearchDisabledBySettings()) return false;
  return explicit === true || Boolean(resolved.apiKey) || aimLikelyNeedsWeb(req);
}

export function createDesktopFirstPartyToolRegistry() {
  const webRuntime = createDesktopWebResearchRuntime();
  const localRoot = localContextRoot();
  return createAimcubToolRegistry({
    ...(localRoot ? createLocalReadOnlyToolHandlers({ workspaceRoot: localRoot }) : {}),
    "memory.search": createMemorySearchHandler(aimStore),
    "memory.write_candidate": createMemoryWriteCandidateHandler(aimStore),
    "context.linked_sources": createContextLinkedSourcesHandler(),
    "context.ask_user": createContextAskUserHandler(),
    "context.distill": createContextDistillHandler(),
    "web.search": webRuntime.search,
    "web.fetch": webRuntime.fetch,
  });
}

export function desktopToolContext(networkEnabled = webResearchEnabled()): AimcubToolHandlerContext {
  const localRoot = localContextRoot();
  return {
    ownerId: LOCAL_OWNER,
    workspaceRoot: localRoot,
    now: () => new Date(),
    permissions: [
      "memory.read",
      "context.source",
      "user.ask",
      "context.distill",
      ...(localRoot ? ["filesystem.read" as const, "filesystem.search" as const] : []),
      ...(writeContextCandidatesEnabled() ? ["memory.write_candidate" as const] : []),
      ...(networkEnabled ? ["network.search" as const, "network.fetch" as const] : []),
    ],
  };
}

export async function collectDesktopPlanningContext(req: DraftRequest): Promise<DesktopPlanningContext> {
  const currentAimId = (req as { id?: unknown }).id;
  const localRoot = localContextRoot();
  const localFiles = localContextFiles();
  const linkedSources = linkedContextSources();
  const contextConfig = resolveContextSourceConfig();
  const attemptWeb = shouldAttemptWebResearch(req);
  const researchRequired = aimRequiresWebResearch(req);
  const [sourceMemories, toolContext] = await Promise.all([
    aimStore.listMemories(),
    collectPlanningToolContext(
      createDesktopFirstPartyToolRegistry(),
      desktopToolContext(attemptWeb),
      {
        title: req.title,
        description: req.description,
        currentAimId: typeof currentAimId === "string" ? currentAimId : undefined,
        includeWeb: attemptWeb,
        fetchWebResults: attemptWeb && fetchWebResultsEnabled(),
        webQueryLimit: contextConfig.research.deepResearch ? 4 : 2,
        webFetchLimit: contextConfig.research.deepResearch ? 5 : 2,
        includeLocal: Boolean(localRoot),
        workspaceRoot: localRoot,
        localFilePaths: localFiles,
        linkedSources,
        askMissingQuestions: true,
        writeDistilledMemoryCandidates: writeContextCandidatesEnabled(),
      },
    ),
  ]);

  return {
    memories: toolContext.memories,
    report: toolContext.report,
    sourceMemories,
    toolObservations: toolContext.observations,
    toolObservationEvents: toolContext.observationEvents,
    toolFailures: toolContext.failures,
    toolDistillation: toolContext.distillation,
    research: toolContext.research,
    researchRequired,
  };
}
