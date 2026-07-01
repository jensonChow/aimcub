import { describe, expect, it, vi } from "vitest";

import {
  OpenAiCompatibleLlmGateway,
  type OpenAiFetchPort,
  type OpenAiFetchResponse,
} from "./openai-gateway";
import type { LlmTask, LlmUsage, UsageMeter } from "./index";

/** A fake fetch returning a canned chat-completions body — no network. */
function fakeFetch(content: string, opts?: { ok?: boolean; status?: number; usage?: { prompt_tokens?: number; completion_tokens?: number } }) {
  const payload = JSON.stringify({
    choices: [{ message: { content } }],
    usage: { prompt_tokens: 11, completion_tokens: 22, ...opts?.usage },
  });
  const impl = vi.fn(async (): Promise<OpenAiFetchResponse> => ({
    ok: opts?.ok ?? true,
    status: opts?.status ?? 200,
    async text() {
      return opts?.ok === false ? content : payload;
    },
  }));
  return { client: impl as unknown as OpenAiFetchPort, impl };
}

/** A fetch returning an arbitrary raw body (for edge cases: non-JSON, empty choices, …). */
function rawFetch(body: string, opts?: { ok?: boolean; status?: number }) {
  const impl = vi.fn(async (): Promise<OpenAiFetchResponse> => ({
    ok: opts?.ok ?? true,
    status: opts?.status ?? 200,
    async text() {
      return body;
    },
  }));
  return { client: impl as unknown as OpenAiFetchPort, impl };
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

describe("OpenAiCompatibleLlmGateway · complete", () => {
  it("returns the message content and normalizes usage from prompt/completion tokens", async () => {
    const { client, impl } = fakeFetch("hello world");
    const { meter, records } = recordingMeter();
    const gw = new OpenAiCompatibleLlmGateway({ meter, ownerId: "owner-1", apiKey: "k", model: "gpt-x", client });

    const res = await gw.complete({ task: "classify", prompt: "say hi" });

    expect(res.output).toBe("hello world");
    expect(res.usage.inputTokens).toBe(11);
    expect(res.usage.outputTokens).toBe(22);
    expect(res.usage.model).toBe("gpt-x");
    expect(impl).toHaveBeenCalledOnce();
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ ownerId: "owner-1", task: "classify" });
  });
});

describe("OpenAiCompatibleLlmGateway · request shaping", () => {
  it("targets {baseURL}/chat/completions, sends the bearer key, and uses the single model for every task", async () => {
    const { client, impl } = fakeFetch("ok");
    const { meter } = recordingMeter();
    const gw = new OpenAiCompatibleLlmGateway({
      meter,
      ownerId: "o",
      apiKey: "secret-key",
      model: "deepseek-chat",
      baseURL: "https://openrouter.ai/api/v1/",
      client,
    });

    // `decompose` would route to Sonnet on Anthropic; here it must still use the one model.
    await gw.complete({ task: "decompose", prompt: "x", system: "be terse" });

    const [url, init] = impl.mock.calls[0]!;
    expect(url).toBe("https://openrouter.ai/api/v1/chat/completions"); // trailing slash trimmed
    expect(init.headers.authorization).toBe("Bearer secret-key");
    const body = JSON.parse(init.body) as { model: string; messages: Array<{ role: string; content: string }> };
    expect(body.model).toBe("deepseek-chat");
    expect(body.messages[0]).toEqual({ role: "system", content: "be terse" });
    expect(body.messages[1]).toEqual({ role: "user", content: "x" });
  });

  it("defaults baseURL to the OpenAI API root when none is given", async () => {
    const { client, impl } = fakeFetch("ok");
    const { meter } = recordingMeter();
    const gw = new OpenAiCompatibleLlmGateway({ meter, ownerId: "o", apiKey: "k", model: "gpt-x", client });

    await gw.complete({ task: "classify", prompt: "x" });

    expect(impl.mock.calls[0]![0]).toBe("https://api.openai.com/v1/chat/completions");
  });

  it("sends max_completion_tokens by default (OpenAI reasoning models reject max_tokens)", async () => {
    const { client, impl } = fakeFetch("ok");
    const { meter } = recordingMeter();
    const gw = new OpenAiCompatibleLlmGateway({ meter, ownerId: "o", apiKey: "k", model: "gpt-x", client });

    await gw.complete({ task: "classify", prompt: "x" });

    const body = JSON.parse(impl.mock.calls[0]![1].body) as Record<string, unknown>;
    expect(body.max_completion_tokens).toBeDefined();
    expect(body.max_tokens).toBeUndefined();
  });

  it("can fall back to max_tokens for legacy servers via maxTokensParam", async () => {
    const { client, impl } = fakeFetch("ok");
    const { meter } = recordingMeter();
    const gw = new OpenAiCompatibleLlmGateway({
      meter,
      ownerId: "o",
      apiKey: "k",
      model: "local",
      client,
      maxTokensParam: "max_tokens",
    });

    await gw.complete({ task: "classify", prompt: "x" });

    const body = JSON.parse(impl.mock.calls[0]![1].body) as Record<string, unknown>;
    expect(body.max_tokens).toBeDefined();
    expect(body.max_completion_tokens).toBeUndefined();
  });

  it("uses DeepSeek-compatible request defaults for api.deepseek.com", async () => {
    const payload = { ok: true };
    const { client, impl } = fakeFetch(JSON.stringify(payload));
    const { meter } = recordingMeter();
    const gw = new OpenAiCompatibleLlmGateway({
      meter,
      ownerId: "o",
      apiKey: "k",
      model: "deepseek-v4-pro",
      baseURL: "https://api.deepseek.com",
      client,
    });

    await gw.completeStructured<typeof payload>({ task: "decompose", prompt: "give me json", schema: { type: "object" } });

    const body = JSON.parse(impl.mock.calls[0]![1].body) as {
      model: string;
      max_tokens?: number;
      max_completion_tokens?: number;
      messages: Array<{ role: string; content: string }>;
      response_format?: { type: string; json_schema?: unknown };
    };
    expect(body.model).toBe("deepseek-v4-pro");
    expect(body.max_tokens).toBeDefined();
    expect(body.max_completion_tokens).toBeUndefined();
    expect(body.response_format).toEqual({ type: "json_object" });
    expect(body.messages[0]!.content).toContain("The JSON must satisfy this JSON Schema:");
  });

  it("omits response_format on a plain (non-structured) complete", async () => {
    const { client, impl } = fakeFetch("ok");
    const { meter } = recordingMeter();
    const gw = new OpenAiCompatibleLlmGateway({ meter, ownerId: "o", apiKey: "k", model: "gpt-x", client });

    await gw.complete({ task: "classify", prompt: "x" });

    const body = JSON.parse(impl.mock.calls[0]![1].body) as Record<string, unknown>;
    expect(body.response_format).toBeUndefined();
  });

  it("supports prompt-only structured output for compatible providers without response_format", async () => {
    const payload = { ok: true };
    const { client, impl } = fakeFetch(JSON.stringify(payload));
    const { meter } = recordingMeter();
    const gw = new OpenAiCompatibleLlmGateway({
      meter,
      ownerId: "o",
      apiKey: "k",
      model: "MiniMax-M3",
      baseURL: "https://api.minimax.io/v1",
      client,
    });

    await gw.completeStructured<typeof payload>({ task: "decompose", prompt: "give me json", schema: { type: "object" } });

    const body = JSON.parse(impl.mock.calls[0]![1].body) as {
      max_tokens?: number;
      max_completion_tokens?: number;
      messages: Array<{ role: string; content: string }>;
      response_format?: unknown;
    };
    expect(body.max_tokens).toBeDefined();
    expect(body.max_completion_tokens).toBeUndefined();
    expect(body.response_format).toBeUndefined();
    expect(body.messages[0]!.content).toContain("Return only valid JSON");
    expect(body.messages[0]!.content).toContain("\"type\":\"object\"");
  });
});

describe("OpenAiCompatibleLlmGateway · completeStructured", () => {
  it("sends response_format json_schema (strict) and parses the JSON content", async () => {
    const payload = { hello: "structured" };
    const { client, impl } = fakeFetch(JSON.stringify(payload));
    const { meter } = recordingMeter();
    const gw = new OpenAiCompatibleLlmGateway({ meter, ownerId: "o", apiKey: "k", model: "gpt-x", client });

    const schema = { type: "object" } as const;
    const res = await gw.completeStructured<typeof payload>({ task: "decompose", prompt: "give me json", schema });

    expect(res.output).toEqual(payload);
    const body = JSON.parse(impl.mock.calls[0]![1].body) as {
      response_format?: { type: string; json_schema?: { name: string; schema: unknown; strict: boolean } };
    };
    expect(body.response_format?.type).toBe("json_schema");
    expect(body.response_format?.json_schema?.strict).toBe(true);
    expect(body.response_format?.json_schema?.schema).toEqual(schema);
  });

  it("throws a clear error when the content is not valid JSON", async () => {
    const { client } = fakeFetch("not json {");
    const { meter } = recordingMeter();
    const gw = new OpenAiCompatibleLlmGateway({ meter, ownerId: "o", apiKey: "k", model: "gpt-x", client });

    await expect(
      gw.completeStructured({ task: "decompose", prompt: "x", schema: {} }),
    ).rejects.toThrow(/not valid JSON/);
  });
});

describe("OpenAiCompatibleLlmGateway · transport errors", () => {
  it("times out a request that never resolves", async () => {
    vi.useFakeTimers();
    try {
      const client = vi.fn(() => new Promise<OpenAiFetchResponse>(() => {})) as unknown as OpenAiFetchPort;
      const { meter } = recordingMeter();
      const gw = new OpenAiCompatibleLlmGateway({
        meter,
        ownerId: "o",
        apiKey: "k",
        model: "gpt-x",
        client,
        requestTimeoutMs: 25,
      });

      const promise = expect(gw.complete({ task: "classify", prompt: "x" })).rejects.toThrow(/request timed out after 25ms/);
      await vi.advanceTimersByTimeAsync(25);
      await promise;
    } finally {
      vi.useRealTimers();
    }
  });

  it("throws on a non-2xx response, including the status and body", async () => {
    const { client } = fakeFetch("rate limited", { ok: false, status: 429 });
    const { meter } = recordingMeter();
    const gw = new OpenAiCompatibleLlmGateway({ meter, ownerId: "o", apiKey: "k", model: "gpt-x", client });

    await expect(gw.complete({ task: "classify", prompt: "x" })).rejects.toThrow(/429/);
  });

  it("throws when a 2xx body is not valid JSON (e.g. an HTML proxy/error page)", async () => {
    const { client } = rawFetch("<html>502 Bad Gateway</html>", { ok: true, status: 200 });
    const { meter } = recordingMeter();
    const gw = new OpenAiCompatibleLlmGateway({ meter, ownerId: "o", apiKey: "k", model: "gpt-x", client });

    await expect(gw.complete({ task: "classify", prompt: "x" })).rejects.toThrow(/response was not valid JSON/);
  });
});

describe("OpenAiCompatibleLlmGateway · response edge cases", () => {
  it("surfaces a strict-mode refusal as a clear error", async () => {
    const body = JSON.stringify({ choices: [{ message: { content: null, refusal: "I can't help with that." } }] });
    const { client } = rawFetch(body);
    const { meter } = recordingMeter();
    const gw = new OpenAiCompatibleLlmGateway({ meter, ownerId: "o", apiKey: "k", model: "gpt-x", client });

    await expect(gw.complete({ task: "classify", prompt: "x" })).rejects.toThrow(/model refused: I can't help/);
  });

  it("coalesces empty choices to an empty string and still meters", async () => {
    const { client } = rawFetch(JSON.stringify({ choices: [], usage: { prompt_tokens: 3, completion_tokens: 0 } }));
    const { meter, records } = recordingMeter();
    const gw = new OpenAiCompatibleLlmGateway({ meter, ownerId: "o", apiKey: "k", model: "gpt-x", client });

    const res = await gw.complete({ task: "classify", prompt: "x" });
    expect(res.output).toBe("");
    expect(records).toHaveLength(1);
    expect(res.usage.inputTokens).toBe(3);
  });

  it("defaults token counts to 0 when the usage block is absent", async () => {
    const { client } = rawFetch(JSON.stringify({ choices: [{ message: { content: "hi" } }] }));
    const { meter } = recordingMeter();
    const gw = new OpenAiCompatibleLlmGateway({ meter, ownerId: "o", apiKey: "k", model: "gpt-x", client });

    const res = await gw.complete({ task: "classify", prompt: "x" });
    expect(res.output).toBe("hi");
    expect(res.usage.inputTokens).toBe(0);
    expect(res.usage.outputTokens).toBe(0);
  });
});
