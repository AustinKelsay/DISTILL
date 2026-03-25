import { contextBridge } from "electron";
import { buildDoctorReport } from "../distill/doctor";
import { getDashboardData, getSessionDetail } from "../distill/query";

contextBridge.exposeInMainWorld("distillApi", {
  getDoctorReport: () => buildDoctorReport(),
  getDashboardData: () => getDashboardData(),
  getSessionDetail: (sessionId: number) => getSessionDetail(sessionId)
});
