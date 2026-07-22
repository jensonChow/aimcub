import type {
  LocalAgentAdapter,
  LocalAgentEvent,
  LocalAgentInvocation,
  LocalAgentRunRequest,
} from "../types";
import {
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

function parseClaudeEvent(raw: Record<string, unknown>): LocalAgentEvent[] {
  const type = typeof raw.type === "string" ? raw.type : "";
  if (type === "system") {
    const sessionId = typeof raw.session_id === "string" ? raw.session_id : undefined;
    return [{ type: "agent.run.started", summary: "Claude session started.", sessionId, raw }];
  }
  if (type === "assistant" && isRecord(raw.message)) {
    const text = textFromContent(raw.message.content);
    return text ? [{ type: "agent.message.delta", summary: text, raw }] : [{ type: "agent.raw", summary: "assistant", raw }];
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
  if (type.includes("tool_use")) {
    const id = typeof raw.id === "string" ? raw.id : undefined;
    const name = typeof raw.name === "string" ? raw.name : "tool";
    return [{ type: "agent.tool.started", summary: name, toolId: id, toolName: name, raw }];
  }
  if (type.includes("tool_result")) {
    const id = typeof raw.tool_use_id === "string" ? raw.tool_use_id : undefined;
    return [{ type: "agent.tool.finished", summary: "tool result", toolId: id, raw }];
  }
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
