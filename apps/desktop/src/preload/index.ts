import { contextBridge, ipcRenderer } from "electron";

import { IPC, type AimcubApi } from "../shared/ipc";

const api: AimcubApi = {
  intake: (req) => ipcRenderer.invoke(IPC.intake, req),
  draft: (req) => ipcRenderer.invoke(IPC.draft, req),
  clarify: (req) => ipcRenderer.invoke(IPC.clarify, req),
  refine: (req) => ipcRenderer.invoke(IPC.refine, req),
  saveGoal: (req) => ipcRenderer.invoke(IPC.saveGoal, req),
  listGoals: () => ipcRenderer.invoke(IPC.listGoals),
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
};

contextBridge.exposeInMainWorld("aimcub", api);
