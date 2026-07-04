import { describe, expect, it } from "vitest";

import { createContextLinkedSourcesHandler } from "./context-linked-sources";
import type { AimcubToolHandlerContext } from "./tool-contract";

const context: AimcubToolHandlerContext = {
  now: () => new Date("2026-07-02T00:00:00.000Z"),
  permissions: ["context.source"],
};

describe("createContextLinkedSourcesHandler", () => {
  it("summarizes local and connector-backed context sources without pretending connector content was read", async () => {
    const handler = createContextLinkedSourcesHandler();

    const result = await handler({
      sources: [
        {
          id: "workspace",
          kind: "local_folder",
          label: "Project workspace",
          enabled: true,
          status: "available",
          path: "/workspace/aimcub",
        },
        {
          id: "prd",
          kind: "local_file",
          label: "PRD",
          enabled: true,
          status: "available",
          path: "/workspace/aimcub/docs/prd.md",
        },
        {
          id: "notion",
          kind: "notion",
          label: "Product wiki",
          enabled: true,
          status: "needs_connector",
          uri: "notion://workspace/product-wiki",
        },
      ],
    }, context);

    expect(result).toMatchObject({
      ok: true,
      observation: {
        data: {
          availableCount: 2,
          blockedCount: 1,
          localFileCount: 1,
          localFolderCount: 1,
          onlineCount: 1,
        },
      },
    });
    expect(result.ok ? result.observation.summary : "").toContain("3 linked context sources");
    expect(result.ok ? result.observation.sources.map((source) => source.kind) : []).toEqual([
      "workspace",
      "file",
      "connector",
    ]);
    expect(result.ok ? result.observation.warnings?.join("\n") : "").toContain("connector-backed sources");
    expect(result.ok ? result.observation.warnings?.join("\n") : "").toContain("Notion or database");
  });

  it("requires context.source permission", async () => {
    const handler = createContextLinkedSourcesHandler();

    const result = await handler({
      sources: [{
        id: "workspace",
        kind: "local_folder",
        label: "Workspace",
        enabled: true,
        status: "available",
        path: "/workspace",
      }],
    }, { ...context, permissions: [] });

    expect(result).toMatchObject({
      ok: false,
      error: { code: "permission_denied", retryable: false },
    });
  });
});
