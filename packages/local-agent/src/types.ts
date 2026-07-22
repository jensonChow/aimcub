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
