import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { enqueueSourceSyncJob, getBackgroundSyncStatus, runNextSourceSyncJob } from "../distill/jobs";
import { ensureDirectory } from "../distill/fs";
import { getLogsPageData } from "../distill/logs";

type SavedEnv = Record<
  | "DISTILL_HOME"
  | "CODEX_HOME"
  | "CLAUDE_HOME"
  | "OPENCODE_DB_PATH"
  | "OPENCODE_CONFIG_DIR"
  | "OPENCODE_STATE_DIR"
  | "HOME"
  | "TEST_OPENCODE_DB_PATH"
  | "TEST_OPENCODE_DB_QUERY_JSON"
  | "TEST_OPENCODE_EXPORT_DIR"
  | "PATH",
  string | undefined
>;

function restoreEnv(saved: SavedEnv): void {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

function withTempEnv<T>(fn: (root: string) => T): T {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "distill-test-"));
  const previous: SavedEnv = {
    DISTILL_HOME: process.env.DISTILL_HOME,
    CODEX_HOME: process.env.CODEX_HOME,
    CLAUDE_HOME: process.env.CLAUDE_HOME,
    OPENCODE_DB_PATH: process.env.OPENCODE_DB_PATH,
    OPENCODE_CONFIG_DIR: process.env.OPENCODE_CONFIG_DIR,
    OPENCODE_STATE_DIR: process.env.OPENCODE_STATE_DIR,
    HOME: process.env.HOME,
    TEST_OPENCODE_DB_PATH: process.env.TEST_OPENCODE_DB_PATH,
    TEST_OPENCODE_DB_QUERY_JSON: process.env.TEST_OPENCODE_DB_QUERY_JSON,
    TEST_OPENCODE_EXPORT_DIR: process.env.TEST_OPENCODE_EXPORT_DIR,
    PATH: process.env.PATH
  };

  process.env.HOME = tempRoot;
  process.env.DISTILL_HOME = path.join(tempRoot, ".distill");
  process.env.CODEX_HOME = path.join(tempRoot, ".codex");
  process.env.CLAUDE_HOME = path.join(tempRoot, ".claude");
  process.env.OPENCODE_DB_PATH = path.join(tempRoot, ".local", "share", "opencode", "opencode.db");
  process.env.OPENCODE_CONFIG_DIR = path.join(tempRoot, ".config", "opencode");
  process.env.OPENCODE_STATE_DIR = path.join(tempRoot, ".local", "state", "opencode");

  try {
    return fn(tempRoot);
  } finally {
    restoreEnv(previous);
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

function writeFixtureFiles(root: string): void {
  const codexPath = path.join(root, ".codex", "archived_sessions");
  const claudePath = path.join(root, ".claude", "projects", "demo-project");
  const opencodeConfigDir = path.join(root, ".config", "opencode");

  ensureDirectory(codexPath);
  ensureDirectory(claudePath);
  ensureDirectory(opencodeConfigDir);
  fs.writeFileSync(path.join(opencodeConfigDir, "opencode.json"), "{}\n");

  fs.writeFileSync(
    path.join(codexPath, "rollout-2026-03-25T10-00-00-abc12345-1111-2222-3333-abcdefabcdef.jsonl"),
    [
      JSON.stringify({
        timestamp: "2026-03-25T10:00:00.000Z",
        type: "session_meta",
        payload: { id: "abc12345-1111-2222-3333-abcdefabcdef", cwd: "/tmp/demo" }
      }),
      JSON.stringify({
        timestamp: "2026-03-25T10:01:00.000Z",
        type: "response_item",
        payload: { type: "message", role: "user", content: [{ type: "input_text", text: "hello codex" }] }
      })
    ].join("\n")
  );

  fs.writeFileSync(
    path.join(claudePath, "123e4567-e89b-12d3-a456-426614174000.jsonl"),
    [
      JSON.stringify({
        type: "user",
        uuid: "u1",
        sessionId: "123e4567-e89b-12d3-a456-426614174000",
        timestamp: "2026-03-25T11:00:00.000Z",
        message: { role: "user", content: [{ type: "text", text: "hello claude" }] }
      })
    ].join("\n")
  );

  writeFakeOpenCodeExecutable(root, [], {});
}

function writeFakeOpenCodeExecutable(
  root: string,
  sessions: Array<Record<string, unknown>> | string,
  exportsBySession: Record<string, string>
): void {
  const binDir = path.join(root, ".bin");
  const opencodeDbPath = path.join(root, ".local", "share", "opencode", "opencode.db");
  const dbQueryPath = path.join(root, "opencode-sessions.json");
  const exportDir = path.join(root, "opencode-exports");

  ensureDirectory(binDir);
  ensureDirectory(path.dirname(opencodeDbPath));
  ensureDirectory(exportDir);

  fs.writeFileSync(opencodeDbPath, "");
  fs.writeFileSync(dbQueryPath, typeof sessions === "string" ? sessions : JSON.stringify(sessions, null, 2));

  for (const [sessionId, output] of Object.entries(exportsBySession)) {
    fs.writeFileSync(path.join(exportDir, `${sessionId}.json`), output);
  }

  const safeExecPath = process.execPath
    .replace(/%/g, "%%")
    .replace(/\^/g, "^^")
    .replace(/&/g, "^&")
    .replace(/\|/g, "^|")
    .replace(/</g, "^<")
    .replace(/>/g, "^>")
    .replace(/"/g, "\"\"");

  const scriptPath = path.join(binDir, "opencode");
  const cmdPath = path.join(binDir, "opencode.cmd");
  fs.writeFileSync(
    scriptPath,
    `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");

const args = process.argv.slice(2);

if (args[0] === "db" && args[1] === "path") {
  process.stdout.write(\`\${process.env.TEST_OPENCODE_DB_PATH ?? ""}\\n\`);
  process.exit(0);
}

if (args[0] === "db") {
  process.stdout.write(fs.readFileSync(process.env.TEST_OPENCODE_DB_QUERY_JSON, "utf8"));
  process.exit(0);
}

if (args[0] === "export") {
  const session = args[1];
  const file = path.join(process.env.TEST_OPENCODE_EXPORT_DIR, \`\${session}.json\`);
  if (!fs.existsSync(file)) {
    process.stderr.write(\`missing export for \${session}\\n\`);
    process.exit(1);
  }

  process.stdout.write(\`Exporting session: \${session}\\n\`);
  process.stdout.write(fs.readFileSync(file, "utf8"));
  process.exit(0);
}

process.stderr.write("unsupported fake opencode command\\n");
process.exit(1);
`
  );
  fs.writeFileSync(
    cmdPath,
    `@echo off
"${safeExecPath}" "%~dp0opencode" %*
`
  );
  if (process.platform !== "win32") {
    fs.chmodSync(scriptPath, 0o755);
  }

  process.env.OPENCODE_DB_PATH = opencodeDbPath;
  process.env.TEST_OPENCODE_DB_PATH = opencodeDbPath;
  process.env.TEST_OPENCODE_DB_QUERY_JSON = dbQueryPath;
  process.env.TEST_OPENCODE_EXPORT_DIR = exportDir;
  process.env.PATH = `${binDir}${path.delimiter}${process.env.PATH ?? ""}`;
}

test("runNextSourceSyncJob includes failed capture counts in the completed summary", () => {
  withTempEnv((root) => {
    writeFixtureFiles(root);
    writeFakeOpenCodeExecutable(
      root,
      [
        {
          id: "ses_ok",
          title: "New session - 2026-03-26T19:15:49.354Z",
          directory: "/tmp/opencode-demo",
          version: "1.3.3",
          time_created: 1774543194067,
          time_updated: 1774543475213,
          time_archived: null,
          share_url: null
        },
        {
          id: "ses_fail",
          title: "Broken export",
          directory: "/tmp/opencode-demo",
          version: "1.3.3",
          time_created: 1774543194068,
          time_updated: 1774543475214,
          time_archived: null,
          share_url: null
        }
      ],
      {
        ses_ok: JSON.stringify({
          info: {
            id: "ses_ok",
            directory: "/tmp/opencode-demo",
            title: "New session - 2026-03-26T19:15:49.354Z",
            version: "1.3.3",
            time: { created: 1774543194067, updated: 1774543475213 }
          },
          messages: [
            {
              info: {
                id: "msg_user",
                role: "user",
                time: { created: 1774543194080 },
                model: { providerID: "ollama", modelID: "nemotron-cascade-2:30b" }
              },
              parts: [{ id: "part_user_text", type: "text", text: "Ship the OpenCode connector" }]
            }
          ]
        })
      }
    );

    enqueueSourceSyncJob("test");
    const status = runNextSourceSyncJob();
    const persistedStatus = getBackgroundSyncStatus();

    assert.equal(status.state, "completed");
    assert.equal(status.discoveredCaptures, 4);
    assert.equal(status.importedCaptures, 3);
    assert.equal(status.skippedCaptures, 0);
    assert.equal(status.failedCaptures, 1);
    assert.equal(
      status.summary,
      "Sync complete: 3 imported, 0 skipped, 1 failed across 4 captures"
    );
    assert.equal(persistedStatus.failedCaptures, 1);
    assert.equal(
      persistedStatus.summary,
      "Sync complete: 3 imported, 0 skipped, 1 failed across 4 captures"
    );
    assert.equal(status.failedEntries?.length, 1);
    assert.equal(status.failedEntries?.[0]?.sourceKind, "opencode");
    assert.match(status.failedEntries?.[0]?.errorText ?? "", /missing export/);

    const logs = getLogsPageData();
    const syncEntry = logs.entries.find((entry) => entry.kind === "sync");

    assert.equal(syncEntry?.status, "completed");
    assert.equal(syncEntry?.level, "error");
    assert.equal(syncEntry?.details?.failedEntries?.length, 1);
  });
});
