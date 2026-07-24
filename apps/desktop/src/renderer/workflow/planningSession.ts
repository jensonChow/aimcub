/**
 * Pure renderer transforms for the embedded planning session (the local agent
 * as the aim-breaking brain). Side-effect free and unit-tested; IPC calls and
 * state transitions stay in App.tsx.
 */
import type { ClarifyOutput } from "@aimcub/llm";
import type { PlanningSessionQuestion } from "@aimcub/llm";

import type { DesktopPreferences, PlanningAgentDetection, PlanningSessionAnswerRequest, PlanningSessionStateView } from "../../shared/ipc";
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
