import {
  collectPlanningToolContext,
  createAimcubToolRegistry,
  createContextDistillHandler,
  createMemorySearchHandler,
  createMemoryWriteCandidateHandler,
  createWebResearchRuntimeFromEnv,
  type AimcubToolHandlerContext,
  type AimcubToolObservation,
  type ContextDistillOutput,
  type PlanningContextForAim,
  type PlanningToolFailure,
} from "@core/llm";

import type { DraftRequest } from "../shared/ipc";
import { aimStore, LOCAL_OWNER } from "./store";

export interface DesktopPlanningContext extends PlanningContextForAim {
  toolObservations: Array<AimcubToolObservation<unknown>>;
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

export function createDesktopFirstPartyToolRegistry() {
  const webRuntime = createWebResearchRuntimeFromEnv(process.env);
  return createAimcubToolRegistry({
    "memory.search": createMemorySearchHandler(aimStore),
    "memory.write_candidate": createMemoryWriteCandidateHandler(aimStore),
    "context.distill": createContextDistillHandler(),
    "web.search": webRuntime.search,
    "web.fetch": webRuntime.fetch,
  });
}

export function desktopToolContext(): AimcubToolHandlerContext {
  return {
    ownerId: LOCAL_OWNER,
    now: () => new Date(),
    permissions: [
      "memory.read",
      "context.distill",
      ...(webResearchEnabled() ? ["network.search" as const, "network.fetch" as const] : []),
    ],
  };
}

export async function collectDesktopPlanningContext(req: DraftRequest): Promise<DesktopPlanningContext> {
  const [sourceMemories, toolContext] = await Promise.all([
    aimStore.listMemories(),
    collectPlanningToolContext(
      createDesktopFirstPartyToolRegistry(),
      desktopToolContext(),
      {
        title: req.title,
        description: req.description,
        includeWeb: webResearchEnabled(),
        fetchWebResults: fetchWebResultsEnabled(),
      },
    ),
  ]);

  return {
    memories: toolContext.memories,
    report: toolContext.report,
    sourceMemories,
    toolObservations: toolContext.observations,
    toolFailures: toolContext.failures,
    toolDistillation: toolContext.distillation,
  };
}
