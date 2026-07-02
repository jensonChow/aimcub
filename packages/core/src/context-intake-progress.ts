import type { ContextCategory } from "@core/types";
import type {
  ContextAcquisitionChannel,
  ContextCaptureScope,
  ContextIntakeLoopReport,
  ContextIntakeOutputKind,
  ContextIntakeLoopStep,
} from "./aim-intake";

export type ContextIntakeProgressSignalSource =
  | "tool_observation"
  | "memory_candidate"
  | "user_request"
  | "user_answer";

export type ContextIntakeProgressStatus =
  | "satisfied"
  | "pending"
  | "blocked";

export interface ContextIntakeProgressSignal {
  source: ContextIntakeProgressSignalSource;
  channel?: ContextAcquisitionChannel;
  toolName?: string;
  category?: ContextCategory;
  scope?: ContextCaptureScope;
  questionId?: string;
  summary?: string;
}

export interface ContextIntakeProgressStep {
  stepId: string;
  acquisitionId: string;
  channel: ContextAcquisitionChannel;
  status: ContextIntakeProgressStatus;
  matchedSignalCount: number;
  requestedUserInputCount: number;
  satisfiedOutputs: ContextIntakeOutputKind[];
  remainingOutputs: ContextIntakeOutputKind[];
  blocksPlanAcceptance: boolean;
  reason: string;
}

export interface ContextIntakeProgressReport {
  version: 1;
  shouldContinue: boolean;
  nextStepId: string | null;
  satisfiedCount: number;
  blockedAcceptanceCount: number;
  pendingCount: number;
  steps: ContextIntakeProgressStep[];
  nextActions: string[];
}

export interface ReviewContextIntakeProgressInput {
  loop: ContextIntakeLoopReport;
  signals?: readonly ContextIntakeProgressSignal[];
}

function signalMatchesStep(signal: ContextIntakeProgressSignal, step: ContextIntakeLoopStep): boolean {
  if (signal.channel && signal.channel === step.channel) return true;
  if (signal.toolName && step.toolCalls.some((tool) => tool.name === signal.toolName)) return true;
  if (signal.category && step.memoryPlan.some((target) => target.categories.includes(signal.category!))) return true;
  return false;
}

function isFirstPartyMemorySearch(signal: ContextIntakeProgressSignal): boolean {
  return signal.source === "tool_observation" && signal.toolName === "memory.search";
}

function toolObservationGroundsAimContext(signal: ContextIntakeProgressSignal, step: ContextIntakeLoopStep): boolean {
  if (signal.source !== "tool_observation") return false;
  if (step.channel === "web_research") {
    return signal.toolName === "web.fetch";
  }
  if (step.channel === "personal_database") {
    if (isFirstPartyMemorySearch(signal)) return signal.scope === "aim";
    return typeof signal.toolName === "string" && step.toolCalls.some((tool) =>
      tool.name === signal.toolName && tool.boundary === "external_connector",
    );
  }
  return true;
}

function outputSatisfied(
  output: ContextIntakeOutputKind,
  step: ContextIntakeLoopStep,
  signals: readonly ContextIntakeProgressSignal[],
): boolean {
  switch (output) {
    case "clarifying_answer":
      return signals.some((signal) =>
        signal.source === "user_answer" &&
        signalMatchesStep(signal, step),
      );
    case "aim_context":
      return signals.some((signal) =>
        signalMatchesStep(signal, step) &&
        signal.source !== "user_request" &&
        (signal.source === "tool_observation" ? toolObservationGroundsAimContext(signal, step) : signal.scope === "aim"),
      );
    case "durable_memory_candidate":
      return signals.some((signal) =>
        signalMatchesStep(signal, step) &&
        (signal.source === "memory_candidate" || signal.scope === "global"),
      );
  }
}

function runtimeBlocked(step: ContextIntakeLoopStep, matched: readonly ContextIntakeProgressSignal[]): boolean {
  if (step.status === "needs_permission") {
    return !matched.some((signal) =>
      signal.source === "tool_observation" || signal.source === "memory_candidate",
    );
  }
  if (step.status === "needs_connector") {
    if (step.channel === "personal_database" && matched.some(isFirstPartyMemorySearch)) return false;
    const connectorTools = new Set(step.toolCalls
      .filter((tool) => tool.boundary === "external_connector")
      .map((tool) => tool.name));
    return connectorTools.size > 0 &&
      !matched.some((signal) =>
        signal.source === "tool_observation" &&
        typeof signal.toolName === "string" &&
        connectorTools.has(signal.toolName),
      );
  }
  return false;
}

function pendingStatus(step: ContextIntakeLoopStep, matched: readonly ContextIntakeProgressSignal[]): ContextIntakeProgressStatus {
  if (runtimeBlocked(step, matched)) return "blocked";
  return "pending";
}

function progressReason(input: {
  step: ContextIntakeLoopStep;
  status: ContextIntakeProgressStatus;
  matchedSignalCount: number;
  requestedUserInputCount: number;
  remainingOutputs: readonly ContextIntakeOutputKind[];
}): string {
  if (input.status === "satisfied") {
    return `${input.step.channel} context intake is satisfied by ${input.matchedSignalCount} signal${input.matchedSignalCount === 1 ? "" : "s"}.`;
  }
  if (input.status === "blocked") {
    return `${input.step.channel} context intake is waiting on ${input.step.status.replace(/_/g, " ")}.`;
  }
  if (input.requestedUserInputCount > 0) {
    return `${input.step.channel} context intake is waiting on ${input.requestedUserInputCount} user request${input.requestedUserInputCount === 1 ? "" : "s"} and still needs ${input.remainingOutputs.join(", ")}.`;
  }
  return `${input.step.channel} context intake still needs ${input.remainingOutputs.join(", ")}.`;
}

function progressStep(
  step: ContextIntakeLoopStep,
  signals: readonly ContextIntakeProgressSignal[],
): ContextIntakeProgressStep {
  const matched = signals.filter((signal) => signalMatchesStep(signal, step));
  const requestedUserInputCount = matched.filter((signal) => signal.source === "user_request").length;
  const satisfiedOutputs = step.outputs.filter((output) => outputSatisfied(output, step, matched));
  const remainingOutputs = step.outputs.filter((output) => !satisfiedOutputs.includes(output));
  const status: ContextIntakeProgressStatus = remainingOutputs.length === 0
    ? "satisfied"
    : pendingStatus(step, matched);
  return {
    stepId: step.id,
    acquisitionId: step.acquisitionId,
    channel: step.channel,
    status,
    matchedSignalCount: matched.length,
    requestedUserInputCount,
    satisfiedOutputs,
    remainingOutputs,
    blocksPlanAcceptance: step.blocksPlanAcceptance,
    reason: progressReason({ step, status, matchedSignalCount: matched.length, requestedUserInputCount, remainingOutputs }),
  };
}

function nextActions(input: {
  steps: readonly ContextIntakeProgressStep[];
  nextStep: ContextIntakeProgressStep | null;
}): string[] {
  const actions: string[] = [];
  const blocking = input.steps.filter((step) => step.blocksPlanAcceptance && step.status !== "satisfied");
  if (input.nextStep) {
    actions.push(`Continue ${input.nextStep.channel} context intake via ${input.nextStep.stepId}.`);
  }
  if (blocking.length > 0) {
    actions.push(`${blocking.length} context intake step${blocking.length === 1 ? "" : "s"} still block plan acceptance.`);
  }
  const blocked = input.steps.filter((step) => step.status === "blocked");
  if (blocked.length > 0) {
    actions.push(`Resolve permissions or connector setup for ${blocked.length} blocked context step${blocked.length === 1 ? "" : "s"}.`);
  }
  if (actions.length === 0) {
    actions.push("Context intake loop is satisfied enough for decomposition; continue collecting eval signals during execution.");
  }
  return actions;
}

export function reviewContextIntakeProgress(
  input: ReviewContextIntakeProgressInput,
): ContextIntakeProgressReport {
  const signals = input.signals ?? [];
  const steps = input.loop.steps.map((step) => progressStep(step, signals));
  const blockingNext = steps.find((step) => step.blocksPlanAcceptance && step.status !== "satisfied") ?? null;
  const nextStep = blockingNext ?? steps.find((step) => step.status !== "satisfied") ?? null;
  const shouldContinue = Boolean(nextStep);
  return {
    version: 1,
    shouldContinue,
    nextStepId: nextStep?.stepId ?? null,
    satisfiedCount: steps.filter((step) => step.status === "satisfied").length,
    blockedAcceptanceCount: steps.filter((step) => step.blocksPlanAcceptance && step.status !== "satisfied").length,
    pendingCount: steps.filter((step) => step.status !== "satisfied").length,
    steps,
    nextActions: nextActions({ steps, nextStep }),
  };
}
