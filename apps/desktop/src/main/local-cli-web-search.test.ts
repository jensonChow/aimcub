import { describe, expect, it, vi } from "vitest";

import type { LlmGateway, LlmRequest, LlmResponse } from "@aimcub/llm";

import { LocalCliWebSearchClient } from "./local-cli-web-search";

describe("LocalCliWebSearchClient", () => {
  it("uses one live-search corpus and serves distinct research lanes", async () => {
    let requestCount = 0;
    const requests: Array<LlmRequest & { schema: unknown }> = [];
    const corpus = {
        results: [
          {
            title: "Official requirements",
            url: "https://regulator.example/requirements",
            snippet: "Current mandatory requirements.",
            source: "Regulator",
            publishedAt: "2026-07-01",
            lanes: ["authoritative_requirements"],
          },
          {
            title: "Independent comparison",
            url: "https://analysis.example/comparison",
            snippet: "Compares three viable alternatives.",
            lanes: ["alternatives_market"],
          },
          {
            title: "Invalid guessed source",
            url: "not-a-url",
            snippet: "Must be discarded.",
            lanes: ["aim_facts"],
          },
        ],
      };
    const gateway: LlmGateway = {
      async complete() {
        throw new Error("not used");
      },
      async completeStructured<T>(request: LlmRequest & { schema: unknown }): Promise<LlmResponse<T>> {
        requestCount += 1;
        requests.push(request);
        return {
          output: corpus as T,
          usage: { model: "local-cli:codex", inputTokens: 1, outputTokens: 1 },
        };
      },
    };
    const client = new LocalCliWebSearchClient(gateway, () => new Date("2026-07-10T00:00:00.000Z"));

    const requirements = await client.search({ query: "Current official requirements", limit: 3 });
    const alternatives = await client.search({ query: "Alternatives and market comparison", limit: 3 });

    expect(requestCount).toBe(1);
    expect(requests[0]).toMatchObject({ task: "classify" });
    expect(requests[0]?.system).toContain("must search before answering");
    expect(requests[0]?.prompt).toContain("2026-07-10");
    expect(requirements.results.map((result) => result.url)).toEqual(["https://regulator.example/requirements"]);
    expect(alternatives.results.map((result) => result.url)).toEqual(["https://analysis.example/comparison"]);
  });

  it("rejects a corpus without observed web URLs", async () => {
    const gateway = {
      complete: vi.fn(),
      completeStructured: vi.fn(async () => ({
        output: { results: [{ title: "No source", url: "invented", snippet: "No URL.", lanes: ["aim_facts"] }] },
        usage: { model: "local-cli:codex", inputTokens: 1, outputTokens: 1 },
      })),
    } as unknown as LlmGateway;

    await expect(new LocalCliWebSearchClient(gateway).search({ query: "current facts" }))
      .rejects.toThrow("no verifiable http(s) sources");
  });
});
