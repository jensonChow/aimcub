/**
 * Main-process manager for embedded planning sessions.
 *
 * One live session per shell aim: the local agent runs as the planning brain
 * (via `@aimcub/local-agent`), this module owns its lifecycle, compacts its
 * activity for the cockpit, broadcasts state like the run queue does, and at
 * draft_ready computes the landing bundle the renderer commits through the
 * existing `updateGoalPlan` path. Sessions survive renderer navigation — the
 * renderer re-attaches through `getPlanningSessionState`.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { reviewPlan } from "@aimcub/core";
import {
  planningSessionDraftState,
  selectPlanningContextForStore,
  type ClarifyAnswer,
  type ClarifyQuestion,
  type PlanningMemory,
  type PlanningSessionEvent,
  type PlanningSessionSnapshot,
} from "@aimcub/llm";
import type { AimDraftPlanningSession } from "@aimcub/types";
import {
  PlanningSessionUnsupportedError,
  planningCapableAgentId,
  preferredPlanningModel,
  startEmbeddedPlanningSession,
  type EmbeddedPlanningSessionHandle,
  type LocalAgentDetection,
  type LocalAgentEvent,
  type LocalAgentId,
} from "@aimcub/local-agent";

import type {
  DesktopPreferences,
  PlanningSessionActivityItem,
  PlanningSessionAnswerRequest,
  PlanningSessionEventPayload,
  PlanningSessionLanding,
  PlanningSessionStartRequest,
  PlanningSessionStateView,
} from "../shared/ipc";
import { loadDesktopPreferences } from "./app-settings";
import { listLocalAgents } from "./local-agents";
import { aimStore } from "./store";
import { aimRequiresWebResearch, embeddedWebResearchEnabled, linkedContextSources, localContextRoot } from "./tools";

const ACTIVITY_BUFFER_LIMIT = 40;

/**
 * The brain a new session runs on: the user's explicit pick when that runtime
 * is present, authenticated, and planning-capable; otherwise the automatic
 * first capable runtime. A stale pick (uninstalled or signed-out runtime)
 * degrades to Auto instead of failing the session.
 */
export function resolvePlanningBrain(
  pref: DesktopPreferences["planningBrain"],
  detections: readonly LocalAgentDetection[],
): LocalAgentId | null {
  if (pref) {
    const picked = detections.find((detection) => detection.id === pref);
    if (picked && planningCapableAgentId([picked]) === picked.id) return picked.id;
  }
  return planningCapableAgentId(detections);
}

/**
 * The model a new session runs on: the user's explicit pick when it targets
 * this runtime AND the runtime still advertises it live (a stale pick after a
 * CLI up/downgrade must not resurrect an undriveable model), else the
 * live-advertised fallback, else the runtime's own default.
 */
export function resolvePlanningSessionModel(
  pref: DesktopPreferences["planningModel"],
  agentId: LocalAgentId,
  detection: LocalAgentDetection | undefined,
): string | undefined {
  if (
    pref
    && pref.agentId === agentId
    && detection?.modelsSource === "live"
    && detection.models.some((model) => model.id === pref.model)
  ) {
    return pref.model;
  }
  return preferredPlanningModel(detection);
}

interface ManagedPlanningSession {
  goalId: string;
  agentId: LocalAgentId;
  model: string | null;
  handle: EmbeddedPlanningSessionHandle;
  memories: PlanningMemory[];
  activity: PlanningSessionActivityItem[];
  questionsAsked: number;
  researchFindingCount: number;
  researchGapCount: number;
  landing: PlanningSessionLanding | null;
  failure: { code: string; message: string } | null;
  settled: boolean;
  /** When this pass first started — carried over from a prior checkpoint on resume. */
  startedAt: string;
  /** How many times this pass has been resumed after stopping. */
  resumedCount: number;
  /** Pending coalesced checkpoint, if one is armed. */
  checkpointTimer: NodeJS.Timeout | null;
  /** Serializes this aim's checkpoint writes so two can never interleave. */
  writeChain: Promise<void>;
}

const sessions = new Map<string, ManagedPlanningSession>();
const metadataStash = new Map<string, AimDraftPlanningSession>();

/**
 * A pass is checkpointed to the store WHILE it runs, so closing the app pauses planning
 * instead of erasing it (founder 2026-07-26: an aim that Aimcub was already planning must
 * never greet its owner with "Start planning"). Writes are coalesced because the store is
 * one JSON file behind an advisory lock and a per-event write of a growing transcript would
 * thrash it — but every hard boundary flushes immediately: a phase change, a question, the
 * user's answer or note, settling, and quit. Losing a coalesced tick costs at most the last
 * ~1.5s of tool activity; losing a user's answer would be unforgivable, so those never wait.
 */
const CHECKPOINT_COALESCE_MS = 1500;

/** Quit must stay responsive: the store lock alone can block for seconds. */
const QUIT_CHECKPOINT_TIMEOUT_MS = 2000;

function passFrom(
  managed: ManagedPlanningSession,
  snapshot: PlanningSessionSnapshot,
  stoppedReason: string,
): AimDraftPlanningSession {
  return planningSessionDraftState(snapshot, managed.agentId, new Date(), {
    model: managed.model,
    startedAt: managed.startedAt,
    stoppedReason,
    resumedCount: managed.resumedCount,
  });
}

/** `null` only in the window before the handle is assigned — nothing to checkpoint yet. */
function passOf(managed: ManagedPlanningSession, stoppedReason: string): AimDraftPlanningSession | null {
  if (!managed.handle) return null;
  return passFrom(managed, managed.handle.session.snapshot(), stoppedReason);
}

function scheduleCheckpoint(managed: ManagedPlanningSession): void {
  if (managed.checkpointTimer) return;
  managed.checkpointTimer = setTimeout(() => {
    managed.checkpointTimer = null;
    void flushCheckpoint(managed);
  }, CHECKPOINT_COALESCE_MS);
  managed.checkpointTimer.unref();
}

/**
 * Write the pass now, cancelling any armed coalesce. A failed write is swallowed: the next
 * checkpoint re-serializes the pass from scratch, so a lost write self-heals, and a store
 * hiccup must never take down the live planning session.
 */
function flushCheckpoint(managed: ManagedPlanningSession, stoppedReason = ""): Promise<void> {
  if (managed.checkpointTimer) {
    clearTimeout(managed.checkpointTimer);
    managed.checkpointTimer = null;
  }
  const pass = passOf(managed, stoppedReason);
  if (!pass) return managed.writeChain;
  managed.writeChain = managed.writeChain
    .then(() => aimStore.savePlanningPass({ goalId: managed.goalId, pass }))
    .then(() => undefined, () => undefined);
  return managed.writeChain;
}

type Broadcast = (payload: PlanningSessionEventPayload) => void;
let broadcast: Broadcast = () => undefined;

export function setPlanningSessionBroadcast(emit: Broadcast): void {
  broadcast = emit;
}

function pushActivity(managed: ManagedPlanningSession, item: PlanningSessionActivityItem): void {
  managed.activity.push(item);
  if (managed.activity.length > ACTIVITY_BUFFER_LIMIT) {
    managed.activity.splice(0, managed.activity.length - ACTIVITY_BUFFER_LIMIT);
  }
}

function viewOf(managed: ManagedPlanningSession): PlanningSessionStateView {
  const state = managed.handle.session.state();
  return {
    goalId: managed.goalId,
    agentId: managed.agentId,
    model: managed.model,
    active: state.phase === "researching" || state.phase === "waiting_user",
    phase: state.phase,
    pendingQuestion: state.pendingQuestion,
    questionsAsked: managed.questionsAsked,
    researchFindingCount: managed.researchFindingCount,
    researchGapCount: managed.researchGapCount,
    activity: [...managed.activity],
    landing: managed.landing,
    failure: managed.failure,
  };
}

function emitView(managed: ManagedPlanningSession, sessionEvent?: PlanningSessionEvent): void {
  broadcast({
    goalId: managed.goalId,
    at: new Date().toISOString(),
    ...(sessionEvent ? { session: sessionEvent } : {}),
    view: viewOf(managed),
  });
}

/** Session Q&A → the funnel's question/answer shapes, so metadata synthesis stays uniform. */
function landingFromOutcome(managed: ManagedPlanningSession): PlanningSessionLanding | null {
  const outcome = managed.handle.session.snapshot().outcome;
  if (!outcome) return null;
  const questions: ClarifyQuestion[] = outcome.answers.map((qna) => ({
    id: qna.question.id,
    question: qna.question.question,
    why_high_impact: qna.question.why_high_impact,
    kind: qna.question.kind,
    allow_other: true,
    selection_mode: qna.question.selection_mode,
    selection_mode_reason: qna.question.selection_mode_reason,
    options: qna.question.options.map((option) => ({ label: option.label, tradeoff: option.tradeoff })),
  }));
  const answers: ClarifyAnswer[] = outcome.answers.map((qna) => ({
    question_id: qna.question.id,
    selected_label: qna.answer.selected_labels[0] ?? null,
    selected_labels: qna.answer.selected_labels,
    other_text: qna.answer.other_text,
  }));
  return {
    plan: outcome.plan,
    quality: outcome.quality,
    review: reviewPlan({ plan: outcome.plan, context: managed.memories, quality: outcome.quality }),
    questions,
    answers,
    assumptions: outcome.assumptions.map((assumption) => ({
      statement: assumption.statement,
      default_value: assumption.default_value,
    })),
  };
}

/** Structure only — the renderer owns every displayed word (localized product voice). */
function summarizeSessionEvent(event: PlanningSessionEvent): PlanningSessionActivityItem | null {
  const at = new Date().toISOString();
  switch (event.type) {
    case "research_reported":
      return { at, kind: "research", label: "", count: event.findingCount };
    case "question_asked":
      return { at, kind: "question", label: event.question.question };
    case "memory_proposed":
      return { at, kind: "status", code: "memory_proposed", label: event.candidate.category };
    case "plan_rejected":
      return { at, kind: "status", code: "plan_rejected", label: event.reason, count: event.attempt };
    case "plan_accepted":
      return { at, kind: "status", code: "plan_accepted", label: "" };
    default:
      return null;
  }
}

function summarizeActivityEvent(event: LocalAgentEvent): PlanningSessionActivityItem | null {
  const at = new Date().toISOString();
  if (event.type === "agent.tool.started") {
    return { at, kind: "tool", label: event.summary ?? "", tool: event.toolName ?? "" };
  }
  if (event.type === "agent.run.started") return { at, kind: "status", code: "started", label: "" };
  return null;
}

export async function startPlanningSession(req: PlanningSessionStartRequest): Promise<PlanningSessionStateView> {
  const existing = sessions.get(req.goalId);
  if (existing && !existing.settled) return viewOf(existing);

  const detections = await listLocalAgents();
  const agentId = resolvePlanningBrain(loadDesktopPreferences().planningBrain, detections);
  if (!agentId) {
    throw new PlanningSessionUnsupportedError("claude");
  }

  const context = await selectPlanningContextForStore(aimStore, {
    title: req.title,
    description: req.description,
  });
  const memories = context.memories;
  // Domain is only ever brain-inferred (landing writes it back): pass it when a prior plan
  // established one, stay silent otherwise so the prompt never states a guessed domain.
  const storedGoal = await aimStore.getGoal(req.goalId);
  const domain = storedGoal?.goal.domain ?? null;
  const workspaceRoot = localContextRoot();
  const cwd = workspaceRoot ?? mkdtempSync(join(tmpdir(), "aimcub-planning-"));

  // A pass this aim already stopped keeps its identity: the resumed session continues the
  // same pass (original start time, incremented resume count) rather than presenting itself
  // as the first attempt. Feeding the prior transcript BACK to the brain is separate work;
  // until then a resume is honest about being a fresh attempt at the same pass.
  const priorPass = await aimStore.getPlanningPass(req.goalId);
  const managed: ManagedPlanningSession = {
    goalId: req.goalId,
    agentId,
    model: null,
    handle: null as unknown as EmbeddedPlanningSessionHandle,
    memories,
    activity: [],
    questionsAsked: 0,
    researchFindingCount: 0,
    researchGapCount: 0,
    landing: null,
    failure: null,
    settled: false,
    startedAt: priorPass?.started_at || new Date().toISOString(),
    resumedCount: priorPass ? priorPass.resumed_count + 1 : 0,
    checkpointTimer: null,
    writeChain: Promise.resolve(),
  };

  const model = resolvePlanningSessionModel(
    loadDesktopPreferences().planningModel,
    agentId,
    detections.find((detection) => detection.id === agentId),
  );
  managed.model = model ?? null;
  const handle = await startEmbeddedPlanningSession({
    agentId,
    aim: { title: req.title, description: req.description, domain },
    memories,
    linkedSources: linkedContextSources(),
    workspaceRoots: workspaceRoot ? [workspaceRoot] : [],
    webResearch: {
      enabled: embeddedWebResearchEnabled(),
      required: aimRequiresWebResearch({ title: req.title, description: req.description }),
    },
    cwd,
    ...(model ? { model } : {}),
  }, {
    onSessionEvent: (event) => {
      if (event.type === "question_asked") managed.questionsAsked += 1;
      if (event.type === "research_reported") {
        managed.researchFindingCount += event.findingCount;
        managed.researchGapCount += event.gapCount;
      }
      if (event.type === "phase_changed" && event.phase === "draft_ready") {
        managed.landing = landingFromOutcome(managed);
        metadataStash.set(managed.goalId, passFrom(managed, managed.handle.session.snapshot(), ""));
      }
      if (event.type === "session_failed") {
        managed.failure = { code: event.failure.code, message: event.failure.message };
      }
      const item = summarizeSessionEvent(event);
      if (item) pushActivity(managed, item);
      emitView(managed, event);
      // A phase change, a question, or a failure is a hard boundary — what the aim looks like
      // on reopen changes at exactly these points, so they never wait on a coalesce.
      if (event.type === "phase_changed" || event.type === "question_asked") void flushCheckpoint(managed);
      else if (event.type === "session_failed") void flushCheckpoint(managed, "failed");
      else scheduleCheckpoint(managed);
    },
    onActivity: (event) => {
      const item = summarizeActivityEvent(event);
      if (!item) return;
      pushActivity(managed, item);
      emitView(managed);
      scheduleCheckpoint(managed);
    },
  });
  managed.handle = handle;
  sessions.set(req.goalId, managed);

  void handle.done.then((result) => {
    managed.settled = true;
    if (result.processFailure && !managed.failure && result.snapshot.phase !== "draft_ready") {
      managed.failure = { code: result.processFailure.code, message: result.processFailure.message };
    }
    if (result.snapshot.phase === "draft_ready" && !managed.landing) {
      managed.landing = landingFromOutcome(managed);
      metadataStash.set(managed.goalId, passFrom(managed, result.snapshot, ""));
    }
    emitView(managed);
    // The brain is gone: this is the pass's final shape until someone resumes it.
    managed.writeChain = managed.writeChain
      .then(() => aimStore.savePlanningPass({
        goalId: managed.goalId,
        pass: passFrom(managed, result.snapshot, managed.failure ? "failed" : ""),
      }))
      .then(() => undefined, () => undefined);
  });

  emitView(managed);
  return viewOf(managed);
}

export function getPlanningSessionState(goalId: string): PlanningSessionStateView | null {
  const managed = sessions.get(goalId);
  return managed ? viewOf(managed) : null;
}

export function answerPlanningQuestion(req: PlanningSessionAnswerRequest): PlanningSessionStateView {
  const managed = sessions.get(req.goalId);
  if (!managed) throw new Error("No planning session is active for this aim.");
  pushActivity(managed, {
    at: new Date().toISOString(),
    kind: "status",
    code: req.skipped ? "question_skipped" : "question_answered",
    label: "",
  });
  managed.handle.provideAnswer(req.requestId, {
    selected_labels: req.labels,
    other_text: req.other.trim() ? req.other.trim() : null,
    ...(req.skipped ? { skipped: true } : {}),
  });
  emitView(managed);
  // The user's own words: never risk them to a coalesce window.
  void flushCheckpoint(managed);
  return viewOf(managed);
}

export function postPlanningChat(goalId: string, text: string): PlanningSessionStateView {
  const managed = sessions.get(goalId);
  if (!managed) throw new Error("No planning session is active for this aim.");
  managed.handle.postUserMessage(text);
  pushActivity(managed, { at: new Date().toISOString(), kind: "chat", label: text });
  emitView(managed);
  void flushCheckpoint(managed);
  return viewOf(managed);
}

export function finishPlanningNow(goalId: string): PlanningSessionStateView {
  const managed = sessions.get(goalId);
  if (!managed) throw new Error("No planning session is active for this aim.");
  managed.handle.requestFinishNow();
  pushActivity(managed, { at: new Date().toISOString(), kind: "status", code: "draft_now", label: "" });
  emitView(managed);
  return viewOf(managed);
}

/**
 * Stop the brain and forget the session. No checkpoint: the callers are aim deletion (the
 * store cascade is about to remove the goal) and quit (which checkpoints deliberately, via
 * {@link checkpointAllPlanningSessions}, before cancelling). An armed coalesce is dropped so
 * a canceled session cannot write itself back afterwards.
 */
export function cancelPlanningSession(goalId: string): void {
  const managed = sessions.get(goalId);
  if (!managed) return;
  if (managed.checkpointTimer) {
    clearTimeout(managed.checkpointTimer);
    managed.checkpointTimer = null;
  }
  managed.handle.cancel();
  sessions.delete(goalId);
  metadataStash.delete(goalId);
}

/**
 * Flush every live pass before the app goes away, so a quit reads as a pause. Bounded: a
 * blocked store lock must not hold the app open, and a pass is best-effort by design.
 */
export async function checkpointAllPlanningSessions(stoppedReason: string): Promise<void> {
  const live = [...sessions.values()].filter((managed) => !managed.settled);
  if (live.length === 0) return;
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, QUIT_CHECKPOINT_TIMEOUT_MS);
    timer.unref();
  });
  try {
    await Promise.race([
      Promise.all(live.map((managed) => flushCheckpoint(managed, stoppedReason))).then(() => undefined),
      deadline,
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Consume the serialized session for this aim's metadata at plan landing. */
export function takePlanningSessionMetadata(goalId: string): AimDraftPlanningSession | null {
  const state = metadataStash.get(goalId) ?? null;
  metadataStash.delete(goalId);
  return state;
}

/** Pending memory candidates the brain proposed, recorded at plan landing. */
export function planningSessionMemoryCandidates(goalId: string): AimDraftPlanningSession["memory_candidates"] {
  const managed = sessions.get(goalId);
  const outcome = managed?.handle.session.snapshot().outcome;
  return outcome ? outcome.memoryCandidates.map((candidate) => ({ ...candidate })) : [];
}

/** The session landed (or the aim is gone): drop the managed entry. */
export function releasePlanningSession(goalId: string): void {
  const managed = sessions.get(goalId);
  if (!managed) return;
  // Landing has just written the final pass through `updateGoalPlan`; an armed coalesce would
  // write a pre-landing snapshot over the top of it.
  if (managed.checkpointTimer) {
    clearTimeout(managed.checkpointTimer);
    managed.checkpointTimer = null;
  }
  if (!managed.settled) managed.handle.cancel();
  sessions.delete(goalId);
}

export function cancelAllPlanningSessions(): void {
  for (const goalId of [...sessions.keys()]) cancelPlanningSession(goalId);
}
