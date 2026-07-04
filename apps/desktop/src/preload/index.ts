import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";

import { IPC, type AimcubApi } from "../shared/ipc";

const api: AimcubApi = {
  intake: (req) => ipcRenderer.invoke(IPC.intake, req),
  draft: (req) => ipcRenderer.invoke(IPC.draft, req),
  clarify: (req) => ipcRenderer.invoke(IPC.clarify, req),
  refine: (req) => ipcRenderer.invoke(IPC.refine, req),
  saveGoal: (req) => ipcRenderer.invoke(IPC.saveGoal, req),
  listGoals: () => ipcRenderer.invoke(IPC.listGoals),
  getGoal: (id) => ipcRenderer.invoke(IPC.getGoal, id),
  getAimProgress: (id) => ipcRenderer.invoke(IPC.getAimProgress, id),
  deleteGoal: (id) => ipcRenderer.invoke(IPC.deleteGoal, id),
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
  confirmMilestone: (req) => ipcRenderer.invoke(IPC.confirmMilestone, req),
  onPlanningLiveEvent: (handler) => {
    const listener = (_event: IpcRendererEvent, payload: unknown) => {
      handler(payload as Parameters<typeof handler>[0]);
    };
    ipcRenderer.on(IPC.planningLiveEvent, listener);
    return () => ipcRenderer.removeListener(IPC.planningLiveEvent, listener);
  },
};

contextBridge.exposeInMainWorld("aimcub", api);
