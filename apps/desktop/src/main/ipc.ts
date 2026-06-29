/**
 * Registers the IPC handlers the renderer calls through the preload bridge.
 * Goal persistence is delegated to the shared `@core/store` (so the CLI sees the same
 * aims). Clarifying answers are folded into `user_stated` memories — the first concrete
 * writes toward the memory pillar.
 */
import { ipcMain } from "electron";

import type { Goal } from "@core/types";
import type { NewMemory } from "@core/store";

import {
  IPC,
  type ClarifyRequest,
  type DraftRequest,
  type ProviderConfig,
  type ProviderStatus,
  type RefineRequest,
  type SaveRequest,
  type SavedGoal,
} from "../shared/ipc";
import { runClarify, runDraft, runRefine } from "./planner";
import { aimStore } from "./store";
import { buildGateway, getProviderStatus, setProviderConfig } from "./gateway";

export function registerIpc(): void {
  ipcMain.handle(IPC.draft, (_e, req: DraftRequest) => runDraft(buildGateway(), req.title, req.description));

  ipcMain.handle(IPC.clarify, (_e, req: ClarifyRequest) =>
    runClarify(buildGateway(), req.title, req.description, req.draft),
  );

  ipcMain.handle(IPC.refine, (_e, req: RefineRequest) =>
    runRefine(buildGateway(), req.title, req.description, req.draft, req.questions, req.answers),
  );

  ipcMain.handle(IPC.listGoals, (): Promise<Goal[]> => aimStore.listGoals());

  ipcMain.handle(IPC.deleteGoal, (_e, id: string): Promise<void> => aimStore.deleteGoal(id));

  ipcMain.handle(IPC.getProviderConfig, async (): Promise<ProviderStatus> => getProviderStatus());

  ipcMain.handle(IPC.setProviderConfig, async (_e, config: ProviderConfig): Promise<ProviderStatus> =>
    setProviderConfig(config),
  );

  ipcMain.handle(IPC.saveGoal, async (_e, req: SaveRequest): Promise<SavedGoal> => {
    // Fold the user's clarifying answers into memory contents (question text → answer).
    const questionById = new Map(req.questions.map((q) => [q.id, q]));
    const memories: NewMemory[] = req.answers
      .map((a) => ({ a, text: a.other_text?.trim() || a.selected_label?.trim() || "" }))
      .filter((x) => x.text.length > 0)
      .map(({ a, text }) => {
        const label = questionById.get(a.question_id)?.question ?? a.question_id;
        return { content: `${label} → ${text}`, source: "user_stated" };
      });

    return aimStore.createGoal({
      title: req.title,
      description: req.description,
      plan: req.plan,
      memories,
    });
  });
}
