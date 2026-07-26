import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";

import { IPC, type AimcubApi } from "../shared/ipc";

const api: AimcubApi = {
  intake: (req) => ipcRenderer.invoke(IPC.intake, req),
  draft: (req) => ipcRenderer.invoke(IPC.draft, req),
  clarify: (req) => ipcRenderer.invoke(IPC.clarify, req),
  refine: (req) => ipcRenderer.invoke(IPC.refine, req),
  saveGoal: (req) => ipcRenderer.invoke(IPC.saveGoal, req),
  createAim: (req) => ipcRenderer.invoke(IPC.createAim, req),
  updateGoalPlan: (req) => ipcRenderer.invoke(IPC.updateGoalPlan, req),
  renameGoal: (req) => ipcRenderer.invoke(IPC.renameGoal, req),
  listGoals: () => ipcRenderer.invoke(IPC.listGoals),
  getGoal: (id) => ipcRenderer.invoke(IPC.getGoal, id),
  getAimProgress: (id) => ipcRenderer.invoke(IPC.getAimProgress, id),
  getAimJournal: (id) => ipcRenderer.invoke(IPC.getAimJournal, id),
  listAimProgressSummaries: () => ipcRenderer.invoke(IPC.listAimProgressSummaries),
  deleteGoal: (id) => ipcRenderer.invoke(IPC.deleteGoal, id),
  listAimDrafts: () => ipcRenderer.invoke(IPC.listAimDrafts),
  getAimDraft: (id) => ipcRenderer.invoke(IPC.getAimDraft, id),
  upsertAimDraft: (req) => ipcRenderer.invoke(IPC.upsertAimDraft, req),
  discardAimDraft: (id) => ipcRenderer.invoke(IPC.discardAimDraft, id),
  listMemories: (goalId) => ipcRenderer.invoke(IPC.listMemories, goalId),
  listContextCandidates: () => ipcRenderer.invoke(IPC.listContextCandidates),
  listContextHistory: () => ipcRenderer.invoke(IPC.listContextHistory),
  listContextProfile: () => ipcRenderer.invoke(IPC.listContextProfile),
  listContextHealth: () => ipcRenderer.invoke(IPC.listContextHealth),
  listContextLearning: () => ipcRenderer.invoke(IPC.listContextLearning),
  listContextLineageLearning: () => ipcRenderer.invoke(IPC.listContextLineageLearning),
  listContextDecompositionLearning: () => ipcRenderer.invoke(IPC.listContextDecompositionLearning),
  listContextDecompositionStrategy: (req) => ipcRenderer.invoke(IPC.listContextDecompositionStrategy, req),
  archiveContextMemory: (id) => ipcRenderer.invoke(IPC.archiveContextMemory, id),
  deprioritizeContextMemory: (req) => ipcRenderer.invoke(IPC.deprioritizeContextMemory, req),
  acceptContextCandidate: (req) => ipcRenderer.invoke(IPC.acceptContextCandidate, req),
  rejectContextCandidate: (id) => ipcRenderer.invoke(IPC.rejectContextCandidate, id),
  getProviderConfig: () => ipcRenderer.invoke(IPC.getProviderConfig),
  setProviderConfig: (config) => ipcRenderer.invoke(IPC.setProviderConfig, config),
  testProviderConfig: (config) => ipcRenderer.invoke(IPC.testProviderConfig, config),
  getWebResearchConfig: () => ipcRenderer.invoke(IPC.getWebResearchConfig),
  setWebResearchConfig: (config) => ipcRenderer.invoke(IPC.setWebResearchConfig, config),
  testWebResearchConfig: (config) => ipcRenderer.invoke(IPC.testWebResearchConfig, config),
  getContextSourceConfig: () => ipcRenderer.invoke(IPC.getContextSourceConfig),
  setContextSourceConfig: (config) => ipcRenderer.invoke(IPC.setContextSourceConfig, config),
  pickLocalContextFolder: () => ipcRenderer.invoke(IPC.pickLocalContextFolder),
  pickLocalContextFiles: () => ipcRenderer.invoke(IPC.pickLocalContextFiles),
  listLocalAgents: () => ipcRenderer.invoke(IPC.listLocalAgents),
  runLocalAgent: (req) => ipcRenderer.invoke(IPC.runLocalAgent, req),
  runMilestoneAgent: (req) => ipcRenderer.invoke(IPC.runMilestoneAgent, req),
  cancelRun: (runId) => ipcRenderer.invoke(IPC.cancelRun, runId),
  claimQueuedRun: (runId) => ipcRenderer.invoke(IPC.claimQueuedRun, runId),
  confirmMilestone: (req) => ipcRenderer.invoke(IPC.confirmMilestone, req),
  getWindowChromeState: () => ipcRenderer.invoke(IPC.getWindowChromeState),
  setThemeSource: (source) => ipcRenderer.invoke(IPC.setThemeSource, source),
  getAppInfo: () => ipcRenderer.invoke(IPC.getAppInfo),
  revealWorkspace: () => ipcRenderer.invoke(IPC.revealWorkspace),
  getStoreDiagnostics: () => ipcRenderer.invoke(IPC.getStoreDiagnostics),
  getDesktopPreferences: () => ipcRenderer.invoke(IPC.getDesktopPreferences),
  setDesktopPreferences: (prefs) => ipcRenderer.invoke(IPC.setDesktopPreferences, prefs),
  pickRunWorkspace: () => ipcRenderer.invoke(IPC.pickRunWorkspace),
  onWindowChromeState: (handler) => {
    const listener = (_event: IpcRendererEvent, payload: unknown) => {
      handler(payload as Parameters<typeof handler>[0]);
    };
    ipcRenderer.on(IPC.windowChromeState, listener);
    return () => ipcRenderer.removeListener(IPC.windowChromeState, listener);
  },
  startPlanningSession: (req) => ipcRenderer.invoke(IPC.startPlanningSession, req),
  getPlanningSessionState: (req) => ipcRenderer.invoke(IPC.getPlanningSessionState, req),
  getPlanningPass: (req) => ipcRenderer.invoke(IPC.getPlanningPass, req),
  discardPlanningPass: (req) => ipcRenderer.invoke(IPC.discardPlanningPass, req),
  answerPlanningQuestion: (req) => ipcRenderer.invoke(IPC.answerPlanningQuestion, req),
  postPlanningChat: (req) => ipcRenderer.invoke(IPC.postPlanningChat, req),
  attachPlanningFiles: (req) => ipcRenderer.invoke(IPC.attachPlanningFiles, req),
  finishPlanningNow: (req) => ipcRenderer.invoke(IPC.finishPlanningNow, req),
  cancelPlanningSession: (req) => ipcRenderer.invoke(IPC.cancelPlanningSession, req),
  onPlanningLiveEvent: (handler) => {
    const listener = (_event: IpcRendererEvent, payload: unknown) => {
      handler(payload as Parameters<typeof handler>[0]);
    };
    ipcRenderer.on(IPC.planningLiveEvent, listener);
    return () => ipcRenderer.removeListener(IPC.planningLiveEvent, listener);
  },
  onPlanningSessionEvent: (handler) => {
    const listener = (_event: IpcRendererEvent, payload: unknown) => {
      handler(payload as Parameters<typeof handler>[0]);
    };
    ipcRenderer.on(IPC.planningSessionEvent, listener);
    return () => ipcRenderer.removeListener(IPC.planningSessionEvent, listener);
  },
  onRunLiveEvent: (handler) => {
    const listener = (_event: IpcRendererEvent, payload: unknown) => {
      handler(payload as Parameters<typeof handler>[0]);
    };
    ipcRenderer.on(IPC.runLiveEvent, listener);
    return () => ipcRenderer.removeListener(IPC.runLiveEvent, listener);
  },
};

contextBridge.exposeInMainWorld("aimcub", api);
