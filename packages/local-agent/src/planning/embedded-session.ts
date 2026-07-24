/**
 * Embedded planning session: a local agent CLI runs as Aimcub's planning brain.
 *
 * This engine joins three parts:
 *   - the pure session protocol (`@aimcub/llm` PlanningSession) that owns
 *     questions, chat, budgets, and plan validation;
 *   - the per-session MCP bridge that projects the session tools to the brain;
 *   - one spawned runtime process (Claude Code first) speaking bidirectional
 *     stream-json, so temporary-chat turns can be injected while it works.
 *
 * Timeout policy is phase-aware: the active-thinking budget ticks only while
 * the session is researching. While a question is parked (`waiting_user`), the
 * clock pauses — a user who answers hours later has lost none of the brain's
 * budget. Exit is honored, not assumed: when the session reaches a terminal
 * phase the process gets a short grace period to leave, then SIGTERM; when the
 * process ends first, `finalize()` still honors the best valid submission.
 */
import type { ChildProcess } from "node:child_process";

import {
  buildPlanningSessionPrompt,
  createPlanningSession,
  type ContextLinkedSource,
  type PlanningMemory,
  type PlanningSession,
  type PlanningSessionAim,
  type PlanningSessionAnswer,
  type PlanningSessionBudgets,
  type PlanningSessionConfig,
  type PlanningSessionEvent,
  type PlanningSessionFailure,
  type PlanningSessionOutcome,
  type PlanningSessionSnapshot,
} from "@aimcub/llm";

import type {
  LocalAgentAdapter,
  LocalAgentDetection,
  LocalAgentEvent,
  LocalAgentFailure,
  LocalAgentId,
  LocalAgentProcessRunner,
  LocalAgentRegistry,
} from "../types";
import { defaultLocalAgentRegistry } from "../registry";
import { defaultProcessRunner, resolveExecutable } from "../runtime";
import { startPlanningMcpBridge } from "./mcp-bridge";

const DEFAULT_ACTIVE_TIMEOUT_MS = 10 * 60_000;
const DEFAULT_EXIT_GRACE_MS = 15_000;
/**
 * Keep the runtime's MCP client from timing out a parked ask_user call.
 * Deliberately NOT `MCP_TIMEOUT`: that gates server STARTUP, and a huge value
 * there turns a failed bridge connect into a silent multi-minute hang.
 */
const MCP_TOOL_TIMEOUT_MS = 7 * 24 * 60 * 60_000;
const FINISH_NOW_MESSAGE =
  "Stop researching now. Submit the plan with your current understanding via submit_plan; put remaining unknowns in assumptions or open_questions.";

/** Thrown when the selected runtime has no planning-session support. */
export class PlanningSessionUnsupportedError extends Error {
  constructor(readonly agentId: LocalAgentId) {
    super(`Local agent "${agentId}" does not support embedded planning sessions.`);
    this.name = "PlanningSessionUnsupportedError";
  }
}

/**
 * The first detected runtime that can act as the planning brain: available,
 * authenticated, and registered with planning-session support. Detection order
 * follows registry order, so the registration preference carries over — and a
 * third-party adapter that implements `buildPlanningSessionInvocation` is
 * picked up with no change here.
 */
export function planningCapableAgentId(
  detections: readonly LocalAgentDetection[],
  registry: LocalAgentRegistry = defaultLocalAgentRegistry,
): LocalAgentId | null {
  for (const detection of detections) {
    if (!detection.available || detection.authStatus !== "ok") continue;
    if (registry.get(detection.id)?.buildPlanningSessionInvocation) return detection.id;
  }
  return null;
}

/**
 * Default model for a planning session when the caller specifies none: the
 * first concrete model the runtime ADVERTISES (mirrors the funnel gateway's
 * preferredModel). Live-run lesson: a runtime's configured default can point
 * at a model its installed version cannot drive (observed: codex defaulting
 * to a server-gated model → immediate 400), while its live-advertised list is
 * what actually works. Explicit user choices always win over this.
 */
export function preferredPlanningModel(detection: LocalAgentDetection | undefined): string | undefined {
  if (!detection || detection.modelsSource !== "live") return undefined;
  return detection.models.find((model) => model.id !== "default")?.id;
}

export interface EmbeddedPlanningSessionRequest {
  agentId: LocalAgentId;
  aim: PlanningSessionAim;
  memories?: readonly PlanningMemory[];
  linkedSources?: readonly ContextLinkedSource[];
  /** Directories the brain may research locally (become runtime --add-dir grants). */
  workspaceRoots?: readonly string[];
  webResearch: { enabled: boolean; required: boolean };
  budgets?: Partial<PlanningSessionBudgets>;
  cwd?: string;
  model?: string;
  reasoning?: string;
  /** Live memory search bound to the real store; defaults to the preselected corpus. */
  searchMemory?: PlanningSessionConfig["searchMemory"];
  /** Active-thinking budget; the clock pauses while a question waits on the user. */
  activeTimeoutMs?: number;
}

export interface EmbeddedPlanningSessionOptions {
  registry?: LocalAgentRegistry;
  runner?: LocalAgentProcessRunner;
  env?: NodeJS.ProcessEnv;
  onSessionEvent?: (event: PlanningSessionEvent) => void;
  onActivity?: (event: LocalAgentEvent) => void;
  /** Test hook: replaces the built mission prompt. */
  promptOverride?: string;
  exitGraceMs?: number;
  serverHost?: string;
}

export interface EmbeddedPlanningSessionResult {
  agentId: LocalAgentId;
  snapshot: PlanningSessionSnapshot;
  outcome: PlanningSessionOutcome | null;
  failure: PlanningSessionFailure | null;
  /** Process-level failure (spawn/timeout/exit), independent of the session verdict. */
  processFailure: LocalAgentFailure | null;
  exitCode: number | null;
  durationMs: number;
  activityEvents: LocalAgentEvent[];
}

export interface EmbeddedPlanningSessionHandle {
  readonly session: PlanningSession;
  /** Exposed for tests and debug surfaces. */
  readonly mcpUrl: string;
  postUserMessage(text: string): void;
  requestFinishNow(): void;
  provideAnswer(requestId: string, answer: Partial<PlanningSessionAnswer>): boolean;
  cancel(): void;
  done: Promise<EmbeddedPlanningSessionResult>;
}

function lineBufferedEvents(
  chunk: Buffer | string,
  buffer: { value: string },
  adapter: LocalAgentAdapter,
): LocalAgentEvent[] {
  buffer.value += chunk.toString();
  const lines = buffer.value.split(/\r?\n/u);
  buffer.value = lines.pop() ?? "";
  return lines.flatMap((line) => {
    const trimmed = line.trim();
    if (!trimmed) return [];
    return adapter.parseLine(trimmed) ?? [{ type: "agent.raw", summary: trimmed }];
  });
}

export async function startEmbeddedPlanningSession(
  request: EmbeddedPlanningSessionRequest,
  options: EmbeddedPlanningSessionOptions = {},
): Promise<EmbeddedPlanningSessionHandle> {
  const registry = options.registry ?? defaultLocalAgentRegistry;
  const adapter = registry.get(request.agentId);
  if (!adapter) throw new PlanningSessionUnsupportedError(request.agentId);
  const buildInvocation = adapter.buildPlanningSessionInvocation;
  if (!buildInvocation) throw new PlanningSessionUnsupportedError(request.agentId);
  const encodeUserMessage = adapter.encodePlanningUserMessage;
  const runner = options.runner ?? defaultProcessRunner;
  const env = options.env ?? process.env;
  const executable = resolveExecutable(adapter, env);
  if (!executable) {
    throw new Error(`Local agent executable was not found: ${adapter.name}. Set ${adapter.envVar} or install it.`);
  }

  const startedAt = Date.now();
  const activityEvents: LocalAgentEvent[] = [];
  let child: ChildProcess | null = null;
  let terminalGraceTimer: NodeJS.Timeout | null = null;
  let idleGraceTimer: NodeJS.Timeout | null = null;
  let processFailure: LocalAgentFailure | null = null;
  let canceled = false;

  // Phase-aware active clock: ticks while researching, pauses while waiting_user.
  let remainingActiveMs = request.activeTimeoutMs ?? DEFAULT_ACTIVE_TIMEOUT_MS;
  let activeSince: number | null = null;
  let activeTimer: NodeJS.Timeout | null = null;

  function clearActiveTimer(): void {
    if (activeTimer) clearTimeout(activeTimer);
    activeTimer = null;
  }

  function pauseActiveClock(): void {
    if (activeSince !== null) {
      remainingActiveMs = Math.max(0, remainingActiveMs - (Date.now() - activeSince));
      activeSince = null;
    }
    clearActiveTimer();
  }

  function resumeActiveClock(): void {
    if (activeSince !== null) return;
    activeSince = Date.now();
    clearActiveTimer();
    activeTimer = setTimeout(() => {
      processFailure ??= {
        code: "timeout",
        message: "The planning brain exceeded its active-thinking budget.",
        retryable: true,
      };
      child?.kill("SIGTERM");
    }, remainingActiveMs);
  }

  function armExitGrace(): void {
    if (terminalGraceTimer) return;
    terminalGraceTimer = setTimeout(() => {
      child?.kill("SIGTERM");
    }, options.exitGraceMs ?? DEFAULT_EXIT_GRACE_MS);
  }

  function clearIdleGrace(): void {
    if (idleGraceTimer) clearTimeout(idleGraceTimer);
    idleGraceTimer = null;
  }

  /**
   * In bidirectional stream-json mode the runtime finishes a turn and then
   * waits for more stdin — forever. A completed turn WITHOUT a terminal
   * session phase means the brain stopped working without submitting: give it
   * a short window (new chat cancels this), then close stdin so the runtime
   * exits and `finalize()` renders the honest verdict.
   */
  function armIdleGrace(): void {
    if (idleGraceTimer || terminalGraceTimer) return;
    idleGraceTimer = setTimeout(() => {
      pauseActiveClock();
      child?.stdin?.end();
      terminalGraceTimer = setTimeout(() => child?.kill("SIGTERM"), 5_000);
    }, options.exitGraceMs ?? DEFAULT_EXIT_GRACE_MS);
  }

  const session = createPlanningSession({
    aim: request.aim,
    memories: request.memories,
    budgets: request.budgets,
    searchMemory: request.searchMemory,
    onEvent: (event) => {
      if (event.type === "phase_changed") {
        if (event.phase === "waiting_user") pauseActiveClock();
        else if (event.phase === "researching") resumeActiveClock();
        else {
          // Terminal phase: stop the clock and give the process time to exit.
          pauseActiveClock();
          armExitGrace();
        }
      }
      options.onSessionEvent?.(event);
    },
  });

  const bridge = await startPlanningMcpBridge({
    session,
    ...(options.serverHost ? { host: options.serverHost } : {}),
  });

  const prompt = options.promptOverride ?? buildPlanningSessionPrompt({
    aim: request.aim,
    memories: request.memories,
    linkedSources: request.linkedSources,
    workspaceRoots: request.workspaceRoots,
    webResearch: request.webResearch,
    budgets: request.budgets,
  });

  const invocation = buildInvocation({
    prompt,
    cwd: request.cwd ?? process.cwd(),
    model: request.model,
    reasoning: request.reasoning,
    network: request.webResearch.enabled,
    extraAllowedDirs: [...(request.workspaceRoots ?? [])],
    mcp: { serverName: bridge.serverName, url: bridge.url, authToken: bridge.authToken },
  });

  const spawned = runner.spawn(executable, invocation.args, {
    cwd: request.cwd ?? process.cwd(),
    env: { ...env, MCP_TOOL_TIMEOUT: String(MCP_TOOL_TIMEOUT_MS) },
  });
  child = spawned;
  resumeActiveClock();

  function emitActivity(event: LocalAgentEvent): void {
    activityEvents.push(event);
    const sessionActive = (() => {
      const phase = session.state().phase;
      return phase === "researching" || phase === "waiting_user";
    })();
    if (event.type === "agent.run.completed" || event.type === "agent.run.failed") {
      if (sessionActive) armIdleGrace();
    } else if (event.type !== "agent.stderr" && event.type !== "agent.raw") {
      // A new turn started producing real activity: the brain is not idle.
      clearIdleGrace();
    }
    options.onActivity?.(event);
  }

  function writeToBrain(encoded: string): void {
    if (spawned.stdin && spawned.stdin.writable) spawned.stdin.write(encoded);
  }

  function deliverQueuedChat(): void {
    if (!encodeUserMessage) return;
    for (const message of session.takeQueuedUserMessages()) writeToBrain(encodeUserMessage(message));
    if (session.takeFinishDirective()) writeToBrain(encodeUserMessage(FINISH_NOW_MESSAGE));
  }

  const done = new Promise<EmbeddedPlanningSessionResult>((resolve) => {
    const stdoutBuffer = { value: "" };
    const stderrBuffer = { value: "" };
    let settled = false;

    function finish(exitCode: number | null, spawnError?: string): void {
      if (settled) return;
      settled = true;
      pauseActiveClock();
      clearIdleGrace();
      if (terminalGraceTimer) clearTimeout(terminalGraceTimer);
      const active = session.state().phase === "researching" || session.state().phase === "waiting_user";
      if (canceled) {
        session.cancel();
      } else if (active) {
        session.finalize();
      }
      const snapshot = session.snapshot();
      if (spawnError) {
        processFailure ??= { code: "spawn_error", message: spawnError, retryable: false };
      } else if (canceled) {
        processFailure ??= { code: "canceled", message: "The planning session was canceled.", retryable: false };
      } else if (exitCode !== 0 && exitCode !== null && snapshot.phase !== "draft_ready") {
        processFailure ??= {
          code: "nonzero_exit",
          message: `The planning brain exited with code ${exitCode}.`,
          retryable: false,
        };
      }
      void bridge.close().then(() => {
        resolve({
          agentId: request.agentId,
          snapshot,
          outcome: snapshot.outcome,
          failure: snapshot.failure,
          processFailure,
          exitCode,
          durationMs: Date.now() - startedAt,
          activityEvents,
        });
      });
    }

    spawned.stdout?.on("data", (chunk: Buffer) => {
      for (const event of lineBufferedEvents(chunk, stdoutBuffer, adapter)) emitActivity(event);
    });
    spawned.stderr?.on("data", (chunk: Buffer) => {
      for (const event of lineBufferedEvents(chunk, stderrBuffer, adapter)) {
        emitActivity(event.type === "agent.raw" ? { ...event, type: "agent.stderr" } : event);
      }
    });
    spawned.on("error", (error) => finish(null, error instanceof Error ? error.message : String(error)));
    spawned.on("close", (code) => finish(code));
  });

  // Stream-capable runtimes (encodePlanningUserMessage) keep stdin open so chat
  // can be injected as live user turns. One-shot runtimes read the prompt until
  // EOF and would wait forever on an open pipe — close it after the prompt;
  // their chat rides along on projected-tool replies instead.
  if (encodeUserMessage) {
    writeToBrain(invocation.stdin);
  } else {
    spawned.stdin?.end(invocation.stdin);
  }

  return {
    session,
    mcpUrl: bridge.url,
    postUserMessage(text: string): void {
      clearIdleGrace();
      session.postUserMessage(text);
      deliverQueuedChat();
    },
    requestFinishNow(): void {
      clearIdleGrace();
      session.requestFinishNow();
      deliverQueuedChat();
    },
    provideAnswer(requestId, answer): boolean {
      const body = session.provideAnswer(requestId, answer);
      const delivered = bridge.resolvePending(requestId, body);
      // Chat queued while the question was parked already rode along on the
      // answer body; a stream-capable runtime needs nothing extra here.
      return delivered;
    },
    cancel(): void {
      if (canceled) return;
      canceled = true;
      session.cancel();
      spawned.kill("SIGTERM");
    },
    done,
  };
}
