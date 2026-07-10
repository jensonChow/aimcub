import type {
  ContextSourceStatus,
  LocalAgentDetection,
  ProviderStatus,
  WebResearchStatus,
} from "../../shared/ipc";
import type { AimHelperProfile } from "../firstRunFlow";
import type { I18n } from "../i18n";

export type SettingsSectionId = "overview" | "provider" | "local" | "web" | "context";
export type SettingsHelperTone = "success" | "warn" | "blue" | "";

export interface SettingsHelper {
  id: SettingsSectionId;
  title: string;
  body: string;
  status: string;
  tone: SettingsHelperTone;
  next: string;
}

interface SettingsModelInput {
  provider: ProviderStatus | null;
  webResearch: WebResearchStatus | null;
  contextSources: ContextSourceStatus | null;
  localAgents: LocalAgentDetection[];
}

export interface SettingsModel {
  navItems: SettingsHelper[];
  helpers: SettingsHelper[];
  overviewHelper: SettingsHelper;
  providerHelper: SettingsHelper;
  localAgentHelper: SettingsHelper;
  webResearchHelper: SettingsHelper;
  contextHelper: SettingsHelper;
  planningReady: boolean;
  overallNext: string;
}

export function settingsSectionForFocus(focus: AimHelperProfile["settingsFocus"]): SettingsSectionId {
  if (focus === "local") return "local";
  if (focus === "web") return "web";
  if (focus === "context") return "context";
  return "provider";
}

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

export function buildSettingsModel(input: SettingsModelInput, t: I18n["t"]): SettingsModel {
  const providerReady = Boolean(input.provider?.configured);
  const readyLocalAgents = input.localAgents.filter((agent) => agent.available && agent.authStatus !== "missing");
  const availableLocalAgents = input.localAgents.filter((agent) => agent.available);
  const localAgentReady = readyLocalAgents.length > 0;
  const planningReady = providerReady || localAgentReady;
  const webResearchReady = Boolean(input.webResearch?.configured) || localAgentReady;
  const webResearchEnabled = input.webResearch?.enabled ?? false;
  const contextSourceCount = activeContextSourceCount(input.contextSources);
  const contextReady = contextSourceCount >= 4;
  const contextHasAnySource = contextSourceCount > 0;
  const providerRuntime = [input.provider?.provider, input.provider?.model].filter(Boolean).join(" / ");

  const providerHelper = {
    id: "provider",
    title: t("settings.helper.provider.title"),
    body: t("settings.helper.provider.body"),
    status: providerReady ? t("intake.ready") : localAgentReady ? t("context.sources.status.optional") : t("os.blocked"),
    tone: providerReady ? "success" : localAgentReady ? "" : "warn",
    next: providerReady
      ? t("settings.provider.next.ready", { provider: providerRuntime || t("settings.provider.saved") })
      : localAgentReady
        ? t("settings.provider.next.optional")
        : t("settings.provider.next.blocked"),
  } satisfies SettingsHelper;

  const localAgentHelper = {
    id: "local",
    title: t("settings.helper.local.title"),
    body: t("settings.helper.local.body"),
    status: localAgentReady ? t("intake.ready") : providerReady ? t("context.sources.status.optional") : t("os.blocked"),
    tone: localAgentReady ? "success" : providerReady ? "" : "warn",
    next: localAgentReady
      ? t("settings.local.next.ready", { n: readyLocalAgents.length })
      : availableLocalAgents.length > 0
        ? t("settings.local.next.auth")
        : t("settings.local.next.install"),
  } satisfies SettingsHelper;

  const webResearchHelper = {
    id: "web",
    title: t("settings.helper.web.title"),
    body: t("settings.helper.web.body"),
    status: webResearchReady ? t("intake.ready") : webResearchEnabled ? t("os.blocked") : t("context.sources.status.optional"),
    tone: webResearchReady ? "success" : webResearchEnabled ? "warn" : "",
    next: webResearchReady
      ? t("settings.web.next.ready")
      : webResearchEnabled
        ? t("settings.web.next.blocked")
        : t("settings.web.next.optional"),
  } satisfies SettingsHelper;

  const contextHelper = {
    id: "context",
    title: t("settings.helper.context.title"),
    body: t("settings.helper.context.body"),
    status: contextReady ? t("intake.ready") : contextHasAnySource ? t("settings.status.partial") : t("os.blocked"),
    tone: contextReady ? "success" : "warn",
    next: contextReady
      ? t("settings.context.next.ready")
      : contextHasAnySource
        ? t("settings.context.next.partial")
        : t("settings.context.next.blocked"),
  } satisfies SettingsHelper;

  const helpers = [providerHelper, localAgentHelper, webResearchHelper, contextHelper];
  const overallNext = !planningReady
    ? t("settings.overall.next.runtime")
    : !contextReady
      ? t("settings.overall.next.context")
      : !webResearchReady
        ? t("settings.overall.next.web")
        : t("settings.overall.next.aim");
  const overviewHelper = {
    id: "overview",
    title: t("settings.nav.overview"),
    body: t("settings.nav.overview.body"),
    status: planningReady ? t("settings.status.readyToPlan") : t("os.blocked"),
    tone: planningReady ? "success" : "warn",
    next: overallNext,
  } satisfies SettingsHelper;

  return {
    navItems: [overviewHelper, ...helpers],
    helpers,
    overviewHelper,
    providerHelper,
    localAgentHelper,
    webResearchHelper,
    contextHelper,
    planningReady,
    overallNext,
  };
}
