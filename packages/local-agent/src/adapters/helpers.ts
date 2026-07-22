import type { LocalAgentArtifact, LocalAgentArtifactKind, LocalAgentModelOption } from "../types";

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

/** The operation words runtimes use for a file change, mapped to the artifact vocabulary. */
const ARTIFACT_KIND_BY_WORD: Readonly<Record<string, LocalAgentArtifactKind>> = {
  add: "file_write",
  added: "file_write",
  create: "file_write",
  created: "file_write",
  write: "file_write",
  edit: "file_edit",
  modify: "file_edit",
  modified: "file_edit",
  update: "file_edit",
  updated: "file_edit",
  delete: "file_delete",
  deleted: "file_delete",
  remove: "file_delete",
  removed: "file_delete",
};

/** One runtime change word (`add` / `update` / `deleted` / ...) as an artifact kind. */
export function artifactKindFromWord(value: unknown): LocalAgentArtifactKind | null {
  if (typeof value !== "string") return null;
  return ARTIFACT_KIND_BY_WORD[value.trim().toLowerCase()] ?? null;
}

function artifactPath(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function pushArtifact(out: LocalAgentArtifact[], path: string | null, kind: LocalAgentArtifactKind): void {
  if (!path) return;
  if (out.some((artifact) => artifact.path === path && artifact.kind === kind)) return;
  out.push({ path, kind });
}

/**
 * File artifacts from a runtime's "changes" payload, in either shape runtimes use:
 * a list (`[{ path, kind }]`) or a map keyed by path (`{ "src/a.ts": { update: {...} } }`).
 * Entries without a usable path are skipped; an unrecognized operation word falls back to
 * `file_write` so a real file change is never dropped for want of a synonym.
 */
export function fileArtifactsFromChanges(value: unknown): LocalAgentArtifact[] {
  const artifacts: LocalAgentArtifact[] = [];
  if (Array.isArray(value)) {
    for (const entry of value) {
      if (typeof entry === "string") {
        pushArtifact(artifacts, artifactPath(entry), "file_write");
        continue;
      }
      if (!isRecord(entry)) continue;
      const path = artifactPath(entry.path ?? entry.file_path ?? entry.file ?? entry.filename);
      const kind = artifactKindFromWord(entry.kind ?? entry.type ?? entry.change ?? entry.status)
        ?? artifactKindFromWord(Object.keys(isRecord(entry.change) ? entry.change : {})[0]);
      pushArtifact(artifacts, path, kind ?? "file_write");
    }
    return artifacts;
  }
  if (isRecord(value)) {
    for (const [path, change] of Object.entries(value)) {
      const kind = isRecord(change)
        ? artifactKindFromWord(change.kind ?? change.type) ?? artifactKindFromWord(Object.keys(change)[0])
        : artifactKindFromWord(change);
      pushArtifact(artifacts, artifactPath(path), kind ?? "file_write");
    }
  }
  return artifacts;
}

/** The file path a tool call names in its input, under any of the usual key spellings. */
export function artifactPathFromToolInput(input: unknown): string | null {
  if (!isRecord(input)) return null;
  return artifactPath(input.file_path ?? input.filePath ?? input.path ?? input.notebook_path ?? input.notebookPath);
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
