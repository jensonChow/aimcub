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
}

const sessions = new Map<string, ManagedPlanningSession>();
const metadataStash = new Map<string, AimDraftPlanningSession>();

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
        metadataStash.set(
          managed.goalId,
          planningSessionDraftState(managed.handle.session.snapshot(), managed.agentId, new Date()),
        );
      }
      if (event.type === "session_failed") {
        managed.failure = { code: event.failure.code, message: event.failure.message };
      }
      const item = summarizeSessionEvent(event);
      if (item) pushActivity(managed, item);
      emitView(managed, event);
    },
    onActivity: (event) => {
      const item = summarizeActivityEvent(event);
      if (!item) return;
      pushActivity(managed, item);
      emitView(managed);
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
      metadataStash.set(
        managed.goalId,
        planningSessionDraftState(result.snapshot, managed.agentId, new Date()),
      );
    }
    emitView(managed);
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
  return viewOf(managed);
}

export function postPlanningChat(goalId: string, text: string): PlanningSessionStateView {
  const managed = sessions.get(goalId);
  if (!managed) throw new Error("No planning session is active for this aim.");
  managed.handle.postUserMessage(text);
  pushActivity(managed, { at: new Date().toISOString(), kind: "chat", label: text });
  emitView(managed);
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

export function cancelPlanningSession(goalId: string): void {
  const managed = sessions.get(goalId);
  if (!managed) return;
  managed.handle.cancel();
  sessions.delete(goalId);
  metadataStash.delete(goalId);
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
  if (!managed.settled) managed.handle.cancel();
  sessions.delete(goalId);
}

export function cancelAllPlanningSessions(): void {
  for (const goalId of [...sessions.keys()]) cancelPlanningSession(goalId);
}
