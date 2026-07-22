import { dialog } from "electron";

import type { ContextSourceSettings } from "@aimcub/store";
import type { ContextSourceConfig, ContextSourceStatus, LocalContextPickResult } from "../shared/ipc";
import { loadContextSourceSettings, saveContextSourceSettings } from "./store";

let current: ContextSourceSettings | null = null;

function flagEnabled(value: string | undefined): boolean {
  return value === "1" || value?.toLowerCase() === "true" || value?.toLowerCase() === "yes";
}

function cleanPath(value: string | undefined): string | undefined {
  return value?.trim() ? value.trim() : undefined;
}

function envWorkspaceRoot(): string | undefined {
  return cleanPath(process.env.AIMCUB_LOCAL_CONTEXT_ROOT ?? process.env.AIMCUB_WORKSPACE_ROOT);
}

function envLocalFiles(): string[] {
  const raw = process.env.AIMCUB_LOCAL_CONTEXT_FILES;
  if (!raw?.trim()) return [];
  const seen = new Set<string>();
  const paths: string[] = [];
  for (const item of raw.split(/[\n,;]+/)) {
    const path = item.trim();
    if (!path || seen.has(path)) continue;
    seen.add(path);
    paths.push(path);
  }
  return paths;
}

function saved(): ContextSourceSettings {
  if (!current) current = loadContextSourceSettings();
  return current;
}

export function loadContextSourceConfig(): void {
  current = loadContextSourceSettings();
}

export function resolveContextSourceConfig(): ContextSourceStatus {
  const stored = saved();
  const envRoot = envWorkspaceRoot();
  const envFiles = envLocalFiles();
  const settingsRoot = cleanPath(stored.local.workspaceRoot);
  const resolvedWorkspaceRoot = envRoot ?? settingsRoot ?? null;
  const resolvedFilePaths = envFiles.length > 0 ? envFiles : stored.local.filePaths;
  const localEnabled = stored.local.enabled || Boolean(envRoot || envFiles.length > 0);
  const envConfigured = Boolean(envRoot || envFiles.length > 0);
  const source = envConfigured ? "env" : (settingsRoot || stored.local.filePaths.length > 0 ? "settings" : null);
  return {
    ...stored,
    local: {
      ...stored.local,
      enabled: localEnabled,
      configured: Boolean(localEnabled && (resolvedWorkspaceRoot || resolvedFilePaths.length > 0)),
      source,
      resolvedWorkspaceRoot,
      resolvedFilePaths,
    },
    online: {
      ...stored.online,
      configuredCount: stored.online.sources.length,
      enabledCount: stored.online.sources.filter((item) => item.enabled).length,
    },
    research: {
      ...stored.research,
      webEnabled: envFlag("AIMCUB_ENABLE_WEB_RESEARCH") ?? stored.research.webEnabled,
    },
  };
}

export function getContextSourceConfig(): ContextSourceStatus {
  return resolveContextSourceConfig();
}

function envFlag(name: string): boolean | null {
  const value = process.env[name];
  if (value === undefined || value.trim() === "") return null;
  return flagEnabled(value);
}

export function setContextSourceConfig(input: ContextSourceConfig): ContextSourceStatus {
  current = saveContextSourceSettings(input);
  return resolveContextSourceConfig();
}

export async function pickLocalContextFolder(): Promise<LocalContextPickResult> {
  const result = await dialog.showOpenDialog({
    properties: ["openDirectory", "createDirectory"],
  });
  return { canceled: result.canceled, paths: result.filePaths };
}

export async function pickLocalContextFiles(): Promise<LocalContextPickResult> {
  const result = await dialog.showOpenDialog({
    properties: ["openFile", "multiSelections"],
  });
  return { canceled: result.canceled, paths: result.filePaths };
}
