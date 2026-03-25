import { countFiles, expandHome, findExecutable, pathExists } from "../../distill/fs";
import { DiscoveredSource, SourcePathCheck } from "../../shared/types";

export function detectCodexSource(): DiscoveredSource {
  const executablePath = findExecutable("codex");
  const dataRoot = expandHome("~/.codex");
  const archivedSessions = `${dataRoot}/archived_sessions`;
  const sessionIndex = `${dataRoot}/session_index.jsonl`;
  const history = `${dataRoot}/history.jsonl`;

  const checks: SourcePathCheck[] = [
    {
      label: "data_root",
      path: dataRoot,
      exists: pathExists(dataRoot)
    },
    {
      label: "archived_sessions",
      path: archivedSessions,
      exists: pathExists(archivedSessions),
      fileCount: countFiles(archivedSessions)
    },
    {
      label: "session_index",
      path: sessionIndex,
      exists: pathExists(sessionIndex),
      fileCount: countFiles(sessionIndex)
    },
    {
      label: "history",
      path: history,
      exists: pathExists(history),
      fileCount: countFiles(history)
    }
  ];

  const installStatus =
    executablePath && checks[0].exists && checks[1].exists
      ? "installed"
      : executablePath || checks.some((check) => check.exists)
        ? "partial"
        : "not_found";

  return {
    kind: "codex",
    displayName: "OpenAI Codex CLI",
    executablePath,
    dataRoot,
    installStatus,
    checks,
    metadata: {
      primaryCapturePath: archivedSessions,
      auxiliaryFiles: [sessionIndex, history]
    }
  };
}
