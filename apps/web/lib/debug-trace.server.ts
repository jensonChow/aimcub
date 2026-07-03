import {
  reviewAimIntake,
  reviewContextIntakeProgress,
  reviewContextSedimentation,
  type PlanReviewReport,
} from "@core/domain";
import type { CreateGoalInput } from "@core/api-client";
import type { DecompositionOutput, GoalDomain } from "@core/types";
import type {
  GoalDebugContextStage,
  GoalDebugModelProvider,
  GoalDebugModelStatus,
  GoalDebugTrace,
  GoalDebugTraceMode,
  GoalDebugUsageEvent,
} from "./debug-trace";

const REASONING_VISIBILITY =
  "Hidden chain-of-thought is not requested or stored; this trace shows model inputs, structured output, quality critique, context gaps, and tool plans.";

function domainOrDefault(domain: GoalDomain | undefined): GoalDomain {
  return domain ?? "software";
}

function buildContextStage(input: {
  label: string;
  title: string;
  description?: string;
  draftReview?: PlanReviewReport | null;
}): GoalDebugContextStage {
  const intake = reviewAimIntake({
    title: input.title,
    description: input.description,
    memories: [],
    selectedContext: [],
    draftReview: input.draftReview ?? null,
  });
  const progress = reviewContextIntakeProgress({ loop: intake.loop, signals: [] });
  const sedimentation = reviewContextSedimentation({ loop: intake.loop, progress, signals: [] });
  return {
    label: input.label,
    intake,
    progress,
    sedimentation,
  };
}

function contractNodeTrace(plan: DecompositionOutput): GoalDebugTrace["plan"]["nodes"] {
  return plan.nodes.map((node) => {
    const contract = node.decomposition_contract;
    return {
      key: node.key,
      title: node.title,
      why: contract?.why ?? "No decomposition contract was returned for this milestone.",
      definitionOfDone: contract?.definition_of_done ?? "",
      evalSignal: contract?.eval_signal ?? "",
      likelyOwner: contract?.likely_owner ?? "either",
      contextGaps: (contract?.context_gaps ?? []).map((gap) => `${gap.category}: ${gap.question}`),
    };
  });
}

export function buildGoalDebugTrace(input: {
  aim: Pick<CreateGoalInput, "title" | "description" | "domain">;
  mode: GoalDebugTraceMode;
  plan: DecompositionOutput;
  review: PlanReviewReport;
  model: {
    primaryProvider: GoalDebugModelProvider;
    finalProvider: GoalDebugModelProvider;
    status: GoalDebugModelStatus;
    attempts: number;
    retried: boolean;
    usage: GoalDebugUsageEvent[];
    fallbackReason?: string;
  };
  generatedAt?: string;
  notices?: string[];
}): GoalDebugTrace {
  const preModel = buildContextStage({
    label: "Before decomposition",
    title: input.aim.title,
    description: input.aim.description,
  });
  const postModel = buildContextStage({
    label: "After draft review",
    title: input.aim.title,
    description: input.aim.description,
    draftReview: input.review,
  });
  const notices = [
    ...(input.notices ?? []),
    ...(input.model.status === "local_only" ? ["No model API key was configured, so the deterministic local decomposer produced this plan."] : []),
    ...(input.model.status === "local_fallback" ? ["The live model path did not produce an accepted plan, so the deterministic local decomposer produced this plan."] : []),
  ];

  return {
    version: 1,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    mode: input.mode,
    aim: {
      title: input.aim.title,
      description: input.aim.description ?? "",
      domain: domainOrDefault(input.aim.domain),
    },
    model: {
      task: "decompose",
      primaryProvider: input.model.primaryProvider,
      finalProvider: input.model.finalProvider,
      status: input.model.status,
      attempts: Math.max(1, input.model.attempts),
      retried: input.model.retried,
      structuredOutput: true,
      usage: input.model.usage,
      ...(input.model.fallbackReason ? { fallbackReason: input.model.fallbackReason } : {}),
      reasoningVisibility: REASONING_VISIBILITY,
    },
    context: {
      selectedContextCount: 0,
      toolObservationCount: 0,
      preModel,
      postModel,
    },
    plan: {
      summary: input.plan.goal_summary,
      rationale: input.plan.rationale,
      nodeCount: input.plan.nodes.length,
      edgeCount: input.plan.edges.length,
      quality: input.review.quality,
      review: input.review,
      nodes: contractNodeTrace(input.plan),
    },
    notices,
  };
}
