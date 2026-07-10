export type GoalActivationOrigin = "external_navigation" | "save_success";
export type NavigationScope = "target" | "surface";

export interface NavigationEpochs {
  workspace: number;
  surface: number;
}

export interface NavigationConcurrencyState<TBusy = string> extends NavigationEpochs {
  planningRunId: string | null;
  busy: TBusy | null;
  saveInFlight: boolean;
}

export type DeferredNavigationToken = Readonly<NavigationEpochs>;

export interface WorkflowMutationLocks {
  saveInFlight: boolean;
  discardInFlight: boolean;
  pendingTargetNavigation: boolean;
  sideEffectInFlight: boolean;
}

export function createNavigationConcurrencyState<TBusy = string>(): NavigationConcurrencyState<TBusy> {
  return {
    workspace: 0,
    surface: 0,
    planningRunId: null,
    busy: null,
    saveInFlight: false,
  };
}

export function captureDeferredNavigation<TBusy>(
  state: NavigationConcurrencyState<TBusy>,
): DeferredNavigationToken {
  return {
    workspace: state.workspace,
    surface: state.surface,
  };
}

export function beginPlanningActivity<TBusy>(
  state: NavigationConcurrencyState<TBusy>,
  planningRunId: string,
  busy: TBusy | null,
): NavigationConcurrencyState<TBusy> {
  return {
    ...state,
    planningRunId,
    busy,
  };
}

export function beginNavigation<TBusy>(
  state: NavigationConcurrencyState<TBusy>,
  scope: NavigationScope,
): NavigationConcurrencyState<TBusy> {
  const interruptedPlanning = Boolean(state.planningRunId);
  return {
    ...state,
    workspace: scope === "target" ? state.workspace + 1 : state.workspace,
    surface: state.surface + 1,
    planningRunId: null,
    busy: interruptedPlanning ? null : state.busy,
  };
}

export function withSaveInFlight<TBusy>(
  state: NavigationConcurrencyState<TBusy>,
  saveInFlight: boolean,
): NavigationConcurrencyState<TBusy> {
  return {
    ...state,
    saveInFlight,
  };
}

export function finishSaveInFlight<TBusy>(
  state: NavigationConcurrencyState<TBusy>,
): NavigationConcurrencyState<TBusy> {
  return {
    ...state,
    busy: null,
    saveInFlight: false,
  };
}

export function canApplyDeferredWorkspaceResponse<TBusy>(
  token: DeferredNavigationToken,
  state: NavigationConcurrencyState<TBusy>,
): boolean {
  return token.workspace === state.workspace;
}

export function canApplyDeferredSurfaceRoute<TBusy>(
  token: DeferredNavigationToken,
  state: NavigationConcurrencyState<TBusy>,
): boolean {
  return token.workspace === state.workspace && token.surface === state.surface;
}

export function canActivateGoal<TBusy>(
  state: NavigationConcurrencyState<TBusy>,
  origin: GoalActivationOrigin,
): boolean {
  return !state.saveInFlight || origin === "save_success";
}

export function canStartWorkflowMutation(locks: WorkflowMutationLocks): boolean {
  return !locks.saveInFlight
    && !locks.discardInFlight
    && !locks.pendingTargetNavigation
    && !locks.sideEffectInFlight;
}
