/**
 * Pure renderer transforms for the embedded planning session (the local agent
 * as the aim-breaking brain). Side-effect free and unit-tested; IPC calls and
 * state transitions stay in App.tsx.
 */
import type { ClarifyOutput } from "@aimcub/llm";
import type { PlanningSessionQuestion } from "@aimcub/llm";
import type { LocalAgentDetection } from "@aimcub/local-agent";

import type { PlanningSessionAnswerRequest, PlanningSessionStateView } from "../../shared/ipc";
import type { ContextAnswerMap } from "../stages/context/types";

/** Renderer-side mirror of the main gate: which runtime can act as the planning brain. */
export function embeddedPlanningAgentId(detections: readonly LocalAgentDetection[]): string | null {
  const claude = detections.find((agent) => agent.id === "claude");
  return claude && claude.available && claude.authStatus === "ok" ? claude.id : null;
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
