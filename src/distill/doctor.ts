import { detectClaudeCodeSource } from "../connectors/claude_code/detect";
import { detectCodexSource } from "../connectors/codex/detect";
import { DoctorReport } from "../shared/types";

export function buildDoctorReport(): DoctorReport {
  return {
    scannedAt: new Date().toISOString(),
    sources: [detectCodexSource(), detectClaudeCodeSource()]
  };
}
