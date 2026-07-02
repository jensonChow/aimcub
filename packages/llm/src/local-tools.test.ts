import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { createLocalReadOnlyToolHandlers } from "./local-tools";
import type { AimcubToolHandlerContext } from "./tool-contract";

async function createWorkspace(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "aimcub-local-tools-"));
  await mkdir(path.join(root, "src"), { recursive: true });
  await mkdir(path.join(root, "node_modules", "ignored"), { recursive: true });
  await writeFile(path.join(root, "package.json"), JSON.stringify({ name: "demo", private: true }, null, 2));
  await writeFile(path.join(root, "src", "plan.ts"), "export const aim = 'Build local context tools';\n");
  await writeFile(path.join(root, ".env"), "SECRET=do-not-read\n");
  await writeFile(path.join(root, "node_modules", "ignored", "package.json"), "{}\n");
  return root;
}

function context(root: string, permissions: AimcubToolHandlerContext["permissions"]): AimcubToolHandlerContext {
  return {
    workspaceRoot: root,
    now: () => new Date("2026-07-02T00:00:00.000Z"),
    permissions,
  };
}

describe("local read-only tool handlers", () => {
  it("scans a workspace without leaking ignored or sensitive paths", async () => {
    const root = await createWorkspace();
    const handlers = createLocalReadOnlyToolHandlers({ workspaceRoot: root });

    const result = await handlers["local.scan_workspace"]!({ root, maxDepth: 4 }, context(root, ["filesystem.read"]));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.observation.data.likelyProjectTypes).toContain("node");
    expect(result.observation.data.manifests).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: path.join(root, "package.json"), kind: "node-package" }),
    ]));
    expect(result.observation.data.manifests).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ path: expect.stringContaining("node_modules") }),
    ]));
    expect(result.observation.data.sensitivePathsExcluded).toContain(".env");
  });

  it("reads and searches text files inside the workspace", async () => {
    const root = await createWorkspace();
    const handlers = createLocalReadOnlyToolHandlers({ workspaceRoot: root });
    const toolContext = context(root, ["filesystem.read", "filesystem.search"]);

    const read = await handlers["local.read"]!({ path: "src/plan.ts" }, toolContext);
    expect(read.ok).toBe(true);
    if (!read.ok) throw new Error(read.error.message);
    expect(read.observation.data.lines[0]).toEqual({ line: 1, text: "export const aim = 'Build local context tools';" });

    const search = await handlers["local.search"]!({ query: "local context", glob: "**/*.ts" }, toolContext);
    expect(search.ok).toBe(true);
    if (!search.ok) throw new Error(search.error.message);
    expect(search.observation.data.matches).toEqual([
      expect.objectContaining({ path: path.join(root, "src", "plan.ts"), line: 1 }),
    ]);
  });

  it("matches glob patterns and enforces workspace boundaries", async () => {
    const root = await createWorkspace();
    const handlers = createLocalReadOnlyToolHandlers({ workspaceRoot: root });
    const toolContext = context(root, ["filesystem.read", "filesystem.search"]);

    const glob = await handlers["local.glob"]!({ pattern: "*.json" }, toolContext);
    expect(glob.ok).toBe(true);
    if (!glob.ok) throw new Error(glob.error.message);
    expect(glob.observation.data.paths).toEqual([path.join(root, "package.json")]);

    const outside = await handlers["local.read"]!({ path: "../outside.txt" }, toolContext);
    expect(outside).toEqual({
      ok: false,
      error: {
        code: "outside_workspace",
        message: "local.read can only read files inside the configured workspace.",
        retryable: false,
        details: undefined,
      },
    });
  });

  it("requires explicit filesystem permissions", async () => {
    const root = await createWorkspace();
    const handlers = createLocalReadOnlyToolHandlers({ workspaceRoot: root });

    const result = await handlers["local.scan_workspace"]!({ root }, context(root, []));

    expect(result).toEqual({
      ok: false,
      error: {
        code: "permission_denied",
        message: "local.scan_workspace requires the filesystem.read permission.",
        retryable: false,
        details: undefined,
      },
    });
  });
});
