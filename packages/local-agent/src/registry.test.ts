import { describe, expect, it } from "vitest";

import {
  BUILT_IN_LOCAL_AGENT_ADAPTERS,
  createLocalAgentRegistry,
  defaultLocalAgentRegistry,
  listRegisteredLocalAgentIds,
} from "./registry";
import type { LocalAgentAdapter } from "./types";

function fakeAdapter(overrides: Partial<LocalAgentAdapter> = {}): LocalAgentAdapter {
  return {
    id: "gemini-fake",
    name: "Fake Gemini",
    bin: "gemini-fake",
    envVar: "GEMINI_FAKE_BIN",
    versionArgs: ["--version"],
    fallbackModels: [{ id: "default", label: "Default" }],
    buildInvocation: (request) => ({ args: ["run"], stdin: request.prompt }),
    parseLine: () => null,
    ...overrides,
  };
}

describe("local agent registry", () => {
  it("registers the built-in adapters in preference order", () => {
    expect(BUILT_IN_LOCAL_AGENT_ADAPTERS.map((adapter) => adapter.id)).toEqual(["codex", "claude"]);
    expect(listRegisteredLocalAgentIds()).toEqual(["codex", "claude"]);
    expect(defaultLocalAgentRegistry.get("codex")?.name).toBe("Codex CLI");
    expect(defaultLocalAgentRegistry.get("unregistered")).toBeNull();
  });

  it("appends newly registered adapters after the built-ins", () => {
    const registry = createLocalAgentRegistry();
    registry.register(fakeAdapter());

    expect(registry.ids()).toEqual(["codex", "claude", "gemini-fake"]);
    expect(registry.list().map((adapter) => adapter.id)).toEqual(["codex", "claude", "gemini-fake"]);
    expect(registry.has("gemini-fake")).toBe(true);
  });

  it("rejects duplicate and malformed adapter ids", () => {
    const registry = createLocalAgentRegistry();
    expect(() => registry.register(fakeAdapter({ id: "codex" }))).toThrow('"codex" is already registered');
    expect(() => registry.register(fakeAdapter({ id: "Bad Id" }))).toThrow('Invalid local agent adapter id "Bad Id"');
    expect(() => registry.register(fakeAdapter({ name: " " }))).toThrow("needs a display name");
    expect(() => registry.register(fakeAdapter({ bin: "" }))).toThrow("needs an executable name");
    expect(() => registry.register(fakeAdapter({ envVar: "" }))).toThrow("env var");
  });

  it("keeps created registries isolated from the default singleton", () => {
    const registry = createLocalAgentRegistry([fakeAdapter()]);

    expect(registry.ids()).toEqual(["gemini-fake"]);
    expect(registry.has("codex")).toBe(false);
    expect(defaultLocalAgentRegistry.has("gemini-fake")).toBe(false);
    expect(listRegisteredLocalAgentIds()).toEqual(["codex", "claude"]);
  });
});
