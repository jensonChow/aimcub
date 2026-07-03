import type {
  AimIntakeReport,
  ContextIntakeProgressReport,
  ContextSedimentationReport,
  PlanQualityReport,
  PlanReviewReport,
} from "@core/domain";
import type { GoalDomain } from "@core/types";

export type GoalDebugTraceMode = "live" | "mock";
export type GoalDebugModelProvider = "anthropic" | "local";
export type GoalDebugModelStatus = "model_succeeded" | "local_fallback" | "local_only";

export interface GoalDebugUsageEvent {
  task: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
}

export interface GoalDebugContextStage {
  label: string;
  intake: AimIntakeReport;
  progress: ContextIntakeProgressReport;
  sedimentation: ContextSedimentationReport;
}

export interface GoalDebugTrace {
  version: 1;
  generatedAt: string;
  mode: GoalDebugTraceMode;
  aim: {
    title: string;
    description: string;
    domain: GoalDomain;
  };
  model: {
    task: "decompose";
    primaryProvider: GoalDebugModelProvider;
    finalProvider: GoalDebugModelProvider;
    status: GoalDebugModelStatus;
    attempts: number;
    retried: boolean;
    structuredOutput: true;
    usage: GoalDebugUsageEvent[];
    fallbackReason?: string;
    reasoningVisibility: string;
  };
  context: {
    selectedContextCount: number;
    toolObservationCount: number;
    preModel: GoalDebugContextStage;
    postModel: GoalDebugContextStage;
  };
  plan: {
    summary: string;
    rationale: string;
    nodeCount: number;
    edgeCount: number;
    quality: PlanQualityReport;
    review: PlanReviewReport;
    nodes: Array<{
      key: string;
      title: string;
      why: string;
      definitionOfDone: string;
      evalSignal: string;
      likelyOwner: string;
      contextGaps: string[];
    }>;
  };
  notices: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function goalDebugTraceFromMetadata(metadata: Record<string, unknown> | null | undefined): GoalDebugTrace | null {
  const trace = metadata?.debug_trace;
  if (!isRecord(trace)) return null;
  if (trace.version !== 1 || !isRecord(trace.model) || !isRecord(trace.context) || !isRecord(trace.plan)) {
    return null;
  }
  return trace as unknown as GoalDebugTrace;
}
