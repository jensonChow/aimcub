import type { AimIntakeReport, PlanReviewReport } from "@core/domain";
import type { AimcubToolSource, PlanningContextSelectionReport } from "@core/llm";
import type { ContextCategory, DecompositionOutput } from "@core/types";

import type { PlanningToolIpcTrace } from "../shared/ipc";

export type ContextReviewTone = "neutral" | "success" | "warn" | "danger";

export interface ContextReviewItem {
  id: string;
  title: string;
  body: string;
  meta: string[];
  category?: ContextCategory;
  tone: ContextReviewTone;
}

export interface ContextBundleReview {
  usedContext: ContextReviewItem[];
  skippedContext: ContextReviewItem[];
  permissionGaps: ContextReviewItem[];
  decompositionRisks: ContextReviewItem[];
  sourceCount: number;
}

export interface ContextBundleReviewInput {
  planningContext?: PlanningContextSelectionReport | null;
  planningTools?: PlanningToolIpcTrace | null;
  intake?: AimIntakeReport | null;
  review?: PlanReviewReport | null;
  plan?: DecompositionOutput | null;
  answeredQuestionIds?: readonly string[];
}

interface LinkedContextSource {
  id: string;
  kind: string;
  label: string;
  enabled: boolean;
  status: "available" | "needs_connector" | "unavailable";
  path?: string;
  uri?: string;
  note?: string;
}

const PERMISSION_FAILURE_CODES = new Set([
  "permission_denied",
  "disabled",
  "outside_workspace",
  "sensitive_path",
]);

const CONTEXT_CATEGORIES = new Set<ContextCategory>([
  "constraint",
  "preference",
  "capability",
  "eval_signal",
  "procedure",
  "project_fact",
]);

function compact(value: string | undefined | null, max = 220): string {
  const cleaned = (value ?? "").replace(/\s+/g, " ").trim();
  if (cleaned.length <= max) return cleaned;
  return `${cleaned.slice(0, max - 3).trim()}...`;
}

function readable(value: string): string {
  return value.replace(/_/g, " ");
}

function sourceKey(source: AimcubToolSource): string {
  return [
    source.kind,
    source.path,
    source.uri,
    source.url,
    source.title,
  ].filter(Boolean).join(":");
}

function toolLabel(toolName: string): string {
  if (toolName.startsWith("memory.")) return "Memory";
  if (toolName.startsWith("local.")) return "Local source";
  if (toolName.startsWith("web.")) return "Web source";
  if (toolName.startsWith("context.")) return "Context source";
  return toolName;
}

function pushUnique(items: ContextReviewItem[], item: ContextReviewItem): void {
  if (items.some((current) => current.id === item.id)) return;
  items.push(item);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asLinkedStatus(value: unknown): LinkedContextSource["status"] {
  return value === "available" || value === "unavailable" ? value : "needs_connector";
}

function asContextCategory(value: unknown): ContextCategory | undefined {
  return typeof value === "string" && CONTEXT_CATEGORIES.has(value as ContextCategory)
    ? value as ContextCategory
    : undefined;
}

function linkedSourcesFromTools(planningTools: PlanningToolIpcTrace | null | undefined): LinkedContextSource[] {
  const events = planningTools?.observationEvents ?? [];
  const linkedEvents = events.filter((event) => event.toolName === "context.linked_sources");
  const sources: LinkedContextSource[] = [];
  for (const event of linkedEvents) {
    const data = event.observation.data;
    if (!isRecord(data) || !Array.isArray(data.sources)) continue;
    for (const rawSource of data.sources) {
      if (!isRecord(rawSource)) continue;
      const id = typeof rawSource.id === "string" ? rawSource.id : "";
      const label = typeof rawSource.label === "string" ? rawSource.label : id || "Linked source";
      if (!id && !label) continue;
      sources.push({
        id: id || label,
        kind: typeof rawSource.kind === "string" ? rawSource.kind : "other",
        label,
        enabled: typeof rawSource.enabled === "boolean" ? rawSource.enabled : true,
        status: asLinkedStatus(rawSource.status),
        ...(typeof rawSource.path === "string" ? { path: rawSource.path } : {}),
        ...(typeof rawSource.uri === "string" ? { uri: rawSource.uri } : {}),
        ...(typeof rawSource.note === "string" ? { note: rawSource.note } : {}),
      });
    }
  }
  return sources;
}

function answeredIds(input: ContextBundleReviewInput): Set<string> {
  return new Set(input.answeredQuestionIds ?? []);
}

export function buildContextBundleReview(input: ContextBundleReviewInput): ContextBundleReview {
  const usedContext: ContextReviewItem[] = [];
  const skippedContext: ContextReviewItem[] = [];
  const permissionGaps: ContextReviewItem[] = [];
  const decompositionRisks: ContextReviewItem[] = [];
  const sourceKeys = new Set<string>();

  for (const row of input.planningContext?.selected ?? []) {
    pushUnique(usedContext, {
      id: `used:${row.memoryId ?? row.content}:${row.score}`,
      title: "Selected for planning",
      body: compact(row.content),
      category: row.category,
      meta: [
        readable(row.scope),
        readable(row.reason),
        `score ${Math.round(row.score)}`,
      ],
      tone: "success",
    });
  }

  for (const row of input.planningContext?.ignored ?? []) {
    pushUnique(skippedContext, {
      id: `skipped:${row.memoryId ?? row.content}:${row.reason}`,
      title: row.reason === "over_selection_limit" ? "Over selection limit" : "Not used in this plan",
      body: compact(row.content),
      category: row.category,
      meta: [
        readable(row.scope),
        readable(row.reason),
        `score ${Math.round(row.score)}`,
      ],
      tone: row.reason === "empty_content" || row.reason === "low_confidence" ? "warn" : "neutral",
    });
  }

  const observationEvents = input.planningTools?.observationEvents ?? [];
  for (const event of observationEvents) {
    for (const source of event.observation.sources) {
      const key = sourceKey(source);
      if (key) sourceKeys.add(key);
    }
    for (const warning of event.observation.warnings ?? []) {
      pushUnique(decompositionRisks, {
        id: `warning:${event.toolName}:${warning}`,
        title: `${toolLabel(event.toolName)} warning`,
        body: compact(warning),
        meta: [event.toolName],
        tone: "warn",
      });
    }
  }

  for (const source of linkedSourcesFromTools(input.planningTools)) {
    const location = source.path ?? source.uri ?? source.note ?? "";
    if (!source.enabled) {
      pushUnique(skippedContext, {
        id: `linked-disabled:${source.id}`,
        title: "Disabled linked source",
        body: compact(source.label),
        meta: [source.kind, compact(location, 120)].filter(Boolean),
        tone: "neutral",
      });
      continue;
    }
    if (source.status === "needs_connector") {
      pushUnique(permissionGaps, {
        id: `linked-connector:${source.id}`,
        title: "Connector or access needed",
        body: compact(source.label),
        meta: [source.kind, compact(location, 120)].filter(Boolean),
        tone: "warn",
      });
      continue;
    }
    if (source.status === "unavailable") {
      pushUnique(skippedContext, {
        id: `linked-unavailable:${source.id}`,
        title: "Linked source unavailable",
        body: compact(source.label),
        meta: [source.kind, compact(location, 120)].filter(Boolean),
        tone: "warn",
      });
    }
  }

  for (const failure of input.planningTools?.failures ?? []) {
    const item: ContextReviewItem = {
      id: `failure:${failure.toolName}:${failure.error.code}:${failure.error.message}`,
      title: `${toolLabel(failure.toolName)} not read`,
      body: compact(failure.error.message),
      meta: [failure.toolName, readable(failure.error.code), failure.error.retryable ? "retryable" : "not retryable"],
      tone: PERMISSION_FAILURE_CODES.has(failure.error.code) ? "warn" : "danger",
    };
    if (PERMISSION_FAILURE_CODES.has(failure.error.code)) {
      pushUnique(permissionGaps, item);
    } else {
      pushUnique(skippedContext, item);
    }
  }

  const answered = answeredIds(input);
  for (const question of input.intake?.questions ?? []) {
    if (answered.has(`intake_${question.id}`) || answered.has(question.id)) continue;
    pushUnique(decompositionRisks, {
      id: `intake:${question.id}`,
      title: "Unanswered intake question",
      body: compact(question.prompt),
      category: question.category,
      meta: [question.priority, question.source, question.reason].map(readable),
      tone: question.priority === "high" ? "danger" : "warn",
    });
  }

  for (const question of input.planningTools?.distillation?.missingQuestions ?? []) {
    pushUnique(decompositionRisks, {
      id: `distill:${question.id}`,
      title: "Missing source question",
      body: compact(question.question),
      category: asContextCategory(question.category),
      meta: ["context distillation"],
      tone: "warn",
    });
  }

  for (const gap of input.review?.context.gaps ?? []) {
    pushUnique(decompositionRisks, {
      id: `review-gap:${gap.source ?? "review"}:${gap.nodeKey ?? ""}:${gap.prompt}`,
      title: gap.nodeTitle ? `Risk in ${gap.nodeTitle}` : "Review context gap",
      body: compact(gap.prompt),
      category: gap.category,
      meta: [gap.priority, gap.source ?? "plan review", gap.reason].map(readable),
      tone: gap.priority === "high" ? "danger" : "warn",
    });
  }

  for (const node of input.plan?.nodes ?? []) {
    for (const gap of node.decomposition_contract?.context_gaps ?? []) {
      pushUnique(decompositionRisks, {
        id: `plan-gap:${node.key}:${gap.category}:${gap.question}`,
        title: `Risk in ${node.title}`,
        body: compact(gap.question),
        category: gap.category,
        meta: ["decomposition contract", compact(gap.reason, 120)],
        tone: gap.category === "eval_signal" ? "danger" : "warn",
      });
    }
  }

  return {
    usedContext,
    skippedContext,
    permissionGaps,
    decompositionRisks,
    sourceCount: sourceKeys.size,
  };
}
