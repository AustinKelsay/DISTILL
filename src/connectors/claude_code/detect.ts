import { countFiles, expandHome, findExecutable, pathExists } from "../../distill/fs";
import { DiscoveredSource, SourcePathCheck } from "../../shared/types";

export function detectClaudeCodeSource(): DiscoveredSource {
  const executablePath = findExecutable("claude");
  const dataRoot = expandHome("~/.claude");
  const projectsPath = `${dataRoot}/projects`;
  const history = `${dataRoot}/history.jsonl`;
  const settings = `${dataRoot}/settings.json`;

  const checks: SourcePathCheck[] = [
    {
      label: "data_root",
      path: dataRoot,
      exists: pathExists(dataRoot)
    },
    {
      label: "projects",
      path: projectsPath,
      exists: pathExists(projectsPath),
      fileCount: countFiles(projectsPath)
    },
    {
      label: "history",
      path: history,
      exists: pathExists(history),
      fileCount: countFiles(history)
    },
    {
      label: "settings",
      path: settings,
      exists: pathExists(settings),
      fileCount: countFiles(settings)
    }
  ];

  const installStatus =
    executablePath && checks[0].exists && checks[1].exists
      ? "installed"
      : executablePath || checks.some((check) => check.exists)
        ? "partial"
        : "not_found";

  return {
    kind: "claude_code",
    displayName: "Claude Code",
    executablePath,
    dataRoot,
    installStatus,
    checks,
    metadata: {
      primaryCapturePath: projectsPath,
      auxiliaryFiles: [history, settings]
    }
  };
}
