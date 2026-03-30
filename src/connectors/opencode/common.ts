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

export type OpenCodeDiscoveryErrorCode =
  | "not_installed"
  | "no_rows"
  | "timeout"
  | "permission_denied"
  | "invalid_json"
  | "cli_error";

export class OpenCodeDiscoveryError extends Error {
  code: OpenCodeDiscoveryErrorCode;
  stdout?: string;
  stderr?: string;

  constructor(
    code: OpenCodeDiscoveryErrorCode,
    message: string,
    options?: { cause?: unknown; stdout?: string; stderr?: string }
  ) {
    super(message, { cause: options?.cause });
    this.name = "OpenCodeDiscoveryError";
    this.code = code;
    this.stdout = options?.stdout;
    this.stderr = options?.stderr;
  }
}

const OPEN_CODE_DB_PATH_TIMEOUT_MS = 5_000;
const OPEN_CODE_DB_PATH_MAX_BUFFER = 64 * 1024;
const OPEN_CODE_COMMAND_TIMEOUT_MS = 15_000;
const OPEN_CODE_COMMAND_MAX_BUFFER = 16 * 1024 * 1024;

type ExecFileSyncError = Error & {
  code?: string;
  signal?: NodeJS.Signals | null;
  stdout?: string | Buffer;
  stderr?: string | Buffer;
};

function outputText(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }

  if (Buffer.isBuffer(value)) {
    const text = value.toString("utf8").trim();
    return text || undefined;
  }

  return undefined;
}

function isNoRowsMessage(message: string | undefined): boolean {
  return Boolean(message && /\bno rows?\b|\bno data\b/i.test(message));
}

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
    throw new OpenCodeDiscoveryError("not_installed", "OpenCode executable not found");
  }

  try {
    return execFileSync(executablePath, args, {
      encoding: "utf8",
      timeout: OPEN_CODE_COMMAND_TIMEOUT_MS,
      maxBuffer: OPEN_CODE_COMMAND_MAX_BUFFER
    });
  } catch (error) {
    if (!(error instanceof Error)) {
      throw error;
    }

    const execError = error as ExecFileSyncError;
    const stdout = outputText(execError.stdout);
    const stderr = outputText(execError.stderr);
    const detail = stderr ?? stdout ?? execError.message;

    if (execError.code === "ENOENT") {
      throw new OpenCodeDiscoveryError("not_installed", "OpenCode executable not found", {
        cause: error,
        stdout,
        stderr
      });
    }

    if (execError.code === "ETIMEDOUT" || /timed out|ETIMEDOUT/i.test(detail)) {
      throw new OpenCodeDiscoveryError("timeout", detail || "OpenCode command timed out", {
        cause: error,
        stdout,
        stderr
      });
    }

    if (
      execError.code === "EACCES"
      || execError.code === "EPERM"
      || /permission denied|operation not permitted/i.test(detail)
    ) {
      throw new OpenCodeDiscoveryError("permission_denied", detail || "OpenCode command permission denied", {
        cause: error,
        stdout,
        stderr
      });
    }

    if (isNoRowsMessage(detail)) {
      throw new OpenCodeDiscoveryError("no_rows", detail, {
        cause: error,
        stdout,
        stderr
      });
    }

    throw new OpenCodeDiscoveryError("cli_error", detail || "OpenCode command failed", {
      cause: error,
      stdout,
      stderr
    });
  }
}

export function readOpenCodeJson<T>(args: string[], executablePath = getOpenCodeExecutablePath()): T {
  const output = runOpenCodeCommand(args, executablePath).trim();
  if (!output) {
    throw new OpenCodeDiscoveryError("invalid_json", "OpenCode command returned empty output");
  }

  try {
    return JSON.parse(output) as T;
  } catch (error) {
    throw new OpenCodeDiscoveryError("invalid_json", "OpenCode command returned invalid JSON", {
      cause: error,
      stdout: output
    });
  }
}

export function listOpenCodeSessions(executablePath = getOpenCodeExecutablePath()): OpenCodeSessionRow[] {
  const query =
    "SELECT id, title, directory, version, time_created, time_updated, time_archived, share_url FROM session ORDER BY time_updated ASC;";

  try {
    const rows = readOpenCodeJson<OpenCodeSessionRow[] | null>(["db", query, "--format", "json"], executablePath);
    if (rows === null) {
      return [];
    }

    if (!Array.isArray(rows)) {
      throw new OpenCodeDiscoveryError("invalid_json", "OpenCode session query returned an unexpected JSON shape", {
        stdout: JSON.stringify(rows)
      });
    }

    return rows;
  } catch (error) {
    if (
      error instanceof OpenCodeDiscoveryError
      && (error.code === "not_installed" || error.code === "no_rows")
    ) {
      return [];
    }

    throw error;
  }
}

export function openCodeTimestampToIso(value: unknown): string | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    const date = new Date(value);
    if (Number.isFinite(date.getTime())) {
      return date.toISOString();
    }
    return undefined;
  }

  if (typeof value === "string" && value.trim()) {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) {
      const date = new Date(numeric);
      if (Number.isFinite(date.getTime())) {
        return date.toISOString();
      }
    }
  }

  return undefined;
}

export function getOpenCodeConfigPath(): string {
  return path.join(getOpenCodeConfigDir(), "opencode.json");
}
