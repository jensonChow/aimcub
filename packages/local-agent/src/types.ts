export type LocalAgentId = "codex" | "claude";

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
}

export interface LocalAgentRunResult {
  ok: boolean;
  agentId: LocalAgentId;
  command: string;
  args: string[];
  events: LocalAgentEvent[];
  outputText: string;
  exitCode: number | null;
  error: string | null;
  durationMs: number;
}

export interface LocalAgentRunOptions {
  runner?: LocalAgentProcessRunner;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
  onEvent?: (event: LocalAgentEvent) => void | Promise<void>;
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
