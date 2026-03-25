import path from "node:path";

export function getHomeDirectory(): string {
  const home = process.env.HOME;
  if (!home) {
    throw new Error("HOME is not set");
  }

  return home;
}

export function getDistillHome(): string {
  return process.env.DISTILL_HOME ?? path.join(getHomeDirectory(), ".distill");
}

export function getDistillDatabasePath(): string {
  return path.join(getDistillHome(), "distill.db");
}

export function getCodexHome(): string {
  return process.env.CODEX_HOME ?? path.join(getHomeDirectory(), ".codex");
}

export function getClaudeHome(): string {
  return process.env.CLAUDE_HOME ?? path.join(getHomeDirectory(), ".claude");
}
