/**
 * Registers the IPC handlers the renderer calls through the preload bridge.
 * Save records the goal + materialized milestones, and the clarifying answers as
 * `user_stated` memories — the first concrete writes toward the memory pillar.
 */
import { ipcMain } from "electron";
import { randomUUID } from "node:crypto";

import type { Goal, Memory } from "@core/types";

import {
  IPC,
  type ClarifyRequest,
  type DraftRequest,
  type KeyStatus,
  type RefineRequest,
  type SaveRequest,
  type SavedGoal,
} from "../shared/ipc";
import { runClarify, runDraft, runRefine } from "./planner";
import { materialize } from "./materialize";
import { LOCAL_OWNER, loadStore, saveStore, saveStoredKey } from "./store";
import { hasApiKey, setApiKey } from "./gateway";

export function registerIpc(): void {
  ipcMain.handle(IPC.draft, (_e, req: DraftRequest) => runDraft(req.title, req.description));

  ipcMain.handle(IPC.clarify, (_e, req: ClarifyRequest) => runClarify(req.title, req.description, req.draft));

  ipcMain.handle(IPC.refine, (_e, req: RefineRequest) =>
    runRefine(req.title, req.description, req.draft, req.questions, req.answers),
  );

  ipcMain.handle(IPC.listGoals, async (): Promise<Goal[]> =>
    loadStore().goals.slice().sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? "")),
  );

  ipcMain.handle(IPC.getKeyStatus, async (): Promise<KeyStatus> => ({ hasKey: hasApiKey() }));

  ipcMain.handle(IPC.setKey, async (_e, key: string): Promise<KeyStatus> => {
    const trimmed = typeof key === "string" ? key.trim() : "";
    if (trimmed) {
      setApiKey(trimmed);
      saveStoredKey(trimmed);
    }
    return { hasKey: hasApiKey() };
  });

  ipcMain.handle(IPC.saveGoal, async (_e, req: SaveRequest): Promise<SavedGoal> => {
    const store = loadStore();
    const now = new Date().toISOString();
    const goalId = randomUUID();

    const goal: Goal = {
      id: goalId,
      owner_id: LOCAL_OWNER,
      title: req.title,
      description: req.description ?? "",
      domain: "software",
      status: "active",
      target_date: null,
      plan_json: req.plan,
      metadata: {},
      created_at: now,
    };

    const milestones = materialize(req.plan, goalId, LOCAL_OWNER);

    const questionById = new Map(req.questions.map((q) => [q.id, q]));
    const memories: Memory[] = req.answers
      .map((a) => ({ answer: a, text: a.other_text?.trim() || a.selected_label?.trim() || "" }))
      .filter((x) => x.text.length > 0)
      .map(({ answer, text }) => {
        const label = questionById.get(answer.question_id)?.question ?? answer.question_id;
        return {
          id: randomUUID(),
          owner_id: LOCAL_OWNER,
          goal_id: goalId,
          kind: "semantic",
          content: `${label} → ${text}`,
          confidence: 1,
          source: "user_stated",
          status: "active",
          superseded_by: null,
          created_at: now,
        } satisfies Memory;
      });

    store.goals.push(goal);
    store.milestonesByGoal[goalId] = milestones;
    store.memories.push(...memories);
    saveStore(store);

    return { goal, milestones };
  });
}
