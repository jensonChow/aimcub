/**
 * The collapsed navigation model (Collapse Stage 3): one work surface per target.
 *
 * A goal's whole loop — planning, work, proof, receipts — lives on the Journey ("aim").
 * Settings and Memory are overlay stages that return to it. The old workbench stages
 * (context / contracts / run / eval) are gone; their essential controls live on the
 * Journey's plan rows and live lane.
 */
export type CockpitStage = "aim" | "settings" | "memory";
export type WorkbenchStage = Exclude<CockpitStage, "settings" | "memory">;
export type WorkspaceTarget =
  | { kind: "home" }
  | { kind: "newAim" }
  | { kind: "draft"; id: string }
  | { kind: "goal"; id: string };

export interface DraftActivationToken {
  draftId: string;
  version: number;
}

export interface DraftActivationTracker {
  capture(draftId: string): DraftActivationToken;
  invalidate(draftId: string): void;
  isCurrent(token: DraftActivationToken): boolean;
}

interface WorkspaceTargetInput {
  selectedGoalId: string | null;
  activeDraftId: string | null;
  showAimComposer: boolean;
}

export function deriveWorkspaceTarget(input: WorkspaceTargetInput): WorkspaceTarget {
  if (input.selectedGoalId) return { kind: "goal", id: input.selectedGoalId };
  if (input.activeDraftId) return { kind: "draft", id: input.activeDraftId };
  if (input.showAimComposer) return { kind: "newAim" };
  return { kind: "home" };
}

export function createDraftActivationTracker(): DraftActivationTracker {
  const versions = new Map<string, number>();

  return {
    capture(draftId) {
      return { draftId, version: versions.get(draftId) ?? 0 };
    },
    invalidate(draftId) {
      versions.set(draftId, (versions.get(draftId) ?? 0) + 1);
    },
    isCurrent(token) {
      return (versions.get(token.draftId) ?? 0) === token.version;
    },
  };
}
