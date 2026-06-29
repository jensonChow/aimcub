/**
 * Desktop persistence = the shared `@core/store` (one JSON store under ~/.aimcub that the
 * CLI also reads), plus a sibling settings.json for the LLM provider config. No Electron
 * userData path and no business logic here anymore — the store lives in `@core/store` so
 * the desktop app and the CLI are two faces over one local store.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { DEFAULT_OWNER, createJsonFileStore, defaultDataDir, type AimStore } from "@core/store";

import type { ProviderConfig } from "../shared/ipc";

/** Fixed local owner for the single-user local app. */
export const LOCAL_OWNER = DEFAULT_OWNER;

/** The shared aim store (aims/milestones/memories), rooted at ~/.aimcub (or $AIMCUB_HOME). */
export const aimStore: AimStore = createJsonFileStore(defaultDataDir());

function settingsPath(): string {
  return join(defaultDataDir(), "settings.json");
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
  mkdirSync(defaultDataDir(), { recursive: true });
  writeFileSync(p, JSON.stringify(config, null, 2), "utf8");
}
