/**
 * The IPC contract shared by main (handlers), preload (bridge), and renderer (types).
 * Renderer imports these as `import type` only, so this module is erased from the
 * renderer bundle — only main/preload pull in the channel constants at runtime.
 */
import type { DecompositionOutput, Goal, Milestone } from "@core/types";
import type { ClarifyOutput, ClarifyQuestion, ClarifyAnswer } from "@core/llm";

export interface DraftRequest {
  title: string;
  description?: string;
}

export interface ClarifyRequest {
  title: string;
  description?: string;
  draft: DecompositionOutput;
}

export interface RefineRequest {
  title: string;
  description?: string;
  draft: DecompositionOutput;
  questions: ClarifyQuestion[];
  answers: ClarifyAnswer[];
}

export interface SaveRequest {
  title: string;
  description?: string;
  plan: DecompositionOutput;
  questions: ClarifyQuestion[];
  answers: ClarifyAnswer[];
}

/** A decomposition result over IPC: `usedFallback` ⇒ produced offline / on LLM failure. */
export interface PlanResult {
  ok: boolean;
  output: DecompositionOutput | null;
  errors: string[];
  usedFallback: boolean;
}

export interface ClarifyIpcResult {
  ok: boolean;
  output: ClarifyOutput | null;
  errors: string[];
  usedFallback: boolean;
}

export interface SavedGoal {
  goal: Goal;
  milestones: Milestone[];
}

export interface KeyStatus {
  hasKey: boolean;
}

/** The typed surface exposed on `window.aimcub` by the preload bridge. */
export interface AimcubApi {
  draft(req: DraftRequest): Promise<PlanResult>;
  clarify(req: ClarifyRequest): Promise<ClarifyIpcResult>;
  refine(req: RefineRequest): Promise<PlanResult>;
  saveGoal(req: SaveRequest): Promise<SavedGoal>;
  listGoals(): Promise<Goal[]>;
  getKeyStatus(): Promise<KeyStatus>;
  setKey(key: string): Promise<KeyStatus>;
}

/** Channel names — kept in one place so main and preload can't drift. */
export const IPC = {
  draft: "aimcub:draft",
  clarify: "aimcub:clarify",
  refine: "aimcub:refine",
  saveGoal: "aimcub:saveGoal",
  listGoals: "aimcub:listGoals",
  getKeyStatus: "aimcub:getKeyStatus",
  setKey: "aimcub:setKey",
} as const;

declare global {
  interface Window {
    aimcub: AimcubApi;
  }
}
