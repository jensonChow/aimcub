/**
 * Pure renderer transforms for the embedded planning session (the local agent
 * as the aim-breaking brain). Side-effect free and unit-tested; IPC calls and
 * state transitions stay in App.tsx.
 */
import type { ClarifyOutput } from "@aimcub/llm";
import type { PlanningSessionQuestion } from "@aimcub/llm";

import type {
  DesktopPreferences,
  PlanningAgentDetection,
  PlanningSessionActivityItem,
  PlanningSessionAnswerRequest,
  PlanningSessionStateView,
} from "../../shared/ipc";
import type { ContextAnswerMap } from "../stages/context/types";

/** A runtime that could run a planning session right now: capable, installed, authenticated. */
function sessionReady(detection: PlanningAgentDetection): boolean {
  return detection.planningCapable && detection.available && detection.authStatus === "ok";
}

/**
 * The brain a new Desktop session would use: the user's pick when it is
 * session-ready, else the first session-ready runtime. Capability comes from
 * main on each detection row — the renderer never mirrors adapter knowledge
 * (a stale mirror once hid the embedded path on a codex-only machine).
 */
export function embeddedPlanningAgentId(
  detections: readonly PlanningAgentDetection[],
  brainPref: DesktopPreferences["planningBrain"] = null,
): string | null {
  if (brainPref) {
    const picked = detections.find((detection) => detection.id === brainPref);
    if (picked && sessionReady(picked)) return picked.id;
  }
  return detections.find(sessionReady)?.id ?? null;
}

/** Auth probes sometimes emit raw JSON; a tooltip deserves words, not payloads. */
function humanAuthReason(detection: PlanningAgentDetection): string {
  if (!detection.available) return "Not installed";
  const message = detection.authMessage?.trim() ?? "";
  if (message && !message.startsWith("{") && message.length <= 80) return message;
  return "Sign in required";
}

export interface PlanningBrainMenuOption {
  id: string;
  label: string;
  selected: boolean;
  /** Present but unusable (signed out / unavailable): rendered disabled with the reason. */
  disabledReason: string | null;
}

export interface PlanningBrainMenu {
  /** The brain a new session would actually use. */
  effectiveAgentId: string;
  currentLabel: string;
  autoSelected: boolean;
  options: PlanningBrainMenuOption[];
}

/**
 * The brain chooser, parallel to the model chooser. Every planning-capable
 * runtime is listed — a signed-out one shows disabled with its auth message —
 * and Auto follows registry order. Null when nothing could run a session.
 */
export function planningBrainMenu(
  detections: readonly PlanningAgentDetection[],
  brainPref: DesktopPreferences["planningBrain"],
): PlanningBrainMenu | null {
  const effective = embeddedPlanningAgentId(detections, brainPref);
  if (!effective) return null;
  const capable = detections.filter((detection) => detection.planningCapable);
  if (capable.length === 0) return null;
  const pickedHonored = Boolean(brainPref) && effective === brainPref;
  return {
    effectiveAgentId: effective,
    currentLabel: capable.find((detection) => detection.id === effective)?.name ?? effective,
    autoSelected: !pickedHonored,
    options: capable.map((detection) => ({
      id: detection.id,
      label: detection.name,
      selected: pickedHonored && detection.id === brainPref,
      disabledReason: sessionReady(detection)
        ? null
        : humanAuthReason(detection),
    })),
  };
}

/**
 * A session question rendered through the existing one-question clarify surface:
 * the payload is ClarifyQuestion-compatible by design, so the focused-question
 * invariants (one visible question, choice cardinality, free-text escape hatch)
 * carry over without a new component.
 */
export function sessionQuestionClarifyOutput(question: PlanningSessionQuestion): ClarifyOutput {
  return {
    questions: [
      {
        id: question.id,
        question: question.question,
        why_high_impact: question.why_high_impact,
        kind: question.kind,
        allow_other: true,
        selection_mode: question.selection_mode,
        selection_mode_reason: question.selection_mode_reason,
        options: question.options.map((option) => ({ label: option.label, tradeoff: option.tradeoff })),
      },
    ],
    assumptions: [],
  };
}

/** Build the answer IPC request from the shared context answer map entry. */
export function sessionAnswerRequest(
  goalId: string,
  question: PlanningSessionQuestion,
  answers: ContextAnswerMap,
): PlanningSessionAnswerRequest {
  const entry = answers[question.id] ?? { labels: [], other: "" };
  return {
    goalId,
    requestId: question.id,
    labels: entry.labels,
    other: entry.other,
  };
}

export interface PlanningModelMenuOption {
  id: string;
  label: string;
  selected: boolean;
}

export interface PlanningModelMenu {
  agentId: string;
  /** Chip label: the effective model (explicit pick, else the auto fallback), or the Auto wording. */
  currentLabel: string | null;
  autoSelected: boolean;
  options: PlanningModelMenuOption[];
}

/**
 * The model menu for the EFFECTIVE planning brain, mirroring the runtime's
 * LIVE-advertised list (a fallback catalog is a guess, not a menu). Returns
 * null when there is no usable brain or nothing live to offer — the chip
 * simply does not render.
 */
export function planningModelMenu(
  detections: readonly PlanningAgentDetection[],
  pref: DesktopPreferences["planningModel"],
  brainPref: DesktopPreferences["planningBrain"] = null,
): PlanningModelMenu | null {
  const agentId = embeddedPlanningAgentId(detections, brainPref);
  if (!agentId) return null;
  const detection = detections.find((entry) => entry.id === agentId);
  if (!detection || detection.modelsSource !== "live") return null;
  const models = detection.models.filter((model) => model.id !== "default");
  if (models.length === 0) return null;
  const picked = pref && pref.agentId === agentId && models.some((model) => model.id === pref.model)
    ? pref.model
    : null;
  const autoModel = models[0]?.id ?? null;
  return {
    agentId,
    currentLabel: picked ?? autoModel,
    autoSelected: picked === null,
    options: models.map((model) => ({
      id: model.id,
      label: model.label || model.id,
      selected: model.id === picked,
    })),
  };
}

/** True when the payload belongs to the aim the cockpit is currently showing. */
export function sessionPayloadIsCurrent(
  view: PlanningSessionStateView | null,
  selectedGoalId: string | null | undefined,
): boolean {
  return Boolean(view && selectedGoalId && view.goalId === selectedGoalId);
}

/** The session is worth a surface: running, waiting, failed, or landed-but-uncommitted. */
export function sessionSurfaceVisible(view: PlanningSessionStateView | null): boolean {
  if (!view) return false;
  if (view.active) return true;
  if (view.failure) return true;
  return view.phase === "draft_ready" && view.landing !== null;
}

// ── Live-lane activity voice ─────────────────────────────────────────────────
//
// Main emits structured activity items; these helpers turn them into localized
// product-voice lines ("Searching the web"), and return null for anything that
// cannot be said in product language — a null row is silently dropped, so raw
// event types and tool ids never reach the surface.

type TranslateFn = (key: string, vars?: Record<string, string | number>) => string;

/** First-party planning tools and common runtime tools → concrete working verbs. */
const TOOL_LINE_KEY: Record<string, string> = {
  "ask user": "planningSession.now.askUser",
  "search memory": "planningSession.now.searchMemory",
  "report research": "planningSession.now.reportResearch",
  "propose memory": "planningSession.now.proposeMemory",
  "submit plan": "planningSession.now.submitPlan",
  "web search": "planningSession.now.webSearch",
  "web fetch": "planningSession.now.webFetch",
  "local read": "planningSession.now.readLocal",
  "read": "planningSession.now.readLocal",
  "glob": "planningSession.now.readLocal",
  "grep": "planningSession.now.readLocal",
  "context distill": "planningSession.now.reportResearch",
  "bash": "planningSession.now.probeWorkspace",
  "shell": "planningSession.now.probeWorkspace",
};

/** "mcp__aimcub__report_research" → "report research"; "web.search" → "web search". */
export function humanizeToolId(tool: string): string {
  const stripped = tool.replace(/^mcp__[a-z0-9-]+__/i, "");
  return stripped.replace(/[._-]+/g, " ").trim().toLowerCase();
}

/**
 * Where a line sits in the trace: the one step still happening, or a step that is
 * already history. Tense is derived from this, never hand-written per string — a
 * history row that said "Reading the aim and your context" under a finished tick
 * claimed work that had already stopped (founder, 2026-07-26).
 */
export type PlanningActivityTense = "now" | "done";

/**
 * One activity item → one localized line, or null when there is nothing sayable.
 * Question, chat, and reject-reason text pass through as content; everything
 * else speaks through i18n keys only.
 *
 * `tense` picks the completed wording for a row that has been passed. Most lines
 * already record something that happened ("Recorded 3 research findings") and read
 * correctly either way; only `DONE_LINE_KEY` entries change words.
 */
export function planningActivityLine(
  item: Pick<PlanningSessionActivityItem, "kind" | "label" | "code" | "tool" | "count">,
  t: TranslateFn,
  tense: PlanningActivityTense = "now",
): string | null {
  if (item.kind === "question") {
    return item.label.trim() ? t("planningSession.now.askedYou", { q: item.label.trim() }) : null;
  }
  if (item.kind === "chat") {
    return item.label.trim() ? t("planningSession.now.chat", { text: item.label.trim() }) : null;
  }
  if (item.kind === "research") {
    return item.count && item.count > 0 ? t("planningSession.now.research", { n: item.count }) : null;
  }
  if (item.kind === "tool") {
    // A tool line is a working verb — it describes the moment, and there is no honest
    // completed form of it. Refusing to render one as history is what makes "Searching
    // the web" structurally unable to sit under a finished tick.
    if (tense === "done") return null;
    const human = humanizeToolId(item.tool ?? "");
    if (!human) return null;
    const key = TOOL_LINE_KEY[human];
    // Unknown runtime tool ids stay unsayable: a raw id interpolated into copy reads as
    // debugger noise ("Using tool"), so fall back to the honest generic working line.
    return key ? t(key) : t("planningSession.now.researching");
  }
  switch (item.code) {
    case "started":
      return t(tense === "done" ? "planningSession.done.started" : "planningSession.now.started");
    case "question_answered":
      return t("planningSession.now.answered");
    case "question_skipped":
      return t("planningSession.now.skipped");
    case "draft_now":
      return t("planningSession.now.draftNow");
    case "plan_accepted":
      return t("planningSession.now.planAccepted");
    case "plan_rejected":
      return t(
        tense === "done" ? "planningSession.done.planRejected" : "planningSession.now.planRejected",
        { n: item.count ?? 1 },
      );
    case "memory_proposed":
      return t("planningSession.now.memory");
    default:
      return null;
  }
}

/** The single "now" line for the live card: the latest sayable activity. */
export function planningActivityNow(
  activity: readonly PlanningSessionActivityItem[],
  t: TranslateFn,
): string | null {
  for (let index = activity.length - 1; index >= 0; index -= 1) {
    const line = planningActivityLine(activity[index]!, t);
    if (line) return line;
  }
  return null;
}

/**
 * The card's thought trace: what the brain has DONE, ending on what it is doing now.
 * History keeps only durable events (findings recorded, questions, answers, notes, plan
 * beats); transient working verbs (tool activity — "Searching the web", "Researching…")
 * matter only as the CURRENT line and drop out once passed, so the trace never reads
 * "Researching… / … / Researching…". Unsayable rows drop, consecutive duplicates collapse,
 * and the trace caps at `limit` lines.
 *
 * Tense follows position, so the words always agree with the tick beside them: only the
 * last row of a `live` trace speaks in progress, everything above it is history. Pass
 * `live: false` for a pass that has stopped — it has no current step at all, so no row
 * may claim one.
 */
export function planningActivityTrace(
  activity: readonly PlanningSessionActivityItem[],
  t: TranslateFn,
  limit = 6,
  live = true,
): string[] {
  type TraceItem = Pick<PlanningSessionActivityItem, "kind" | "label" | "code" | "tool" | "count">;
  const history: TraceItem[] = [];
  const historyLines: string[] = [];
  let current: TraceItem | null = null;
  for (const item of activity) {
    if (item.kind === "tool") {
      // Working verbs never enter history; a stopped trace drops them entirely.
      if (live && planningActivityLine(item, t)) current = item;
      continue;
    }
    const line = planningActivityLine(item, t, "done");
    if (!line) continue;
    current = null;
    if (historyLines[historyLines.length - 1] === line) continue;
    history.push(item);
    historyLines.push(line);
  }
  const rows = current ? [...history, current] : history;
  return rows.slice(-limit).flatMap((item, index, kept) => {
    const line = planningActivityLine(item, t, live && index === kept.length - 1 ? "now" : "done");
    return line ? [line] : [];
  });
}
