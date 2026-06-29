/**
 * Clarify-loop helpers: turn the user's answers to clarifying questions into the inputs the
 * planner + store expect. `parseAnswers` / `answersToMemories` are pure (unit-tested);
 * `promptAnswers` is the interactive readline path, reached only on a TTY.
 *
 * Answers fold into the refined plan via `@core/llm`'s `buildRefinedDescription`, and into
 * `user_stated` memories the same way the desktop save path does (question text → answer) —
 * one shared shape so a CLI-created aim and a desktop-created aim look identical in the store.
 */
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

import type { ClarifyAnswer, ClarifyQuestion } from "@core/llm";
import type { NewMemory } from "@core/store";

/**
 * Parse a JSON array of clarify answers (from `--answers`). Lenient: rows missing a
 * `question_id` or carrying no actual answer are dropped. Throws only when the input is not
 * valid JSON or not an array.
 */
export function parseAnswers(raw: string): ClarifyAnswer[] {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error("--answers is not valid JSON (expected an array of {question_id, selected_label?, other_text?})");
  }
  if (!Array.isArray(data)) {
    throw new Error("--answers must be a JSON array of {question_id, selected_label?, other_text?}");
  }

  const answers: ClarifyAnswer[] = [];
  for (const item of data) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const question_id =
      typeof o.question_id === "string" ? o.question_id : typeof o.id === "string" ? o.id : "";
    if (!question_id) continue;
    const selected_label = typeof o.selected_label === "string" && o.selected_label.trim() ? o.selected_label : null;
    const other_text = typeof o.other_text === "string" && o.other_text.trim() ? o.other_text : null;
    if (!selected_label && !other_text) continue; // an answer with nothing chosen is a non-answer
    answers.push({ question_id, selected_label, other_text });
  }
  return answers;
}

/** Fold answers into `user_stated` memories — mirrors the desktop save path. Pure. */
export function answersToMemories(questions: ClarifyQuestion[], answers: ClarifyAnswer[]): NewMemory[] {
  const byId = new Map(questions.map((q) => [q.id, q]));
  return answers
    .map((a) => ({ a, text: a.other_text?.trim() || a.selected_label?.trim() || "" }))
    .filter((x) => x.text.length > 0)
    .map(({ a, text }) => {
      const label = byId.get(a.question_id)?.question ?? a.question_id;
      return { content: `${label} → ${text}`, source: "user_stated" as const };
    });
}

/** Interactively ask each question on the TTY and collect the answers (empty input = skip). */
export async function promptAnswers(questions: ClarifyQuestion[]): Promise<ClarifyAnswer[]> {
  const rl = createInterface({ input: stdin, output: stdout });
  const answers: ClarifyAnswer[] = [];
  try {
    for (let i = 0; i < questions.length; i++) {
      const q = questions[i]!;
      stdout.write(`\n[${i + 1}/${questions.length}] (${q.kind}) ${q.question}\n`);
      if (q.why_high_impact) stdout.write(`  why: ${q.why_high_impact}\n`);
      q.options.forEach((o, n) => stdout.write(`  ${n + 1}) ${o.label}${o.tradeoff ? ` — ${o.tradeoff}` : ""}\n`));

      const reply = (await rl.question(`  Pick 1-${q.options.length}, type your own answer, or Enter to skip: `)).trim();
      if (!reply) continue; // skip → leave to the disclosed assumption / default

      const n = Number(reply);
      if (Number.isInteger(n) && n >= 1 && n <= q.options.length) {
        answers.push({ question_id: q.id, selected_label: q.options[n - 1]!.label, other_text: null });
      } else {
        answers.push({ question_id: q.id, selected_label: null, other_text: reply });
      }
    }
  } finally {
    rl.close();
  }
  return answers;
}
