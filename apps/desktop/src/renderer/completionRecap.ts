import type { AimProgressReadModel } from "@aimcub/core";

export function hasCompletionRecap(progress: AimProgressReadModel | null): boolean {
  return progress?.completion_recap?.complete === true;
}
