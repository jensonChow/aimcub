import { describe, expect, it, vi } from "vitest";

import { AnthropicLlmGateway, resolveAnthropicApiKey, type AnthropicClientPort } from "./anthropic-gateway";
import { Models, type LlmTask, type LlmUsage, type UsageMeter } from "./index";

// A fake SDK client implementing the minimal port — no network, no API key.
function fakeClient(text: string, usage?: Partial<AnthropicUsage>) {
  const create = vi.fn(async (body: unknown) => ({
    _body: body,
    content: [{ type: "text", text }],
    usage: {
      input_tokens: 10,
      output_tokens: 20,
      cache_read_input_tokens: 5,
      cache_creation_input_tokens: null,
      ...usage,
    },
  }));
  const client: AnthropicClientPort = { messages: { create: create as never } };
  return { client, create };
}

interface AnthropicUsage {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens: number | null;
  cache_creation_input_tokens: number | null;
}

function recordingMeter() {
  const records: Array<{ ownerId: string; task: LlmTask; usage: LlmUsage }> = [];
  const meter: UsageMeter = {
    async record(ownerId, task, usage) {
      records.push({ ownerId, task, usage });
    },
  };
  return { meter, records };
}

describe("AnthropicLlmGateway · complete", () => {
  it("returns concatenated text and normalizes usage", async () => {
    const { client, create } = fakeClient("hello world");
    const { meter, records } = recordingMeter();
    const gw = new AnthropicLlmGateway({ meter, ownerId: "owner-1", client });

    const res = await gw.complete({ task: "classify", prompt: "say hi" });

    expect(res.output).toBe("hello world");
    expect(res.usage.inputTokens).toBe(10);
    expect(res.usage.outputTokens).toBe(20);
    expect(res.usage.cacheReadTokens).toBe(5);
    expect(res.usage.cacheWriteTokens).toBeUndefined(); // null → undefined
    expect(create).toHaveBeenCalledOnce();
    // metered
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ ownerId: "owner-1", task: "classify" });
  });
});

describe("AnthropicLlmGateway · model routing via routeModel", () => {
  const cases: Array<[LlmTask, string]> = [
    ["decompose", Models.sonnet],
    ["replan", Models.sonnet],
    ["classify", Models.haiku],
    ["extract_memory", Models.haiku],
  ];

  it.each(cases)("routes %s to the right model", async (task, expectedModel) => {
    const { client, create } = fakeClient("ok");
    const { meter } = recordingMeter();
    const gw = new AnthropicLlmGateway({ meter, ownerId: "o", client });

    await gw.complete({ task, prompt: "x" });

    const body = create.mock.calls[0]![0] as { model: string };
    expect(body.model).toBe(expectedModel);
  });

  it("honors an explicit model override", async () => {
    const { client, create } = fakeClient("ok");
    const { meter } = recordingMeter();
    const gw = new AnthropicLlmGateway({ meter, ownerId: "o", client });

    await gw.complete({ task: "decompose", prompt: "x", model: Models.haiku });

    const body = create.mock.calls[0]![0] as { model: string };
    expect(body.model).toBe(Models.haiku);
  });
});

describe("resolveAnthropicApiKey · BYO-key precedence", () => {
  it("prefers an explicit key over the env var", () => {
    expect(resolveAnthropicApiKey("explicit", "from-env")).toBe("explicit");
  });

  it("falls back to the env var when no explicit key is given", () => {
    expect(resolveAnthropicApiKey(undefined, "from-env")).toBe("from-env");
  });

  it("throws a clear error when neither is present", () => {
    expect(() => resolveAnthropicApiKey(undefined, undefined)).toThrow(/no Anthropic API key/);
  });
});

describe("AnthropicLlmGateway · completeStructured", () => {
  it("passes the schema as output_config.format and parses the JSON response", async () => {
    const payload = { hello: "structured" };
    const { client, create } = fakeClient(JSON.stringify(payload));
    const { meter } = recordingMeter();
    const gw = new AnthropicLlmGateway({ meter, ownerId: "o", client });

    const schema = { type: "object" } as const;
    const res = await gw.completeStructured<typeof payload>({
      task: "decompose",
      prompt: "give me json",
      system: "be terse",
      schema,
    });

    expect(res.output).toEqual(payload);
    const body = create.mock.calls[0]![0] as {
      system?: string;
      output_config?: { format?: { type: string; schema: unknown } };
    };
    expect(body.system).toBe("be terse");
    expect(body.output_config?.format?.type).toBe("json_schema");
    expect(body.output_config?.format?.schema).toBe(schema);
  });

  it("throws a clear error when the structured output is not valid JSON", async () => {
    const { client } = fakeClient("not json {");
    const { meter } = recordingMeter();
    const gw = new AnthropicLlmGateway({ meter, ownerId: "o", client });

    await expect(
      gw.completeStructured({ task: "decompose", prompt: "x", schema: {} }),
    ).rejects.toThrow(/not valid JSON/);
  });
});
