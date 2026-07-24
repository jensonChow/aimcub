/**
 * Desktop-only preferences (`desktop-settings.json`, beside the shared store).
 *
 * These are NOT in `@aimcub/store`'s settings family on purpose: provider / web-research / context
 * sources are shared with the CLI, while these describe how this app renders itself. Nothing here
 * is a secret and nothing here changes what a run may do — developer mode reveals debug surfaces,
 * it never widens a permission.
 */
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { defaultDataDir } from "@aimcub/store";

import type { DesktopPreferences } from "../shared/ipc";

export const DEFAULT_DESKTOP_PREFERENCES: DesktopPreferences = {
  developerMode: false,
  planningModel: null,
  planningBrain: null,
};

export function desktopPreferencesPath(dataDir: string = defaultDataDir()): string {
  return join(dataDir, "desktop-settings.json");
}

/** Unknown/partial/corrupt input degrades to the defaults — a preferences file is never fatal. */
export function normalizeDesktopPreferences(raw: unknown): DesktopPreferences {
  const record = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  return {
    developerMode: record.developerMode === true,
    planningModel: normalizePlanningModel(record.planningModel),
    planningBrain: typeof record.planningBrain === "string" && record.planningBrain.trim()
      ? record.planningBrain.trim()
      : null,
  };
}

function normalizePlanningModel(raw: unknown): DesktopPreferences["planningModel"] {
  if (typeof raw !== "object" || raw === null) return null;
  const record = raw as Record<string, unknown>;
  const agentId = typeof record.agentId === "string" ? record.agentId.trim() : "";
  const model = typeof record.model === "string" ? record.model.trim() : "";
  return agentId && model ? { agentId, model } : null;
}

let cached: DesktopPreferences | null = null;

export function loadDesktopPreferences(dataDir: string = defaultDataDir()): DesktopPreferences {
  if (cached) return cached;
  try {
    const path = desktopPreferencesPath(dataDir);
    cached = existsSync(path)
      ? normalizeDesktopPreferences(JSON.parse(readFileSync(path, "utf8")) as unknown)
      : { ...DEFAULT_DESKTOP_PREFERENCES };
  } catch {
    cached = { ...DEFAULT_DESKTOP_PREFERENCES };
  }
  return cached;
}

/** Written temp + rename so a crash mid-write cannot leave a half-file that reads as corrupt. */
export function saveDesktopPreferences(
  input: DesktopPreferences,
  dataDir: string = defaultDataDir(),
): DesktopPreferences {
  const normalized = normalizeDesktopPreferences(input);
  const path = desktopPreferencesPath(dataDir);
  const temp = `${path}.tmp`;
  writeFileSync(temp, `${JSON.stringify(normalized, null, 2)}\n`, { mode: 0o600 });
  renameSync(temp, path);
  cached = normalized;
  return normalized;
}

/** Test seam: drop the in-process cache so the next load re-reads the file. */
export function resetDesktopPreferencesCache(): void {
  cached = null;
}
