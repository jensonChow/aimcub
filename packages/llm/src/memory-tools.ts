import type { ContextCategory, Memory, MemoryKind } from "@aimcub/types";

import {
  selectPlanningMemoriesWithTrace,
  type PlanningMemory,
} from "./planning-context";
import type {
  AimcubToolHandler,
  AimcubToolResult,
  MemorySearchInput,
  MemorySearchOutput,
  MemoryWriteCandidateInput,
  MemoryWriteCandidateOutput,
} from "./tool-contract";

export interface MemorySearchStore {
  listMemories(goalId?: string | null): Promise<Memory[]>;
}

export interface MemoryWriteCandidateStore {
  addMemoryCandidate(input: {
    goalId?: string | null;
    content: string;
    kind?: MemoryKind;
    category?: ContextCategory;
    source?: Memory["source"];
    confidence?: number;
  }): Promise<Memory>;
}

export type MemoryToolStore = MemorySearchStore & Partial<MemoryWriteCandidateStore>;

const DEFAULT_MEMORY_LIMIT = 12;
const HARD_MEMORY_LIMIT = 50;

function fail<T>(
  code: "invalid_input" | "permission_denied" | "unavailable" | "io_error",
  message: string,
  retryable = false,
): AimcubToolResult<T> {
  return { ok: false, error: { code, message, retryable } };
}

function normalizeLimit(limit: number | undefined): number {
  if (limit === undefined) return DEFAULT_MEMORY_LIMIT;
  if (!Number.isInteger(limit) || limit < 1) return DEFAULT_MEMORY_LIMIT;
  return Math.min(limit, HARD_MEMORY_LIMIT);
}

function memoryGoalId(memory: Pick<Memory, "goal_id"> | PlanningMemory): string | null {
  return ("goal_id" in memory ? memory.goal_id : memory.goalId) ?? null;
}

function outputScope(goalId: string | null, currentAimId?: string): MemorySearchOutput["memories"][number]["scope"] {
  if (!goalId) return "global";
  return currentAimId && goalId === currentAimId ? "current_aim" : "related_aim";
}

function filterByScope(memories: Memory[], scope: MemorySearchInput["scope"] | undefined, aimId?: string): Memory[] {
  switch (scope ?? "both") {
    case "global":
      return memories.filter((memory) => !memory.goal_id);
    case "current_aim":
      return aimId ? memories.filter((memory) => memory.goal_id === aimId) : [];
    case "both":
      return memories;
  }
}

function toPlanningMemory(memory: Memory): PlanningMemory {
  return {
    id: memory.id,
    memoryId: memory.id,
    content: memory.content,
    kind: memory.kind,
    category: memory.category,
    source: memory.source,
    confidence: memory.confidence,
    goalId: memory.goal_id,
    goal_id: memory.goal_id,
  };
}

function toMemorySearchOutput(memory: PlanningMemory, currentAimId?: string): MemorySearchOutput["memories"][number] {
  const goalId = memoryGoalId(memory);
  return {
    id: memory.memoryId ?? memory.id ?? "",
    content: memory.content,
    category: String(memory.category ?? "project_fact"),
    kind: String(memory.kind ?? "semantic"),
    scope: outputScope(goalId, currentAimId),
    ...(goalId ? { goalId } : {}),
    ...(typeof memory.confidence === "number" ? { confidence: memory.confidence } : {}),
  };
}

function sourceObservedAt(contextNow: () => Date): string {
  try {
    return contextNow().toISOString();
  } catch {
    return new Date().toISOString();
  }
}

export function createMemorySearchHandler(store: MemorySearchStore): AimcubToolHandler<MemorySearchInput, MemorySearchOutput> {
  return async (input, context) => {
    if (!context.permissions.includes("memory.read")) {
      return fail("permission_denied", "memory.search requires the memory.read permission.");
    }
    const rawInput = input as Partial<MemorySearchInput> | null | undefined;
    if (!rawInput || typeof rawInput.query !== "string" || !rawInput.query.trim()) {
      return fail("invalid_input", "memory.search requires a non-empty query.");
    }

    try {
      const all = await store.listMemories(null);
      const scoped = filterByScope(all, rawInput.scope, rawInput.aimId).map(toPlanningMemory);
      const selection = selectPlanningMemoriesWithTrace({
        title: rawInput.query,
        currentGoalId: rawInput.aimId,
        limit: normalizeLimit(rawInput.limit),
        memories: scoped,
      });
      const memories = selection.memories.map((memory) => toMemorySearchOutput(memory, rawInput.aimId));
      const observedAt = sourceObservedAt(context.now);
      return {
        ok: true,
        observation: {
          summary: memories.length === 1 ? "Selected 1 planning memory." : `Selected ${memories.length} planning memories.`,
          data: { memories },
          sources: memories.map((memory) => ({
            kind: "memory",
            title: memory.category,
            uri: `memory:${memory.id}`,
            observedAt,
          })),
        },
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return fail("io_error", `memory.search failed: ${message}`, true);
    }
  };
}

export function createMemoryWriteCandidateHandler(
  store: MemoryWriteCandidateStore,
): AimcubToolHandler<MemoryWriteCandidateInput, MemoryWriteCandidateOutput> {
  return async (input, context) => {
    if (!context.permissions.includes("memory.write_candidate")) {
      return fail("permission_denied", "memory.write_candidate requires the memory.write_candidate permission.");
    }
    const rawInput = input as Partial<MemoryWriteCandidateInput> | null | undefined;
    if (!rawInput || typeof rawInput.content !== "string" || !rawInput.content.trim()) {
      return fail("invalid_input", "memory.write_candidate requires non-empty content.");
    }
    if (rawInput.scope === "current_aim" && !rawInput.aimId) {
      return fail("invalid_input", "memory.write_candidate current_aim scope requires aimId.");
    }

    try {
      const memory = await store.addMemoryCandidate({
        goalId: rawInput.scope === "current_aim" ? rawInput.aimId : null,
        content: rawInput.content,
        category: rawInput.category as ContextCategory | undefined,
        source: "agent_inferred",
        confidence: 0.7,
      });
      return {
        ok: true,
        observation: {
          summary: "Created a pending memory candidate.",
          data: { candidateId: memory.id, status: "pending" },
          sources: [{
            kind: "memory",
            title: memory.category,
            uri: `memory:${memory.id}`,
            observedAt: sourceObservedAt(context.now),
          }],
        },
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return fail("io_error", `memory.write_candidate failed: ${message}`, true);
    }
  };
}
