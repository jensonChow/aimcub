import { execFile, spawn } from "node:child_process";
import { accessSync, constants, existsSync } from "node:fs";
import { delimiter, join } from "node:path";
import { homedir } from "node:os";

import type {
  LocalAgentDetection,
  LocalAgentEvent,
  LocalAgentId,
  LocalAgentModelOption,
  LocalAgentRunRequest,
  LocalAgentRunResult,
  LocalAgentSandboxMode,
} from "../shared/ipc";

const DEFAULT_MODEL: LocalAgentModelOption = { id: "default", label: "Default" };
const DEFAULT_PROBE_TIMEOUT_MS = 5_000;
const DEFAULT_RUN_TIMEOUT_MS = 120_000;
const MAX_STDIO_BYTES = 8 * 1024 * 1024;

type ProbeResult = {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  error?: NodeJS.ErrnoException;
  timedOut?: boolean;
};

type SpawnedProcess = ReturnType<typeof spawn>;

type LocalAgentDefinition = {
  id: LocalAgentId;
  name: string;
  bin: string;
  envVar: string;
  fallbackBins?: string[];
  fallbackPaths?: () => string[];
  versionArgs: string[];
  authProbe?: { args: string[]; timeoutMs?: number };
  listModels?: {
    args: string[];
    timeoutMs?: number;
    parse: (stdout: string) => LocalAgentModelOption[] | null;
  };
  fallbackModels: LocalAgentModelOption[];
  reasoningOptions?: LocalAgentModelOption[];
  buildArgs: (request: LocalAgentRunRequest) => {
    args: string[];
    stdin: string;
    parser: "codex-jsonl" | "claude-stream-json";
  };
};

export interface LocalAgentProcessRunner {
  execFile(file: string, args: readonly string[], options: {
    env: NodeJS.ProcessEnv;
    timeoutMs: number;
    maxBuffer: number;
  }): Promise<ProbeResult>;
  spawn(file: string, args: readonly string[], options: {
    cwd?: string;
    env: NodeJS.ProcessEnv;
  }): SpawnedProcess;
}

const defaultRunner: LocalAgentProcessRunner = {
  execFile(file, args, options) {
    return execFileProbe(file, args, options);
  },
  spawn(file, args, options) {
    return spawn(file, [...args], {
      cwd: options.cwd,
      env: options.env,
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
    });
  },
};

function safeAccessExecutable(path: string): boolean {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function splitPath(value: string | undefined): string[] {
  return (value ?? "")
    .split(delimiter)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function commonExecutableDirs(): string[] {
  const home = homedir();
  return [
    "/opt/homebrew/bin",
    "/usr/local/bin",
    "/usr/bin",
    "/bin",
    join(home, ".local", "bin"),
    join(home, ".npm-global", "bin"),
    join(home, ".bun", "bin"),
    join(home, ".nvm", "current", "bin"),
    join(home, "Library", "pnpm"),
  ];
}

function executableCandidates(def: LocalAgentDefinition, env: NodeJS.ProcessEnv): string[] {
  const out: string[] = [];
  const envPath = env[def.envVar]?.trim();
  if (envPath) return [envPath];
  const bins = [def.bin, ...(def.fallbackBins ?? [])];
  for (const dir of [...splitPath(env.PATH), ...commonExecutableDirs()]) {
    for (const bin of bins) out.push(join(dir, bin));
  }
  out.push(...(def.fallbackPaths?.() ?? []));
  return [...new Set(out)];
}

function resolveExecutable(def: LocalAgentDefinition, env: NodeJS.ProcessEnv = process.env): string | null {
  for (const candidate of executableCandidates(def, env)) {
    if (existsSync(candidate) && safeAccessExecutable(candidate)) return candidate;
  }
  return null;
}

function execFileProbe(
  file: string,
  args: readonly string[],
  options: { env: NodeJS.ProcessEnv; timeoutMs: number; maxBuffer: number },
): Promise<ProbeResult> {
  return new Promise((resolve) => {
    execFile(file, [...args], {
      env: options.env,
      timeout: options.timeoutMs,
      maxBuffer: options.maxBuffer,
    }, (error, stdout, stderr) => {
      const err = error as (NodeJS.ErrnoException & { killed?: boolean }) | null;
      resolve({
        exitCode: typeof err?.code === "number" ? err.code : err ? null : 0,
        stdout: String(stdout ?? ""),
        stderr: String(stderr ?? ""),
        error: err ?? undefined,
        timedOut: Boolean(err?.killed),
      });
    });
  });
}

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

function buildCodexArgs(request: LocalAgentRunRequest) {
  const permission = request.permission ?? {};
  const sandbox = permission.sandbox ?? "read-only";
  const args = [
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
  return { args, stdin: request.prompt, parser: "codex-jsonl" as const };
}

function buildClaudeArgs(request: LocalAgentRunRequest) {
  const args = ["-p", "--output-format", "stream-json", "--verbose"];
  if (request.model && request.model !== "default") args.push("--model", request.model);
  for (const dir of request.extraAllowedDirs ?? []) {
    if (dir.trim()) args.push("--add-dir", dir.trim());
  }
  const sandbox = request.permission?.sandbox ?? "read-only";
  const permissionMode = sandbox === "read-only" ? "plan" : "bypassPermissions";
  args.push("--permission-mode", permissionMode);
  return { args, stdin: request.prompt, parser: "claude-stream-json" as const };
}

const LOCAL_AGENT_DEFS: LocalAgentDefinition[] = [
  {
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
    buildArgs: buildCodexArgs,
  },
  {
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
    buildArgs: buildClaudeArgs,
  },
];

function getLocalAgentDef(id: LocalAgentId): LocalAgentDefinition {
  const def = LOCAL_AGENT_DEFS.find((item) => item.id === id);
  if (!def) throw new Error(`Unknown local agent: ${id}`);
  return def;
}

function authStatusFromProbe(probe: ProbeResult): Pick<LocalAgentDetection, "authStatus" | "authMessage"> {
  const output = `${probe.stdout}\n${probe.stderr}`.trim();
  if (probe.exitCode === 0) return { authStatus: "ok", authMessage: output || null };
  if (probe.error?.code === "ENOENT") return { authStatus: "unknown", authMessage: "Auth probe is not available." };
  return { authStatus: "missing", authMessage: output || "Authentication is required." };
}

async function detectLocalAgent(
  def: LocalAgentDefinition,
  runner: LocalAgentProcessRunner,
  env: NodeJS.ProcessEnv,
): Promise<LocalAgentDetection> {
  const path = resolveExecutable(def, env);
  const base = {
    id: def.id,
    name: def.name,
    runMode: "local_cli" as const,
    models: def.fallbackModels,
    modelsSource: "fallback" as const,
    reasoningOptions: def.reasoningOptions ?? [],
  };
  if (!path) {
    return {
      ...base,
      available: false,
      path: null,
      version: null,
      authStatus: "unknown",
      authMessage: null,
      diagnostics: [`Install ${def.name} or set ${def.envVar} to its executable path.`],
    };
  }

  const versionProbe = await runner.execFile(path, def.versionArgs, {
    env,
    timeoutMs: DEFAULT_PROBE_TIMEOUT_MS,
    maxBuffer: MAX_STDIO_BYTES,
  });
  if (versionProbe.error?.code === "EACCES" || versionProbe.exitCode === 126) {
    return {
      ...base,
      available: false,
      path,
      version: null,
      authStatus: "unknown",
      authMessage: null,
      diagnostics: [`${def.name} was found but is not executable.`],
    };
  }
  if (versionProbe.error?.code === "ENOENT" || versionProbe.exitCode === 127) {
    return {
      ...base,
      available: false,
      path,
      version: null,
      authStatus: "unknown",
      authMessage: null,
      diagnostics: [`${def.name} points to a missing executable target.`],
    };
  }

  const [authProbe, modelProbe] = await Promise.all([
    def.authProbe
      ? runner.execFile(path, def.authProbe.args, {
          env,
          timeoutMs: def.authProbe.timeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS,
          maxBuffer: MAX_STDIO_BYTES,
        })
      : Promise.resolve<ProbeResult>({ exitCode: 0, stdout: "", stderr: "" }),
    def.listModels
      ? runner.execFile(path, def.listModels.args, {
          env,
          timeoutMs: def.listModels.timeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS,
          maxBuffer: MAX_STDIO_BYTES,
        })
      : Promise.resolve<ProbeResult>({ exitCode: 1, stdout: "", stderr: "" }),
  ]);

  const parsedModels = def.listModels && modelProbe.exitCode === 0
    ? def.listModels.parse(modelProbe.stdout)
    : null;
  return {
    ...base,
    available: true,
    path,
    version: versionProbe.stdout.trim().split(/\r?\n/u)[0]?.trim() || null,
    ...authStatusFromProbe(authProbe),
    models: parsedModels ?? def.fallbackModels,
    modelsSource: parsedModels ? "live" : "fallback",
    diagnostics: [],
  };
}

export async function listLocalAgents(options: {
  runner?: LocalAgentProcessRunner;
  env?: NodeJS.ProcessEnv;
} = {}): Promise<LocalAgentDetection[]> {
  const runner = options.runner ?? defaultRunner;
  const env = options.env ?? process.env;
  return Promise.all(LOCAL_AGENT_DEFS.map((def) => detectLocalAgent(def, runner, env)));
}

function safeJsonParse(line: string): unknown {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function stringifyValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (value == null) return "";
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function usageFromRecord(value: unknown): Record<string, number> | null {
  if (!isRecord(value)) return null;
  const usage: Record<string, number> = {};
  for (const [key, raw] of Object.entries(value)) {
    if (typeof raw === "number") usage[key] = raw;
  }
  return Object.keys(usage).length > 0 ? usage : null;
}

function textFromContent(value: unknown): string {
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
    if (resultText) events.push({ type: "agent.message.delta", summary: resultText, raw });
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

function parseAgentLine(line: string, parser: "codex-jsonl" | "claude-stream-json"): LocalAgentEvent[] {
  const parsed = safeJsonParse(line);
  if (!isRecord(parsed)) return [{ type: "agent.raw", summary: line }];
  return parser === "codex-jsonl" ? parseCodexEvent(parsed) : parseClaudeEvent(parsed);
}

function collectLineBufferedEvents(
  chunk: Buffer | string,
  buffer: { value: string },
  parser: "codex-jsonl" | "claude-stream-json",
): LocalAgentEvent[] {
  buffer.value += chunk.toString();
  const lines = buffer.value.split(/\r?\n/u);
  buffer.value = lines.pop() ?? "";
  return lines.flatMap((line) => line.trim() ? parseAgentLine(line.trim(), parser) : []);
}

function sanitizeRunRequest(request: LocalAgentRunRequest): LocalAgentRunRequest {
  const prompt = request.prompt.trim();
  if (!prompt) throw new Error("Local agent prompt is required.");
  return {
    ...request,
    prompt,
    cwd: request.cwd?.trim() || process.cwd(),
    extraAllowedDirs: (request.extraAllowedDirs ?? []).map((dir) => dir.trim()).filter(Boolean),
  };
}

export async function runLocalAgent(
  rawRequest: LocalAgentRunRequest,
  options: {
    runner?: LocalAgentProcessRunner;
    env?: NodeJS.ProcessEnv;
    timeoutMs?: number;
  } = {},
): Promise<LocalAgentRunResult> {
  const request = sanitizeRunRequest(rawRequest);
  const startedAt = Date.now();
  const runner = options.runner ?? defaultRunner;
  const env = options.env ?? process.env;
  const def = getLocalAgentDef(request.agentId);
  const executable = resolveExecutable(def, env);
  const events: LocalAgentEvent[] = [];
  let outputText = "";
  if (!executable) {
    return {
      ok: false,
      agentId: request.agentId,
      command: def.bin,
      args: [],
      events: [{
        type: "agent.run.failed",
        summary: `Install ${def.name} or set ${def.envVar} to its executable path.`,
      }],
      outputText: "",
      exitCode: null,
      error: `Local agent executable was not found: ${def.name}.`,
      durationMs: Date.now() - startedAt,
    };
  }
  const command = executable;

  const built = def.buildArgs(request);
  events.push({ type: "agent.run.started", summary: `${def.name} started.`, raw: { command, args: built.args } });

  return new Promise((resolve) => {
    const child = runner.spawn(command, built.args, { cwd: request.cwd, env });
    const stdoutBuffer = { value: "" };
    const stderrBuffer = { value: "" };
    let settled = false;
    let killedByTimeout = false;
    const timeout = setTimeout(() => {
      killedByTimeout = true;
      child.kill("SIGTERM");
    }, options.timeoutMs ?? request.timeoutMs ?? DEFAULT_RUN_TIMEOUT_MS);

    function finish(exitCode: number | null, error?: string) {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      const stdoutRemainder = stdoutBuffer.value.trim();
      if (stdoutRemainder) {
        const parsed = parseAgentLine(stdoutRemainder, built.parser);
        events.push(...parsed);
        outputText += parsed.filter((event) => event.type === "agent.message.delta").map((event) => event.summary).join("");
      }
      const stderrRemainder = stderrBuffer.value.trim();
      if (stderrRemainder) events.push({ type: "agent.stderr", summary: stderrRemainder });
      const failed = Boolean(error) || killedByTimeout || (exitCode !== 0 && exitCode !== null);
      events.push({
        type: failed ? "agent.run.failed" : "agent.run.completed",
        summary: killedByTimeout ? "Local agent run timed out." : failed ? error ?? `Local agent exited with code ${exitCode}.` : "Local agent run completed.",
      });
      resolve({
        ok: !failed,
        agentId: request.agentId,
        command,
        args: built.args,
        events,
        outputText,
        exitCode,
        error: failed ? (killedByTimeout ? "Local agent run timed out." : error ?? `Local agent exited with code ${exitCode}.`) : null,
        durationMs: Date.now() - startedAt,
      });
    }

    child.stdout?.on("data", (chunk) => {
      const parsed = collectLineBufferedEvents(chunk, stdoutBuffer, built.parser);
      events.push(...parsed);
      outputText += parsed.filter((event) => event.type === "agent.message.delta").map((event) => event.summary).join("");
    });
    child.stderr?.on("data", (chunk) => {
      const parsed = collectLineBufferedEvents(chunk, stderrBuffer, built.parser);
      for (const event of parsed) events.push(event.type === "agent.raw" ? { ...event, type: "agent.stderr" } : event);
    });
    child.on("error", (err) => finish(null, err instanceof Error ? err.message : String(err)));
    child.on("close", (code) => finish(code));
    child.stdin?.end(built.stdin);
  });
}
