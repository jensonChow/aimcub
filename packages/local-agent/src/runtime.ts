import { execFile, spawn } from "node:child_process";
import { accessSync, constants, existsSync } from "node:fs";
import { delimiter, join } from "node:path";
import { homedir } from "node:os";

import type {
  LocalAgentAdapter,
  LocalAgentDetection,
  LocalAgentEvent,
  LocalAgentFailure,
  LocalAgentProcessRunner,
  LocalAgentRegistry,
  LocalAgentRunOptions,
  LocalAgentRunRequest,
  LocalAgentRunResult,
} from "./types";
import { AgentSelectionError } from "./errors";
import { defaultLocalAgentRegistry } from "./registry";

export type {
  LocalAgentAdapter,
  LocalAgentDetection,
  LocalAgentEvent,
  LocalAgentFailure,
  LocalAgentFailureCode,
  LocalAgentId,
  LocalAgentInvocation,
  LocalAgentModelOption,
  LocalAgentProcessRunner,
  LocalAgentRegistry,
  LocalAgentRunOptions,
  LocalAgentRunRequest,
  LocalAgentRunResult,
  LocalAgentSandboxMode,
} from "./types";

const DEFAULT_PROBE_TIMEOUT_MS = 5_000;
const DEFAULT_RUN_TIMEOUT_MS = 120_000;
const MAX_STDIO_BYTES = 8 * 1024 * 1024;
const CANCELED_MESSAGE = "Local agent run was canceled.";
const TIMEOUT_MESSAGE = "Local agent run timed out.";

type ProbeResult = {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  error?: NodeJS.ErrnoException;
  timedOut?: boolean;
};

export const defaultProcessRunner: LocalAgentProcessRunner = {
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

function executableCandidates(adapter: LocalAgentAdapter, env: NodeJS.ProcessEnv): string[] {
  const out: string[] = [];
  const envPath = env[adapter.envVar]?.trim();
  if (envPath) return [envPath];
  const bins = [adapter.bin, ...(adapter.fallbackBins ?? [])];
  for (const dir of [...splitPath(env.PATH), ...commonExecutableDirs()]) {
    for (const bin of bins) out.push(join(dir, bin));
  }
  out.push(...(adapter.fallbackPaths?.() ?? []));
  return [...new Set(out)];
}

export function resolveExecutable(adapter: LocalAgentAdapter, env: NodeJS.ProcessEnv = process.env): string | null {
  for (const candidate of executableCandidates(adapter, env)) {
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

function authStatusFromProbe(probe: ProbeResult): Pick<LocalAgentDetection, "authStatus" | "authMessage"> {
  const output = `${probe.stdout}\n${probe.stderr}`.trim();
  if (probe.exitCode === 0) return { authStatus: "ok", authMessage: output || null };
  if (probe.error?.code === "ENOENT") return { authStatus: "unknown", authMessage: "Auth probe is not available." };
  return { authStatus: "missing", authMessage: output || "Authentication is required." };
}

async function detectLocalAgent(
  adapter: LocalAgentAdapter,
  runner: LocalAgentProcessRunner,
  env: NodeJS.ProcessEnv,
): Promise<LocalAgentDetection> {
  const path = resolveExecutable(adapter, env);
  const base = {
    id: adapter.id,
    name: adapter.name,
    runMode: "local_cli" as const,
    models: adapter.fallbackModels,
    modelsSource: "fallback" as const,
    reasoningOptions: adapter.reasoningOptions ?? [],
  };
  if (!path) {
    return {
      ...base,
      available: false,
      path: null,
      version: null,
      authStatus: "unknown",
      authMessage: null,
      diagnostics: [`Install ${adapter.name} or set ${adapter.envVar} to its executable path.`],
    };
  }

  const versionProbe = await runner.execFile(path, adapter.versionArgs, {
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
      diagnostics: [`${adapter.name} was found but is not executable.`],
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
      diagnostics: [`${adapter.name} points to a missing executable target.`],
    };
  }

  const [authProbe, modelProbe] = await Promise.all([
    adapter.authProbe
      ? runner.execFile(path, adapter.authProbe.args, {
          env,
          timeoutMs: adapter.authProbe.timeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS,
          maxBuffer: MAX_STDIO_BYTES,
        })
      : Promise.resolve<ProbeResult>({ exitCode: 0, stdout: "", stderr: "" }),
    adapter.listModels
      ? runner.execFile(path, adapter.listModels.args, {
          env,
          timeoutMs: adapter.listModels.timeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS,
          maxBuffer: MAX_STDIO_BYTES,
        })
      : Promise.resolve<ProbeResult>({ exitCode: 1, stdout: "", stderr: "" }),
  ]);

  const parsedModels = adapter.listModels && modelProbe.exitCode === 0
    ? adapter.listModels.parse(modelProbe.stdout)
    : null;
  return {
    ...base,
    available: true,
    path,
    version: versionProbe.stdout.trim().split(/\r?\n/u)[0]?.trim() || null,
    ...authStatusFromProbe(authProbe),
    models: parsedModels ?? adapter.fallbackModels,
    modelsSource: parsedModels ? "live" : "fallback",
    diagnostics: [],
  };
}

export async function listLocalAgents(options: {
  runner?: LocalAgentProcessRunner;
  env?: NodeJS.ProcessEnv;
  registry?: LocalAgentRegistry;
} = {}): Promise<LocalAgentDetection[]> {
  const runner = options.runner ?? defaultProcessRunner;
  const env = options.env ?? process.env;
  const adapters = (options.registry ?? defaultLocalAgentRegistry).list();
  return Promise.all(adapters.map((adapter) => detectLocalAgent(adapter, runner, env)));
}

function parseAgentLine(line: string, adapter: LocalAgentAdapter): LocalAgentEvent[] {
  return adapter.parseLine(line) ?? [{ type: "agent.raw", summary: line }];
}

function collectLineBufferedEvents(
  chunk: Buffer | string,
  buffer: { value: string },
  adapter: LocalAgentAdapter,
): LocalAgentEvent[] {
  buffer.value += chunk.toString();
  const lines = buffer.value.split(/\r?\n/u);
  buffer.value = lines.pop() ?? "";
  return lines.flatMap((line) => line.trim() ? parseAgentLine(line.trim(), adapter) : []);
}

function mergeOutputText(current: string, events: readonly LocalAgentEvent[]): string {
  const deltas = events.filter((event) => event.type === "agent.message.delta");
  const replacing = deltas.find((event) => event.replacesOutput);
  if (replacing) return replacing.summary;
  return current + deltas.map((event) => event.summary).join("");
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

function resolveAdapter(agentId: string, registry: LocalAgentRegistry): LocalAgentAdapter {
  const adapter = registry.get(agentId);
  // A misconfigured id is a programming/config error, not a runtime failure a
  // queue could retry — so it throws instead of returning a failed result.
  if (!adapter) {
    throw new AgentSelectionError(
      "unknown_agent",
      `Unknown local agent "${agentId}". Registered agents: ${registry.ids().join(", ")}.`,
      agentId,
    );
  }
  return adapter;
}

export async function runLocalAgent(
  rawRequest: LocalAgentRunRequest,
  options: LocalAgentRunOptions = {},
): Promise<LocalAgentRunResult> {
  const adapter = resolveAdapter(rawRequest.agentId, options.registry ?? defaultLocalAgentRegistry);
  const request = sanitizeRunRequest(rawRequest);
  const startedAt = Date.now();
  const runner = options.runner ?? defaultProcessRunner;
  const env = options.env ?? process.env;
  const signal = options.signal;
  const executable = resolveExecutable(adapter, env);
  const events: LocalAgentEvent[] = [];
  let outputText = "";
  let eventDelivery = Promise.resolve();
  let eventDeliveryError: string | null = null;

  function emitEvent(event: LocalAgentEvent): void {
    events.push(event);
    if (!options.onEvent) return;
    eventDelivery = eventDelivery
      .then(() => options.onEvent?.(event))
      .then(() => undefined)
      .catch((error) => {
        eventDeliveryError ??= error instanceof Error ? error.message : String(error);
      });
  }

  async function settleWithoutSpawning(
    command: string,
    failure: LocalAgentFailure,
  ): Promise<LocalAgentRunResult> {
    await eventDelivery;
    return {
      ok: false,
      agentId: request.agentId,
      command,
      args: [],
      events,
      outputText: "",
      exitCode: null,
      error: failure.message,
      failure,
      durationMs: Date.now() - startedAt,
    };
  }

  if (!executable) {
    emitEvent({
      type: "agent.run.failed",
      summary: `Install ${adapter.name} or set ${adapter.envVar} to its executable path.`,
    });
    return settleWithoutSpawning(adapter.bin, {
      code: "executable_not_found",
      message: `Local agent executable was not found: ${adapter.name}.`,
      retryable: false,
    });
  }
  const command = executable;

  if (signal?.aborted) {
    emitEvent({ type: "agent.run.failed", summary: CANCELED_MESSAGE });
    return settleWithoutSpawning(command, { code: "canceled", message: CANCELED_MESSAGE, retryable: false });
  }

  const invocation = adapter.buildInvocation(request);
  emitEvent({ type: "agent.run.started", summary: `${adapter.name} started.`, raw: { command, args: invocation.args } });

  return new Promise((resolve) => {
    const child = runner.spawn(command, invocation.args, { cwd: request.cwd, env });
    const stdoutBuffer = { value: "" };
    const stderrBuffer = { value: "" };
    let settled = false;
    let killedByTimeout = false;
    let killedByAbort = false;
    const timeout = setTimeout(() => {
      killedByTimeout = true;
      child.kill("SIGTERM");
    }, options.timeoutMs ?? request.timeoutMs ?? DEFAULT_RUN_TIMEOUT_MS);
    function onAbort(): void {
      killedByAbort = true;
      child.kill("SIGTERM");
    }
    signal?.addEventListener("abort", onAbort);

    function classifyFailure(
      exitCode: number | null,
      error: string | undefined,
      callbackError: string | null,
      failed: boolean,
    ): LocalAgentFailure | null {
      if (callbackError) {
        return {
          code: "event_callback_error",
          message: `Local agent event callback failed: ${callbackError}`,
          retryable: false,
        };
      }
      if (!failed) return null;
      if (killedByAbort) return { code: "canceled", message: CANCELED_MESSAGE, retryable: false };
      // Only a timeout is retryable for now; the future run queue widens this.
      if (killedByTimeout) return { code: "timeout", message: TIMEOUT_MESSAGE, retryable: true };
      if (error) return { code: "spawn_error", message: error, retryable: false };
      return { code: "nonzero_exit", message: `Local agent exited with code ${exitCode}.`, retryable: false };
    }

    async function finish(exitCode: number | null, error?: string) {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      signal?.removeEventListener("abort", onAbort);
      const stdoutRemainder = stdoutBuffer.value.trim();
      if (stdoutRemainder) {
        const parsed = parseAgentLine(stdoutRemainder, adapter);
        for (const event of parsed) emitEvent(event);
        outputText = mergeOutputText(outputText, parsed);
      }
      const stderrRemainder = stderrBuffer.value.trim();
      if (stderrRemainder) emitEvent({ type: "agent.stderr", summary: stderrRemainder });
      const failed = Boolean(error) || killedByTimeout || killedByAbort || (exitCode !== 0 && exitCode !== null);
      const failureSummary = killedByAbort
        ? CANCELED_MESSAGE
        : killedByTimeout
          ? TIMEOUT_MESSAGE
          : error ?? `Local agent exited with code ${exitCode}.`;
      emitEvent({
        type: failed ? "agent.run.failed" : "agent.run.completed",
        summary: failed ? failureSummary : "Local agent run completed.",
      });
      await eventDelivery;
      const callbackError = eventDeliveryError;
      const failure = classifyFailure(exitCode, error, callbackError, failed);
      resolve({
        ok: !failure,
        agentId: request.agentId,
        command,
        args: invocation.args,
        events,
        outputText,
        exitCode,
        error: failure?.message ?? null,
        failure,
        durationMs: Date.now() - startedAt,
      });
    }

    child.stdout?.on("data", (chunk) => {
      const parsed = collectLineBufferedEvents(chunk, stdoutBuffer, adapter);
      for (const event of parsed) emitEvent(event);
      outputText = mergeOutputText(outputText, parsed);
    });
    child.stderr?.on("data", (chunk) => {
      const parsed = collectLineBufferedEvents(chunk, stderrBuffer, adapter);
      for (const event of parsed) emitEvent(event.type === "agent.raw" ? { ...event, type: "agent.stderr" } : event);
    });
    child.on("error", (err) => void finish(null, err instanceof Error ? err.message : String(err)));
    child.on("close", (code) => void finish(code));
    child.stdin?.end(invocation.stdin);
  });
}
