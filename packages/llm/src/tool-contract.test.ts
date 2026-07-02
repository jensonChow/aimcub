import { describe, expect, it } from "vitest";

import {
  BUILT_IN_TOOL_CONTRACTS,
  BUILT_IN_TOOL_NAMES,
  assertValidToolContracts,
  getBuiltInToolContract,
  isBuiltInToolName,
  validateToolContracts,
  type AimcubToolContract,
  type AimcubToolName,
} from "./tool-contract";

const EXPECTED_TOOL_NAMES: readonly AimcubToolName[] = [
  "local.read",
  "local.write",
  "local.edit",
  "local.search",
  "local.glob",
  "local.scan_workspace",
  "memory.search",
  "memory.write_candidate",
  "web.search",
  "web.fetch",
  "context.distill",
  "context.ask_user",
];

describe("built-in tool contracts", () => {
  it("declares the first-party planning tool surface", () => {
    expect(BUILT_IN_TOOL_NAMES).toEqual(EXPECTED_TOOL_NAMES);
    expect(BUILT_IN_TOOL_CONTRACTS).toHaveLength(EXPECTED_TOOL_NAMES.length);
  });

  it("keeps every contract structurally valid", () => {
    expect(validateToolContracts(BUILT_IN_TOOL_CONTRACTS)).toEqual({ ok: true, errors: [] });
    expect(() => assertValidToolContracts(BUILT_IN_TOOL_CONTRACTS)).not.toThrow();
  });

  it("detects duplicate tool names", () => {
    const duplicate = [
      getBuiltInToolContract("local.read"),
      getBuiltInToolContract("local.read"),
    ] satisfies readonly AimcubToolContract[];

    expect(validateToolContracts(duplicate)).toEqual({
      ok: false,
      errors: ["duplicate tool name: local.read"],
    });
  });

  it("marks web tools as optional provider-backed network tools", () => {
    const search = getBuiltInToolContract("web.search");
    const fetch = getBuiltInToolContract("web.fetch");

    expect(search.availability).toBe("requires_network_provider");
    expect(fetch.availability).toBe("requires_network_provider");
    expect(search.permission.kind).toBe("network.search");
    expect(fetch.permission.kind).toBe("network.fetch");
    expect(search.errors).toContain("disabled");
    expect(fetch.errors).toContain("disabled");
  });

  it("keeps local write/edit behind explicit user approval", () => {
    expect(getBuiltInToolContract("local.write").permission.requiresUserApproval).toBe(true);
    expect(getBuiltInToolContract("local.edit").permission.requiresUserApproval).toBe(true);
    expect(getBuiltInToolContract("local.read").permission.requiresUserApproval).toBe(false);
  });

  it("recognizes built-in names without exposing MCP as the substrate", () => {
    expect(isBuiltInToolName("memory.search")).toBe(true);
    expect(isBuiltInToolName("web.search")).toBe(true);
    expect(isBuiltInToolName("mcp.search")).toBe(false);
  });
});
