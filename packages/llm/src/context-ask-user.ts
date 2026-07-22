import type {
  AimcubToolHandler,
  AimcubToolResult,
  ContextAskUserInput,
  ContextAskUserOutput,
} from "./tool-contract";
import { decideChoiceSelection } from "@aimcub/core";

const DEFAULT_MAX_QUESTIONS = 5;

function fail<T>(message: string): AimcubToolResult<T> {
  return { ok: false, error: { code: "invalid_input", message, retryable: false } };
}

function cleanText(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function captureScope(value: unknown): "global" | "current_aim" | "none" {
  return value === "global" || value === "none" ? value : "current_aim";
}

function uniqueChoices(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const seen = new Set<string>();
  const choices: string[] = [];
  for (const item of value) {
    const text = cleanText(item);
    if (!text || seen.has(text.toLowerCase())) continue;
    seen.add(text.toLowerCase());
    choices.push(text);
  }
  return choices.length > 0 ? choices : undefined;
}

function normalizeQuestions(
  questions: unknown,
  maxQuestions: number,
): ContextAskUserInput["questions"] | null {
  if (!Array.isArray(questions) || questions.length === 0 || questions.length > maxQuestions) return null;
  const normalized: ContextAskUserInput["questions"] = [];
  for (const item of questions) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return null;
    const row = item as Record<string, unknown>;
    const id = cleanText(row.id);
    const question = cleanText(row.question);
    if (!id || !question) return null;
    const category = cleanText(row.category);
    const choices = uniqueChoices(row.choices);
    const selection = decideChoiceSelection({
      question,
      options: (choices ?? []).map((label) => ({ label })),
      requestedMode: row.selectionMode,
      requestedReason: row.selectionModeReason,
    });
    normalized.push({
      id,
      question,
      ...(category ? { category } : {}),
      ...(choices ? { choices } : {}),
      selectionMode: selection.mode,
      selectionModeReason: selection.reason,
      captureScope: captureScope(row.captureScope),
    });
  }
  return normalized;
}

function requestId(now: Date, questions: readonly { id: string }[]): string {
  return `ask_${now.toISOString()}_${questions.map((question) => question.id).join("_")}`;
}

export function createContextAskUserHandler(options: {
  maxQuestions?: number;
} = {}): AimcubToolHandler<ContextAskUserInput, ContextAskUserOutput> {
  return async (input, context) => {
    if (!context.permissions.includes("user.ask")) {
      return {
        ok: false,
        error: {
          code: "permission_denied",
          message: "context.ask_user requires the user.ask permission.",
          retryable: false,
        },
      };
    }
    const rawInput = input as Partial<ContextAskUserInput> | null | undefined;
    const maxQuestions = options.maxQuestions ?? DEFAULT_MAX_QUESTIONS;
    const questions = normalizeQuestions(rawInput?.questions, maxQuestions);
    if (!questions) return fail(`context.ask_user requires 1-${maxQuestions} valid questions.`);

    const id = requestId(context.now(), questions);
    const output: ContextAskUserOutput = { requestId: id, questions };
    return {
      ok: true,
      observation: {
        summary: `Prepared ${questions.length} user context question${questions.length === 1 ? "" : "s"}.`,
        data: output,
        sources: [{
          kind: "user",
          title: "User context request",
          uri: `aimcub:user-request:${id}`,
          observedAt: context.now().toISOString(),
        }],
      },
    };
  };
}
