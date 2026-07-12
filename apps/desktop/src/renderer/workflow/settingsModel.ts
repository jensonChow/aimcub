import type { ContextSourceStatus } from "../../shared/ipc";
import type { AimHelperProfile } from "../firstRunFlow";

/**
 * Settings categories (the in-workspace rail): General / Planning brain / Workers /
 * Research / About — the re-synced Glass IA. The old readiness "Overview" is gone;
 * each tab's form carries its own honest status copy.
 */
export type SettingsSectionId = "general" | "brain" | "workers" | "research" | "about";

/** Where a runtime-guidance profile should land inside Settings. */
export function settingsSectionForFocus(focus: AimHelperProfile["settingsFocus"]): SettingsSectionId {
  if (focus === "local") return "workers";
  if (focus === "web" || focus === "context") return "research";
  return "brain";
}

/** How many of the six context sources are active — the Research tab's summary line. */
export function activeContextSourceCount(status: ContextSourceStatus | null): number {
  if (!status) return 0;
  const localActive = status.local.configured;
  const onlineActive = status.online.enabled && status.online.enabledCount > 0;
  const webActive = status.research.webEnabled;
  const deepActive = status.research.deepResearch && webActive && localActive;
  const sessionActive = status.userSession.enabled;
  const questionnaireActive = status.questionnaire.enabled;
  return [localActive, onlineActive, webActive, deepActive, sessionActive, questionnaireActive].filter(Boolean).length;
}

export const CONTEXT_SOURCE_TOTAL = 6;
