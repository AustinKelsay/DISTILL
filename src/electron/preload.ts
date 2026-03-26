import { contextBridge } from "electron";
import { addSessionTag, getDefaultLabelNames, removeSessionTag, toggleSessionLabel } from "../distill/curation";
import { buildDoctorReport } from "../distill/doctor";
import { exportSessionsByLabel } from "../distill/export";
import { getDashboardData, getSessionDetail, searchSessions } from "../distill/query";

contextBridge.exposeInMainWorld("distillApi", {
  getDoctorReport: () => buildDoctorReport(),
  getDashboardData: () => getDashboardData(),
  getSessionDetail: (sessionId: number) => getSessionDetail(sessionId),
  searchSessions: (query: string) => searchSessions(query),
  addSessionTag: (sessionId: number, tagName: string) => addSessionTag(sessionId, tagName),
  removeSessionTag: (sessionId: number, tagId: number) => removeSessionTag(sessionId, tagId),
  toggleSessionLabel: (sessionId: number, labelName: string) => toggleSessionLabel(sessionId, labelName),
  getDefaultLabelNames: () => getDefaultLabelNames(),
  exportSessionsByLabel: (label: string) => exportSessionsByLabel(label)
});
