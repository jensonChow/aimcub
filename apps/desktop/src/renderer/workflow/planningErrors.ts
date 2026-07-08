import type { I18n } from "../i18n";

export type PlanningFailureStage = "draft" | "refine" | "save";

export interface ProductError {
  title: string;
  message: string;
  recovery: string;
  details: string[];
}

export interface PlanningFailureRoute {
  mode: "contexting" | "answering" | "reviewing";
  stageOverride: "context" | "contracts";
}

const INTERNAL_PLAN_PATH = /\b(nodes|edges|acceptance_rule|clauses|match|decomposition_contract|routing_override)(?:\.\d+|\.[a-z_]+)*\b/i;
const MAX_DETAIL_COUNT = 8;
const MAX_DETAIL_LENGTH = 500;

function compactErrors(errors: readonly string[]): string[] {
  const details: string[] = [];
  const seen = new Set<string>();
  for (const raw of errors) {
    const trimmed = raw.replace(/\s+/g, " ").trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    details.push(trimmed.length > MAX_DETAIL_LENGTH ? `${trimmed.slice(0, MAX_DETAIL_LENGTH - 1)}...` : trimmed);
    if (details.length >= MAX_DETAIL_COUNT) break;
  }
  return details;
}

function hasInternalPlanPath(error: string): boolean {
  return INTERNAL_PLAN_PATH.test(error) && /:/.test(error);
}

export function formatPlanValidationIssues(errors: readonly string[], t: I18n["t"]): string[] {
  const issues: string[] = [];
  for (const error of errors) {
    if (/duplicate node keys/i.test(error)) {
      issues.push(t("planningError.issue.duplicateNodes"));
    } else if (/node count/i.test(error)) {
      issues.push(t("planningError.issue.nodeCount"));
    } else if (/edge\.|self-dependency|dependency cycle/i.test(error)) {
      issues.push(t("planningError.issue.dependencies"));
    } else if (hasInternalPlanPath(error)) {
      issues.push(t("planningError.issue.schema"));
    } else {
      issues.push(t("planningError.issue.generic"));
    }
  }

  return [...new Set(issues)].slice(0, 3);
}

export function formatPlanningFailure(input: {
  stage: PlanningFailureStage;
  errors: readonly string[];
  t: I18n["t"];
  fallback?: string;
}): ProductError {
  const details = compactErrors(input.errors.length ? input.errors : [input.fallback ?? "Unknown planning failure."]);
  if (input.stage === "save") {
    return {
      title: input.t("planningError.save.title"),
      message: formatPlanValidationIssues(input.errors, input.t)[0] ?? input.t("planningError.save.message"),
      recovery: input.t("planningError.save.recovery"),
      details,
    };
  }
  if (input.stage === "refine") {
    return {
      title: input.t("planningError.refine.title"),
      message: input.t("planningError.refine.message"),
      recovery: input.t("planningError.refine.recovery"),
      details,
    };
  }
  return {
    title: input.t("planningError.draft.title"),
    message: input.t("planningError.draft.message"),
    recovery: input.t("planningError.draft.recovery"),
    details,
  };
}

export function routeAfterPlanningFailure(stage: PlanningFailureStage): PlanningFailureRoute {
  if (stage === "save") return { mode: "reviewing", stageOverride: "contracts" };
  if (stage === "refine") return { mode: "answering", stageOverride: "context" };
  return { mode: "contexting", stageOverride: "context" };
}
