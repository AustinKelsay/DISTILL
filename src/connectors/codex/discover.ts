import fs from "node:fs";
import path from "node:path";
import { listFilesRecursive } from "../../distill/fs";
import { getCodexHome } from "../../distill/paths";
import { DiscoveredCapture } from "../../shared/types";

function extractSessionId(filePath: string): string | undefined {
  const match = path.basename(filePath).match(/([0-9a-f]{8,}-[0-9a-f-]+)\.jsonl$/i);
  return match?.[1];
}

export function discoverCodexCaptures(): DiscoveredCapture[] {
  const archivedSessionsPath = path.join(getCodexHome(), "archived_sessions");

  return listFilesRecursive(archivedSessionsPath)
    .filter((filePath) => filePath.endsWith(".jsonl"))
    .map((filePath) => {
      const stat = fs.statSync(filePath);

      return {
        sourceKind: "codex",
        captureKind: "archived_session",
        sourcePath: filePath,
        externalSessionId: extractSessionId(filePath),
        sourceModifiedAt: stat.mtime.toISOString(),
        sourceSizeBytes: stat.size,
        metadata: {}
      };
    });
}
