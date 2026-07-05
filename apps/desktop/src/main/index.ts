import { app, BrowserWindow } from "electron";
import { join } from "node:path";

import { registerIpc } from "./ipc";
import { loadContextSourceConfig } from "./context-source-settings";
import { loadProviderConfig } from "./gateway";
import { loadWebResearchConfig } from "./web-research-settings";

app.setName("Aimcub");

let mainWindow: BrowserWindow | null = null;

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 1100,
    minHeight: 720,
    show: false,
    title: "Aimcub",
    backgroundColor: "#fafafa",
    titleBarStyle: process.platform === "darwin" ? "hidden" : "default",
    trafficLightPosition: process.platform === "darwin" ? { x: 16, y: 16 } : undefined,
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      sandbox: false,
    },
  });

  mainWindow = win;
  win.on("closed", () => {
    if (mainWindow === win) mainWindow = null;
  });
  win.on("ready-to-show", () => win.show());

  // In dev, electron-vite serves the renderer over HTTP; in prod, load the built file.
  const devUrl = process.env.ELECTRON_RENDERER_URL;
  if (devUrl) {
    void win.loadURL(devUrl);
  } else {
    void win.loadFile(join(__dirname, "../renderer/index.html"));
  }
}

const singleInstanceLock = app.requestSingleInstanceLock();

if (!singleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });
}

app.whenReady().then(() => {
  if (!singleInstanceLock) return;
  // Load the persisted provider config into memory, then wire IPC.
  loadProviderConfig();
  loadWebResearchConfig();
  loadContextSourceConfig();
  registerIpc();
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
