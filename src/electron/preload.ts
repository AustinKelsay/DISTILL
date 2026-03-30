import { contextBridge, ipcRenderer } from "electron";
import { addSessionTag, getDefaultLabelNames, removeSessionTag, toggleSessionLabel } from "../distill/curation";
import { buildDoctorReport } from "../distill/doctor";
import { exportSessionsByLabel } from "../distill/export";
import { getLogsPageData } from "../distill/logs";
import { setSourceColor } from "../distill/preferences";
import { getDashboardData, getSessionDetail, searchSessions } from "../distill/query";
import { getAppSettingsSnapshot } from "../distill/settings";
import { AppSettingsSnapshot, BackgroundSyncStatus, LogsPageData, SourceColors } from "../shared/types";

contextBridge.exposeInMainWorld("distillApi", {
  getDoctorReport: () => buildDoctorReport(),
  getDashboardData: () => getDashboardData(),
  getSessionDetail: (sessionId: number) => getSessionDetail(sessionId),
  searchSessions: (query: string) => searchSessions(query),
  getLogsPageData: () => getLogsPageData() as LogsPageData,
  addSessionTag: (sessionId: number, tagName: string) => addSessionTag(sessionId, tagName),
  removeSessionTag: (sessionId: number, tagId: number) => removeSessionTag(sessionId, tagId),
  toggleSessionLabel: (sessionId: number, labelName: string) => toggleSessionLabel(sessionId, labelName),
  getDefaultLabelNames: () => getDefaultLabelNames(),
  exportSessionsByLabel: (label: string) => exportSessionsByLabel(label),
  setSourceColor: (sourceKind: string, color: string) => setSourceColor(sourceKind, color) as SourceColors,
  getAppSettings: () => getAppSettingsSnapshot() as AppSettingsSnapshot,
  getBackgroundSyncStatus: () =>
    ipcRenderer.invoke("distill:get-background-sync-status") as Promise<BackgroundSyncStatus>,
  requestBackgroundSync: () =>
    ipcRenderer.invoke("distill:request-background-sync") as Promise<BackgroundSyncStatus>,
  onBackgroundSyncStatus: (listener: (status: BackgroundSyncStatus) => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, status: BackgroundSyncStatus) => listener(status);
    ipcRenderer.on("distill:background-sync", wrapped);
    return () => ipcRenderer.removeListener("distill:background-sync", wrapped);
  }
});
