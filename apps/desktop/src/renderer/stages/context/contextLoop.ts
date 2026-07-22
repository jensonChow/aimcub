import type { AimIntakeReport } from "@aimcub/core";
import type { PlanningContextSelectionReport } from "@aimcub/llm";

import type { ContextSourceStatus, PlanningLiveEvent, PlanningToolIpcTrace } from "../../../shared/ipc";
import type { ContextBundleReview } from "../../contextReview";
import type { StringKey } from "../../i18n";

export type ContextActivityState = "idle" | "waiting" | "active" | "complete" | "blocked";
export type ContextSufficiencyLevel = "thin" | "useful" | "strong";

export interface ContextLoopMessage {
  key: StringKey;
  vars?: Record<string, string | number>;
}

export interface ContextActivityItem {
  id: "local" | "linked" | "web" | "distill" | "questions";
  state: ContextActivityState;
  title: ContextLoopMessage;
  body: ContextLoopMessage;
}

export interface ContextSufficiencySignal {
  score: number;
  level: ContextSufficiencyLevel;
  summary: ContextLoopMessage;
  next: ContextLoopMessage;
  warnings: ContextLoopMessage[];
}

export interface ContextLoopModel {
  hasLiveResearchData: boolean;
  activity: ContextActivityItem[];
  sufficiency: ContextSufficiencySignal;
}

export interface ContextLoopModelInput {
  contextSources: ContextSourceStatus | null;
  review: ContextBundleReview;
  planningContext?: PlanningContextSelectionReport | null;
  planningTools?: PlanningToolIpcTrace | null;
  intake?: AimIntakeReport | null;
  liveEvents?: readonly PlanningLiveEvent[];
  running?: boolean;
  answeredQuestionCount?: number;
  questionCount?: number;
  contextNote?: string;
}

function message(key: StringKey, vars?: Record<string, string | number>): ContextLoopMessage {
  return vars ? { key, vars } : { key };
}

function clampScore(score: number): number {
  return Math.max(0, Math.min(100, Math.round(score)));
}

function localPathCount(status: ContextSourceStatus | null): number {
  if (!status?.local.enabled) return 0;
  const folderCount = status.local.resolvedWorkspaceRoot || status.local.workspaceRoot ? 1 : 0;
  const fileCount = status.local.resolvedFilePaths?.length ?? status.local.filePaths.length;
  return folderCount + fileCount;
}

function onlineReferenceCount(status: ContextSourceStatus | null): number {
  if (!status?.online.enabled) return 0;
  return status.online.sources.filter((source) => source.enabled && source.reference.trim().length > 0).length;
}

function toolEvents(planningTools: PlanningToolIpcTrace | null | undefined, prefix: string) {
  return (planningTools?.observationEvents ?? []).filter((event) => event.toolName.startsWith(prefix));
}

function toolEvent(planningTools: PlanningToolIpcTrace | null | undefined, toolName: string) {
  return (planningTools?.observationEvents ?? []).filter((event) => event.toolName === toolName);
}

function toolFailures(planningTools: PlanningToolIpcTrace | null | undefined, prefix: string) {
  return (planningTools?.failures ?? []).filter((failure) => failure.toolName.startsWith(prefix));
}

function toolFailure(planningTools: PlanningToolIpcTrace | null | undefined, toolName: string) {
  return (planningTools?.failures ?? []).filter((failure) => failure.toolName === toolName);
}

function observationSourceCount(planningTools: PlanningToolIpcTrace | null | undefined, prefix: string): number {
  return toolEvents(planningTools, prefix).reduce((sum, event) => sum + event.observation.sources.length, 0);
}

function totalObservationCount(planningTools: PlanningToolIpcTrace | null | undefined): number {
  return planningTools?.observationEvents?.length ?? planningTools?.observations.length ?? 0;
}

function hasLiveData(input: ContextLoopModelInput): boolean {
  return Boolean(
    input.running
      || (input.liveEvents?.length ?? 0) > 0
      || input.planningContext
      || input.planningTools
      || input.intake,
  );
}

function buildActivity(input: ContextLoopModelInput): ContextActivityItem[] {
  const planningTools = input.planningTools;
  const running = Boolean(input.running);
  const localCount = localPathCount(input.contextSources);
  const linkedCount = onlineReferenceCount(input.contextSources);
  const webEnabled = input.contextSources?.research.webEnabled === true;
  const intakePaused = input.contextSources
    ? !input.contextSources.questionnaire.enabled && !input.contextSources.userSession.enabled
    : false;

  const localEvents = toolEvents(planningTools, "local.");
  const localFailures = toolFailures(planningTools, "local.");
  const linkedEvents = toolEvent(planningTools, "context.linked_sources");
  const linkedBlockedCount = input.review.permissionGaps.filter((item) => item.id.startsWith("linked-")).length;
  const webEvents = toolEvents(planningTools, "web.");
  const webFailures = toolFailures(planningTools, "web.");
  const distillEvents = toolEvent(planningTools, "context.distill");
  const distillFailures = toolFailure(planningTools, "context.distill");
  const distillation = planningTools?.distillation ?? null;
  const questionCount = Math.max(
    input.questionCount ?? 0,
    input.intake?.questions.length ?? 0,
    distillation?.missingQuestions.length ?? 0,
  );
  const observationCount = totalObservationCount(planningTools);

  const localState: ContextActivityState = localFailures.length
    ? "blocked"
    : localEvents.length
      ? "complete"
      : running && localCount > 0
        ? "active"
        : localCount > 0
          ? "waiting"
          : "idle";

  const linkedState: ContextActivityState = linkedBlockedCount > 0
    ? "blocked"
    : linkedEvents.length
      ? "complete"
      : running && linkedCount > 0
        ? "active"
        : linkedCount > 0
          ? "waiting"
          : "idle";

  const webState: ContextActivityState = webFailures.length
    ? "blocked"
    : webEvents.length
      ? "complete"
      : running && webEnabled
        ? "active"
        : webEnabled
          ? "waiting"
          : "idle";

  const distillState: ContextActivityState = distillFailures.length
    ? "blocked"
    : distillation || distillEvents.length
      ? "complete"
      : running && observationCount > 0
        ? "active"
        : "waiting";

  const questionState: ContextActivityState = intakePaused && questionCount === 0
    ? "blocked"
    : questionCount > 0
      ? "complete"
      : running
        ? "active"
        : "waiting";

  return [
    {
      id: "local",
      state: localState,
      title: message("context.activity.local.title"),
      body: localState === "blocked"
        ? message("context.activity.local.blocked", { n: localFailures.length })
        : localState === "complete"
          ? message("context.activity.local.done", { n: Math.max(localEvents.length, observationSourceCount(planningTools, "local.")) })
          : localState === "active"
            ? message("context.activity.local.active", { n: localCount })
            : localState === "waiting"
              ? message("context.activity.local.waiting", { n: localCount })
              : message("context.activity.local.idle"),
    },
    {
      id: "linked",
      state: linkedState,
      title: message("context.activity.linked.title"),
      body: linkedState === "blocked"
        ? message("context.activity.linked.blocked", { n: linkedBlockedCount })
        : linkedState === "complete"
          ? message("context.activity.linked.done", { n: Math.max(linkedEvents.length, linkedCount) })
          : linkedState === "active"
            ? message("context.activity.linked.active", { n: linkedCount })
            : linkedState === "waiting"
              ? message("context.activity.linked.waiting", { n: linkedCount })
              : message("context.activity.linked.idle"),
    },
    {
      id: "web",
      state: webState,
      title: message("context.activity.web.title"),
      body: webState === "blocked"
        ? message("context.activity.web.blocked", { n: webFailures.length })
        : webState === "complete"
          ? message("context.activity.web.done", { n: Math.max(webEvents.length, observationSourceCount(planningTools, "web.")) })
          : webState === "active"
            ? message("context.activity.web.active")
            : webState === "waiting"
              ? message("context.activity.web.waiting")
              : message("context.activity.web.idle"),
    },
    {
      id: "distill",
      state: distillState,
      title: message("context.activity.distill.title"),
      body: distillState === "blocked"
        ? message("context.activity.distill.blocked")
        : distillState === "complete"
          ? message("context.activity.distill.done", { n: distillation?.missingQuestions.length ?? 0 })
          : distillState === "active"
            ? message("context.activity.distill.active")
            : message("context.activity.distill.waiting"),
    },
    {
      id: "questions",
      state: questionState,
      title: message("context.activity.questions.title"),
      body: questionState === "blocked"
        ? message("context.activity.questions.blocked")
        : questionState === "complete"
          ? message("context.activity.questions.done", { n: questionCount })
          : questionState === "active"
            ? message("context.activity.questions.active")
            : message("context.activity.questions.waiting"),
    },
  ];
}

function buildSufficiency(input: ContextLoopModelInput): ContextSufficiencySignal {
  const localCount = localPathCount(input.contextSources);
  const selectedCount = input.review.usedContext.length || input.planningContext?.selected.length || 0;
  const sourceCount = input.review.sourceCount;
  const observationCount = totalObservationCount(input.planningTools);
  const answeredQuestionCount = input.answeredQuestionCount ?? 0;
  const noteProvided = Boolean(input.contextNote?.trim());
  const distillationReady = Boolean(input.planningTools?.distillation);
  const permissionGapCount = input.review.permissionGaps.length;
  const skippedCount = input.review.skippedContext.length;
  const riskCount = input.review.decompositionRisks.length;
  const intakePaused = input.contextSources
    ? !input.contextSources.questionnaire.enabled && !input.contextSources.userSession.enabled
    : false;

  let score = 24;
  if (input.intake) score = Math.max(score, 20 + Math.round(input.intake.score * 0.45));
  if (localCount > 0) score += 10;
  score += Math.min(24, selectedCount * 12);
  score += Math.min(15, sourceCount * 5);
  score += Math.min(24, answeredQuestionCount * 12);
  if (noteProvided) score += 10;
  if (distillationReady) score += 10;
  score += Math.min(12, observationCount * 4);
  score -= Math.min(24, permissionGapCount * 12);
  score -= Math.min(15, skippedCount * 5);
  score -= Math.min(30, riskCount * 10);
  if (intakePaused) score -= 8;

  const finalScore = clampScore(score);
  const level: ContextSufficiencyLevel = finalScore >= 75 ? "strong" : finalScore >= 45 ? "useful" : "thin";
  const warnings: ContextLoopMessage[] = [];
  if (permissionGapCount > 0) warnings.push(message("context.sufficiency.warning.permissions", { n: permissionGapCount }));
  if (riskCount > 0) warnings.push(message("context.sufficiency.warning.risks", { n: riskCount }));
  if (skippedCount > 0) warnings.push(message("context.sufficiency.warning.skipped", { n: skippedCount }));
  if (selectedCount === 0 && localCount === 0 && answeredQuestionCount === 0 && !noteProvided) {
    warnings.push(message("context.sufficiency.warning.empty"));
  }

  const next = permissionGapCount > 0
    ? message("context.sufficiency.next.permissions")
    : riskCount > 0
      ? message("context.sufficiency.next.risks")
      : skippedCount > 0
        ? message("context.sufficiency.next.skipped")
        : level === "strong"
          ? message("context.sufficiency.next.strong")
          : level === "useful"
            ? message("context.sufficiency.next.useful")
            : message("context.sufficiency.next.thin");

  return {
    score: finalScore,
    level,
    summary: message(sufficiencySummaryKey(level)),
    next,
    warnings,
  };
}

function sufficiencySummaryKey(level: ContextSufficiencyLevel): StringKey {
  if (level === "strong") return "context.sufficiency.summary.strong";
  if (level === "useful") return "context.sufficiency.summary.useful";
  return "context.sufficiency.summary.thin";
}

export function buildContextLoopModel(input: ContextLoopModelInput): ContextLoopModel {
  return {
    hasLiveResearchData: hasLiveData(input),
    activity: buildActivity(input),
    sufficiency: buildSufficiency(input),
  };
}
