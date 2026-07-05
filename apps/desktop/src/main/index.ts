import { app, BrowserWindow, type Point } from "electron";
import { join } from "node:path";

import { registerIpc } from "./ipc";
import { loadContextSourceConfig } from "./context-source-settings";
import { loadProviderConfig } from "./gateway";
import { loadWebResearchConfig } from "./web-research-settings";
import { IPC, type WindowChromeState } from "../shared/ipc";

app.setName("Aimcub");

let mainWindow: BrowserWindow | null = null;

const MAC_TRAFFIC_LIGHT_X = 16;
const MAC_TRAFFIC_LIGHT_ROW_HEIGHT = 46;
const MAC_TRAFFIC_LIGHT_BUTTON_SIZE = 14;

function nativeTrafficLightPosition(zoomFactor = 1): Point {
  const safeZoomFactor = Number.isFinite(zoomFactor) && zoomFactor > 0 ? zoomFactor : 1;
  return {
    x: MAC_TRAFFIC_LIGHT_X,
    y: Math.round((MAC_TRAFFIC_LIGHT_ROW_HEIGHT * safeZoomFactor - MAC_TRAFFIC_LIGHT_BUTTON_SIZE) / 2),
  };
}

function applyNativeMacWindowChrome(win: BrowserWindow): void {
  if (process.platform !== "darwin" || win.isDestroyed()) return;
  win.setWindowButtonVisibility(true);
  win.setWindowButtonPosition(nativeTrafficLightPosition(win.webContents.getZoomFactor()));
}

function scheduleNativeMacWindowChrome(win: BrowserWindow): void {
  if (process.platform !== "darwin") return;
  setTimeout(() => applyNativeMacWindowChrome(win), 0);
}

function windowChromeState(win: BrowserWindow): WindowChromeState {
  return {
    fullscreen: win.isFullScreen(),
  };
}

function sendWindowChromeState(win: BrowserWindow): void {
  if (win.webContents.isDestroyed()) return;
  win.webContents.send(IPC.windowChromeState, windowChromeState(win));
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 1100,
    minHeight: 720,
    show: false,
    title: "Aimcub",
    backgroundColor: "#fafafa",
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    trafficLightPosition: process.platform === "darwin" ? nativeTrafficLightPosition() : undefined,
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      sandbox: false,
    },
  });

  mainWindow = win;
  applyNativeMacWindowChrome(win);
  win.on("closed", () => {
    if (mainWindow === win) mainWindow = null;
  });
  win.on("ready-to-show", () => {
    applyNativeMacWindowChrome(win);
    win.show();
  });
  win.on("focus", () => applyNativeMacWindowChrome(win));
  win.on("blur", () => applyNativeMacWindowChrome(win));
  win.on("show", () => applyNativeMacWindowChrome(win));
  win.on("restore", () => applyNativeMacWindowChrome(win));
  win.on("enter-full-screen", () => {
    applyNativeMacWindowChrome(win);
    sendWindowChromeState(win);
  });
  win.on("leave-full-screen", () => {
    applyNativeMacWindowChrome(win);
    sendWindowChromeState(win);
  });
  win.webContents.on("did-finish-load", () => {
    applyNativeMacWindowChrome(win);
    sendWindowChromeState(win);
  });
  win.webContents.on("zoom-changed", () => scheduleNativeMacWindowChrome(win));

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
