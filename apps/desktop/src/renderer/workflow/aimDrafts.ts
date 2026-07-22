import { decideChoiceSelection } from "@aimcub/core";
import type { ClarifyAnswer, ClarifyAssumption, ClarifyOutput, ClarifyQuestion } from "@aimcub/llm";
import type {
  AimDraft,
  AimDraftAnswer,
  AimDraftQuestion,
  AimDraftSaveBlock,
  AimDraftStage,
  AimDraftStatus,
  AimDraftSurface,
  DecompositionOutput,
} from "@aimcub/types";

import type { UpsertAimDraftRequest } from "../../shared/ipc";
import type { CockpitStage } from "../CockpitShell";
import type { ProductError } from "./planningErrors";

export interface AimDraftBuildInput {
  id: string | null;
  title: string;
  description: string;
  parent: { goalId: string; milestoneId: string } | null;
  activeStage: CockpitStage;
  aimSurface: AimDraftSurface;
  phase: "intake" | "postDraft" | null;
  contextNote: string;
  intakeClarify: ClarifyOutput | null;
  intakeAnswers: ClarifyAnswer[];
  clarify: ClarifyOutput | null;
  clarifyAnswers: ClarifyAnswer[];
  draft: DecompositionOutput | null;
  finalPlan: DecompositionOutput | null;
  saveBlock: AimDraftSaveBlock | null;
}

export interface HydratedAimDraft {
  id: string;
  title: string;
  description: string;
  parent: { goalId: string; milestoneId: string } | null;
  stage: AimDraftStage;
  aimSurface: AimDraftSurface;
  phase: "intake" | "postDraft" | null;
  contextNote: string;
  intakeClarify: ClarifyOutput | null;
  intakeAnswers: Record<string, { labels: string[]; other: string }>;
  clarify: ClarifyOutput | null;
  clarifyAnswers: Record<string, { labels: string[]; other: string }>;
  draft: DecompositionOutput | null;
  finalPlan: DecompositionOutput | null;
  saveBlock: AimDraftSaveBlock | null;
}

export function aimDraftHasContent(input: AimDraftBuildInput): boolean {
  return Boolean(
    input.title.trim()
      || input.description.trim()
      || input.contextNote.trim()
      || input.parent
      || input.intakeClarify?.questions.length
      || input.intakeAnswers.length
      || input.clarify?.questions.length
      || input.clarifyAnswers.length
      || input.draft
      || input.finalPlan
      || input.saveBlock,
  );
}

export function persistedAimSurface(mode: "idle" | "compose" | "summary" | "edit"): AimDraftSurface {
  return mode === "compose" ? "compose" : "summary";
}

function persistedQuestion(question: ClarifyQuestion): AimDraftQuestion {
  return {
    id: question.id,
    question: question.question,
    why_high_impact: question.why_high_impact,
    kind: question.kind,
    source_dimension: question.source_dimension ?? null,
    allow_other: question.allow_other,
    selection_mode: question.selection_mode ?? null,
    selection_mode_reason: question.selection_mode_reason ?? null,
    options: question.options.map((option) => ({
      label: option.label,
      tradeoff: option.tradeoff,
    })),
  };
}

function persistedAnswer(answer: ClarifyAnswer): AimDraftAnswer {
  return {
    question_id: answer.question_id,
    selected_label: answer.selected_label,
    selected_labels: answer.selected_labels ?? null,
    other_text: answer.other_text,
  };
}

function persistedAssumption(assumption: ClarifyAssumption) {
  return {
    statement: assumption.statement,
    default_value: assumption.default_value,
  };
}

function restoreQuestion(question: AimDraftQuestion): ClarifyQuestion {
  const seenOptionLabels = new Set<string>();
  const options = question.options.flatMap((option) => {
    const label = option.label.trim();
    const key = label.toLowerCase();
    if (!label || seenOptionLabels.has(key)) return [];
    seenOptionLabels.add(key);
    return [{ label, tradeoff: option.tradeoff }];
  });
  const selection = decideChoiceSelection({
    question: question.question,
    options: options.map((option) => ({ label: option.label, detail: option.tradeoff })),
    requestedMode: question.selection_mode,
    requestedReason: question.selection_mode_reason,
  });
  return {
    id: question.id,
    question: question.question,
    why_high_impact: question.why_high_impact,
    kind: question.kind,
    source_dimension: question.source_dimension ?? undefined,
    allow_other: question.allow_other,
    selection_mode: selection.mode,
    selection_mode_reason: selection.reason,
    options,
  };
}

function restoreOutput(
  questions: readonly AimDraftQuestion[],
  assumptions: ReadonlyArray<AimDraft["clarify_assumptions"][number]>,
): ClarifyOutput | null {
  if (questions.length === 0 && assumptions.length === 0) return null;
  return {
    questions: questions.map(restoreQuestion),
    assumptions: assumptions.map((assumption) => ({
      statement: assumption.statement,
      default_value: assumption.default_value,
    })),
  };
}

function answerMap(
  answers: readonly AimDraftAnswer[],
  questions: readonly ClarifyQuestion[],
): Record<string, { labels: string[]; other: string }> {
  const map: Record<string, { labels: string[]; other: string }> = {};
  const questionById = new Map(questions.map((question) => [question.id, question]));
  for (const answer of answers) {
    const rawLabels = answer.selected_labels?.length
      ? answer.selected_labels
      : answer.selected_label
        ? [answer.selected_label]
        : [];
    const labels = [...new Set(rawLabels.map((label) => label.trim()).filter(Boolean))];
    const other = answer.other_text ?? "";
    const question = questionById.get(answer.question_id);
    const optionLabels = new Set(question?.options.map((option) => option.label) ?? []);
    const knownLabels = question ? labels.filter((label) => optionLabels.has(label)) : labels;
    const unknownLabels = question ? labels.filter((label) => !optionLabels.has(label)) : [];
    if (question?.selection_mode === "single" && (labels.length > 1 || (labels.length > 0 && other.trim()) || unknownLabels.length > 0)) {
      map[answer.question_id] = {
        labels: [],
        other: [...labels, other.trim()].filter(Boolean).join("; "),
      };
      continue;
    }
    map[answer.question_id] = {
      labels: question?.selection_mode === "single" ? knownLabels.slice(0, 1) : knownLabels,
      other: [...unknownLabels, other.trim()].filter(Boolean).join("; "),
    };
  }
  return map;
}

export function saveBlockFromProductError(error: ProductError): AimDraftSaveBlock {
  return {
    title: error.title,
    message: error.message,
    recovery: error.recovery,
    issues: error.message ? [error.message] : [],
  };
}

export function aimDraftStatus(input: Pick<AimDraftBuildInput, "draft" | "finalPlan" | "saveBlock" | "phase" | "contextNote" | "intakeAnswers" | "clarifyAnswers">): AimDraftStatus {
  if (input.saveBlock) return "save_blocked";
  if (input.finalPlan || input.draft) return "plan_ready";
  if (input.phase === "intake" || input.contextNote.trim() || input.intakeAnswers.length || input.clarifyAnswers.length) {
    return "context_needed";
  }
  return "draft";
}

export function aimDraftStage(input: Pick<AimDraftBuildInput, "activeStage" | "draft" | "finalPlan" | "phase" | "contextNote" | "intakeAnswers" | "clarifyAnswers">): AimDraftStage {
  if (input.activeStage === "aim" || input.activeStage === "context" || input.activeStage === "contracts") return input.activeStage;
  if (input.finalPlan || input.draft) return "contracts";
  if (input.phase || input.contextNote.trim() || input.intakeAnswers.length || input.clarifyAnswers.length) return "context";
  return "aim";
}

export function buildAimDraftUpsertRequest(input: AimDraftBuildInput): UpsertAimDraftRequest | null {
  if (!aimDraftHasContent(input)) return null;
  return {
    ...(input.id ? { id: input.id } : {}),
    title: input.title,
    description: input.description,
    parentGoalId: input.parent?.goalId ?? null,
    parentMilestoneId: input.parent?.milestoneId ?? null,
    currentStage: aimDraftStage(input),
    aimSurface: input.aimSurface,
    phase: input.phase === "postDraft" ? "post_draft" : input.phase,
    status: aimDraftStatus(input),
    contextNote: input.contextNote,
    intakeQuestions: input.intakeClarify?.questions.map(persistedQuestion) ?? [],
    intakeAnswers: input.intakeAnswers.map(persistedAnswer),
    clarifyQuestions: input.clarify?.questions.map(persistedQuestion) ?? [],
    clarifyAnswers: input.clarifyAnswers.map(persistedAnswer),
    clarifyAssumptions: input.clarify?.assumptions.map(persistedAssumption) ?? [],
    draftPlan: input.draft,
    finalPlan: input.finalPlan,
    saveBlock: input.saveBlock,
  };
}

export function hydrateAimDraft(draft: AimDraft): HydratedAimDraft {
  const phase = draft.phase === "post_draft" ? "postDraft" : draft.phase;
  const intakeClarify = restoreOutput(draft.intake_questions, []);
  const clarify = restoreOutput(draft.clarify_questions, draft.clarify_assumptions);
  return {
    id: draft.id,
    title: draft.title,
    description: draft.description,
    parent: draft.parent_goal_id && draft.parent_milestone_id
      ? { goalId: draft.parent_goal_id, milestoneId: draft.parent_milestone_id }
      : null,
    stage: draft.current_stage,
    // Drafts created before aim_surface existed should recover into the safe
    // reading state. Edit remains explicit, while new writes preserve a truly
    // unsubmitted composer as "compose".
    aimSurface: draft.aim_surface ?? "summary",
    phase,
    contextNote: draft.context_note,
    intakeClarify,
    intakeAnswers: answerMap(draft.intake_answers, intakeClarify?.questions ?? []),
    clarify,
    clarifyAnswers: answerMap(draft.clarify_answers, clarify?.questions ?? []),
    draft: draft.draft_plan,
    finalPlan: draft.final_plan,
    saveBlock: draft.save_block,
  };
}
