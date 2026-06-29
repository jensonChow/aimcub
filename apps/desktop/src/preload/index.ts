import { contextBridge, ipcRenderer } from "electron";

import { IPC, type AimcubApi } from "../shared/ipc";

const api: AimcubApi = {
  draft: (req) => ipcRenderer.invoke(IPC.draft, req),
  clarify: (req) => ipcRenderer.invoke(IPC.clarify, req),
  refine: (req) => ipcRenderer.invoke(IPC.refine, req),
  saveGoal: (req) => ipcRenderer.invoke(IPC.saveGoal, req),
  listGoals: () => ipcRenderer.invoke(IPC.listGoals),
  deleteGoal: (id) => ipcRenderer.invoke(IPC.deleteGoal, id),
  getProviderConfig: () => ipcRenderer.invoke(IPC.getProviderConfig),
  setProviderConfig: (config) => ipcRenderer.invoke(IPC.setProviderConfig, config),
};

contextBridge.exposeInMainWorld("aimcub", api);
