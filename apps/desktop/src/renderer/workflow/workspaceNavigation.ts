export type CockpitStage = "aim" | "context" | "contracts" | "run" | "eval" | "settings" | "memory";
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

export const WORKBENCH_STAGE_IDS = ["aim", "context", "contracts", "run", "eval"] as const satisfies readonly WorkbenchStage[];

export const DRAFT_WORKBENCH_STAGE_IDS = ["aim", "context", "contracts"] as const satisfies readonly WorkbenchStage[];

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

export function availableWorkbenchStages(target: WorkspaceTarget): readonly WorkbenchStage[] {
  if (target.kind === "goal") return WORKBENCH_STAGE_IDS;
  if (target.kind === "draft") return DRAFT_WORKBENCH_STAGE_IDS;
  return ["aim"];
}

export function hasWorkbenchNavigation(target: WorkspaceTarget): boolean {
  return target.kind === "draft" || target.kind === "goal";
}

export function isWorkbenchStageAvailable(target: WorkspaceTarget, stage: CockpitStage): stage is WorkbenchStage {
  return stage !== "settings" && stage !== "memory" && availableWorkbenchStages(target).includes(stage);
}

export function settingsReturnStage(
  target: WorkspaceTarget,
  activeStage: CockpitStage,
  currentReturnStage: WorkbenchStage,
): WorkbenchStage {
  return isWorkbenchStageAvailable(target, activeStage) ? activeStage : currentReturnStage;
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
