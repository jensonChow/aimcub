import type { LocalAgentModelOption } from "../types";

/**
 * The shared toolkit for writing a local agent adapter. Everything here is pure
 * and stream-shape agnostic, so a new runtime's parseLine can reuse it instead
 * of re-implementing JSON/usage/content coercion.
 */

export const DEFAULT_MODEL: LocalAgentModelOption = { id: "default", label: "Default" };
export const DEFAULT_PROBE_TIMEOUT_MS = 5_000;

export function safeJsonParse(line: string): unknown {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function stringifyValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (value == null) return "";
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function usageFromRecord(value: unknown): Record<string, number> | null {
  if (!isRecord(value)) return null;
  const usage: Record<string, number> = {};
  for (const [key, raw] of Object.entries(value)) {
    if (typeof raw === "number") usage[key] = raw;
  }
  return Object.keys(usage).length > 0 ? usage : null;
}

export function textFromContent(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (typeof item === "string") return item;
        if (isRecord(item) && typeof item.text === "string") return item.text;
        return "";
      })
      .join("");
  }
  if (isRecord(value) && typeof value.text === "string") return value.text;
  return "";
}
