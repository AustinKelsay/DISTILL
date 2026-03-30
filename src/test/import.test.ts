import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { sourceConnectors } from "../connectors";
import { SourceConnector } from "../connectors/types";
import { runImport } from "../distill/import";
import { ensureDirectory } from "../distill/fs";
import { DiscoveredCapture } from "../shared/types";

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

test("runImport bootstraps the database and records discovered captures", () => {
  withTempEnv((root) => {
    writeFixtureFiles(root);

    const report = runImport();
    const db = new DatabaseSync(report.databasePath);

    const sourceCount = db.prepare("SELECT COUNT(*) AS count FROM sources").get() as { count: number };
    const captureCount = db.prepare("SELECT COUNT(*) AS count FROM captures").get() as { count: number };
    const captureRecordCount = db.prepare("SELECT COUNT(*) AS count FROM capture_records").get() as { count: number };
    const sessionCount = db.prepare("SELECT COUNT(*) AS count FROM sessions").get() as { count: number };
    const messageCount = db.prepare("SELECT COUNT(*) AS count FROM messages").get() as { count: number };
    const activityCount = db.prepare("SELECT COUNT(*) AS count FROM activity_events").get() as { count: number };

    assert.equal(sourceCount.count, 3);
    assert.equal(captureCount.count, 2);
    assert.ok(captureRecordCount.count >= 2);
    assert.equal(sessionCount.count, 2);
    assert.ok(messageCount.count >= 2);
    assert.equal(activityCount.count, 2);
    assert.equal(report.sourceSummaries.length, 3);
    assert.equal(report.sourceSummaries.every((summary) => summary.failedCaptures === 0), true);

    db.close();
  });
});

test("runImport is idempotent for unchanged raw captures", () => {
  withTempEnv((root) => {
    writeFixtureFiles(root);

    const first = runImport();
    const second = runImport();

    const db = new DatabaseSync(first.databasePath);
    const captureCount = db.prepare("SELECT COUNT(*) AS count FROM captures").get() as { count: number };

    assert.equal(captureCount.count, 2);
    assert.equal(second.sourceSummaries.every((summary) => summary.importedCaptures === 0), true);
    assert.equal(second.sourceSummaries.filter((summary) => summary.kind !== "opencode").every((summary) => summary.skippedCaptures >= 1), true);
    assert.equal(second.sourceSummaries.every((summary) => summary.failedCaptures === 0), true);

    db.close();
  });
});

test("runImport reimports changed captures and refreshes normalized session content", () => {
  withTempEnv((root) => {
    writeFixtureFiles(root);

    const first = runImport();
    const codexCapturePath = path.join(
      root,
      ".codex",
      "archived_sessions",
      "rollout-2026-03-25T10-00-00-abc12345-1111-2222-3333-abcdefabcdef.jsonl"
    );

    fs.writeFileSync(
      codexCapturePath,
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
        }),
        JSON.stringify({
          timestamp: "2026-03-25T10:02:00.000Z",
          type: "response_item",
          payload: {
            type: "message",
            role: "assistant",
            content: [{ type: "output_text", text: "updated answer" }]
          }
        })
      ].join("\n")
    );

    const second = runImport();
    const db = new DatabaseSync(first.databasePath);

    const captureCount = db.prepare("SELECT COUNT(*) AS count FROM captures").get() as { count: number };
    const session = db
      .prepare("SELECT raw_capture_count, message_count FROM sessions WHERE external_session_id = ?")
      .get("abc12345-1111-2222-3333-abcdefabcdef") as { raw_capture_count: number; message_count: number };
    const messages = db
      .prepare(
        "SELECT role, text, ordinal FROM messages WHERE session_id = (SELECT id FROM sessions WHERE external_session_id = ?) ORDER BY ordinal"
      )
      .all("abc12345-1111-2222-3333-abcdefabcdef")
      .map((row) => ({ ...row })) as Array<{ role: string; text: string; ordinal: number }>;

    assert.equal(captureCount.count, 3);
    assert.equal(second.sourceSummaries.find((summary) => summary.kind === "codex")?.importedCaptures, 1);
    assert.equal(session.raw_capture_count, 2);
    assert.equal(session.message_count, 2);
    assert.deepEqual(messages, [
      { role: "user", text: "hello codex", ordinal: 1 },
      { role: "assistant", text: "updated answer", ordinal: 2 }
    ]);

    db.close();
  });
});

test("runImport imports Codex sessions from the live sessions directory", () => {
  withTempEnv((root) => {
    writeFixtureFiles(root);

    const liveCodexPath = path.join(
      root,
      ".codex",
      "sessions",
      "2026",
      "03",
      "30"
    );
    ensureDirectory(liveCodexPath);

    fs.writeFileSync(
      path.join(liveCodexPath, "rollout-2026-03-30T08-09-36-live1234-1111-2222-3333-abcdefabcdef.jsonl"),
      [
        JSON.stringify({
          timestamp: "2026-03-30T08:09:36.000Z",
          type: "session_meta",
          payload: { id: "live1234-1111-2222-3333-abcdefabcdef", cwd: "/tmp/live-demo" }
        }),
        JSON.stringify({
          timestamp: "2026-03-30T08:10:00.000Z",
          type: "response_item",
          payload: { type: "message", role: "user", content: [{ type: "input_text", text: "recent live codex session" }] }
        })
      ].join("\n")
    );

    const report = runImport();
    const db = new DatabaseSync(report.databasePath);

    const session = db
      .prepare("SELECT title, project_path, updated_at FROM sessions WHERE external_session_id = ?")
      .get("live1234-1111-2222-3333-abcdefabcdef") as
      | { title: string | null; project_path: string | null; updated_at: string | null }
      | undefined;
    const codexSummary = report.sourceSummaries.find((summary) => summary.kind === "codex");

    assert.ok(session);
    assert.equal(session?.title, "recent live codex session");
    assert.equal(session?.project_path, "/tmp/live-demo");
    assert.equal(session?.updated_at, "2026-03-30T08:10:00.000Z");
    assert.equal(codexSummary?.importedCaptures, 2);

    db.close();
  });
});

test("runImport prefers live Codex sessions over archived duplicates", () => {
  withTempEnv((root) => {
    writeFixtureFiles(root);

    const externalSessionId = "live1234-1111-2222-3333-abcdefabcdef";
    const archivedCodexPath = path.join(root, ".codex", "archived_sessions");
    const liveCodexPath = path.join(root, ".codex", "sessions", "2026", "03", "30");
    ensureDirectory(liveCodexPath);

    fs.writeFileSync(
      path.join(archivedCodexPath, `rollout-2026-03-29T07-00-00-${externalSessionId}.jsonl`),
      [
        JSON.stringify({
          timestamp: "2026-03-29T07:00:00.000Z",
          type: "session_meta",
          payload: { id: externalSessionId, cwd: "/tmp/archived-demo" }
        }),
        JSON.stringify({
          timestamp: "2026-03-29T07:01:00.000Z",
          type: "response_item",
          payload: { type: "message", role: "user", content: [{ type: "input_text", text: "stale archived codex session" }] }
        })
      ].join("\n")
    );

    fs.writeFileSync(
      path.join(liveCodexPath, `rollout-2026-03-30T08-09-36-${externalSessionId}.jsonl`),
      [
        JSON.stringify({
          timestamp: "2026-03-30T08:09:36.000Z",
          type: "session_meta",
          payload: { id: externalSessionId, cwd: "/tmp/live-demo" }
        }),
        JSON.stringify({
          timestamp: "2026-03-30T08:10:00.000Z",
          type: "response_item",
          payload: { type: "message", role: "user", content: [{ type: "input_text", text: "recent live codex session" }] }
        })
      ].join("\n")
    );

    const report = runImport();
    const db = new DatabaseSync(report.databasePath);

    const sessions = db
      .prepare("SELECT title, project_path, updated_at FROM sessions WHERE external_session_id = ?")
      .all(externalSessionId) as Array<{ title: string | null; project_path: string | null; updated_at: string | null }>;
    const codexSummary = report.sourceSummaries.find((summary) => summary.kind === "codex");

    assert.equal(sessions.length, 1);
    assert.equal(sessions[0]?.title, "recent live codex session");
    assert.equal(sessions[0]?.project_path, "/tmp/live-demo");
    assert.equal(sessions[0]?.updated_at, "2026-03-30T08:10:00.000Z");
    assert.equal(codexSummary?.importedCaptures, 2);

    db.close();
  });
});

test("runImport imports OpenCode sessions through the fake CLI and keeps failures isolated", () => {
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
            },
            {
              info: {
                id: "msg_assistant",
                role: "assistant",
                parentID: "msg_user",
                time: { created: 1774543194090 },
                providerID: "ollama",
                modelID: "nemotron-cascade-2:30b"
              },
              parts: [
                { id: "part_reasoning", type: "reasoning", text: "Need to inspect the repo first." },
                { id: "part_text", type: "text", text: "I will inspect the repo first." }
              ]
            }
          ]
        })
      }
    );

    const report = runImport();
    const db = new DatabaseSync(report.databasePath);
    const opencodeSummary = report.sourceSummaries.find((summary) => summary.kind === "opencode");
    const session = db
      .prepare("SELECT title, message_count, model, cli_version FROM sessions WHERE external_session_id = 'ses_ok'")
      .get() as { title: string; message_count: number; model: string; cli_version: string };
    const failedCapture = db
      .prepare("SELECT status, error_text FROM captures WHERE external_session_id = 'ses_fail'")
      .get() as { status: string; error_text: string | null };

    assert.equal(opencodeSummary?.discoveredCaptures, 2);
    assert.equal(opencodeSummary?.importedCaptures, 1);
    assert.equal(opencodeSummary?.failedCaptures, 1);
    assert.equal(session.title, "Ship the OpenCode connector");
    assert.equal(session.message_count, 3);
    assert.equal(session.model, "nemotron-cascade-2:30b");
    assert.equal(session.cli_version, "1.3.3");
    assert.equal(failedCapture.status, "failed");
    assert.match(failedCapture.error_text ?? "", /missing export/i);
    assert.equal(report.captures.find((capture) => capture.externalSessionId === "ses_ok")?.status, "imported");
    assert.equal(report.captures.find((capture) => capture.externalSessionId === "ses_fail")?.status, "failed");
    assert.match(report.captures.find((capture) => capture.externalSessionId === "ses_fail")?.errorText ?? "", /missing export/i);

    db.close();
  });
});

test("runImport rolls back partial normalization writes when session replacement fails", () => {
  withTempEnv((root) => {
    writeFixtureFiles(root);
    writeFakeOpenCodeExecutable(
      root,
      [
        {
          id: "ses_tx_fail",
          title: "Duplicate parts",
          directory: "/tmp/opencode-demo",
          version: "1.3.3",
          time_created: 1774543194067,
          time_updated: 1774543475213,
          time_archived: null,
          share_url: null
        }
      ],
      {
        ses_tx_fail: JSON.stringify({
          info: {
            id: "ses_tx_fail",
            directory: "/tmp/opencode-demo",
            title: "Duplicate parts",
            version: "1.3.3",
            time: { created: 1774543194067, updated: 1774543475213 }
          },
          messages: [
            {
              info: {
                id: "msg_user",
                role: "user",
                time: { created: 1774543194080 },
                model: { providerID: "ollama", modelID: "draft-model" }
              },
              parts: [{ id: "part_user_text", type: "text", text: "Trigger a transaction failure" }]
            },
            {
              info: {
                id: "msg_assistant",
                role: "assistant",
                parentID: "msg_user",
                time: { created: 1774543194090 },
                providerID: "openai",
                modelID: "final-model"
              },
              parts: [
                { id: "duplicate_part", type: "text", text: "first assistant response" },
                { id: "duplicate_part", type: "text", text: "second assistant response" }
              ]
            }
          ]
        })
      }
    );

    const report = runImport();
    const db = new DatabaseSync(report.databasePath);
    const failedCapture = db
      .prepare("SELECT id, status, error_text FROM captures WHERE external_session_id = 'ses_tx_fail'")
      .get() as { id: number; status: string; error_text: string | null };
    const captureRecordCount = db
      .prepare("SELECT COUNT(*) AS count FROM capture_records WHERE capture_id = ?")
      .get(failedCapture.id) as { count: number };
    const sessionCount = db
      .prepare("SELECT COUNT(*) AS count FROM sessions WHERE external_session_id = 'ses_tx_fail'")
      .get() as { count: number };
    const failedReport = report.captures.find((capture) => capture.externalSessionId === "ses_tx_fail");
    const opencodeSummary = report.sourceSummaries.find((summary) => summary.kind === "opencode");

    assert.equal(failedCapture.status, "failed");
    assert.match(failedCapture.error_text ?? "", /unique|constraint/i);
    assert.equal(captureRecordCount.count, 0);
    assert.equal(sessionCount.count, 0);
    assert.equal(opencodeSummary?.failedCaptures, 1);
    assert.equal(failedReport?.status, "failed");
    assert.match(failedReport?.errorText ?? "", /unique|constraint/i);

    db.close();
  });
});

test("runImport keeps other connectors importing when OpenCode discovery fails", () => {
  withTempEnv((root) => {
    writeFixtureFiles(root);
    writeFakeOpenCodeExecutable(root, "{not json", {});

    const report = runImport();
    const opencodeSummary = report.sourceSummaries.find((summary) => summary.kind === "opencode");
    const codexSummary = report.sourceSummaries.find((summary) => summary.kind === "codex");
    const claudeSummary = report.sourceSummaries.find((summary) => summary.kind === "claude_code");

    assert.equal(codexSummary?.importedCaptures, 1);
    assert.equal(claudeSummary?.importedCaptures, 1);
    assert.equal(opencodeSummary?.discoveredCaptures, 0);
    assert.equal(opencodeSummary?.importedCaptures, 0);
    assert.equal(opencodeSummary?.failedCaptures, 0);
    assert.equal(report.captures.length, 2);
    assert.match(
      report.failedEntries.find((entry) => entry.sourceKind === "opencode")?.errorText ?? "",
      /OpenCode session discovery failed: OpenCode command returned invalid JSON/
    );
  });
});

test("runImport reuses the same failed capture row when snapshotting the same capture fails again", () => {
  withTempEnv((root) => {
    writeFixtureFiles(root);

    const failingCapture: DiscoveredCapture = {
      sourceKind: "opencode",
      captureKind: "session_export",
      sourcePath: "opencode://session/snapshot-failure",
      externalSessionId: "snapshot-failure",
      sourceModifiedAt: "2026-03-30T08:10:00.000Z",
      sourceSizeBytes: 42,
      metadata: {}
    };

    const connectorIndex = sourceConnectors.findIndex((connector) => connector.kind === "opencode");
    assert.notEqual(connectorIndex, -1);

    const originalConnector = sourceConnectors[connectorIndex] as SourceConnector;
    let attempt = 0;
    sourceConnectors[connectorIndex] = {
      ...originalConnector,
      discoverCaptures: () => [failingCapture],
      snapshotCapture: () => {
        attempt += 1;
        throw new Error(`snapshot exploded ${attempt}`);
      }
    };

    try {
      const first = runImport();
      const second = runImport();
      const db = new DatabaseSync(first.databasePath);
      const rows = db
        .prepare(`
          SELECT c.raw_sha256, c.status, c.error_text
          FROM captures c
          JOIN sources s ON s.id = c.source_id
          WHERE s.kind = 'opencode' AND c.source_path = ?
        `)
        .all(failingCapture.sourcePath) as Array<{ raw_sha256: string; status: string; error_text: string | null }>;
      const secondFailure = second.captures.find((capture) => capture.sourcePath === failingCapture.sourcePath);

      assert.equal(rows.length, 1);
      assert.equal(rows[0]?.status, "failed");
      assert.match(rows[0]?.error_text ?? "", /snapshot exploded 2/);
      assert.equal(secondFailure?.status, "failed");
      assert.match(secondFailure?.errorText ?? "", /snapshot exploded 2/);

      db.close();
    } finally {
      sourceConnectors[connectorIndex] = originalConnector;
    }
  });
});
