import {
  collectPlanningToolContext,
  createAimcubToolRegistry,
  createContextAskUserHandler,
  createContextDistillHandler,
  createLocalReadOnlyToolHandlers,
  createMemorySearchHandler,
  createMemoryWriteCandidateHandler,
  createWebResearchRuntimeFromEnv,
  type AimcubToolHandlerContext,
  type AimcubToolObservation,
  type ContextDistillOutput,
  type PlanningContextForAim,
  type PlanningToolFailure,
  type PlanningToolObservationEvent,
  type ResearchBrief,
} from "@core/llm";

import type { DraftRequest } from "../shared/ipc";
import { aimStore, LOCAL_OWNER } from "./store";

export interface DesktopPlanningContext extends PlanningContextForAim {
  toolObservations: Array<AimcubToolObservation<unknown>>;
  toolObservationEvents: PlanningToolObservationEvent[];
  toolFailures: PlanningToolFailure[];
  toolDistillation: ContextDistillOutput | null;
  research: ResearchBrief | null;
}

function flagEnabled(value: string | undefined): boolean {
  return value === "1" || value?.toLowerCase() === "true" || value?.toLowerCase() === "yes";
}

function envFlag(name: string): boolean | null {
  const value = process.env[name];
  if (value === undefined || value.trim() === "") return null;
  return flagEnabled(value);
}

function hasWebSearchProvider(): boolean {
  return Boolean(process.env.AIMCUB_BRAVE_SEARCH_API_KEY ?? process.env.BRAVE_SEARCH_API_KEY);
}

function webResearchEnabled(): boolean {
  return envFlag("AIMCUB_ENABLE_WEB_RESEARCH") ?? hasWebSearchProvider();
}

function fetchWebResultsEnabled(): boolean {
  return envFlag("AIMCUB_FETCH_WEB_RESULTS") ?? webResearchEnabled();
}

function writeContextCandidatesEnabled(): boolean {
  return flagEnabled(process.env.AIMCUB_WRITE_CONTEXT_CANDIDATES);
}

function localContextRoot(): string | undefined {
  const root = process.env.AIMCUB_LOCAL_CONTEXT_ROOT ?? process.env.AIMCUB_WORKSPACE_ROOT;
  return root?.trim() ? root.trim() : undefined;
}

function aimLikelyNeedsWeb(req: DraftRequest): boolean {
  const text = [req.title, req.description].filter(Boolean).join(" ").toLowerCase();
  return /\b(latest|current|today|recent|research|search|web|online|compare|market|competitor|pricing|docs|api|regulation|law|travel|visa|flight|hotel)\b/i.test(text)
    || /最新|当前|现在|近期|调研|搜索|联网|网页|在线|对比|市场|竞品|价格|文档|api|法规|法律|旅行|旅游|签证|机票|航班|酒店/.test(text);
}

function shouldAttemptWebResearch(req: DraftRequest): boolean {
  const explicit = envFlag("AIMCUB_ENABLE_WEB_RESEARCH");
  if (explicit === false) return false;
  return explicit === true || hasWebSearchProvider() || aimLikelyNeedsWeb(req);
}

export function createDesktopFirstPartyToolRegistry() {
  const webRuntime = createWebResearchRuntimeFromEnv(process.env);
  const localRoot = localContextRoot();
  return createAimcubToolRegistry({
    ...(localRoot ? createLocalReadOnlyToolHandlers({ workspaceRoot: localRoot }) : {}),
    "memory.search": createMemorySearchHandler(aimStore),
    "memory.write_candidate": createMemoryWriteCandidateHandler(aimStore),
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
  const attemptWeb = shouldAttemptWebResearch(req);
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
        webFetchLimit: 3,
        includeLocal: Boolean(localRoot),
        workspaceRoot: localRoot,
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
  };
}
