import type { AimProgressReadModel } from "@aimcub/core";

import type { CockpitStage } from "./CockpitShell";

export function hasCompletionRecap(progress: AimProgressReadModel | null): boolean {
  return progress?.completion_recap?.complete === true;
}

export function stageForOpenedAim(progress: AimProgressReadModel | null): CockpitStage {
  return hasCompletionRecap(progress) ? "eval" : "aim";
}
