import { contextBridge, ipcRenderer } from "electron";

import { IPC, type AimcubApi } from "../shared/ipc";

const api: AimcubApi = {
  draft: (req) => ipcRenderer.invoke(IPC.draft, req),
  clarify: (req) => ipcRenderer.invoke(IPC.clarify, req),
  refine: (req) => ipcRenderer.invoke(IPC.refine, req),
  saveGoal: (req) => ipcRenderer.invoke(IPC.saveGoal, req),
  listGoals: () => ipcRenderer.invoke(IPC.listGoals),
  getKeyStatus: () => ipcRenderer.invoke(IPC.getKeyStatus),
  setKey: (key) => ipcRenderer.invoke(IPC.setKey, key),
};

contextBridge.exposeInMainWorld("aimcub", api);
