import type { ContextCategory, Memory, MemoryKind } from "@core/types";
import type {
  ContextAcquisitionChannel,
  ContextCaptureScope,
  ContextIntakeLoopReport,
} from "./aim-intake";
import { isPromptLikeContextCandidate } from "./context";
import type {
  ContextIntakeProgressReport,
  ContextIntakeProgressSignal,
} from "./context-intake-progress";

export type ContextSedimentationSource =
  | "tool_observation"
  | "memory_candidate"
  | "user_answer"
  | "distilled_context";

export interface ContextSedimentationCandidateInput {
  content: string;
  category: ContextCategory;
  scope: ContextCaptureScope;
  source: ContextSedimentationSource;
  channel?: ContextAcquisitionChannel;
  stepId?: string;
  originId?: string;
  confidence?: number;
}

export interface ContextSedimentationAimContext {
  content: string;
  category: ContextCategory;
  source: ContextSedimentationSource;
  channel?: ContextAcquisitionChannel;
  stepId?: string;
  reason: string;
}

export interface ContextSedimentationMemoryCandidate {
  content: string;
  kind: MemoryKind;
  category: ContextCategory;
  source: Memory["source"];
  confidence: number;
  channel?: ContextAcquisitionChannel;
  stepId?: string;
  originId?: string;
  reason: string;
}

export interface ContextSedimentationPendingStep {
  stepId: string;
  channel: ContextAcquisitionChannel;
  status: "pending" | "blocked";
  blocksPlanAcceptance: boolean;
  remainingOutputs: string[];
  reason: string;
}

export interface ContextSedimentationReport {
  version: 1;
  readyForDecomposition: boolean;
  shouldIterate: boolean;
  aimContextCount: number;
  durableMemoryCandidateCount: number;
  aimContext: ContextSedimentationAimContext[];
  durableMemoryCandidates: ContextSedimentationMemoryCandidate[];
  pendingSteps: ContextSedimentationPendingStep[];
  nextActions: string[];
}

export interface ReviewContextSedimentationInput {
  loop: ContextIntakeLoopReport;
  progress?: ContextIntakeProgressReport | null;
  signals?: readonly ContextIntakeProgressSignal[];
  candidates?: readonly ContextSedimentationCandidateInput[];
  maxAimContext?: number;
  maxMemoryCandidates?: number;
}

function cleanText(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function candidateKey(input: Pick<ContextSedimentationCandidateInput, "content" | "category" | "scope">): string {
  return [
    input.scope,
    input.category,
    cleanText(input.content).toLowerCase(),
  ].join("\u0000");
}

function memoryKindForCategory(category: ContextCategory): MemoryKind {
  return category === "procedure" ? "procedural" : "semantic";
}

function memorySourceForSedimentation(source: ContextSedimentationSource): Memory["source"] {
  switch (source) {
    case "user_answer":
      return "user_stated";
    case "tool_observation":
    case "memory_candidate":
    case "distilled_context":
      return "agent_inferred";
  }
}

function defaultConfidence(candidate: ContextSedimentationCandidateInput): number {
  if (typeof candidate.confidence === "number" && Number.isFinite(candidate.confidence)) {
    return Math.max(0, Math.min(1, candidate.confidence));
  }
  switch (candidate.source) {
    case "user_answer":
      return 0.82;
    case "memory_candidate":
      return 0.8;
    case "distilled_context":
      return 0.74;
    case "tool_observation":
      return 0.68;
  }
}

function scopeForSignal(signal: ContextIntakeProgressSignal): ContextCaptureScope | null {
  if (signal.scope) return signal.scope;
  if (signal.source === "tool_observation") return "aim";
  if (signal.source === "memory_candidate") return "global";
  return null;
}

function candidatesFromSignals(signals: readonly ContextIntakeProgressSignal[]): ContextSedimentationCandidateInput[] {
  return signals.flatMap((signal): ContextSedimentationCandidateInput[] => {
    if (signal.source === "user_request") return [];
    if (signal.source === "tool_observation" && signal.channel === "web_research" && signal.toolName !== "web.fetch") return [];
    const content = cleanText(signal.summary);
    const scope = scopeForSignal(signal);
    if (!content || !scope || !signal.category) return [];
    return [{
      content,
      category: signal.category,
      scope,
      source: signal.source,
      channel: signal.channel,
      originId: signal.questionId ?? signal.toolName,
    }];
  });
}

function stepForCandidate(
  candidate: ContextSedimentationCandidateInput,
  loop: ContextIntakeLoopReport,
): string | undefined {
  if (candidate.stepId) return candidate.stepId;
  const step = loop.steps.find((item) =>
    (candidate.channel && item.channel === candidate.channel) ||
    item.memoryPlan.some((target) =>
      target.scope === candidate.scope &&
      target.categories.includes(candidate.category),
    ),
  );
  return step?.id;
}

function normalizeCandidates(input: ReviewContextSedimentationInput): ContextSedimentationCandidateInput[] {
  const candidates = [
    ...candidatesFromSignals(input.signals ?? []),
    ...(input.candidates ?? []),
  ];
  const seen = new Set<string>();
  const normalized: ContextSedimentationCandidateInput[] = [];
  for (const candidate of candidates) {
    const content = cleanText(candidate.content);
    if (!content || isPromptLikeContextCandidate(content)) continue;
    const row = {
      ...candidate,
      content,
      stepId: stepForCandidate(candidate, input.loop),
    };
    const key = candidateKey(row);
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push(row);
  }
  return normalized;
}

function aimContextReason(candidate: ContextSedimentationCandidateInput): string {
  if (candidate.channel) return `Aim-scoped context collected through ${candidate.channel}.`;
  return "Aim-scoped context collected for the current decomposition.";
}

function memoryCandidateReason(candidate: ContextSedimentationCandidateInput): string {
  if (candidate.channel) return `Durable ${candidate.category} context collected through ${candidate.channel}.`;
  return `Durable ${candidate.category} context collected during planning.`;
}

function pendingSteps(
  progress: ContextIntakeProgressReport | null | undefined,
): ContextSedimentationPendingStep[] {
  return (progress?.steps ?? [])
    .filter((step): step is typeof step & { status: "pending" | "blocked" } =>
      step.status === "pending" || step.status === "blocked",
    )
    .map((step) => ({
      stepId: step.stepId,
      channel: step.channel,
      status: step.status,
      blocksPlanAcceptance: step.blocksPlanAcceptance,
      remainingOutputs: step.remainingOutputs,
      reason: step.reason,
    }));
}

function nextActions(input: {
  readyForDecomposition: boolean;
  pendingSteps: readonly ContextSedimentationPendingStep[];
  aimContextCount: number;
  durableMemoryCandidateCount: number;
}): string[] {
  const actions: string[] = [];
  const acceptanceBlocking = input.pendingSteps.filter((step) => step.blocksPlanAcceptance);
  if (acceptanceBlocking.length > 0) {
    actions.push(`Continue ${acceptanceBlocking[0]!.channel} intake before accepting the decomposition.`);
  }
  const blocked = input.pendingSteps.filter((step) => step.status === "blocked");
  if (blocked.length > 0) {
    actions.push(`Resolve permission or connector setup for ${blocked.length} blocked context step${blocked.length === 1 ? "" : "s"}.`);
  }
  if (input.durableMemoryCandidateCount > 0) {
    actions.push(`Review ${input.durableMemoryCandidateCount} durable memory candidate${input.durableMemoryCandidateCount === 1 ? "" : "s"} before promoting to long-term memory.`);
  }
  if (input.aimContextCount > 0) {
    actions.push(`Use ${input.aimContextCount} aim-scoped context item${input.aimContextCount === 1 ? "" : "s"} to refine milestones and handoff briefs.`);
  }
  if (actions.length === 0 && input.readyForDecomposition) {
    actions.push("Context is settled enough to decompose and route tasks to humans or agents.");
  }
  if (actions.length === 0) {
    actions.push("Collect at least one grounded context item before accepting the plan.");
  }
  return actions;
}

export function reviewContextSedimentation(
  input: ReviewContextSedimentationInput,
): ContextSedimentationReport {
  const normalized = normalizeCandidates(input);
  const aimContext = normalized
    .filter((candidate) => candidate.scope === "aim")
    .slice(0, input.maxAimContext ?? 12)
    .map((candidate): ContextSedimentationAimContext => ({
      content: candidate.content,
      category: candidate.category,
      source: candidate.source,
      ...(candidate.channel ? { channel: candidate.channel } : {}),
      ...(candidate.stepId ? { stepId: candidate.stepId } : {}),
      reason: aimContextReason(candidate),
    }));
  const durableMemoryCandidates = normalized
    .filter((candidate) => candidate.scope === "global")
    .slice(0, input.maxMemoryCandidates ?? 12)
    .map((candidate): ContextSedimentationMemoryCandidate => ({
      content: candidate.content,
      kind: memoryKindForCategory(candidate.category),
      category: candidate.category,
      source: memorySourceForSedimentation(candidate.source),
      confidence: defaultConfidence(candidate),
      ...(candidate.channel ? { channel: candidate.channel } : {}),
      ...(candidate.stepId ? { stepId: candidate.stepId } : {}),
      ...(candidate.originId ? { originId: candidate.originId } : {}),
      reason: memoryCandidateReason(candidate),
    }));
  const pending = pendingSteps(input.progress);
  const shouldIterate = pending.some((step) => step.blocksPlanAcceptance);
  const groundedContextCount = aimContext.length + durableMemoryCandidates.length;
  const readyForDecomposition = !shouldIterate && (groundedContextCount > 0 || !input.loop.shouldContinue);

  return {
    version: 1,
    readyForDecomposition,
    shouldIterate,
    aimContextCount: aimContext.length,
    durableMemoryCandidateCount: durableMemoryCandidates.length,
    aimContext,
    durableMemoryCandidates,
    pendingSteps: pending,
    nextActions: nextActions({
      readyForDecomposition,
      pendingSteps: pending,
      aimContextCount: aimContext.length,
      durableMemoryCandidateCount: durableMemoryCandidates.length,
    }),
  };
}
