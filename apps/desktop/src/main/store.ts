/**
 * Local-first persistence: a single JSON file in the app's userData dir. No Supabase,
 * no network. Shapes reuse @core/types 1:1 so a later Supabase sync is transform-free.
 * A sibling settings.json holds the Anthropic API key (GUI launches don't inherit shell env).
 */
import { app } from "electron";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import type { Goal, Memory, Milestone } from "@core/types";

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

export function loadStoredKey(): string | null {
  try {
    const p = settingsPath();
    if (!existsSync(p)) return null;
    const s = JSON.parse(readFileSync(p, "utf8")) as { anthropicApiKey?: unknown };
    return typeof s.anthropicApiKey === "string" && s.anthropicApiKey.trim() ? s.anthropicApiKey : null;
  } catch {
    return null;
  }
}

export function saveStoredKey(key: string): void {
  writeFileSync(settingsPath(), JSON.stringify({ anthropicApiKey: key }, null, 2), "utf8");
}
