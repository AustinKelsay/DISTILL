import { contextBridge } from "electron";
import { buildDoctorReport } from "../distill/doctor";

contextBridge.exposeInMainWorld("distillApi", {
  getDoctorReport: () => buildDoctorReport()
});
