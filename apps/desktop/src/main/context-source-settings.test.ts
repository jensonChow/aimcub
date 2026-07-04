import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  dialog: {
    showOpenDialog: vi.fn(async () => ({ canceled: true, filePaths: [] })),
  },
}));

import {
  getContextSourceConfig,
  loadContextSourceConfig,
  resolveContextSourceConfig,
  setContextSourceConfig,
} from "./context-source-settings";

const ORIGINAL_ENV = { ...process.env };

function freshHome(): string {
  return mkdtempSync(join(tmpdir(), "aimcub-desktop-context-sources-"));
}

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  loadContextSourceConfig();
});

describe("desktop context source settings", () => {
  it("saves and resolves local files, online sources, research, session, and questionnaire controls", () => {
    process.env = { ...ORIGINAL_ENV, AIMCUB_HOME: freshHome() };
    loadContextSourceConfig();

    const status = setContextSourceConfig({
      version: 1,
      local: {
        enabled: true,
        workspaceRoot: "/workspace/aimcub",
        filePaths: ["/workspace/aimcub/docs/prd.md"],
      },
      online: {
        enabled: true,
        sources: [{
          id: "notion-1",
          provider: "notion",
          label: "Product wiki",
          reference: "notion://workspace/product",
          enabled: true,
        }],
      },
      research: { webEnabled: true, deepResearch: true },
      userSession: { enabled: true },
      questionnaire: { enabled: true },
    });

    expect(status.local).toMatchObject({
      configured: true,
      source: "settings",
      resolvedWorkspaceRoot: "/workspace/aimcub",
      resolvedFilePaths: ["/workspace/aimcub/docs/prd.md"],
    });
    expect(status.online).toMatchObject({
      configuredCount: 1,
      enabledCount: 1,
    });
    expect(resolveContextSourceConfig()).toEqual(status);
    expect(getContextSourceConfig()).toEqual(status);
  });

  it("lets environment local sources override saved local sources", () => {
    process.env = {
      ...ORIGINAL_ENV,
      AIMCUB_HOME: freshHome(),
      AIMCUB_LOCAL_CONTEXT_ROOT: "/env/workspace",
      AIMCUB_LOCAL_CONTEXT_FILES: "/env/workspace/a.md,/env/workspace/b.md",
    };
    loadContextSourceConfig();
    setContextSourceConfig({
      version: 1,
      local: {
        enabled: true,
        workspaceRoot: "/settings/workspace",
        filePaths: ["/settings/workspace/prd.md"],
      },
      online: { enabled: false, sources: [] },
      research: { webEnabled: true, deepResearch: false },
      userSession: { enabled: true },
      questionnaire: { enabled: true },
    });

    expect(resolveContextSourceConfig().local).toMatchObject({
      configured: true,
      source: "env",
      resolvedWorkspaceRoot: "/env/workspace",
      resolvedFilePaths: ["/env/workspace/a.md", "/env/workspace/b.md"],
    });
  });

  it("lets AIMCUB_ENABLE_WEB_RESEARCH override the context source web toggle", () => {
    process.env = { ...ORIGINAL_ENV, AIMCUB_HOME: freshHome(), AIMCUB_ENABLE_WEB_RESEARCH: "false" };
    loadContextSourceConfig();
    setContextSourceConfig({
      version: 1,
      local: { enabled: false, filePaths: [] },
      online: { enabled: false, sources: [] },
      research: { webEnabled: true, deepResearch: true },
      userSession: { enabled: true },
      questionnaire: { enabled: true },
    });

    expect(resolveContextSourceConfig().research.webEnabled).toBe(false);
  });
});
