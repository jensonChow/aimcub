import { contextBridge } from "electron";

// Minimal bridge for the scaffold; the typed planner/persistence API is added with IPC.
contextBridge.exposeInMainWorld("aimcub", {
  ping: (): string => "pong",
});
