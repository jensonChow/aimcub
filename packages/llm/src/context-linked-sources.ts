import type {
  AimcubToolHandler,
  AimcubToolObservation,
  AimcubToolResult,
  AimcubToolSource,
  ContextLinkedSource,
  ContextLinkedSourcesInput,
  ContextLinkedSourcesOutput,
} from "./tool-contract";

const MAX_SOURCES = 50;

function fail<T>(message: string): AimcubToolResult<T> {
  return { ok: false, error: { code: "invalid_input", message, retryable: false } };
}

function cleanText(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function cleanPath(value: unknown): string | undefined {
  const text = typeof value === "string" ? value.trim() : "";
  return text ? text : undefined;
}

function sourceKind(value: unknown): ContextLinkedSource["kind"] {
  switch (value) {
    case "local_folder":
    case "local_file":
    case "online_folder":
    case "database":
    case "notion":
    case "obsidian":
    case "url":
    case "other":
      return value;
    default:
      return "other";
  }
}

function sourceStatus(value: unknown): ContextLinkedSource["status"] {
  switch (value) {
    case "available":
    case "needs_connector":
    case "unavailable":
      return value;
    default:
      return "needs_connector";
  }
}

function normalizeSources(value: unknown): ContextLinkedSource[] | null {
  if (!Array.isArray(value) || value.length > MAX_SOURCES) return null;
  const seen = new Set<string>();
  const sources: ContextLinkedSource[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return null;
    const row = item as Record<string, unknown>;
    const id = cleanText(row.id);
    const kind = sourceKind(row.kind);
    const label = cleanText(row.label) || id || kind;
    const path = cleanPath(row.path);
    const uri = cleanPath(row.uri);
    const note = cleanText(row.note);
    if (!id || (!path && !uri)) return null;
    const key = `${kind}\u0000${path ?? uri}`;
    if (seen.has(key)) continue;
    seen.add(key);
    sources.push({
      id,
      kind,
      label,
      enabled: typeof row.enabled === "boolean" ? row.enabled : true,
      status: sourceStatus(row.status),
      ...(path ? { path } : {}),
      ...(uri ? { uri } : {}),
      ...(note ? { note } : {}),
    });
  }
  return sources;
}

function sourceMetadata(source: ContextLinkedSource, observedAt: string): AimcubToolSource {
  if (source.kind === "local_folder") {
    return { kind: "workspace", title: source.label, path: source.path, observedAt };
  }
  if (source.kind === "local_file") {
    return { kind: "file", title: source.label, path: source.path, observedAt };
  }
  if (source.kind === "url") {
    return { kind: "web", title: source.label, url: source.uri, observedAt };
  }
  return { kind: "connector", title: source.label, uri: source.uri, observedAt };
}

function planningHints(sources: readonly ContextLinkedSource[]): string[] {
  const enabled = sources.filter((source) => source.enabled);
  const hints: string[] = [];
  if (enabled.some((source) => source.kind === "local_folder")) {
    hints.push("Scan the linked local folder before decomposing if the aim depends on existing files or workflows.");
  }
  if (enabled.some((source) => source.kind === "local_file")) {
    hints.push("Read the explicitly attached local files before asking the user to restate their contents.");
  }
  if (enabled.some((source) => source.status === "needs_connector")) {
    hints.push("Treat connector-backed sources as known locations, not observed facts; ask for export, connector access, or a summary if their contents would change the plan.");
  }
  if (enabled.some((source) => source.kind === "notion" || source.kind === "database")) {
    hints.push("For Notion or database sources, collect schema, key records, owner, and permission context before assigning execution work.");
  }
  if (enabled.some((source) => source.kind === "obsidian")) {
    hints.push("For Obsidian sources, prefer a local vault folder when possible so local.read/local.search can inspect the notes directly.");
  }
  return hints;
}

function outputFor(sources: ContextLinkedSource[]): ContextLinkedSourcesOutput {
  const enabled = sources.filter((source) => source.enabled);
  return {
    sources,
    availableCount: enabled.filter((source) => source.status === "available").length,
    blockedCount: enabled.filter((source) => source.status !== "available").length,
    localFileCount: enabled.filter((source) => source.kind === "local_file").length,
    localFolderCount: enabled.filter((source) => source.kind === "local_folder").length,
    onlineCount: enabled.filter((source) => source.kind !== "local_file" && source.kind !== "local_folder").length,
    planningHints: planningHints(sources),
  };
}

export function createContextLinkedSourcesHandler(): AimcubToolHandler<ContextLinkedSourcesInput, ContextLinkedSourcesOutput> {
  return async (input, context) => {
    if (!context.permissions.includes("context.source")) {
      return {
        ok: false,
        error: {
          code: "permission_denied",
          message: "context.linked_sources requires the context.source permission.",
          retryable: false,
        },
      };
    }
    const rawInput = input as Partial<ContextLinkedSourcesInput> | null | undefined;
    const sources = normalizeSources(rawInput?.sources);
    if (!sources) return fail("context.linked_sources requires 0-50 valid sources.");

    const output = outputFor(sources);
    const observedAt = context.now().toISOString();
    const observation: AimcubToolObservation<ContextLinkedSourcesOutput> = {
      summary: `Registered ${output.sources.length} linked context source${output.sources.length === 1 ? "" : "s"}: ${output.availableCount} available, ${output.blockedCount} needing connector/access.`,
      data: output,
      sources: output.sources.map((source) => sourceMetadata(source, observedAt)),
      ...(output.planningHints.length > 0 ? { warnings: output.planningHints } : {}),
    };
    return { ok: true, observation };
  };
}
