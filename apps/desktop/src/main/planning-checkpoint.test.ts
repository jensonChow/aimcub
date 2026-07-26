/**
 * Checkpointing an in-flight planning pass.
 *
 * The bug this covers (founder 2026-07-26): an aim Aimcub had already been planning greeted its
 * owner with "Start planning" the next day, because the whole session lived in a main-process Map
 * that died with the app and never wrote a byte. These tests drive the real serializer against a
 * fake brain and assert what reaches the store — the coalescing, the hard-boundary flushes, and
 * the quit path — because "the pass survives" is a claim about persisted bytes, not about state.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { LocalAgentDetection, LocalAgentEvent } from "@aimcub/local-agent";
import type { PlanningSessionEvent, PlanningSessionSnapshot } from "@aimcub/llm";
import type { AimDraftPlanningSession } from "@aimcub/types";

const savedPasses: { goalId: string; pass: AimDraftPlanningSession | null }[] = [];
let priorPass: AimDraftPlanningSession | null = null;
let snapshot: PlanningSessionSnapshot;
let sessionEvent: (event: PlanningSessionEvent) => void = () => undefined;
let activityEvent: (event: LocalAgentEvent) => void = () => undefined;
let canceled = false;
let resolveDone: (() => void) | null = null;

function detection(): LocalAgentDetection {
  return {
    id: "codex",
    name: "Codex",
    runMode: "local_cli",
    available: true,
    path: "/bin/codex",
    version: "0.145.0",
    authStatus: "ok",
    authMessage: null,
    models: [{ id: "gpt-5.6-sol", label: "gpt-5.6-sol" }],
    modelsSource: "live",
    reasoningOptions: [],
    diagnostics: [],
  };
}

function freshSnapshot(): PlanningSessionSnapshot {
  return {
    phase: "researching",
    questionsAsked: 0,
    submitAttempts: 0,
    pendingQuestion: null,
    transcript: [],
    outcome: null,
    failure: null,
  };
}

vi.mock("./store", () => ({
  aimStore: {
    savePlanningPass: vi.fn(async (input: { goalId: string; pass: AimDraftPlanningSession | null }) => {
      savedPasses.push({ goalId: input.goalId, pass: input.pass });
      return { goal: { id: input.goalId } };
    }),
    getPlanningPass: vi.fn(async () => priorPass),
    getGoal: vi.fn(async () => null),
  },
}));

vi.mock("./local-agents", () => ({ listLocalAgents: vi.fn(async () => [detection()]) }));
vi.mock("./app-settings", () => ({
  loadDesktopPreferences: vi.fn(() => ({ planningBrain: "codex", planningModel: null })),
}));
vi.mock("./tools", () => ({
  aimRequiresWebResearch: vi.fn(() => false),
  embeddedWebResearchEnabled: vi.fn(() => false),
  linkedContextSources: vi.fn(() => []),
  localContextRoot: vi.fn(() => null),
}));

// The real serializer is the point of these tests; only context selection and the spawned brain
// are replaced.
vi.mock("@aimcub/llm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@aimcub/llm")>();
  return { ...actual, selectPlanningContextForStore: vi.fn(async () => ({ memories: [] })) };
});

vi.mock("@aimcub/local-agent", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@aimcub/local-agent")>();
  return {
    ...actual,
    planningCapableAgentId: vi.fn(() => "codex"),
    preferredPlanningModel: vi.fn(() => "gpt-5.6-sol"),
    startEmbeddedPlanningSession: vi.fn(async (_request: unknown, options: {
      onSessionEvent: (event: PlanningSessionEvent) => void;
      onActivity: (event: LocalAgentEvent) => void;
    }) => {
      sessionEvent = options.onSessionEvent;
      activityEvent = options.onActivity;
      return {
        session: { snapshot: () => snapshot, state: () => ({ phase: snapshot.phase, pendingQuestion: null }) },
        mcpUrl: "http://127.0.0.1:0",
        postUserMessage: vi.fn(),
        requestFinishNow: vi.fn(),
        provideAnswer: vi.fn(() => true),
        cancel: vi.fn(() => {
          canceled = true;
        }),
        done: new Promise<{ processFailure: null; snapshot: PlanningSessionSnapshot }>((resolve) => {
          resolveDone = () => resolve({ processFailure: null, snapshot });
        }),
      };
    }),
  };
});

const GOAL_ID = "82e331b1-4ed7-47f5-9a1b-18dd098d265a";

/** Let the checkpoint write-chain (a promise chain, not a timer) settle. */
async function settleWrites(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

async function start() {
  const module = await import("./planning-session");
  await module.startPlanningSession({ goalId: GOAL_ID, title: "我想做一个塔罗的AI产品" });
  await settleWrites();
  return module;
}

describe("planning-pass checkpointing", () => {
  beforeEach(() => {
    vi.useRealTimers();
    vi.resetModules();
    savedPasses.length = 0;
    priorPass = null;
    snapshot = freshSnapshot();
    canceled = false;
    resolveDone = null;
  });

  it("flushes a question immediately — a pending question is what a reopened aim must show", async () => {
    await start();
    snapshot = {
      ...freshSnapshot(),
      phase: "waiting_user",
      transcript: [{ kind: "research", at: "2026-07-26T09:00:00.000Z", findings: [], gaps: ["no web"] }],
    } as PlanningSessionSnapshot;
    sessionEvent({
      type: "question_asked",
      question: {
        id: "q1",
        question: "What is your budget?",
        why_high_impact: "Sets the whole scope.",
        kind: "constraint",
        allow_other: true,
        selection_mode: "single",
        selection_mode_reason: "mutually_exclusive",
        capture_scope: "current_aim",
        options: [],
      },
    });
    await settleWrites();

    expect(savedPasses).toHaveLength(1);
    expect(savedPasses[0]!.goalId).toBe(GOAL_ID);
    expect(savedPasses[0]!.pass?.phase).toBe("waiting_user");
    expect(savedPasses[0]!.pass?.research_gaps).toEqual(["no web"]);
    // Provenance the paused surface reads: which brain, which model, still live.
    expect(savedPasses[0]!.pass?.agent_id).toBe("codex");
    expect(savedPasses[0]!.pass?.model).toBe("gpt-5.6-sol");
    expect(savedPasses[0]!.pass?.stopped_reason).toBe("");
  });

  it("coalesces tool activity instead of writing the store per event", async () => {
    vi.useFakeTimers();
    await start();
    for (let i = 0; i < 5; i += 1) {
      activityEvent({ type: "agent.tool.started", summary: `read ${i}`, toolName: "local.read" } as LocalAgentEvent);
    }
    expect(savedPasses).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(1600);
    await settleWrites();
    // Five events, one write.
    expect(savedPasses).toHaveLength(1);
  });

  it("checkpoints every live pass as app_quit before the brains are killed", async () => {
    const module = await start();
    snapshot = { ...freshSnapshot(), phase: "waiting_user" };

    await module.checkpointAllPlanningSessions("app_quit");
    expect(savedPasses.at(-1)!.pass?.stopped_reason).toBe("app_quit");
    expect(savedPasses.at(-1)!.pass?.phase).toBe("waiting_user");
    // The pass is written BEFORE the child process dies, never after.
    expect(canceled).toBe(false);
    module.cancelAllPlanningSessions();
    expect(canceled).toBe(true);
  });

  it("records a failed pass as failed, and a settled pass at its final shape", async () => {
    await start();
    sessionEvent({
      type: "session_failed",
      failure: { code: "no_plan_submitted", message: "codex exited before submitting a plan", lastErrors: [] },
    });
    await settleWrites();
    expect(savedPasses.at(-1)!.pass?.stopped_reason).toBe("failed");

    resolveDone?.();
    await settleWrites();
    expect(savedPasses.at(-1)!.pass?.stopped_reason).toBe("failed");
  });

  it("continues a prior pass: original start time kept, resume counted", async () => {
    priorPass = {
      agent_id: "codex",
      phase: "waiting_user",
      updated_at: "2026-07-25T14:30:00.000Z",
      model: "gpt-5.6-sol",
      started_at: "2026-07-25T14:03:09.714Z",
      stopped_reason: "app_quit",
      resumed_count: 1,
      truncated: false,
      transcript: [],
      research_findings: [],
      research_gaps: [],
      research_summary: "",
      assumptions: [],
      open_questions: [],
      memory_candidates: [],
    };
    await start();
    sessionEvent({ type: "phase_changed", phase: "researching" } as PlanningSessionEvent);
    await settleWrites();

    expect(savedPasses.at(-1)!.pass?.started_at).toBe("2026-07-25T14:03:09.714Z");
    expect(savedPasses.at(-1)!.pass?.resumed_count).toBe(2);
  });

  it("drops an armed checkpoint when the session is canceled, so a dead pass cannot write back", async () => {
    vi.useFakeTimers();
    const module = await start();
    activityEvent({ type: "agent.tool.started", summary: "read", toolName: "local.read" } as LocalAgentEvent);
    module.cancelPlanningSession(GOAL_ID);

    await vi.advanceTimersByTimeAsync(3000);
    await settleWrites();
    expect(savedPasses).toHaveLength(0);
  });
});
