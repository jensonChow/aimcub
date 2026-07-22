/**
 * Durability + concurrency contract for the JSON store.
 *
 * These are the properties that make one `~/.aimcub` safe for Desktop AND the CLI at the same
 * time: whole-file writes land atomically, a corrupt file is quarantined and recovered instead
 * of silently presenting as empty, and every mutation serializes behind a cross-process lock.
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { DecompositionOutput } from "@aimcub/types";

import {
  backupPathFor,
  createJsonFileStore,
  saveSettings,
  settingsPath,
  storeLockPath,
  type LocalStore,
  type StoreLockPayload,
} from "./index";

const PLAN = DecompositionOutput.parse({
  goal_summary: "Keep the local store honest",
  nodes: [
    {
      key: "m1",
      title: "Harden the store",
      acceptance_rule: { clauses: [{ evaluator: "manual_confirm" }] },
    },
  ],
});

const freshDir = (): string => mkdtempSync(join(tmpdir(), "aimcub-durability-"));
const storeFile = (dir: string): string => join(dir, "store.json");
const readStoreFile = (dir: string): LocalStore => JSON.parse(readFileSync(storeFile(dir), "utf8")) as LocalStore;

/** Silence the (intentional) corruption warnings while still asserting they happened. */
function spyOnWarn() {
  return vi.spyOn(console, "warn").mockImplementation(() => {});
}

afterEach(() => {
  vi.restoreAllMocks();
});

/** A pid that is guaranteed dead: a child process we already reaped. */
function deadPid(): number {
  const done = spawnSync(process.execPath, ["-e", "process.exit(0)"]);
  if (typeof done.pid !== "number") throw new Error("could not spawn a probe process");
  return done.pid;
}

function writeLockFile(dir: string, payload: StoreLockPayload): string {
  const path = storeLockPath(dir);
  writeFileSync(path, JSON.stringify(payload), "utf8");
  return path;
}

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

describe("store durability · atomic writes", () => {
  it("leaves no temp or lock debris behind, and mirrors every committed save into .bak", async () => {
    const dir = freshDir();
    const store = createJsonFileStore(dir);

    await store.addMemory({ content: "First fact worth keeping." });
    expect(readFileSync(backupPathFor(storeFile(dir)), "utf8")).toBe(readFileSync(storeFile(dir), "utf8"));

    await store.addMemory({ content: "Second fact worth keeping." });

    // The backup tracks the LAST COMMITTED state, so recovery never costs the user an operation.
    const backup = JSON.parse(readFileSync(backupPathFor(storeFile(dir)), "utf8")) as LocalStore;
    expect(backup.memories.map((m) => m.content)).toEqual([
      "First fact worth keeping.",
      "Second fact worth keeping.",
    ]);
    expect(readStoreFile(dir).memories).toHaveLength(2);

    await store.addActor({ kind: "human", displayName: "Jenson" });
    await store.createAimShell({ title: "Shell aim" });

    const entries = readdirSync(dir);
    expect(entries.filter((name) => name.endsWith(".tmp"))).toEqual([]);
    expect(entries).not.toContain("store.lock");
    expect(entries.sort()).toEqual(["store.json", "store.json.bak"]);
  });

  it("writes settings files atomically and keeps them owner-only", () => {
    const dir = freshDir();
    saveSettings({ provider: "anthropic", apiKey: "sk-test" }, dir);
    saveSettings({ provider: "anthropic", apiKey: "sk-rotated" }, dir);

    expect(statSync(settingsPath(dir)).mode & 0o777).toBe(0o600);
    expect(JSON.parse(readFileSync(settingsPath(dir), "utf8"))).toMatchObject({ apiKey: "sk-rotated" });
    expect(readdirSync(dir).filter((name) => name.endsWith(".tmp"))).toEqual([]);
  });
});

describe("store durability · corruption safety", () => {
  it("quarantines a corrupt store, recovers from the backup, and reports what happened", async () => {
    const dir = freshDir();
    const seed = createJsonFileStore(dir);
    await seed.addMemory({ content: "Recoverable fact." });
    await seed.addActor({ kind: "human", displayName: "Jenson" });
    const beforeCorruption = readStoreFile(dir);

    writeFileSync(storeFile(dir), '{"goals": [ this is not json', "utf8");

    const warn = spyOnWarn();
    const store = createJsonFileStore(dir);
    const memories = await store.listMemories();

    expect(memories.map((m) => m.content)).toEqual(["Recoverable fact."]);
    expect(warn).toHaveBeenCalled();
    // Nothing committed before the corruption is lost — not even the last operation.
    expect(await store.listActors()).toHaveLength(1);

    const diagnostics = await store.getDiagnostics();
    expect(diagnostics.map((d) => d.kind)).toEqual(["corrupt_quarantined", "recovered_from_backup"]);

    // The corrupt bytes are kept for forensics, not thrown away.
    const quarantined = readdirSync(dir).filter((name) => name.includes(".corrupt-"));
    expect(quarantined).toHaveLength(1);
    expect(readFileSync(join(dir, quarantined[0]!), "utf8")).toContain("this is not json");

    // The live file is whole again, so a lock-free reader sees the recovered rows too.
    expect(readStoreFile(dir).memories).toEqual(beforeCorruption.memories);
    expect(await createJsonFileStore(dir).listActors()).toHaveLength(1);
  });

  it("recovers a store truncated by a crash mid-write", async () => {
    const dir = freshDir();
    const seed = createJsonFileStore(dir);
    await seed.addMemory({ content: "Survives a truncation." });
    await seed.addMemory({ content: "Second fact." });

    writeFileSync(storeFile(dir), "", "utf8"); // what a killed process used to leave behind

    spyOnWarn();
    const store = createJsonFileStore(dir);
    expect((await store.listMemories()).map((m) => m.content).sort()).toEqual([
      "Second fact.",
      "Survives a truncation.",
    ]);
    expect((await store.getDiagnostics()).map((d) => d.kind)).toContain("recovered_from_backup");
  });

  it("treats parseable-but-wrong-shape content as corruption instead of an empty store", async () => {
    const dir = freshDir();
    const seed = createJsonFileStore(dir);
    await seed.addMemory({ content: "Still here." });
    await seed.addMemory({ content: "And here." });

    writeFileSync(storeFile(dir), JSON.stringify({ goals: "not-an-array" }), "utf8");

    spyOnWarn();
    const store = createJsonFileStore(dir);
    expect(await store.listMemories()).toHaveLength(2);
    expect((await store.getDiagnostics()).map((d) => d.kind)).toEqual(["corrupt_quarantined", "recovered_from_backup"]);
  });

  it("with no backup: empty store plus diagnostics, never silence", async () => {
    const dir = freshDir();
    writeFileSync(storeFile(dir), "{ half a file", "utf8");

    const warn = spyOnWarn();
    const store = createJsonFileStore(dir);

    expect(await store.listGoals()).toEqual([]);
    expect((await store.getDiagnostics()).map((d) => d.kind)).toEqual(["corrupt_quarantined", "no_backup"]);
    expect(warn).toHaveBeenCalledTimes(2);
    expect(readdirSync(dir).filter((name) => name.includes(".corrupt-"))).toHaveLength(1);
  });

  it("stays silent on a first run with no store file", async () => {
    const dir = freshDir();
    const warn = spyOnWarn();
    const store = createJsonFileStore(dir);

    expect(await store.listGoals()).toEqual([]);
    expect(await store.getDiagnostics()).toEqual([]);
    expect(warn).not.toHaveBeenCalled();
  });

  it("round-trips mutations after a recovery", async () => {
    const dir = freshDir();
    const seed = createJsonFileStore(dir);
    await seed.addMemory({ content: "Before the corruption." });
    await seed.addMemory({ content: "Also before." });
    writeFileSync(storeFile(dir), "not json at all", "utf8");

    spyOnWarn();
    const store = createJsonFileStore(dir);
    await store.addMemory({ content: "After the recovery." });

    const reopened = createJsonFileStore(dir);
    expect((await reopened.listMemories()).map((m) => m.content).sort()).toEqual([
      "After the recovery.",
      "Also before.",
      "Before the corruption.",
    ]);
    expect(await reopened.getDiagnostics()).toEqual([]);
  });

  it("keeps importData(replace) on the safe path", async () => {
    const dir = freshDir();
    const seed = createJsonFileStore(dir);
    await seed.addMemory({ content: "Replaced away." });
    const snapshot = await seed.exportData();
    snapshot.memories = [];

    const imported = await createJsonFileStore(dir).importData(snapshot, "replace");

    expect(imported.memories).toBe(0);
    expect(readStoreFile(dir).memories).toEqual([]);
    // The replace landed through the same atomic write + backup mirror as every other save.
    expect(readFileSync(backupPathFor(storeFile(dir)), "utf8")).toBe(readFileSync(storeFile(dir), "utf8"));
    expect(readdirSync(dir).filter((name) => name.endsWith(".tmp"))).toEqual([]);
  });
});

describe("store durability · cross-process lock", () => {
  it("fails with a descriptive error naming the holder when the lock is held", async () => {
    const dir = freshDir();
    const lockPath = writeLockFile(dir, {
      pid: process.pid, // alive, so it can never be reclaimed as stale
      acquiredAt: new Date().toISOString(),
      token: "held-by-someone-else",
    });
    const store = createJsonFileStore(dir, { lock: { timeoutMs: 60, retryMs: 5 } });

    await expect(store.addMemory({ content: "Blocked." })).rejects.toThrow(
      new RegExp(`held by pid ${process.pid}`),
    );
    // A lock we do not own is never stolen.
    expect(existsSync(lockPath)).toBe(true);
  });

  it("holds the lock for every mutating operation, while reads stay lock-free", async () => {
    const dir = freshDir();
    writeLockFile(dir, { pid: process.pid, acquiredAt: new Date().toISOString(), token: "holder" });
    const store = createJsonFileStore(dir, { lock: { timeoutMs: 30, retryMs: 5 } });

    const mutations: Array<[string, () => Promise<unknown>]> = [
      ["addMemory", () => store.addMemory({ content: "x" })],
      ["addActor", () => store.addActor({ kind: "human", displayName: "Jenson" })],
      ["upsertAimDraft", () => store.upsertAimDraft({ title: "draft" })],
      ["createAimShell", () => store.createAimShell({ title: "shell" })],
      ["createGoal", () => store.createGoal({ title: "aim", plan: PLAN })],
      ["deleteGoal", () => store.deleteGoal("missing")],
      ["importData", () => store.importData({ memories: [] } as unknown as LocalStore, "replace")],
    ];
    for (const [name, run] of mutations) {
      await expect(run(), `${name} must wait for the lock`).rejects.toThrow(/Timed out .* waiting for the Aimcub store lock/);
    }

    // Readers never wait on a writer: atomic renames already guarantee a whole file.
    expect(await store.listGoals()).toEqual([]);
    expect(await store.listMemories()).toEqual([]);
  });

  it("releases the lock when a mutation throws", async () => {
    const dir = freshDir();
    const store = createJsonFileStore(dir, { lock: { timeoutMs: 200, retryMs: 5 } });

    await expect(store.addEvidence({ goalId: "missing", kind: "note" })).rejects.toThrow(/not found/);

    expect(existsSync(storeLockPath(dir))).toBe(false);
    // A leaked lock would wedge the next write until the stale window expires.
    await expect(store.addMemory({ content: "The store is still writable." })).resolves.toBeTruthy();
  });

  it("reclaims a lock whose holder process is gone", async () => {
    const dir = freshDir();
    const lockPath = writeLockFile(dir, {
      pid: deadPid(),
      acquiredAt: new Date().toISOString(), // fresh: only the dead pid can justify reclaiming
      token: "abandoned-by-a-crash",
    });
    spyOnWarn();
    const store = createJsonFileStore(dir, { lock: { timeoutMs: 500, retryMs: 5 } });

    const memory = await store.addMemory({ content: "Written after reclaiming a crashed lock." });

    expect(memory.content).toBe("Written after reclaiming a crashed lock.");
    expect(existsSync(lockPath)).toBe(false);
  });

  it("reclaims a lock that outlived the stale window even if the pid is alive", async () => {
    const dir = freshDir();
    writeLockFile(dir, {
      pid: process.pid,
      acquiredAt: new Date(Date.now() - 10 * 60_000).toISOString(),
      token: "forgotten",
    });
    spyOnWarn();
    const store = createJsonFileStore(dir, { lock: { timeoutMs: 500, retryMs: 5, staleMs: 30_000 } });

    await store.addMemory({ content: "Written after a stale lock aged out." });

    expect(await store.listMemories()).toHaveLength(1);
    expect(existsSync(storeLockPath(dir))).toBe(false);
  });

  it("blocks a second writer until the holding process releases", async () => {
    const dir = freshDir();
    const lockPath = storeLockPath(dir);
    const holdMs = 400;
    // A real second process (this is the Desktop-vs-CLI case) takes and then releases the lock.
    const holder = spawn(process.execPath, [
      "-e",
      `const fs = require("node:fs");
       const path = ${JSON.stringify(lockPath)};
       fs.mkdirSync(${JSON.stringify(dir)}, { recursive: true });
       fs.writeFileSync(path, JSON.stringify({ pid: process.pid, acquiredAt: new Date().toISOString(), token: "child" }), { flag: "wx" });
       setTimeout(() => fs.unlinkSync(path), ${holdMs});`,
    ], { stdio: "ignore" });

    try {
      const appeared = Date.now();
      while (!existsSync(lockPath)) {
        if (Date.now() - appeared > 5_000) throw new Error("the holder process never took the lock");
        await delay(5);
      }

      const store = createJsonFileStore(dir, { lock: { timeoutMs: 10_000, retryMs: 10 } });
      const startedAt = Date.now();
      await store.addMemory({ content: "Written once the other process let go." });
      const waited = Date.now() - startedAt;

      expect(waited).toBeGreaterThanOrEqual(150);
      expect(await store.listMemories()).toHaveLength(1);
      expect(existsSync(lockPath)).toBe(false);
    } finally {
      holder.kill();
    }
  }, 20_000);
});

describe("store durability · concurrent instances", () => {
  it("keeps every write when two independent stores over one data dir interleave", async () => {
    const dir = freshDir();
    const a = createJsonFileStore(dir);
    const b = createJsonFileStore(dir);

    const { goal, milestones } = await a.createGoal({ title: "Shared aim", plan: PLAN });
    const milestoneId = milestones[0]!.id;

    for (let i = 0; i < 5; i += 1) {
      await a.addEvidence({ goalId: goal.id, kind: "note", summary: `evidence ${i}` });
      await b.createRun({ goalId: goal.id, milestoneId, actorKind: "agent" });
      await a.addMemory({ content: `fact from A ${i}` });
      await b.addActor({ kind: "human", displayName: `human ${i}` });
    }

    const final = readStoreFile(dir);
    expect(final.evidence).toHaveLength(5);
    expect(final.runs).toHaveLength(5);
    expect(final.memories).toHaveLength(5);
    expect(final.actors).toHaveLength(5);

    // Both faces of the store agree, and neither reported an incident.
    expect(await a.exportData()).toEqual(await b.exportData());
    expect(await a.getDiagnostics()).toEqual([]);
    expect(await b.getDiagnostics()).toEqual([]);
  });
});
