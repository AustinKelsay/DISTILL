import { execFileSync } from "node:child_process";
import path from "node:path";
import { findExecutable } from "../../distill/fs";
import {
  getOpenCodeConfigDir,
  getOpenCodeDefaultDatabasePath,
  getOpenCodeStateDir
} from "../../distill/paths";

export type OpenCodeSessionRow = {
  id: string;
  title?: string | null;
  directory?: string | null;
  version?: string | null;
  time_created?: number | null;
  time_updated?: number | null;
  time_archived?: number | null;
  share_url?: string | null;
};

const OPEN_CODE_DB_PATH_TIMEOUT_MS = 5_000;
const OPEN_CODE_DB_PATH_MAX_BUFFER = 64 * 1024;
const OPEN_CODE_COMMAND_TIMEOUT_MS = 15_000;
const OPEN_CODE_COMMAND_MAX_BUFFER = 16 * 1024 * 1024;

export function getOpenCodeExecutablePath(): string | undefined {
  return findExecutable("opencode");
}

export function getOpenCodeDatabasePath(executablePath = getOpenCodeExecutablePath()): string {
  if (executablePath) {
    try {
      const result = execFileSync(executablePath, ["db", "path"], {
        encoding: "utf8",
        timeout: OPEN_CODE_DB_PATH_TIMEOUT_MS,
        maxBuffer: OPEN_CODE_DB_PATH_MAX_BUFFER
      }).trim();
      if (result) {
        return result;
      }
    } catch {
      // fall back to the default path below
    }
  }

  return getOpenCodeDefaultDatabasePath();
}

export function getOpenCodeDatabaseRoot(executablePath = getOpenCodeExecutablePath()): string {
  return path.dirname(getOpenCodeDatabasePath(executablePath));
}

export function getOpenCodePromptHistoryPath(): string {
  return path.join(getOpenCodeStateDir(), "prompt-history.jsonl");
}

export function runOpenCodeCommand(args: string[], executablePath = getOpenCodeExecutablePath()): string {
  if (!executablePath) {
    throw new Error("OpenCode executable not found");
  }

  return execFileSync(executablePath, args, {
    encoding: "utf8",
    timeout: OPEN_CODE_COMMAND_TIMEOUT_MS,
    maxBuffer: OPEN_CODE_COMMAND_MAX_BUFFER
  });
}

export function readOpenCodeJson<T>(args: string[], executablePath = getOpenCodeExecutablePath()): T {
  const output = runOpenCodeCommand(args, executablePath).trim();
  return JSON.parse(output) as T;
}

export function listOpenCodeSessions(executablePath = getOpenCodeExecutablePath()): OpenCodeSessionRow[] {
  const query =
    "SELECT id, title, directory, version, time_created, time_updated, time_archived, share_url FROM session ORDER BY time_updated ASC;";

  try {
    const rows = readOpenCodeJson<OpenCodeSessionRow[]>(["db", query, "--format", "json"], executablePath);
    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  }
}

export function openCodeTimestampToIso(value: unknown): string | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return new Date(value).toISOString();
  }

  if (typeof value === "string" && value.trim()) {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) {
      return new Date(numeric).toISOString();
    }
  }

  return undefined;
}

export function getOpenCodeConfigPath(): string {
  return path.join(getOpenCodeConfigDir(), "opencode.json");
}
