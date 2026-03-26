import { getDefaultLabelNames } from "./curation";
import { getClaudeHome, getCodexHome, getDistillDatabasePath, getDistillHome } from "./paths";
import { AppSettingsSnapshot } from "../shared/types";

export const BACKGROUND_SYNC_INTERVAL_MINUTES = 2;

export function getAppSettingsSnapshot(): AppSettingsSnapshot {
  return {
    distillHome: getDistillHome(),
    databasePath: getDistillDatabasePath(),
    codexHome: getCodexHome(),
    claudeHome: getClaudeHome(),
    sourceKinds: ["codex", "claude_code"],
    defaultLabels: getDefaultLabelNames(),
    backgroundSyncIntervalMinutes: BACKGROUND_SYNC_INTERVAL_MINUTES,
    envOverrides: {
      distillHome: Boolean(process.env.DISTILL_HOME),
      codexHome: Boolean(process.env.CODEX_HOME),
      claudeHome: Boolean(process.env.CLAUDE_HOME)
    }
  };
}
