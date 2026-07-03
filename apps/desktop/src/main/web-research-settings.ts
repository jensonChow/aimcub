import {
  createWebResearchRuntime,
  type AimcubToolHandlerContext,
  type WebResearchRuntime,
} from "@core/llm";
import type { WebResearchSettings } from "@core/store";

import type { WebResearchConfig, WebResearchStatus, WebResearchTestResult } from "../shared/ipc";
import { loadWebResearchSettings, saveWebResearchSettings } from "./store";

const WEB_RESEARCH_TEST_QUERY = "Aimcub web research";

let current: WebResearchSettings | null = null;

function flagEnabled(value: string | undefined): boolean {
  return value === "1" || value?.toLowerCase() === "true" || value?.toLowerCase() === "yes";
}

function envFlag(name: string): boolean | null {
  const value = process.env[name];
  if (value === undefined || value.trim() === "") return null;
  return flagEnabled(value);
}

function envApiKey(): string {
  return (process.env.AIMCUB_BRAVE_SEARCH_API_KEY ?? process.env.BRAVE_SEARCH_API_KEY ?? "").trim();
}

function saved(): WebResearchSettings | null {
  if (current) return current;
  current = loadWebResearchSettings();
  return current;
}

export interface ResolvedWebResearchConfig {
  provider: "brave";
  apiKey: string;
  enabled: boolean;
  fetchPages: boolean;
  keySource: "env" | "settings" | null;
}

export function loadWebResearchConfig(): void {
  current = loadWebResearchSettings();
}

export function resolveWebResearchConfig(): ResolvedWebResearchConfig {
  const stored = saved();
  const envKey = envApiKey();
  const settingsKey = stored?.apiKey.trim() ?? "";
  const apiKey = envKey || settingsKey;
  const enabled = envFlag("AIMCUB_ENABLE_WEB_RESEARCH") ?? stored?.enabled ?? Boolean(apiKey);
  const fetchPages = envFlag("AIMCUB_FETCH_WEB_RESULTS") ?? stored?.fetchPages ?? enabled;
  return {
    provider: "brave",
    apiKey,
    enabled,
    fetchPages,
    keySource: envKey ? "env" : settingsKey ? "settings" : null,
  };
}

export function createDesktopWebResearchRuntime(): WebResearchRuntime {
  return createWebResearchRuntime({ braveApiKey: resolveWebResearchConfig().apiKey });
}

export function webResearchDisabledBySettings(): boolean {
  const stored = saved();
  return Boolean(stored && stored.enabled === false);
}

export function getWebResearchStatus(): WebResearchStatus {
  const resolved = resolveWebResearchConfig();
  return {
    configured: resolved.enabled && Boolean(resolved.apiKey),
    provider: "brave",
    enabled: resolved.enabled,
    fetchPages: resolved.fetchPages,
    hasApiKey: Boolean(resolved.apiKey),
    keySource: resolved.keySource,
  };
}

export function setWebResearchConfig(input: WebResearchConfig): WebResearchStatus {
  const existing = saved();
  const apiKey = input.apiKey.trim() || existing?.apiKey.trim() || "";
  current = {
    provider: "brave",
    apiKey,
    enabled: input.enabled,
    fetchPages: input.fetchPages,
  };
  saveWebResearchSettings(current);
  return getWebResearchStatus();
}

export async function testWebResearchConfig(input: WebResearchConfig): Promise<WebResearchTestResult> {
  const startedAt = Date.now();
  const apiKey = input.apiKey.trim() || saved()?.apiKey.trim() || envApiKey();
  const base: Omit<WebResearchTestResult, "ok" | "error"> = {
    provider: "brave",
    latencyMs: 0,
    resultCount: 0,
  };
  if (!apiKey) {
    return { ...base, ok: false, error: "Brave Search API key is required.", latencyMs: Date.now() - startedAt };
  }

  const runtime = createWebResearchRuntime({ braveApiKey: apiKey });
  const context: AimcubToolHandlerContext = {
    now: () => new Date(),
    permissions: ["network.search"],
  };
  const result = await runtime.search({ query: WEB_RESEARCH_TEST_QUERY, limit: 1 }, context);
  if (!result.ok) {
    return {
      ...base,
      ok: false,
      error: result.error.message,
      latencyMs: Date.now() - startedAt,
    };
  }
  return {
    ...base,
    ok: true,
    error: null,
    resultCount: result.observation.data.results.length,
    latencyMs: Date.now() - startedAt,
  };
}
