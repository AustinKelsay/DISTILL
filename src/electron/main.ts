import path from "node:path";
import { app, BrowserWindow, ipcMain } from "electron";
import {
  enqueueSourceSyncJob,
  getBackgroundSyncStatus,
  markStaleRunningSyncJobsFailed,
  runNextSourceSyncJob
} from "../distill/jobs";

const BACKGROUND_SYNC_INTERVAL_MS = 2 * 60 * 1000;

let mainWindow: BrowserWindow | null = null;
let backgroundSyncTimer: NodeJS.Timeout | undefined;
let isSyncing = false;

function createMainWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1120,
    height: 760,
    minWidth: 900,
    minHeight: 620,
    backgroundColor: "#1a1a1e",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadFile(path.join(process.cwd(), "static", "index.html"));
}

function broadcastBackgroundSyncStatus(): void {
  const status = getBackgroundSyncStatus();
  mainWindow?.webContents.send("distill:background-sync", status);
}

function runBackgroundSync(reason: string): void {
  if (isSyncing) {
    return;
  }

  isSyncing = true;

  try {
    enqueueSourceSyncJob(reason);
    broadcastBackgroundSyncStatus();
    const status = runNextSourceSyncJob();
    console.log(status.summary);
    mainWindow?.webContents.send("distill:background-sync", status);
  } finally {
    isSyncing = false;
  }
}

function startBackgroundSyncLoop(): void {
  backgroundSyncTimer = setInterval(() => {
    runBackgroundSync("interval");
  }, BACKGROUND_SYNC_INTERVAL_MS);
}

ipcMain.handle("distill:get-background-sync-status", () => getBackgroundSyncStatus());
ipcMain.handle("distill:request-background-sync", () => {
  runBackgroundSync("manual");
  return getBackgroundSyncStatus();
});

app.whenReady().then(() => {
  markStaleRunningSyncJobsFailed();
  runBackgroundSync("startup");
  createMainWindow();
  startBackgroundSyncLoop();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (backgroundSyncTimer) {
    clearInterval(backgroundSyncTimer);
    backgroundSyncTimer = undefined;
  }

  if (process.platform !== "darwin") {
    app.quit();
  }
});
