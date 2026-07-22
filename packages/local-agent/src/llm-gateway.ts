import type { LlmGateway, LlmRequest, LlmResponse, LlmUsage } from "@core/llm";

import type { LocalAgentId, LocalAgentRegistry, LocalAgentRunResult } from "./types";
import { defaultLocalAgentRegistry } from "./registry";
import { listLocalAgents, runLocalAgent } from "./runtime";

const DEFAULT_CLI_TIMEOUT_MS = 180_000;

function approximateTokens(value: string): number {
  return Math.max(1, Math.ceil(value.length / 4));
}

function usage(model: string, input: string, output: string): LlmUsage {
  return {
    model,
    inputTokens: approximateTokens(input),
    outputTokens: approximateTokens(output),
  };
}

function structuredPrompt(req: LlmRequest & { schema: unknown }): string {
  return [
    req.system ? `System instructions:\n${req.system}` : "",
    "",
    "User prompt:",
    req.prompt,
    "",
    "Return only valid JSON matching this JSON Schema. Do not wrap it in markdown.",
    JSON.stringify(req.schema),
  ].filter(Boolean).join("\n");
}

function plainPrompt(req: LlmRequest): string {
  return [
    req.system ? `System instructions:\n${req.system}` : "",
    "",
    "User prompt:",
    req.prompt,
  ].filter(Boolean).join("\n");
}

function extractJson(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) throw new Error("Local CLI returned no output.");
  try {
    return JSON.parse(trimmed);
  } catch {
    const startObject = trimmed.indexOf("{");
    const startArray = trimmed.indexOf("[");
    const start = startObject === -1 ? startArray : startArray === -1 ? startObject : Math.min(startObject, startArray);
    const end = Math.max(trimmed.lastIndexOf("}"), trimmed.lastIndexOf("]"));
    if (start === -1 || end <= start) throw new Error("Local CLI did not return parseable JSON.");
    return JSON.parse(trimmed.slice(start, end + 1));
  }
}

function bestError(result: LocalAgentRunResult): string {
  return result.error || result.events.find((event) => event.type === "agent.run.failed")?.summary || "Local CLI planning run failed.";
}

export class LocalCliLlmGateway implements LlmGateway {
  private detectedModels: Promise<Partial<Record<LocalAgentId, string>>> | null = null;

  constructor(
    private readonly options: {
      agentIds?: readonly LocalAgentId[];
      model?: string;
      reasoning?: string;
      cwd?: string;
      timeoutMs?: number;
      network?: boolean;
      registry?: LocalAgentRegistry;
    } = {},
  ) {}

  async complete(req: LlmRequest): Promise<LlmResponse<string>> {
    const prompt = plainPrompt(req);
    const { result, agentId, model: selectedModel } = await this.run(prompt, req);
    const model = `local-cli:${agentId}:${selectedModel || "default"}`;
    return {
      output: result.outputText,
      usage: usage(model, prompt, result.outputText),
    };
  }

  async completeStructured<T>(req: LlmRequest & { schema: unknown }): Promise<LlmResponse<T>> {
    const prompt = structuredPrompt(req);
    const { result, agentId, model: selectedModel } = await this.run(prompt, req);
    const model = `local-cli:${agentId}:${selectedModel || "default"}`;
    return {
      output: extractJson(result.outputText) as T,
      usage: usage(model, prompt, result.outputText),
    };
  }

  private async run(prompt: string, req: LlmRequest): Promise<{
    result: LocalAgentRunResult;
    agentId: LocalAgentId;
    model?: string;
  }> {
    const registry = this.options.registry ?? defaultLocalAgentRegistry;
    // No explicit chain: fall back across every registered agent in
    // registration order.
    const agentIds: readonly LocalAgentId[] = this.options.agentIds?.length ? this.options.agentIds : registry.ids();
    const errors: string[] = [];
    for (const agentId of agentIds) {
      const model = req.model || this.options.model || await this.preferredModel(agentId);
      let result: LocalAgentRunResult;
      try {
        result = await runLocalAgent({
          agentId,
          prompt,
          cwd: this.options.cwd ?? process.cwd(),
          model,
          reasoning: this.options.reasoning,
          timeoutMs: this.options.timeoutMs ?? DEFAULT_CLI_TIMEOUT_MS,
          permission: { sandbox: "read-only", network: this.options.network ?? false },
        }, { registry: this.options.registry });
      } catch (error) {
        errors.push(`${agentId}: ${error instanceof Error ? error.message : String(error)}`);
        continue;
      }
      if (result.ok) return { result, agentId, model };
      errors.push(`${agentId}: ${bestError(result)}`);
    }
    throw new Error(errors.join("; ") || "No local CLI planning runtime is available.");
  }

  private async preferredModel(agentId: LocalAgentId): Promise<string | undefined> {
    this.detectedModels ??= listLocalAgents({ registry: this.options.registry }).then((agents) => Object.fromEntries(
      agents.flatMap((agent) => {
        const model = agent.models.find((candidate) => candidate.id !== "default")?.id;
        return model ? [[agent.id, model]] : [];
      }),
    ));
    return (await this.detectedModels)[agentId];
  }
}
