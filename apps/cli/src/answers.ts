/**
 * Clarify-loop helpers: turn the user's answers to clarifying questions into the inputs the
 * planner + store expect. `parseAnswers` / `answersToMemories` are pure (unit-tested);
 * `promptAnswers` is the interactive readline path, reached only on a TTY.
 *
 * Answers fold into the refined plan via `@aimcub/llm`'s `buildRefinedDescription`, and into
 * `user_stated` memories the same way the desktop save path does (question text → answer) —
 * one shared shape so a CLI-created aim and a desktop-created aim look identical in the store.
 */
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

import { decideChoiceSelection, type ContextIntakeProgressSignal } from "@aimcub/core";
import { clarifyAnswersToMemories } from "@aimcub/llm";
import type { ClarifyAnswer, ClarifyQuestion } from "@aimcub/llm";
import type { NewMemory } from "@aimcub/store";

/**
 * Parse a JSON array of clarify answers (from `--answers`). Lenient: rows missing a
 * `question_id` or carrying no actual answer are dropped. Throws only when the input is not
 * valid JSON or not an array.
 */
export function parseAnswers(raw: string, questions: readonly ClarifyQuestion[] = []): ClarifyAnswer[] {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error("--answers is not valid JSON (expected an array of {question_id, selected_label?, selected_labels?, other_text?})");
  }
  if (!Array.isArray(data)) {
    throw new Error("--answers must be a JSON array of {question_id, selected_label?, selected_labels?, other_text?}");
  }

  const answers: ClarifyAnswer[] = [];
  const questionById = new Map(questions.map((question) => [question.id, question]));
  for (const item of data) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const question_id =
      typeof o.question_id === "string" ? o.question_id : typeof o.id === "string" ? o.id : "";
    if (!question_id) continue;
    const rawListedLabels = Array.isArray(o.selected_labels) ? o.selected_labels : null;
    const hasListedLabels = rawListedLabels !== null;
    const listedLabels: string[] = rawListedLabels
      ? [...new Set(rawListedLabels.flatMap((label: unknown) =>
        typeof label === "string" && label.trim() ? [label.trim()] : []))]
      : [];
    const explicitLabel = typeof o.selected_label === "string" && o.selected_label.trim()
      ? o.selected_label.trim()
      : null;
    const selected_labels = explicitLabel
      ? [explicitLabel, ...listedLabels.filter((label) => label !== explicitLabel)]
      : listedLabels;
    const selected_label = explicitLabel ?? selected_labels[0] ?? null;
    const other_text = typeof o.other_text === "string" && o.other_text.trim() ? o.other_text : null;
    if (!selected_label && selected_labels.length === 0 && !other_text) continue;
    const question = questionById.get(question_id);
    const selectionMode = question
      ? decideChoiceSelection({
        question: question.question,
        options: question.options.map((option) => ({ label: option.label, detail: option.tradeoff })),
        requestedMode: question.selection_mode,
        requestedReason: question.selection_mode_reason,
      }).mode
      : null;
    if (selectionMode === "single" && (selected_labels.length > 1 || (selected_label && other_text))) {
      throw new Error(`--answers entry ${question_id} is single-select; provide one selected label or one other_text answer`);
    }
    answers.push({
      question_id,
      selected_label,
      ...(hasListedLabels && selected_labels.length > 0 ? { selected_labels } : {}),
      other_text,
    });
  }
  return answers;
}

function questionLabel(question: ClarifyQuestion): string {
  return question.source_dimension
    ? `${question.kind} · ${question.source_dimension.replace("_", "-")}`
    : question.kind;
}

function questionWhyLabel(question: ClarifyQuestion): string {
  return (question.why_asked ?? [])
    .map((why) => {
      if (why.code === "review_gap") return why.category ? `review gap/${why.category.replace("_", "-")}` : "review gap";
      if (why.code === "quality_dimension") return `quality/${why.source_dimension?.replace("_", "-") ?? "dimension"}`;
      return `learning/${why.recommendation ?? "signal"}`;
    })
    .join(" · ");
}

function questionCaptureLabel(question: ClarifyQuestion): string {
  const capture = question.capture;
  if (!capture) return "";
  const origin = capture.origin?.nodeKey ? ` · from ${capture.origin.nodeKey}` : "";
  const roi = typeof capture.origin?.roiScore === "number" ? ` · roi ${capture.origin.roiScore}` : "";
  return `${capture.scope}/${capture.category.replace("_", "-")} · ${capture.purpose.replace("_", "-")} · improves ${capture.improvesDimension.replace("_", "-")}${origin}${roi}`;
}

/** Fold answers into `user_stated` memories — mirrors the desktop save path. Pure. */
export function answersToMemories(questions: ClarifyQuestion[], answers: ClarifyAnswer[]): NewMemory[] {
  return clarifyAnswersToMemories(questions, answers);
}

/** Fold answers into intake-progress signals so CLI-saved aims retain the context loop state. */
export function answersToIntakeSignals(
  questions: ClarifyQuestion[],
  answers: ClarifyAnswer[],
): ContextIntakeProgressSignal[] {
  const questionById = new Map(questions.map((question) => [question.id, question]));
  return answers.flatMap((answer): ContextIntakeProgressSignal[] => {
    const selected = answer.selected_labels?.map((label) => label.trim()).filter(Boolean).join("; ");
    const text = selected
      ? [selected, answer.other_text?.trim()].filter(Boolean).join("; ")
      : answer.other_text?.trim() || answer.selected_label?.trim();
    if (!text) return [];
    const question = questionById.get(answer.question_id);
    const inferredMemory = clarifyAnswersToMemories(questions, [answer])[0];
    return [{
      source: "user_answer",
      channel: "questionnaire",
      category: question?.capture?.category ?? inferredMemory?.category,
      scope: question?.capture?.scope ?? "aim",
      questionId: answer.question_id,
      summary: text,
    }];
  });
}

/** Parse one interactive reply while preserving the question's single/multi contract. */
export function parseChoiceReply(question: ClarifyQuestion, raw: string): ClarifyAnswer | null {
  const reply = raw.trim();
  if (!reply) return null;
  const selectionMode = decideChoiceSelection({
    question: question.question,
    options: question.options.map((option) => ({ label: option.label, detail: option.tradeoff })),
    requestedMode: question.selection_mode,
    requestedReason: question.selection_mode_reason,
  }).mode;
  const [indexPart = "", ...customParts] = reply.split("|");
  const customText = customParts.join("|").trim();
  const indexText = selectionMode === "multiple"
    ? /^\d+(?:\s*[,\uff0c]\s*\d+)*$/.test(indexPart.trim())
    : /^\d+$/.test(indexPart.trim()) && customParts.length === 0;
  if (indexText) {
    const indexes = [...new Set(indexPart.split(/[,\uff0c]/).map((value) => Number(value.trim())))];
    if (indexes.every((index) => Number.isInteger(index) && index >= 1 && index <= question.options.length)) {
      const selectedLabels = indexes.map((index) => question.options[index - 1]!.label);
      return {
        question_id: question.id,
        selected_label: selectedLabels[0] ?? null,
        selected_labels: selectedLabels,
        other_text: customText || null,
      };
    }
  }
  return { question_id: question.id, selected_label: null, selected_labels: [], other_text: reply };
}

/** Interactively ask each question on the TTY and collect the answers (empty input = skip). */
export async function promptAnswers(questions: ClarifyQuestion[]): Promise<ClarifyAnswer[]> {
  const rl = createInterface({ input: stdin, output: stdout });
  const answers: ClarifyAnswer[] = [];
  try {
    for (let i = 0; i < questions.length; i++) {
      const q = questions[i]!;
      stdout.write(`\n[${i + 1}/${questions.length}] (${questionLabel(q)}) ${q.question}\n`);
      if (q.why_high_impact) stdout.write(`  why: ${q.why_high_impact}\n`);
      const asked = questionWhyLabel(q);
      if (asked) stdout.write(`  asked: ${asked}\n`);
      const capture = questionCaptureLabel(q);
      if (capture) stdout.write(`  capture: ${capture}\n`);
      q.options.forEach((o, n) => stdout.write(`  ${n + 1}) ${o.label}${o.tradeoff ? ` — ${o.tradeoff}` : ""}\n`));

      const selectionMode = decideChoiceSelection({
        question: q.question,
        options: q.options.map((option) => ({ label: option.label, detail: option.tradeoff })),
        requestedMode: q.selection_mode,
        requestedReason: q.selection_mode_reason,
      }).mode;
      const prompt = selectionMode === "multiple"
        ? `  Pick one or more from 1-${q.options.length} (for example 1,3 or 1,3 | another answer), type your own answer, or Enter to skip: `
        : `  Pick 1-${q.options.length}, type your own answer, or Enter to skip: `;
      const answer = parseChoiceReply(q, await rl.question(prompt));
      if (answer) answers.push(answer);
    }
  } finally {
    rl.close();
  }
  return answers;
}
