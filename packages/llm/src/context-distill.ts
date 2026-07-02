import type {
  AimcubToolHandler,
  AimcubToolObservation,
  AimcubToolResult,
  AimcubToolSource,
  ContextDistillInput,
  ContextDistillOutput,
  MemorySearchOutput,
  WebFetchOutput,
  WebSearchOutput,
} from "./tool-contract";

const MAX_SUMMARY_LINES = 12;
const MAX_MISSING_QUESTIONS = 3;

function fail<T>(message: string): AimcubToolResult<T> {
  return { ok: false, error: { code: "invalid_input", message, retryable: false } };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isMemorySearchOutput(value: unknown): value is MemorySearchOutput {
  return isRecord(value) && Array.isArray(value.memories);
}

function isWebSearchOutput(value: unknown): value is WebSearchOutput {
  return isRecord(value) && Array.isArray(value.results);
}

function isWebFetchOutput(value: unknown): value is WebFetchOutput {
  return isRecord(value) && typeof value.finalUrl === "string" && typeof value.status === "number";
}

function uniqueSources(observations: readonly AimcubToolObservation<unknown>[]): AimcubToolSource[] {
  const seen = new Set<string>();
  const sources: AimcubToolSource[] = [];
  for (const source of observations.flatMap((observation) => observation.sources)) {
    const key = source.uri ?? source.url ?? source.path ?? source.title ?? JSON.stringify(source);
    if (seen.has(key)) continue;
    seen.add(key);
    sources.push(source);
  }
  return sources;
}

function summarizeObservation(observation: AimcubToolObservation<unknown>): string[] {
  const data = observation.data;
  if (isMemorySearchOutput(data)) {
    return data.memories.slice(0, 6).map((memory) =>
      `${memory.category}: ${memory.content}`,
    );
  }
  if (isWebSearchOutput(data)) {
    return data.results.slice(0, 4).map((result) =>
      `web: ${result.title}${result.snippet ? ` — ${result.snippet}` : ""} (${result.url})`,
    );
  }
  if (isWebFetchOutput(data)) {
    const title = data.title ? `${data.title} ` : "";
    const text = data.text ? ` — ${data.text.slice(0, 300)}` : "";
    return [`web page: ${title}(${data.finalUrl})${text}`];
  }
  return observation.summary ? [observation.summary] : [];
}

function missingQuestions(input: ContextDistillInput): ContextDistillOutput["missingQuestions"] {
  const observations = input.observations ?? [];
  const hasMemory = observations.some((observation) => isMemorySearchOutput(observation.data));
  const memoryCount = observations.flatMap((observation) =>
    isMemorySearchOutput(observation.data) ? observation.data.memories : [],
  ).length;
  const hasEvalSignal = observations.some((observation) =>
    isMemorySearchOutput(observation.data) &&
    observation.data.memories.some((memory) => memory.category === "eval_signal"),
  );
  const questions: ContextDistillOutput["missingQuestions"] = [];
  if (!hasMemory || memoryCount === 0) {
    questions.push({
      id: "missing_planning_context",
      category: "project_fact",
      question: "What context, constraints, or prior decisions should shape this aim?",
    });
  }
  if (!hasEvalSignal) {
    questions.push({
      id: "missing_eval_signal",
      category: "eval_signal",
      question: "What evidence would make this aim count as genuinely complete?",
    });
  }
  return questions.slice(0, MAX_MISSING_QUESTIONS);
}

export function createContextDistillHandler(): AimcubToolHandler<ContextDistillInput, ContextDistillOutput> {
  return async (input, context) => {
    if (!context.permissions.includes("context.distill")) {
      return {
        ok: false,
        error: {
          code: "permission_denied",
          message: "context.distill requires the context.distill permission.",
          retryable: false,
        },
      };
    }
    const rawInput = input as Partial<ContextDistillInput> | null | undefined;
    if (!rawInput || typeof rawInput.aimTitle !== "string" || !rawInput.aimTitle.trim()) {
      return fail("context.distill requires aimTitle.");
    }
    if (!Array.isArray(rawInput.observations)) {
      return fail("context.distill requires observations.");
    }

    const summaryLines = rawInput.observations
      .flatMap(summarizeObservation)
      .map((line) => line.replace(/\s+/g, " ").trim())
      .filter(Boolean)
      .slice(0, MAX_SUMMARY_LINES);
    const output: ContextDistillOutput = {
      summary: summaryLines.length > 0
        ? summaryLines.join("\n")
        : `No tool context was available for ${rawInput.aimTitle.trim()}.`,
      usedSources: uniqueSources(rawInput.observations),
      missingQuestions: missingQuestions(input),
      durableMemoryCandidates: [],
    };

    return {
      ok: true,
      observation: {
        summary: "Distilled planning tool observations into compact context.",
        data: output,
        sources: output.usedSources,
      },
    };
  };
}
