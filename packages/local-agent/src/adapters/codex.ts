import { homedir } from "node:os";
import { join } from "node:path";

import type {
  LocalAgentAdapter,
  LocalAgentEvent,
  LocalAgentInvocation,
  LocalAgentModelOption,
  LocalAgentRunRequest,
  LocalAgentSandboxMode,
  PlanningSessionInvocationRequest,
} from "../types";
import {
  DEFAULT_MODEL,
  DEFAULT_PROBE_TIMEOUT_MS,
  fileArtifactsFromChanges,
  isRecord,
  safeJsonParse,
  stringifyValue,
  textFromContent,
  usageFromRecord,
} from "./helpers";

function parseCodexDebugModels(stdout: string): LocalAgentModelOption[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const rawModels = (parsed as { models?: unknown }).models;
  if (!Array.isArray(rawModels)) return null;
  const models = [DEFAULT_MODEL];
  const seen = new Set(models.map((item) => item.id));
  for (const raw of rawModels) {
    if (!raw || typeof raw !== "object") continue;
    const entry = raw as {
      slug?: unknown;
      id?: unknown;
      display_name?: unknown;
      name?: unknown;
      visibility?: unknown;
    };
    if (entry.visibility === "hidden") continue;
    const id = typeof entry.slug === "string" && entry.slug.trim()
      ? entry.slug.trim()
      : typeof entry.id === "string" && entry.id.trim()
        ? entry.id.trim()
        : "";
    if (!id || seen.has(id)) continue;
    const label = typeof entry.display_name === "string" && entry.display_name.trim()
      ? entry.display_name.trim()
      : typeof entry.name === "string" && entry.name.trim()
        ? entry.name.trim()
        : id;
    seen.add(id);
    models.push({ id, label });
  }
  return models.length > 1 ? models : null;
}

function codexFallbackPaths(): string[] {
  if (process.platform !== "darwin") return [];
  return [
    "/Applications/Codex.app/Contents/Resources/codex",
    join(homedir(), "Applications", "Codex.app", "Contents", "Resources", "codex"),
  ];
}

function codexSandboxArgs(sandbox: LocalAgentSandboxMode, network: boolean): string[] {
  if (sandbox === "danger-full-access") return ["--sandbox", "danger-full-access"];
  const mode = sandbox === "read-only" ? "read-only" : "workspace-write";
  const args = ["--sandbox", mode];
  if (mode === "workspace-write" && network) {
    args.push("-c", "sandbox_workspace_write.network_access=true");
  }
  return args;
}

function quoteConfigString(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, "\\\"")}"`;
}

/**
 * A planning session runs Codex as the embedded planning brain: `exec --json`
 * under a read-only sandbox (its shell research reads but never writes),
 * `--search` when the session grants live web, and the projected Aimcub tools
 * over the per-session streamable-HTTP MCP bridge. Codex MCP configs cannot
 * set request headers, so the session token travels as a `token` query
 * parameter on the loopback URL; the per-tool timeout is raised so a parked
 * ask_user survives however long the user takes to answer. Codex exec is
 * one-shot on stdin, so there is no `encodePlanningUserMessage`: temporary
 * chat reaches the brain on the next projected-tool reply.
 */
function buildCodexPlanningInvocation(request: PlanningSessionInvocationRequest): LocalAgentInvocation {
  const args = [
    ...(request.network ? ["--search"] : []),
    "exec",
    "--json",
    "--skip-git-repo-check",
    ...codexSandboxArgs("read-only", false),
    "-C", request.cwd,
  ];
  for (const dir of request.extraAllowedDirs ?? []) {
    if (dir.trim()) args.push("--add-dir", dir.trim());
  }
  if (request.model && request.model !== "default") args.push("--model", request.model);
  if (request.reasoning && request.reasoning !== "default") {
    args.push("-c", `model_reasoning_effort=${quoteConfigString(request.reasoning)}`);
  }
  const bridgeUrl = `${request.mcp.url}?token=${request.mcp.authToken}`;
  args.push("-c", `mcp_servers.${request.mcp.serverName}.url=${quoteConfigString(bridgeUrl)}`);
  args.push("-c", `mcp_servers.${request.mcp.serverName}.tool_timeout_sec=604800`);
  args.push("-c", `mcp_servers.${request.mcp.serverName}.startup_timeout_sec=20`);
  return { args, stdin: request.prompt };
}

function buildCodexInvocation(request: LocalAgentRunRequest): LocalAgentInvocation {
  const permission = request.permission ?? {};
  const sandbox = permission.sandbox ?? "read-only";
  const args = [
    ...(permission.network ? ["--search"] : []),
    "exec",
    "--json",
    "--skip-git-repo-check",
    ...codexSandboxArgs(sandbox, permission.network ?? false),
  ];
  if (request.cwd) args.push("-C", request.cwd);
  for (const dir of request.extraAllowedDirs ?? []) {
    if (dir.trim()) args.push("--add-dir", dir.trim());
  }
  if (request.model && request.model !== "default") args.push("--model", request.model);
  if (request.reasoning && request.reasoning !== "default") {
    args.push("-c", `model_reasoning_effort=${quoteConfigString(request.reasoning)}`);
  }
  return { args, stdin: request.prompt };
}

function parseCodexEvent(raw: Record<string, unknown>): LocalAgentEvent[] {
  const type = typeof raw.type === "string" ? raw.type : "";
  if (type === "thread.started") {
    const sessionId = typeof raw.thread_id === "string" ? raw.thread_id : undefined;
    return [{ type: "agent.run.started", summary: "Codex thread started.", sessionId, raw }];
  }
  if (type.includes("agent_message")) {
    const text = textFromContent(raw.delta ?? raw.text ?? raw.message ?? raw.content);
    return text ? [{ type: "agent.message.delta", summary: text, raw }] : [{ type: "agent.raw", summary: type, raw }];
  }
  const item = isRecord(raw.item) ? raw.item : null;
  const itemType = typeof item?.type === "string" ? item.type : "";
  if (type.startsWith("item.") && itemType === "agent_message") {
    const text = textFromContent(item?.text ?? item?.content ?? item?.message);
    return text
      ? [{ type: "agent.message.delta", summary: text, raw }]
      : [{ type: "agent.raw", summary: `${type}:${itemType}`, raw }];
  }
  // Codex names the files it wrote in a `file_change` item (and in `patch_apply_*` on the flat
  // protocol). Those paths are the run's actual work product, so they travel as artifacts.
  const fileChange = ["file_change", "patch"].some((marker) => itemType.includes(marker) || type.includes(marker));
  if (fileChange) {
    const artifacts = fileArtifactsFromChanges(item?.changes ?? raw.changes);
    const id = typeof item?.id === "string" ? item.id : typeof raw.call_id === "string" ? raw.call_id : undefined;
    const name = itemType || (type.includes("patch") ? "apply_patch" : "file_change");
    const finished = type.includes("completed") || type.includes("finished") || type.includes("end");
    return [{
      type: finished ? "agent.tool.finished" : "agent.tool.started",
      summary: name,
      toolId: id,
      toolName: name,
      raw,
      ...(artifacts.length > 0 ? { artifacts } : {}),
    }];
  }
  if (type.startsWith("item.") && (itemType.includes("command") || itemType.includes("tool"))) {
    const id = typeof item?.id === "string" ? item.id : undefined;
    const name = typeof item?.name === "string"
      ? item.name
      : typeof item?.command === "string"
        ? item.command
        : itemType.includes("command") ? "shell" : "tool";
    return [{
      type: type === "item.completed" ? "agent.tool.finished" : "agent.tool.started",
      summary: name,
      toolId: id,
      toolName: name,
      raw,
    }];
  }
  if (type.includes("tool") || type.includes("exec_command") || type.includes("command")) {
    const id = typeof raw.id === "string" ? raw.id : typeof raw.call_id === "string" ? raw.call_id : undefined;
    const name = typeof raw.name === "string"
      ? raw.name
      : typeof raw.command === "string"
        ? raw.command
        : type.includes("exec") ? "shell" : "tool";
    if (type.includes("completed") || type.includes("finished") || type.includes("end")) {
      return [{
        type: "agent.tool.finished",
        summary: name,
        toolId: id,
        toolName: name,
        raw,
      }];
    }
    return [{
      type: "agent.tool.started",
      summary: name,
      toolId: id,
      toolName: name,
      raw,
    }];
  }
  const usage = usageFromRecord(raw.usage ?? raw.token_usage);
  if (usage) return [{ type: "agent.usage.reported", summary: "Token usage reported.", usage, raw }];
  if (type.includes("error")) {
    return [{ type: "agent.run.failed", summary: stringifyValue(raw.error ?? raw.message ?? "Codex error"), raw }];
  }
  return [{ type: "agent.raw", summary: type || "codex event", raw }];
}

export const codexAdapter: LocalAgentAdapter = {
  id: "codex",
  name: "Codex CLI",
  bin: "codex",
  envVar: "CODEX_BIN",
  versionArgs: ["--version"],
  authProbe: { args: ["login", "status"], timeoutMs: DEFAULT_PROBE_TIMEOUT_MS },
  listModels: {
    args: ["debug", "models"],
    parse: parseCodexDebugModels,
    timeoutMs: DEFAULT_PROBE_TIMEOUT_MS,
  },
  fallbackPaths: codexFallbackPaths,
  fallbackModels: [
    DEFAULT_MODEL,
    { id: "gpt-5.5", label: "gpt-5.5" },
    { id: "gpt-5.4", label: "gpt-5.4" },
    { id: "gpt-5.4-mini", label: "gpt-5.4-mini" },
    { id: "gpt-5.3-codex", label: "gpt-5.3-codex" },
    { id: "gpt-5.1", label: "gpt-5.1" },
    { id: "gpt-5-codex", label: "gpt-5-codex" },
    { id: "gpt-5", label: "gpt-5" },
    { id: "o3", label: "o3" },
    { id: "o4-mini", label: "o4-mini" },
  ],
  reasoningOptions: [
    DEFAULT_MODEL,
    { id: "minimal", label: "Minimal" },
    { id: "low", label: "Low" },
    { id: "medium", label: "Medium" },
    { id: "high", label: "High" },
  ],
  buildInvocation: buildCodexInvocation,
  parseLine(line) {
    const parsed = safeJsonParse(line);
    return isRecord(parsed) ? parseCodexEvent(parsed) : null;
  },
  buildPlanningSessionInvocation: buildCodexPlanningInvocation,
};
