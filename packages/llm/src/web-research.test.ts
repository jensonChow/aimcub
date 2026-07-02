import { describe, expect, it, vi } from "vitest";

import {
  BraveWebSearchClient,
  createWebResearchRuntime,
  type WebResearchFetchPort,
} from "./web-research";
import type { AimcubToolHandlerContext } from "./tool-contract";

const baseContext: AimcubToolHandlerContext = {
  now: () => new Date("2026-07-02T00:00:00.000Z"),
  permissions: ["network.search", "network.fetch"],
};

function response(body: string, init: {
  ok?: boolean;
  status?: number;
  url?: string;
  headers?: Record<string, string>;
} = {}) {
  const headers = new Map(Object.entries(init.headers ?? {}).map(([key, value]) => [key.toLowerCase(), value]));
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    url: init.url,
    headers: {
      get(name: string) {
        return headers.get(name.toLowerCase()) ?? null;
      },
    },
    async text() {
      return body;
    },
  };
}

describe("web research runtime · web.search", () => {
  it("requires network.search permission", async () => {
    const runtime = createWebResearchRuntime({
      searchClient: {
        async search() {
          return { results: [] };
        },
      },
    });

    const result = await runtime.search({ query: "Aimcub" }, { ...baseContext, permissions: [] });

    expect(result).toMatchObject({
      ok: false,
      error: { code: "permission_denied", retryable: false },
    });
  });

  it("returns disabled when no search provider is configured", async () => {
    const runtime = createWebResearchRuntime({ searchClient: null });

    const result = await runtime.search({ query: "Aimcub" }, baseContext);

    expect(result).toMatchObject({
      ok: false,
      error: { code: "disabled", retryable: false },
    });
  });

  it("returns invalid_input for malformed search input", async () => {
    const runtime = createWebResearchRuntime({
      searchClient: {
        async search() {
          return { results: [] };
        },
      },
    });

    const result = await runtime.search(null as never, baseContext);

    expect(result).toMatchObject({
      ok: false,
      error: { code: "invalid_input", retryable: false },
    });
  });

  it("runs a configured provider and emits web sources", async () => {
    const runtime = createWebResearchRuntime({
      searchClient: {
        async search(input) {
          expect(input.limit).toBe(3);
          return {
            results: [
              { title: "Aimcub", url: "https://example.com/aimcub", snippet: "Planning runtime" },
              { title: "Other", url: "https://other.test/post", snippet: "Filtered out" },
            ],
          };
        },
      },
    });

    const result = await runtime.search({ query: "Aimcub", limit: 3, domains: ["example.com"] }, baseContext);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.observation.data.results).toEqual([
      { title: "Aimcub", url: "https://example.com/aimcub", snippet: "Planning runtime" },
    ]);
    expect(result.observation.sources).toEqual([
      {
        kind: "web",
        title: "Aimcub",
        url: "https://example.com/aimcub",
        uri: "https://example.com/aimcub",
        observedAt: "2026-07-02T00:00:00.000Z",
      },
    ]);
  });
});

describe("web research runtime · web.fetch", () => {
  it("requires network.fetch permission", async () => {
    const runtime = createWebResearchRuntime({
      fetchImpl: async () => response("ok"),
    });

    const result = await runtime.fetch({ url: "https://example.com" }, { ...baseContext, permissions: [] });

    expect(result).toMatchObject({
      ok: false,
      error: { code: "permission_denied", retryable: false },
    });
  });

  it("blocks localhost and private-network URLs by default", async () => {
    const fetchImpl = vi.fn<WebResearchFetchPort>(async () => response("should not be fetched"));
    const runtime = createWebResearchRuntime({ fetchImpl });

    const result = await runtime.fetch({ url: "http://127.0.0.1:5173" }, baseContext);

    expect(result).toMatchObject({
      ok: false,
      error: { code: "permission_denied", retryable: false },
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("returns invalid_input for malformed fetch input", async () => {
    const fetchImpl = vi.fn<WebResearchFetchPort>(async () => response("should not be fetched"));
    const runtime = createWebResearchRuntime({ fetchImpl });

    const result = await runtime.fetch(null as never, baseContext);

    expect(result).toMatchObject({
      ok: false,
      error: { code: "invalid_input", retryable: false },
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("extracts bounded HTML text, title, links, and sources", async () => {
    const html = `
      <!doctype html>
      <html>
        <head><title>Aimcub &amp; Tools</title><style>.x { color: red; }</style></head>
        <body>
          <script>secret()</script>
          <h1>Aimcub</h1>
          <p>First-party web fetch.</p>
          <a href="/docs">Docs</a>
          <a href="mailto:test@example.com">Email</a>
        </body>
      </html>
    `;
    const runtime = createWebResearchRuntime({
      fetchImpl: async () => response(html, {
        url: "https://example.com/research",
        headers: { "content-type": "text/html; charset=utf-8" },
      }),
    });

    const result = await runtime.fetch({ url: "https://example.com/research", extractMode: "text_with_links" }, baseContext);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.observation.data).toMatchObject({
      finalUrl: "https://example.com/research",
      status: 200,
      title: "Aimcub & Tools",
      truncated: false,
      links: [{ text: "Docs", url: "https://example.com/docs" }],
    });
    expect(result.observation.data.text).toContain("Aimcub");
    expect(result.observation.data.text).toContain("First-party web fetch.");
    expect(result.observation.data.text).not.toContain("secret()");
    expect(result.observation.sources[0]).toMatchObject({
      kind: "web",
      title: "Aimcub & Tools",
      url: "https://example.com/research",
    });
  });

  it("can return metadata without full text", async () => {
    const runtime = createWebResearchRuntime({
      fetchImpl: async () => response("<title>Only title</title><p>Body</p>", {
        headers: { "content-type": "text/html" },
      }),
    });

    const result = await runtime.fetch({ url: "https://example.com", extractMode: "metadata" }, baseContext);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.observation.data.title).toBe("Only title");
    expect(result.observation.data.text).toBeUndefined();
  });

  it("truncates text to the requested byte budget", async () => {
    const runtime = createWebResearchRuntime({
      fetchImpl: async () => response("abcdef", {
        headers: { "content-type": "text/plain" },
      }),
    });

    const result = await runtime.fetch({ url: "https://example.com/readme.txt", maxBytes: 3 }, baseContext);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.observation.data.text).toBe("abc");
    expect(result.observation.data.truncated).toBe(true);
    expect(result.observation.warnings).toEqual(["Content truncated to 3 bytes."]);
  });

  it("truncates on UTF-8 byte boundaries", async () => {
    const runtime = createWebResearchRuntime({
      fetchImpl: async () => response("你好吗", {
        headers: { "content-type": "text/plain" },
      }),
    });

    const result = await runtime.fetch({ url: "https://example.com/zh.txt", maxBytes: 4 }, baseContext);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.observation.data.text).toBe("你");
    expect(result.observation.data.truncated).toBe(true);
  });

  it("rejects unsupported content types", async () => {
    const runtime = createWebResearchRuntime({
      fetchImpl: async () => response("%PDF", {
        headers: { "content-type": "application/pdf" },
      }),
    });

    const result = await runtime.fetch({ url: "https://example.com/file.pdf" }, baseContext);

    expect(result).toMatchObject({
      ok: false,
      error: { code: "unsupported_content_type", retryable: false },
    });
  });
});

describe("BraveWebSearchClient", () => {
  it("maps Brave results into Aimcub web.search output", async () => {
    const fetchImpl = vi.fn<WebResearchFetchPort>(async () => response(JSON.stringify({
      web: {
        results: [
          {
            title: "Aimcub docs",
            url: "https://docs.example.com/aimcub",
            description: "<b>Planning</b> tools",
            age: "2026-07-01",
            profile: { name: "Example Docs" },
          },
          {
            title: "Other docs",
            url: "https://other.example.com/aimcub",
            description: "Other",
          },
        ],
      },
    }), { headers: { "content-type": "application/json" } }));
    const client = new BraveWebSearchClient({
      apiKey: "brave-key",
      fetchImpl,
      endpoint: "https://search.test/res/v1/web/search",
    });

    const output = await client.search({
      query: "Aimcub web tools",
      limit: 2,
      recencyDays: 7,
      domains: ["docs.example.com"],
    });

    expect(output.results).toEqual([
      {
        title: "Aimcub docs",
        url: "https://docs.example.com/aimcub",
        snippet: "Planning tools",
        source: "Example Docs",
        publishedAt: "2026-07-01",
      },
    ]);
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toContain("q=Aimcub+web+tools");
    expect(url).toContain("count=2");
    expect(url).toContain("freshness=pw");
    expect(init?.headers?.["X-Subscription-Token"]).toBe("brave-key");
  });
});
