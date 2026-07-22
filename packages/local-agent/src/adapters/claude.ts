import type {
  LocalAgentAdapter,
  LocalAgentArtifact,
  LocalAgentArtifactKind,
  LocalAgentEvent,
  LocalAgentInvocation,
  LocalAgentRunRequest,
} from "../types";
import {
  artifactPathFromToolInput,
  DEFAULT_MODEL,
  DEFAULT_PROBE_TIMEOUT_MS,
  isRecord,
  safeJsonParse,
  stringifyValue,
  textFromContent,
  usageFromRecord,
} from "./helpers";

function buildClaudeInvocation(request: LocalAgentRunRequest): LocalAgentInvocation {
  const args = ["-p", "--output-format", "stream-json", "--verbose"];
  if (request.model && request.model !== "default") args.push("--model", request.model);
  if (request.reasoning && request.reasoning !== "default") args.push("--effort", request.reasoning);
  for (const dir of request.extraAllowedDirs ?? []) {
    if (dir.trim()) args.push("--add-dir", dir.trim());
  }
  const sandbox = request.permission?.sandbox ?? "read-only";
  const permissionMode = sandbox === "read-only"
    ? "plan"
    : sandbox === "workspace-write"
      ? "acceptEdits"
      : "bypassPermissions";
  args.push("--permission-mode", permissionMode);
  if (request.permission?.network !== true) args.push("--disallowedTools", "WebSearch,WebFetch");
  return { args, stdin: request.prompt };
}

/** Claude's file tools, mapped to what each one does to the file it names. */
const CLAUDE_TOOL_ARTIFACT_KIND: Readonly<Record<string, LocalAgentArtifactKind>> = {
  write: "file_write",
  notebookwrite: "file_write",
  edit: "file_edit",
  multiedit: "file_edit",
  notebookedit: "file_edit",
  update: "file_edit",
};

/** A tool call's file artifacts. Read/search/shell tools name no work product and yield none. */
function claudeToolArtifacts(name: string, input: unknown): LocalAgentArtifact[] {
  const kind = CLAUDE_TOOL_ARTIFACT_KIND[name.trim().toLowerCase()];
  if (!kind) return [];
  const path = artifactPathFromToolInput(input);
  return path ? [{ path, kind }] : [];
}

/** Claude nests its tool calls in message content, so blocks are where the work shows up. */
function contentBlocks(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

/**
 * One tool call. `raw` is the block rather than the whole message: the block is the exact
 * payload this event was normalized from, and a message may carry several of them.
 */
function toolUseEvent(block: Record<string, unknown>): LocalAgentEvent {
  const name = typeof block.name === "string" ? block.name : "tool";
  const artifacts = claudeToolArtifacts(name, block.input);
  return {
    type: "agent.tool.started",
    summary: name,
    toolId: typeof block.id === "string" ? block.id : undefined,
    toolName: name,
    raw: block,
    ...(artifacts.length > 0 ? { artifacts } : {}),
  };
}

function toolResultEvent(block: Record<string, unknown>): LocalAgentEvent {
  return {
    type: "agent.tool.finished",
    summary: "tool result",
    toolId: typeof block.tool_use_id === "string" ? block.tool_use_id : undefined,
    raw: block,
  };
}

function parseClaudeEvent(raw: Record<string, unknown>): LocalAgentEvent[] {
  const type = typeof raw.type === "string" ? raw.type : "";
  if (type === "system") {
    const sessionId = typeof raw.session_id === "string" ? raw.session_id : undefined;
    return [{ type: "agent.run.started", summary: "Claude session started.", sessionId, raw }];
  }
  if (type === "assistant" && isRecord(raw.message)) {
    const events: LocalAgentEvent[] = [];
    const text = textFromContent(raw.message.content);
    if (text) events.push({ type: "agent.message.delta", summary: text, raw });
    for (const block of contentBlocks(raw.message.content)) {
      if (block.type === "tool_use") events.push(toolUseEvent(block));
    }
    return events.length > 0 ? events : [{ type: "agent.raw", summary: "assistant", raw }];
  }
  if (type === "user" && isRecord(raw.message)) {
    const events = contentBlocks(raw.message.content)
      .filter((block) => block.type === "tool_result")
      .map(toolResultEvent);
    if (events.length > 0) return events;
  }
  if (type === "result") {
    const events: LocalAgentEvent[] = [];
    const resultText = textFromContent(raw.result);
    // The result payload is Claude's authoritative final answer: it supersedes
    // the assistant deltas accumulated so far rather than appending to them.
    if (resultText) events.push({ type: "agent.message.delta", summary: resultText, raw, replacesOutput: true });
    const usage = usageFromRecord(raw.usage);
    if (usage) events.push({ type: "agent.usage.reported", summary: "Token usage reported.", usage, raw });
    events.push({
      type: "agent.run.completed",
      summary: typeof raw.subtype === "string" ? raw.subtype : "Claude run completed.",
      raw,
    });
    return events;
  }
  // The same blocks also arrive unwrapped on some stream shapes; `raw` is the block either way.
  if (type.includes("tool_use")) return [toolUseEvent(raw)];
  if (type.includes("tool_result")) return [toolResultEvent(raw)];
  if (type === "error") {
    return [{ type: "agent.run.failed", summary: stringifyValue(raw.error ?? raw.message ?? "Claude error"), raw }];
  }
  return [{ type: "agent.raw", summary: type || "claude event", raw }];
}

export const claudeAdapter: LocalAgentAdapter = {
  id: "claude",
  name: "Claude Code",
  bin: "claude",
  envVar: "CLAUDE_BIN",
  fallbackBins: ["openclaude"],
  versionArgs: ["--version"],
  authProbe: { args: ["auth", "status"], timeoutMs: DEFAULT_PROBE_TIMEOUT_MS },
  fallbackModels: [
    DEFAULT_MODEL,
    { id: "sonnet", label: "Sonnet" },
    { id: "opus", label: "Opus" },
    { id: "haiku", label: "Haiku" },
    { id: "claude-sonnet-5", label: "claude-sonnet-5" },
    { id: "claude-haiku-4-5-20251001", label: "claude-haiku-4-5-20251001" },
  ],
  buildInvocation: buildClaudeInvocation,
  parseLine(line) {
    const parsed = safeJsonParse(line);
    return isRecord(parsed) ? parseClaudeEvent(parsed) : null;
  },
};
