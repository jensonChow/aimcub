/**
 * Local-first persistence: a single JSON file in the app's userData dir. No Supabase,
 * no network. Shapes reuse @core/types 1:1 so a later Supabase sync is transform-free.
 * A sibling settings.json holds the LLM provider config (GUI launches don't inherit shell env).
 */
import { app } from "electron";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import type { Goal, Memory, Milestone } from "@core/types";

import type { ProviderConfig } from "../shared/ipc";

/** Fixed local owner for the single-user desktop slice (matches the web demo owner). */
export const LOCAL_OWNER = "00000000-0000-4000-8000-000000000001";

export interface LocalStore {
  ownerId: string;
  goals: Goal[];
  milestonesByGoal: Record<string, Milestone[]>;
  memories: Memory[];
}

function dataPath(): string {
  return join(app.getPath("userData"), "aimcub-local.json");
}

function settingsPath(): string {
  return join(app.getPath("userData"), "settings.json");
}

function emptyStore(): LocalStore {
  return { ownerId: LOCAL_OWNER, goals: [], milestonesByGoal: {}, memories: [] };
}

export function loadStore(): LocalStore {
  try {
    const p = dataPath();
    if (!existsSync(p)) return emptyStore();
    const parsed = JSON.parse(readFileSync(p, "utf8")) as Partial<LocalStore>;
    return {
      ownerId: parsed.ownerId ?? LOCAL_OWNER,
      goals: parsed.goals ?? [],
      milestonesByGoal: parsed.milestonesByGoal ?? {},
      memories: parsed.memories ?? [],
    };
  } catch {
    return emptyStore();
  }
}

export function saveStore(store: LocalStore): void {
  const p = dataPath();
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(store, null, 2), "utf8");
}

/** Remove a goal and its materialized milestones + derived memories. */
export function deleteGoal(id: string): void {
  const store = loadStore();
  store.goals = store.goals.filter((g) => g.id !== id);
  delete store.milestonesByGoal[id];
  store.memories = store.memories.filter((m) => m.goal_id !== id);
  saveStore(store);
}

/**
 * Load the provider config from settings.json. Migrates the legacy `{ anthropicApiKey }`
 * shape (the key-only desktop slice) into the new multi-provider shape. Returns null when
 * nothing usable is on file.
 */
export function loadSettings(): ProviderConfig | null {
  try {
    const p = settingsPath();
    if (!existsSync(p)) return null;
    const s = JSON.parse(readFileSync(p, "utf8")) as Record<string, unknown>;

    // Legacy migration: an Anthropic-only key blob from the first desktop slice.
    if (typeof s.anthropicApiKey === "string" && s.anthropicApiKey.trim() && !s.provider) {
      return { provider: "anthropic", apiKey: s.anthropicApiKey.trim() };
    }

    const provider = s.provider;
    if (provider !== "anthropic" && provider !== "openai-compatible") return null;
    const apiKey = typeof s.apiKey === "string" ? s.apiKey : "";
    return {
      provider,
      apiKey,
      baseURL: typeof s.baseURL === "string" && s.baseURL.trim() ? s.baseURL.trim() : undefined,
      model: typeof s.model === "string" && s.model.trim() ? s.model.trim() : undefined,
    };
  } catch {
    return null;
  }
}

export function saveSettings(config: ProviderConfig): void {
  const p = settingsPath();
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(config, null, 2), "utf8");
}
