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
        (signal.scope === "aim" || signal.source === "tool_observation"),
      );
    case "durable_memory_candidate":
      return signals.some((signal) =>
        signalMatchesStep(signal, step) &&
        (signal.source === "memory_candidate" || signal.scope === "global"),
      );
  }
}

function pendingStatus(step: ContextIntakeLoopStep): ContextIntakeProgressStatus {
  if (step.status === "needs_permission" || step.status === "needs_connector") return "blocked";
  return "pending";
}

function progressReason(input: {
  step: ContextIntakeLoopStep;
  status: ContextIntakeProgressStatus;
  matchedSignalCount: number;
  remainingOutputs: readonly ContextIntakeOutputKind[];
}): string {
  if (input.status === "satisfied") {
    return `${input.step.channel} context intake is satisfied by ${input.matchedSignalCount} signal${input.matchedSignalCount === 1 ? "" : "s"}.`;
  }
  if (input.status === "blocked") {
    return `${input.step.channel} context intake is waiting on ${input.step.status.replace(/_/g, " ")}.`;
  }
  return `${input.step.channel} context intake still needs ${input.remainingOutputs.join(", ")}.`;
}

function progressStep(
  step: ContextIntakeLoopStep,
  signals: readonly ContextIntakeProgressSignal[],
): ContextIntakeProgressStep {
  const matched = signals.filter((signal) => signalMatchesStep(signal, step));
  const satisfiedOutputs = step.outputs.filter((output) => outputSatisfied(output, step, matched));
  const remainingOutputs = step.outputs.filter((output) => !satisfiedOutputs.includes(output));
  const status: ContextIntakeProgressStatus = remainingOutputs.length === 0
    ? "satisfied"
    : pendingStatus(step);
  return {
    stepId: step.id,
    acquisitionId: step.acquisitionId,
    channel: step.channel,
    status,
    matchedSignalCount: matched.length,
    satisfiedOutputs,
    remainingOutputs,
    blocksPlanAcceptance: step.blocksPlanAcceptance,
    reason: progressReason({ step, status, matchedSignalCount: matched.length, remainingOutputs }),
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
