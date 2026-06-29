/**
 * The planning pipeline run in the main process: draft → clarify → refine.
 *
 * Each step uses the @core/llm brain through the configured gateway. There is NO offline
 * template fallback ("真刀实枪"): if no provider is configured, or the LLM call fails, or
 * the model returns an invalid plan, the step returns `{ ok: false, errors }` for the UI
 * to surface honestly. The gateway is injected (built from config in the IPC layer) so
 * this module stays free of Electron and is unit-testable with a mock gateway.
 */
import {
  decompose,
  clarify,
  buildRefinedDescription,
  type LlmGateway,
  type ClarifyAnswer,
  type ClarifyQuestion,
} from "@core/llm";
import type { DecompositionOutput } from "@core/types";

import type { ClarifyIpcResult, PlanResult } from "../shared/ipc";

const NO_PROVIDER = "No LLM provider configured — add a provider and API key in settings.";

export async function runDraft(
  gateway: LlmGateway | null,
  title: string,
  description?: string,
): Promise<PlanResult> {
  if (!gateway) return { ok: false, output: null, errors: [NO_PROVIDER] };
  const r = await decompose(gateway, { title, description });
  if (r.output) return { ok: true, output: r.output, errors: [] };
  return { ok: false, output: null, errors: r.validation.errors };
}

export async function runClarify(
  gateway: LlmGateway | null,
  title: string,
  description: string | undefined,
  draft: DecompositionOutput,
): Promise<ClarifyIpcResult> {
  if (!gateway) return { ok: false, output: null, errors: [NO_PROVIDER] };
  const r = await clarify(gateway, { title, description, draft });
  if (r.output) return { ok: true, output: r.output, errors: [] };
  return { ok: false, output: null, errors: r.validation.errors };
}

export async function runRefine(
  gateway: LlmGateway | null,
  title: string,
  description: string | undefined,
  _draft: DecompositionOutput,
  questions: ClarifyQuestion[],
  answers: ClarifyAnswer[],
): Promise<PlanResult> {
  if (!gateway) return { ok: false, output: null, errors: [NO_PROVIDER] };
  const refinedDescription = buildRefinedDescription(description, questions, answers);
  const r = await decompose(gateway, { title, description: refinedDescription });
  if (r.output) return { ok: true, output: r.output, errors: [] };
  return { ok: false, output: null, errors: r.validation.errors };
}
