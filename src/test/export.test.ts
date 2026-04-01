import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { addSessionTag, ensureDefaultLabels, toggleSessionLabel } from "../distill/curation";
import { openDistillDatabase } from "../distill/db";
import { ensureDirectory } from "../distill/fs";
import { exportSessionsByLabel } from "../distill/export";
import { runImport } from "../distill/import";

function withTempDistill<T>(fn: (root: string) => T): T {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "distill-export-"));
  const previous = process.env.DISTILL_HOME;
  process.env.DISTILL_HOME = path.join(tempRoot, ".distill");

  try {
    return fn(tempRoot);
  } finally {
    process.env.DISTILL_HOME = previous;
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

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

function withTempImportEnv<T>(fn: (root: string) => T): T {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "distill-export-import-"));
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

function writeFakeOpenCodeExecutable(
  root: string,
  sessions: Array<Record<string, unknown>>,
  exportsBySession: Record<string, string>
): void {
  const binDir = path.join(root, ".bin");
  const opencodeDbPath = path.join(root, ".local", "share", "opencode", "opencode.db");
  const dbQueryPath = path.join(root, "opencode-sessions.json");
  const exportDir = path.join(root, "opencode-exports");
  const opencodeConfigDir = path.join(root, ".config", "opencode");

  ensureDirectory(binDir);
  ensureDirectory(path.dirname(opencodeDbPath));
  ensureDirectory(exportDir);
  ensureDirectory(opencodeConfigDir);

  fs.writeFileSync(opencodeDbPath, "");
  fs.writeFileSync(dbQueryPath, JSON.stringify(sessions, null, 2));
  fs.writeFileSync(path.join(opencodeConfigDir, "opencode.json"), "{}\n");

  for (const [sessionId, output] of Object.entries(exportsBySession)) {
    fs.writeFileSync(path.join(exportDir, `${sessionId}.json`), output);
  }

  const scriptPath = path.join(binDir, "opencode");
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

  process.stdout.write(fs.readFileSync(file, "utf8"));
  process.exit(0);
}

process.stderr.write("unsupported fake opencode command\\n");
process.exit(1);
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

test("exportSessionsByLabel writes labeled sessions to JSONL", () => {
  withTempDistill(() => {
    const distillDb = openDistillDatabase();
    const db = distillDb.db;

    db.prepare(`
      INSERT INTO sources (id, kind, display_name, install_status, detected_at, metadata_json)
      VALUES (1, 'claude_code', 'Claude Code', 'installed', '2026-03-25T00:00:00Z', '{}')
    `).run();

    db.prepare(`
      INSERT INTO sessions (
        id, source_id, external_session_id, title, project_path, source_url, started_at, updated_at,
        message_count, raw_capture_count, summary, metadata_json
      ) VALUES (
        40, 1, 'session-export', 'Export me', '/tmp/demo', 'https://example.test/export/40',
        '2026-03-25T14:59:00Z', '2026-03-25T15:00:00Z', 2, 1,
        'Projection-faithful export summary.',
        '{"capturePath":"/tmp/demo/session.jsonl","externalSessionIdProvenance":{"kind":"source"}}'
      )
    `).run();

    db.prepare(`
      INSERT INTO messages (
        id, session_id, ordinal, role, text, text_hash, created_at, message_kind, metadata_json
      ) VALUES
      (200, 40, 1, 'user', 'Draft the launch copy.', 'aa', '2026-03-25T15:00:00Z', 'text', '{"partType":"text"}'),
      (201, 40, 2, 'assistant', 'Here is a tighter launch draft.', 'bb', '2026-03-25T15:01:00Z', 'text', '{"partType":"text","reviewed":true}')
    `).run();

    distillDb.close();

    ensureDefaultLabels();
    addSessionTag(40, "marketing");
    toggleSessionLabel(40, "train");

    const report = exportSessionsByLabel("train");
    const lines = fs.readFileSync(report.outputPath, "utf8").trim().split("\n");
    const payload = JSON.parse(lines[0] ?? "{}");
    const verifyDb = openDistillDatabase();
    const activityEvents = verifyDb.db
      .prepare("SELECT event_type FROM activity_events ORDER BY id ASC")
      .all() as Array<{ event_type: string }>;
    verifyDb.close();

    assert.equal(report.recordCount, 1);
    assert.equal(lines.length, 1);
    assert.equal(payload.title, "Export me");
    assert.equal(payload.source_url, "https://example.test/export/40");
    assert.equal(payload.summary, "Projection-faithful export summary.");
    assert.deepEqual(payload.metadata, {
      capturePath: "/tmp/demo/session.jsonl",
      externalSessionIdProvenance: {
        kind: "source"
      }
    });
    assert.deepEqual(payload.labels, ["train"]);
    assert.deepEqual(payload.tags, ["marketing"]);
    assert.equal(payload.messages.length, 2);
    assert.equal(payload.messages[0].message_kind, "text");
    assert.deepEqual(payload.messages[0].metadata, { partType: "text" });
    assert.deepEqual(payload.messages[1].metadata, { partType: "text", reviewed: true });
    assert.equal(payload.turn_pairs.length, 1);
    assert.equal(payload.turn_pairs[0].assistant, "Here is a tighter launch draft.");
    assert.deepEqual(
      activityEvents.filter((row) => row.event_type === "export_written").map((row) => row.event_type),
      ["export_written"]
    );
  });
});

test("exportSessionsByLabel preserves imported OpenCode meta messages and projection metadata", () => {
  withTempImportEnv((root) => {
    writeFakeOpenCodeExecutable(
      root,
      [
        {
          id: "ses_meta",
          title: "New session - 2026-03-26T19:15:49.354Z",
          directory: "/tmp/opencode-demo",
          version: "1.3.3",
          time_created: 1774543194067,
          time_updated: 1774543475213,
          time_archived: null,
          share_url: "https://example.test/share/ses_meta"
        }
      ],
      {
        ses_meta: JSON.stringify({
          info: {
            id: "ses_meta",
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
                time: { created: 1774543195090, updated: 1774543475213 },
                modelID: "nemotron-cascade-2:30b",
                providerID: "ollama"
              },
              parts: [
                { id: "part_reasoning", type: "reasoning", text: "Inspecting the repository before editing." },
                { id: "part_assistant_text", type: "text", text: "I will update the connector." }
              ]
            }
          ]
        })
      }
    );

    runImport();

    const distillDb = openDistillDatabase();
    const session = distillDb.db
      .prepare("SELECT id FROM sessions WHERE external_session_id = 'ses_meta' LIMIT 1")
      .get() as { id: number } | undefined;
    distillDb.close();

    assert.ok(session);

    ensureDefaultLabels();
    toggleSessionLabel(session!.id, "train");

    const report = exportSessionsByLabel("train");
    const payload = JSON.parse(fs.readFileSync(report.outputPath, "utf8").trim() || "{}");

    assert.equal(payload.external_session_id, "ses_meta");
    assert.equal(payload.source, "opencode");
    assert.equal(payload.source_url, "https://example.test/share/ses_meta");
    assert.equal(payload.messages.some((message: { message_kind?: string }) => message.message_kind === "meta"), true);
    assert.equal(payload.messages[1].ordinal, 2);
    assert.equal(payload.messages[1].role, "assistant");
    assert.equal(payload.messages[1].text, "Inspecting the repository before editing.");
    assert.equal(payload.messages[1].created_at, "2026-03-26T16:39:55.090Z");
    assert.equal(payload.messages[1].message_kind, "meta");
    assert.deepEqual(payload.messages[1].metadata, {
      partType: "reasoning"
    });
    assert.equal(payload.messages[2].message_kind, "text");
    assert.deepEqual(payload.metadata.externalSessionIdProvenance, {
      kind: "source"
    });
  });
});

test("exportSessionsByLabel trims and normalizes the requested label", () => {
  withTempDistill(() => {
    const distillDb = openDistillDatabase();
    const db = distillDb.db;

    db.prepare(`
      INSERT INTO sources (id, kind, display_name, install_status, detected_at, metadata_json)
      VALUES (1, 'claude_code', 'Claude Code', 'installed', '2026-03-25T00:00:00Z', '{}')
    `).run();

    db.prepare(`
      INSERT INTO sessions (
        id, source_id, external_session_id, title, project_path, updated_at,
        message_count, raw_capture_count, metadata_json
      ) VALUES (41, 1, 'session-export-2', 'Normalize me', '/tmp/demo', '2026-03-25T16:00:00Z', 1, 1, '{}')
    `).run();

    distillDb.close();

    ensureDefaultLabels();
    toggleSessionLabel(41, "train");

    const report = exportSessionsByLabel("  TRAIN  ");
    assert.equal(report.label, "train");
    assert.equal(report.recordCount, 1);
    assert.match(path.basename(report.outputPath), /^train-sessions-/);
  });
});

test("exportSessionsByLabel cleans up temp files when the export transaction fails", () => {
  withTempDistill((root) => {
    const distillDb = openDistillDatabase();
    const db = distillDb.db;

    db.prepare(`
      INSERT INTO sources (id, kind, display_name, install_status, detected_at, metadata_json)
      VALUES (1, 'claude_code', 'Claude Code', 'installed', '2026-03-25T00:00:00Z', '{}')
    `).run();

    db.prepare(`
      INSERT INTO sessions (
        id, source_id, external_session_id, title, project_path, updated_at,
        message_count, raw_capture_count, metadata_json
      ) VALUES (42, 1, 'session-export-3', 'Rollback me', '/tmp/demo', '2026-03-25T17:00:00Z', 1, 1, '{}')
    `).run();

    distillDb.close();

    ensureDefaultLabels();
    toggleSessionLabel(42, "train");

    const originalExec = DatabaseSync.prototype.exec;
    let failCommit = true;

    DatabaseSync.prototype.exec = function patchedExec(sql: string): unknown {
      if (failCommit && sql === "COMMIT") {
        failCommit = false;
        throw new Error("commit failed");
      }

      return originalExec.call(this, sql);
    };

    try {
      assert.throws(() => exportSessionsByLabel("train"), /commit failed/);
    } finally {
      DatabaseSync.prototype.exec = originalExec;
    }

    const exportsDir = path.join(root, ".distill", "exports");
    const exportFiles = fs.readdirSync(exportsDir);

    assert.deepEqual(exportFiles, []);

    const verifyDb = openDistillDatabase();
    const exportCount = verifyDb.db.prepare("SELECT COUNT(*) AS count FROM exports").get() as { count: number };
    verifyDb.close();

    assert.equal(exportCount.count, 0);
  });
});
