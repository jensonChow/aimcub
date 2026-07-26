/**
 * Checkpointing an in-flight planning pass.
 *
 * The bug this covers (founder 2026-07-26): an aim Aimcub had already been planning greeted its
 * owner with "Start planning" the next day, because the whole session lived in a main-process Map
 * that died with the app and never wrote a byte. These tests drive the real serializer against a
 * fake brain and assert what reaches the store — the coalescing, the hard-boundary flushes, and
 * the quit path — because "the pass survives" is a claim about persisted bytes, not about state.
 */
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { LocalAgentDetection, LocalAgentEvent } from "@aimcub/local-agent";
import type { PlanningSessionEvent, PlanningSessionSnapshot } from "@aimcub/llm";
import type { AimDraftPlanningSession } from "@aimcub/types";

const savedPasses: { goalId: string; pass: AimDraftPlanningSession | null }[] = [];
const startRequests: { resume?: unknown; workspaceRoots?: readonly string[] }[] = [];
/** Everything the fake brain was told, so an attachment's delivery is observable. */
const postedMessages: string[] = [];
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
    startEmbeddedPlanningSession: vi.fn(async (request: { resume?: unknown; workspaceRoots?: readonly string[] }, options: {
      onSessionEvent: (event: PlanningSessionEvent) => void;
      onActivity: (event: LocalAgentEvent) => void;
    }) => {
      startRequests.push(request);
      sessionEvent = options.onSessionEvent;
      activityEvent = options.onActivity;
      return {
        session: { snapshot: () => snapshot, state: () => ({ phase: snapshot.phase, pendingQuestion: null }) },
        mcpUrl: "http://127.0.0.1:0",
        postUserMessage: vi.fn((text: string) => {
          postedMessages.push(text);
        }),
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

/** A pass that stopped mid-flight with real history on it, as a quit would leave one. */
function pausedPass(overrides: Partial<AimDraftPlanningSession> = {}): AimDraftPlanningSession {
  return {
    agent_id: "codex",
    phase: "waiting_user",
    updated_at: "2026-07-25T14:30:00.000Z",
    model: "gpt-5.6-sol",
    started_at: "2026-07-25T14:03:09.714Z",
    stopped_reason: "app_quit",
    resumed_count: 1,
    runtime_session_id: "",
    truncated: false,
    attachments: [],
    draft_plan: null,
    transcript: [
      { at: "2026-07-25T14:06:00.000Z", kind: "question", question: { id: "q1", question: "谁是你的第一批用户？" } },
      { at: "2026-07-25T14:12:00.000Z", kind: "answer", request_id: "q1", answer: { selected_labels: ["小红书上的塔罗爱好者"], other_text: null } },
      { at: "2026-07-25T14:26:00.000Z", kind: "user_message", text: "先做 iOS，别做网页", delivered: true },
    ],
    research_findings: [{ summary: "Finding A", source_urls: ["https://a.example"] }],
    research_gaps: ["pricing unknown"],
    research_summary: "",
    assumptions: [],
    open_questions: [],
    memory_candidates: [],
    ...overrides,
  };
}

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
    startRequests.length = 0;
    postedMessages.length = 0;
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
    priorPass = pausedPass();
    await start();
    sessionEvent({ type: "phase_changed", phase: "researching" } as PlanningSessionEvent);
    await settleWrites();

    expect(savedPasses.at(-1)!.pass?.started_at).toBe("2026-07-25T14:03:09.714Z");
    expect(savedPasses.at(-1)!.pass?.resumed_count).toBe(2);
  });

  it("resumes with BOTH halves: the pass's history and the runtime's own thread", async () => {
    priorPass = pausedPass({ runtime_session_id: "thread-7" });
    await start();

    const resume = startRequests.at(-1)!.resume as {
      history: { transcript: unknown[]; questionsAsked: number };
      briefing: { answers: unknown[]; notes: string[]; planDrafted: boolean };
      runtimeSessionId?: string;
    };
    // Half one: the pass's own history, so the session machine can refuse a repeat question.
    expect(resume.history.transcript).toHaveLength(3);
    expect(resume.history.questionsAsked).toBe(1);
    expect(resume.briefing.answers).toHaveLength(1);
    expect(resume.briefing.notes).toEqual(["先做 iOS，别做网页"]);
    expect(resume.briefing.planDrafted).toBe(false);
    // Half two: the runtime reopens its own thread.
    expect(resume.runtimeSessionId).toBe("thread-7");
    // Counters continue rather than restarting at zero.
    const view = await (await import("./planning-session")).getPlanningSessionState(GOAL_ID);
    expect(view?.questionsAsked).toBe(1);
    expect(view?.researchFindingCount).toBe(1);
  });

  it("drops a thread id from a DIFFERENT brain instead of handing it to this one", async () => {
    // A Codex thread means nothing to Claude; passing it would fail the spawn for no reason.
    priorPass = pausedPass({ agent_id: "claude", runtime_session_id: "claude-thread-1" });
    await start();

    const resume = startRequests.at(-1)!.resume as { runtimeSessionId?: string; briefing: unknown };
    expect(resume.runtimeSessionId).toBeUndefined();
    // The briefing still goes: continuity of the WORK never depends on the runtime's thread.
    expect(resume.briefing).toBeTruthy();
  });

  it("treats an empty pass as no resume at all", async () => {
    // Checkpointed before the brain achieved anything: there is nothing to continue, and a briefing
    // would claim prior work that does not exist.
    priorPass = pausedPass({ transcript: [], research_findings: [], research_gaps: [] });
    await start();
    expect(startRequests.at(-1)!.resume).toBeUndefined();
  });

  it("does not seed the runtime thread id, so a thread that cannot reopen self-heals", async () => {
    priorPass = pausedPass({ runtime_session_id: "stale-thread" });
    await start();
    // The runtime never announced a session (it could not find the thread), so the checkpoint
    // carries no id and the next attempt starts clean instead of retrying a doomed id.
    sessionEvent({
      type: "session_failed",
      failure: { code: "no_plan_submitted", message: "resume failed", lastErrors: [] },
    });
    await settleWrites();
    expect(savedPasses.at(-1)!.pass?.runtime_session_id).toBe("");

    // When the runtime DOES announce one, the thread was found — so it is kept.
    savedPasses.length = 0;
    activityEvent({ type: "agent.run.started", summary: "started", sessionId: "live-thread" } as LocalAgentEvent);
    await settleWrites();
    expect(savedPasses.at(-1)!.pass?.runtime_session_id).toBe("live-thread");
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

/**
 * Files the user hands to a running brain.
 *
 * The brain's file sandbox is fixed at spawn, so these tests assert the two things that make an
 * attachment real rather than merely announced: the staging directory is GRANTED before the
 * process starts, and the pass carries the originals so a resume can re-stage them.
 */
describe("planning-session attachments", () => {
  let source: string;

  beforeEach(() => {
    vi.useRealTimers();
    vi.resetModules();
    savedPasses.length = 0;
    startRequests.length = 0;
    postedMessages.length = 0;
    priorPass = null;
    snapshot = freshSnapshot();
    canceled = false;
    resolveDone = null;
    source = mkdtempSync(join(tmpdir(), "aimcub-attach-flow-"));
  });

  afterEach(() => {
    rmSync(source, { recursive: true, force: true });
  });

  function sourceFile(name: string, contents = "material"): string {
    const path = join(source, name);
    writeFileSync(path, contents);
    return path;
  }

  it("grants the staging directory at spawn, before anything is attached", async () => {
    await start();
    // Created empty and granted up front: this is the session's only chance to widen the sandbox,
    // so it cannot wait until the user actually picks a file.
    const roots = startRequests[0]!.workspaceRoots ?? [];
    expect(roots).toHaveLength(1);
    expect(existsSync(roots[0]!)).toBe(true);
    expect(readdirSync(roots[0]!)).toEqual([]);
  });

  it("stages the file into that granted directory and tells the brain where it is", async () => {
    const module = await start();
    const stage = startRequests[0]!.workspaceRoots![0]!;

    const view = module.attachPlanningFiles(GOAL_ID, [sourceFile("spec.md", "the real contents")]);

    // The brain reads the COPY: naming the user's own path would land outside its sandbox.
    expect(readFileSync(join(stage, "spec.md"), "utf8")).toBe("the real contents");
    expect(postedMessages.at(-1)).toContain(join(stage, "spec.md"));
    expect(view.activity.at(-1)).toMatchObject({ kind: "status", code: "files_attached", label: "spec.md", count: 1 });
  });

  it("checkpoints the attachment immediately, by original path", async () => {
    const module = await start();
    module.attachPlanningFiles(GOAL_ID, [sourceFile("spec.md")]);
    await settleWrites();

    // The user's own contribution never waits on a coalesce window.
    expect(savedPasses.at(-1)!.pass?.attachments).toEqual([
      { path: join(source, "spec.md"), name: "spec.md", at: expect.any(String) },
    ]);
  });

  it("re-stages a resumed pass's files, so quitting does not silently strip them", async () => {
    const original = sourceFile("spec.md", "carried across the restart");
    priorPass = pausedPass({
      attachments: [{ path: original, name: "spec.md", at: "2026-07-25T14:20:00.000Z" }],
    });

    const module = await start();
    const stage = startRequests[0]!.workspaceRoots![0]!;

    // The previous session's staging directory died with its process; only the original survived.
    expect(readFileSync(join(stage, "spec.md"), "utf8")).toBe("carried across the restart");
    // And the resumed brain is told the NEW paths — its briefing points at a directory that is gone.
    expect(postedMessages.at(-1)).toContain(join(stage, "spec.md"));
    expect(module.getPlanningSessionState(GOAL_ID)!.activity).toContainEqual(
      expect.objectContaining({ code: "files_attached", label: "spec.md" }),
    );
  });

  it("says so when a resumed pass's file has since moved, instead of planning without it", async () => {
    priorPass = pausedPass({
      attachments: [{ path: join(source, "gone.md"), name: "gone.md", at: "2026-07-25T14:20:00.000Z" }],
    });

    const module = await start();

    expect(module.getPlanningSessionState(GOAL_ID)!.activity).toContainEqual(
      expect.objectContaining({ code: "file_lost", label: "gone.md" }),
    );
    // Nothing was staged, so nothing may claim to be attached.
    expect(postedMessages).toHaveLength(0);
  });

  it("reports a file it could not take without losing the rest of the selection", async () => {
    const module = await start();
    const view = module.attachPlanningFiles(GOAL_ID, [join(source, "missing.md"), sourceFile("good.md")]);

    const codes = view.activity.map((item) => item.code);
    expect(codes).toContain("file_rejected");
    expect(codes).toContain("files_attached");
    expect(view.activity.find((item) => item.code === "file_rejected")?.label).toBe("missing.md");
    expect(view.activity.find((item) => item.code === "files_attached")?.label).toBe("good.md");
  });

  it("removes the staged copies when the session is canceled", async () => {
    const module = await start();
    const stage = startRequests[0]!.workspaceRoots![0]!;
    module.attachPlanningFiles(GOAL_ID, [sourceFile("spec.md")]);
    expect(existsSync(stage)).toBe(true);

    module.cancelPlanningSession(GOAL_ID);
    expect(existsSync(stage)).toBe(false);
  });
});
