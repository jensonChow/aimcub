import { describe, expect, it } from "vitest";

import { createAimcubToolRegistry } from "./tool-registry";
import type { AimcubToolHandlerContext } from "./tool-contract";

const context: AimcubToolHandlerContext = {
  now: () => new Date("2026-07-02T00:00:00.000Z"),
  permissions: ["memory.read"],
};

describe("Aimcub tool registry", () => {
  it("executes registered first-party handlers", async () => {
    const registry = createAimcubToolRegistry({
      "memory.search": async () => ({
        ok: true,
        observation: {
          summary: "selected memory",
          data: { memories: [] },
          sources: [],
        },
      }),
    });

    const result = await registry.execute("memory.search", { query: "Build Aimcub" }, context);

    expect(registry.has("memory.search")).toBe(true);
    expect(registry.has("web.search")).toBe(false);
    expect(result).toMatchObject({
      ok: true,
      observation: { summary: "selected memory" },
    });
    expect(registry.listAvailable().map((contract) => contract.name)).toEqual(["memory.search"]);
  });

  it("returns disabled for unregistered tools", async () => {
    const registry = createAimcubToolRegistry({});

    const result = await registry.execute("web.search", { query: "Aimcub" }, context);

    expect(result).toMatchObject({
      ok: false,
      error: { code: "disabled", retryable: false },
    });
  });

  it("normalizes thrown handler errors", async () => {
    const registry = createAimcubToolRegistry({
      "memory.search": async () => {
        throw new Error("store exploded");
      },
    });

    const result = await registry.execute("memory.search", { query: "Aimcub" }, context);

    expect(result).toMatchObject({
      ok: false,
      error: { code: "unknown_error", retryable: true },
    });
    expect(result.ok ? "" : result.error.message).toContain("store exploded");
  });
});
