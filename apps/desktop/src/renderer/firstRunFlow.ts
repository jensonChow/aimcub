import type { LocalAgentDetection, ProviderStatus } from "../shared/ipc";
import type { CockpitStage } from "./CockpitShell";

type RuntimeProvider = Pick<ProviderStatus, "configured"> | null | undefined;
type RuntimeAgent = Pick<LocalAgentDetection, "available" | "authStatus">;

export type AimSubmitAction = "missing_aim" | "show_helper_guidance" | "start_planning";
export type AimHelperCapability = "code_execution" | "current_research" | "source_context" | "general_planning";
export type AimHelperPreference = "local_agent" | "provider_with_web" | "provider" | "either";
export type AimHelperSettingsFocus = "local" | "provider" | "web" | "context";

export interface AimHelperProfile {
  capability: AimHelperCapability;
  preferredHelper: AimHelperPreference;
  settingsFocus: AimHelperSettingsFocus;
}

export interface RefreshRoute {
  autoOpenFirstGoal: boolean;
  stageOverride: CockpitStage | null;
}

export function hasReadyLocalAgent(localAgents: readonly RuntimeAgent[]): boolean {
  return localAgents.some((agent) => agent.available && agent.authStatus !== "missing");
}

export function hasPlanningRuntime(provider: RuntimeProvider, localAgents: readonly RuntimeAgent[]): boolean {
  return Boolean(provider?.configured) || hasReadyLocalAgent(localAgents);
}

export function routeAfterRefresh(input: {
  hasSelectedAim: boolean;
  hasActiveDraft: boolean;
  hasDrafts: boolean;
  hasGoals: boolean;
}): RefreshRoute {
  if (input.hasSelectedAim || input.hasActiveDraft) {
    return { autoOpenFirstGoal: false, stageOverride: null };
  }
  return {
    autoOpenFirstGoal: input.hasGoals && !input.hasDrafts,
    stageOverride: "aim",
  };
}

export function routeAfterAimSubmit(input: {
  title: string;
  provider: RuntimeProvider;
  localAgents: readonly RuntimeAgent[];
}): AimSubmitAction {
  if (!input.title.trim()) return "missing_aim";
  return hasPlanningRuntime(input.provider, input.localAgents) ? "start_planning" : "show_helper_guidance";
}

export function deriveAimHelperProfile(input: { title: string; description?: string | null }): AimHelperProfile {
  const text = `${input.title} ${input.description ?? ""}`.toLowerCase();
  if (/\b(latest|current|research|compare|market|news|source|sources|citation|regulation|price|prices|trend|trends)\b/.test(text)) {
    return {
      capability: "current_research",
      preferredHelper: "provider_with_web",
      settingsFocus: "web",
    };
  }
  if (/\b(app|application|software|code|coding|repo|repository|github|bug|feature|build|ship|website|web app|api|cli|desktop|electron|react|typescript|database|supabase|deploy|fix|implement|test|lint|package|release)\b/.test(text)) {
    return {
      capability: "code_execution",
      preferredHelper: "local_agent",
      settingsFocus: "local",
    };
  }
  if (/\b(file|files|folder|workspace|pdf|document|doc|docs|spreadsheet|sheet|notes|transcript|photo|library|archive|dataset|csv)\b/.test(text)) {
    return {
      capability: "source_context",
      preferredHelper: "provider",
      settingsFocus: "context",
    };
  }
  return {
    capability: "general_planning",
    preferredHelper: "either",
    settingsFocus: "provider",
  };
}
