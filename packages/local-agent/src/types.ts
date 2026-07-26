// This module intentionally has no module-level imports: adapters, the registry
// and the engine all depend on it, so keeping it import-free keeps them cycle-free.

/**
 * A registered local agent runtime id (for example "codex" or "claude").
 * Ids are free strings so a community adapter can add a runtime without any
 * change to core dispatch; `LocalAgentRegistry` validates them on registration.
 */
export type LocalAgentId = string;

export type LocalAgentSandboxMode = "read-only" | "workspace-write" | "danger-full-access";

export interface LocalAgentModelOption {
  id: string;
  label: string;
}

export interface LocalAgentDetection {
  id: LocalAgentId;
  name: string;
  runMode: "local_cli";
  available: boolean;
  path: string | null;
  version: string | null;
  authStatus: "ok" | "missing" | "unknown";
  authMessage: string | null;
  models: LocalAgentModelOption[];
  modelsSource: "live" | "fallback";
  reasoningOptions: LocalAgentModelOption[];
  diagnostics: string[];
}

export interface LocalAgentRunRequest {
  agentId: LocalAgentId;
  prompt: string;
  cwd?: string;
  model?: string;
  reasoning?: string;
  extraAllowedDirs?: string[];
  timeoutMs?: number;
  permission?: {
    sandbox?: LocalAgentSandboxMode;
    network?: boolean;
  };
}

/**
 * What a runtime did to one concrete file. The kinds name the OPERATION, not the
 * file's resulting state: a runtime that overwrites a path usually cannot say
 * whether it existed beforehand, so "file_write" covers create-or-overwrite.
 */
export type LocalAgentArtifactKind = "file_write" | "file_edit" | "file_delete";

/** One file a run touched, as the runtime reported it. */
export interface LocalAgentArtifact {
  /** Path exactly as the runtime named it — absolute, or relative to the run cwd. */
  path: string;
  kind: LocalAgentArtifactKind;
}

export interface LocalAgentEvent {
  type:
    | "agent.run.started"
    | "agent.message.delta"
    | "agent.tool.started"
    | "agent.tool.finished"
    | "agent.usage.reported"
    | "agent.run.completed"
    | "agent.run.failed"
    | "agent.stderr"
    | "agent.raw";
  summary: string;
  sessionId?: string;
  toolId?: string;
  toolName?: string;
  usage?: Record<string, number>;
  raw?: unknown;
  /**
   * Files this event touched, when the runtime's tool payload names concrete
   * paths. Optional and additive: an adapter that never sets it keeps working,
   * and the orchestrator turns each entry into a durable `artifact.created` run
   * event plus an artifacts summary on the run's evidence.
   */
  artifacts?: LocalAgentArtifact[];
  /**
   * Only meaningful on "agent.message.delta": when true this summary is the
   * runtime's authoritative final output and REPLACES the accumulated output
   * text instead of being appended to it.
   */
  replacesOutput?: boolean;
}

export type LocalAgentFailureCode =
  | "executable_not_found"
  | "timeout"
  | "canceled"
  | "nonzero_exit"
  | "spawn_error"
  | "event_callback_error";

export interface LocalAgentFailure {
  code: LocalAgentFailureCode;
  message: string;
  retryable: boolean;
}

export interface LocalAgentRunResult {
  ok: boolean;
  agentId: LocalAgentId;
  command: string;
  args: string[];
  events: LocalAgentEvent[];
  outputText: string;
  exitCode: number | null;
  /** Human-readable failure text; `failure` carries the machine-readable form. */
  error: string | null;
  failure: LocalAgentFailure | null;
  durationMs: number;
}

export interface LocalAgentRunOptions {
  runner?: LocalAgentProcessRunner;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
  onEvent?: (event: LocalAgentEvent) => void | Promise<void>;
  /** Aborting sends SIGTERM and settles the run with failure code "canceled". */
  signal?: AbortSignal;
  /** Defaults to the module singleton; tests inject isolated registries. */
  registry?: LocalAgentRegistry;
}

export interface LocalAgentProcessRunner {
  execFile(file: string, args: readonly string[], options: {
    env: NodeJS.ProcessEnv;
    timeoutMs: number;
    maxBuffer: number;
  }): Promise<{
    exitCode: number | null;
    stdout: string;
    stderr: string;
    error?: NodeJS.ErrnoException;
    timedOut?: boolean;
  }>;
  spawn(file: string, args: readonly string[], options: {
    cwd?: string;
    env: NodeJS.ProcessEnv;
  }): import("node:child_process").ChildProcess;
}

/** What an adapter turns a sanitized run request into. Adapters never spawn. */
export interface LocalAgentInvocation {
  args: string[];
  stdin: string;
}

/** The per-session Aimcub MCP bridge an embedded planning brain connects to. */
export interface PlanningSessionMcpConfig {
  /** MCP server name as the runtime sees it (tool ids become `mcp__<name>__<tool>`). */
  serverName: string;
  /** Loopback streamable-HTTP endpoint, e.g. `http://127.0.0.1:PORT/mcp`. */
  url: string;
  /** Per-session bearer token; the bridge rejects requests without it. */
  authToken: string;
}

/**
 * Input for a planning-session invocation: the runtime is launched as Aimcub's
 * embedded planning BRAIN — researching with its own read-only/web tools and
 * interacting through the projected Aimcub MCP tools — not as a sub-aim executor.
 */
export interface PlanningSessionInvocationRequest {
  prompt: string;
  cwd: string;
  model?: string;
  reasoning?: string;
  /** Whether the runtime may use its own live web search/fetch tools. */
  network: boolean;
  /** Directories the brain may read for local context research. */
  extraAllowedDirs?: string[];
  mcp: PlanningSessionMcpConfig;
  /**
   * The runtime's OWN session/thread id from an earlier pass on this aim. When set, the adapter
   * should resume that thread so the brain regains its own reasoning history rather than only the
   * briefing Aimcub reconstructs for it. The child process itself is long gone — this restores the
   * conversation, not the process.
   *
   * An adapter that cannot resume may ignore this: the session then starts fresh but still carries
   * the prior-pass briefing in its prompt, so no answered question is asked twice. The permission
   * contract still binds — a resumed invocation must map `sandbox`/`network` exactly as a fresh one
   * does, whatever flag form the resume path requires.
   */
  resumeSessionId?: string;
}

/**
 * Everything the engine needs to detect, launch and normalize one CLI runtime.
 * Adapters are pure description plus two pure functions; process handling,
 * timeouts, cancellation and event delivery stay engine-owned.
 */
export interface LocalAgentAdapter {
  /** Stable runtime id; must match /^[a-z][a-z0-9-]*$/. */
  id: LocalAgentId;
  /** The single source of truth for this runtime's display name. */
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
  /**
   * Build the CLI invocation for an already-sanitized request. This MUST honor
   * `request.permission.sandbox` and `request.permission.network` — mapping
   * them onto the runtime's own flags is the security contract of an adapter.
   */
  buildInvocation: (request: LocalAgentRunRequest) => LocalAgentInvocation;
  /**
   * Normalize one line of runtime stdout/stderr. Returning null means "not mine":
   * the engine emits `agent.raw` (or `agent.stderr` on the stderr path) instead.
   */
  parseLine: (line: string) => LocalAgentEvent[] | null;
  /**
   * Build the invocation that runs this runtime as an embedded planning brain
   * (read-only research + the Aimcub MCP bridge). Optional: a runtime without it
   * does not support embedded planning sessions and callers fall back to the
   * structured-output funnel. The invocation MUST keep the runtime read-only and
   * honor `request.network`.
   */
  buildPlanningSessionInvocation?: (request: PlanningSessionInvocationRequest) => LocalAgentInvocation;
  /**
   * Encode one injected user chat turn for a live planning session's stdin.
   * Optional: without it, queued chat still reaches the brain by riding along on
   * the next projected-tool reply instead of arriving as a real user turn.
   */
  encodePlanningUserMessage?: (text: string) => string;
}

export interface LocalAgentRegistry {
  /** Throws on a duplicate or invalid adapter. */
  register(adapter: LocalAgentAdapter): void;
  has(id: LocalAgentId): boolean;
  get(id: LocalAgentId): LocalAgentAdapter | null;
  /** Registration order — this order IS the preference order. */
  list(): LocalAgentAdapter[];
  ids(): LocalAgentId[];
}
