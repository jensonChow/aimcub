import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { beforeEach, describe, expect, it } from "vitest";

import {
  DEFAULT_DESKTOP_PREFERENCES,
  desktopPreferencesPath,
  loadDesktopPreferences,
  normalizeDesktopPreferences,
  resetDesktopPreferencesCache,
  saveDesktopPreferences,
} from "./app-settings";

function dataDir(): string {
  return mkdtempSync(join(tmpdir(), "aimcub-desktop-prefs-"));
}

beforeEach(() => {
  resetDesktopPreferencesCache();
});

describe("desktop preferences", () => {
  it("defaults developer mode off, which is the product state", () => {
    expect(DEFAULT_DESKTOP_PREFERENCES).toEqual({ developerMode: false, planningModel: null });
    expect(loadDesktopPreferences(dataDir())).toEqual({ developerMode: false, planningModel: null });
  });

  it("round-trips through its own file beside the store", () => {
    const dir = dataDir();
    expect(saveDesktopPreferences({ developerMode: true, planningModel: { agentId: "codex", model: "gpt-5.5" } }, dir))
      .toEqual({ developerMode: true, planningModel: { agentId: "codex", model: "gpt-5.5" } });
    expect(desktopPreferencesPath(dir)).toBe(join(dir, "desktop-settings.json"));

    resetDesktopPreferencesCache();
    expect(loadDesktopPreferences(dir)).toEqual({ developerMode: true, planningModel: { agentId: "codex", model: "gpt-5.5" } });
    expect(JSON.parse(readFileSync(desktopPreferencesPath(dir), "utf8")))
      .toEqual({ developerMode: true, planningModel: { agentId: "codex", model: "gpt-5.5" } });
  });

  it("degrades a corrupt or partial file to the defaults instead of failing to launch", () => {
    const dir = dataDir();
    writeFileSync(desktopPreferencesPath(dir), "{ not json");
    expect(loadDesktopPreferences(dir)).toEqual({ developerMode: false, planningModel: null });

    resetDesktopPreferencesCache();
    writeFileSync(desktopPreferencesPath(dir), JSON.stringify({ developerMode: "yes please" }));
    expect(loadDesktopPreferences(dir)).toEqual({ developerMode: false, planningModel: null });
  });

  it("only ever reads a strict boolean, so no truthy value can turn it on by accident", () => {
    expect(normalizeDesktopPreferences({ developerMode: 1 })).toEqual({ developerMode: false, planningModel: null });
    expect(normalizeDesktopPreferences({ developerMode: "true" })).toEqual({ developerMode: false, planningModel: null });
    expect(normalizeDesktopPreferences({ developerMode: true })).toEqual({ developerMode: true, planningModel: null });
    expect(normalizeDesktopPreferences(null)).toEqual({ developerMode: false, planningModel: null });
  });

  it("normalizes the planning-model pick and degrades junk to Auto", () => {
    expect(normalizeDesktopPreferences({ planningModel: { agentId: "codex", model: "gpt-5.6-sol" } }))
      .toEqual({ developerMode: false, planningModel: { agentId: "codex", model: "gpt-5.6-sol" } });
    expect(normalizeDesktopPreferences({ planningModel: { agentId: " codex ", model: " gpt-5.5 " } }).planningModel)
      .toEqual({ agentId: "codex", model: "gpt-5.5" });
    expect(normalizeDesktopPreferences({ planningModel: { agentId: "", model: "x" } }).planningModel).toBeNull();
    expect(normalizeDesktopPreferences({ planningModel: { agentId: "codex" } }).planningModel).toBeNull();
    expect(normalizeDesktopPreferences({ planningModel: "gpt-5.5" }).planningModel).toBeNull();
    expect(normalizeDesktopPreferences({ planningModel: null }).planningModel).toBeNull();
  });

  it("is reachable over typed IPC through the preload bridge", () => {
    const shared = readFileSync(new URL("../shared/ipc.ts", import.meta.url), "utf8");
    const main = readFileSync(new URL("./ipc.ts", import.meta.url), "utf8");
    const preload = readFileSync(new URL("../preload/index.ts", import.meta.url), "utf8");

    for (const channel of ["getDesktopPreferences", "setDesktopPreferences", "getStoreDiagnostics", "pickRunWorkspace"]) {
      expect(shared, `${channel} channel`).toContain(`${channel}: "aimcub:${channel}"`);
      expect(main, `${channel} handler`).toContain(`ipcMain.handle(IPC.${channel}`);
      expect(preload, `${channel} bridge`).toContain(`ipcRenderer.invoke(IPC.${channel}`);
    }
  });
});
