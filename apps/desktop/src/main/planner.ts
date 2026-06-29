/**
 * The planning pipeline run in the main process: draft → clarify → refine.
 * Each step uses the @core/llm brain when an API key is present, and falls back to the
 * deterministic offline path so the whole flow works with no key (local-first).
 */
import {
  decompose,
  localDecompose,
  clarify,
  localClarify,
  buildRefinedDescription,
  type ClarifyAnswer,
  type ClarifyQuestion,
} from "@core/llm";
import type { DecompositionOutput } from "@core/types";

import { buildGateway, hasApiKey } from "./gateway";
import type { ClarifyIpcResult, PlanResult } from "../shared/ipc";

export async function runDraft(title: string, description?: string): Promise<PlanResult> {
  if (hasApiKey()) {
    try {
      const r = await decompose(buildGateway(), { title, description });
      if (r.output) return { ok: true, output: r.output, errors: [], usedFallback: false };
      return { ok: true, output: localDecompose({ title, description }), errors: r.validation.errors, usedFallback: true };
    } catch {
      // fall through to offline
    }
  }
  return { ok: true, output: localDecompose({ title, description }), errors: [], usedFallback: true };
}

export async function runClarify(
  title: string,
  description: string | undefined,
  draft: DecompositionOutput,
): Promise<ClarifyIpcResult> {
  if (hasApiKey()) {
    try {
      const r = await clarify(buildGateway(), { title, description, draft });
      if (r.output) return { ok: true, output: r.output, errors: [], usedFallback: false };
      return { ok: true, output: localClarify({ title, description, draft }), errors: r.validation.errors, usedFallback: true };
    } catch {
      // fall through to offline
    }
  }
  return { ok: true, output: localClarify({ title, description, draft }), errors: [], usedFallback: true };
}

export async function runRefine(
  title: string,
  description: string | undefined,
  draft: DecompositionOutput,
  questions: ClarifyQuestion[],
  answers: ClarifyAnswer[],
): Promise<PlanResult> {
  if (hasApiKey()) {
    const refinedDescription = buildRefinedDescription(description, questions, answers);
    try {
      const r = await decompose(buildGateway(), { title, description: refinedDescription });
      if (r.output) return { ok: true, output: r.output, errors: [], usedFallback: false };
    } catch {
      // fall through
    }
  }
  // Offline (or refine failed): the draft already passed validation — keep it.
  return { ok: true, output: draft, errors: [], usedFallback: true };
}
