import { app, BrowserWindow } from "electron";
import { join } from "node:path";

import { registerIpc } from "./ipc";
import { loadProviderConfig } from "./gateway";

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1000,
    height: 760,
    show: false,
    title: "Aimcub",
    backgroundColor: "#fafafa",
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    trafficLightPosition: process.platform === "darwin" ? { x: 18, y: 18 } : undefined,
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      sandbox: false,
    },
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

app.whenReady().then(() => {
  // Load the persisted provider config into memory, then wire IPC.
  loadProviderConfig();
  registerIpc();
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
