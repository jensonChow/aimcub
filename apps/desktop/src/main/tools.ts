import {
  collectPlanningToolContext,
  createAimcubToolRegistry,
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
} from "@core/llm";

import type { DraftRequest } from "../shared/ipc";
import { aimStore, LOCAL_OWNER } from "./store";

export interface DesktopPlanningContext extends PlanningContextForAim {
  toolObservations: Array<AimcubToolObservation<unknown>>;
  toolObservationEvents: PlanningToolObservationEvent[];
  toolFailures: PlanningToolFailure[];
  toolDistillation: ContextDistillOutput | null;
}

function flagEnabled(value: string | undefined): boolean {
  return value === "1" || value?.toLowerCase() === "true" || value?.toLowerCase() === "yes";
}

function webResearchEnabled(): boolean {
  return flagEnabled(process.env.AIMCUB_ENABLE_WEB_RESEARCH);
}

function fetchWebResultsEnabled(): boolean {
  return flagEnabled(process.env.AIMCUB_FETCH_WEB_RESULTS);
}

function writeContextCandidatesEnabled(): boolean {
  return flagEnabled(process.env.AIMCUB_WRITE_CONTEXT_CANDIDATES);
}

function localContextRoot(): string | undefined {
  const root = process.env.AIMCUB_LOCAL_CONTEXT_ROOT ?? process.env.AIMCUB_WORKSPACE_ROOT;
  return root?.trim() ? root.trim() : undefined;
}

export function createDesktopFirstPartyToolRegistry() {
  const webRuntime = createWebResearchRuntimeFromEnv(process.env);
  const localRoot = localContextRoot();
  return createAimcubToolRegistry({
    ...(localRoot ? createLocalReadOnlyToolHandlers({ workspaceRoot: localRoot }) : {}),
    "memory.search": createMemorySearchHandler(aimStore),
    "memory.write_candidate": createMemoryWriteCandidateHandler(aimStore),
    "context.distill": createContextDistillHandler(),
    "web.search": webRuntime.search,
    "web.fetch": webRuntime.fetch,
  });
}

export function desktopToolContext(): AimcubToolHandlerContext {
  const localRoot = localContextRoot();
  return {
    ownerId: LOCAL_OWNER,
    workspaceRoot: localRoot,
    now: () => new Date(),
    permissions: [
      "memory.read",
      "context.distill",
      ...(localRoot ? ["filesystem.read" as const, "filesystem.search" as const] : []),
      ...(writeContextCandidatesEnabled() ? ["memory.write_candidate" as const] : []),
      ...(webResearchEnabled() ? ["network.search" as const, "network.fetch" as const] : []),
    ],
  };
}

export async function collectDesktopPlanningContext(req: DraftRequest): Promise<DesktopPlanningContext> {
  const currentAimId = (req as { id?: unknown }).id;
  const localRoot = localContextRoot();
  const [sourceMemories, toolContext] = await Promise.all([
    aimStore.listMemories(),
    collectPlanningToolContext(
      createDesktopFirstPartyToolRegistry(),
      desktopToolContext(),
      {
        title: req.title,
        description: req.description,
        currentAimId: typeof currentAimId === "string" ? currentAimId : undefined,
        includeWeb: webResearchEnabled(),
        fetchWebResults: fetchWebResultsEnabled(),
        includeLocal: Boolean(localRoot),
        workspaceRoot: localRoot,
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
  };
}
