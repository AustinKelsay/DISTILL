import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { addSessionTag, ensureDefaultLabels, toggleSessionLabel } from "../distill/curation";
import { openDistillDatabase } from "../distill/db";
import { exportSessionsByLabel } from "../distill/export";

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
        id, source_id, external_session_id, title, project_path, updated_at,
        message_count, raw_capture_count, metadata_json
      ) VALUES (40, 1, 'session-export', 'Export me', '/tmp/demo', '2026-03-25T15:00:00Z', 2, 1, '{}')
    `).run();

    db.prepare(`
      INSERT INTO messages (
        id, session_id, ordinal, role, text, text_hash, created_at, message_kind, metadata_json
      ) VALUES
      (200, 40, 1, 'user', 'Draft the launch copy.', 'aa', '2026-03-25T15:00:00Z', 'text', '{}'),
      (201, 40, 2, 'assistant', 'Here is a tighter launch draft.', 'bb', '2026-03-25T15:01:00Z', 'text', '{}')
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
    assert.deepEqual(payload.tags, ["marketing"]);
    assert.deepEqual(payload.labels, ["train"]);
    assert.equal(payload.messages.length, 2);
    assert.equal(payload.turn_pairs.length, 1);
    assert.equal(payload.turn_pairs[0].assistant, "Here is a tighter launch draft.");
    assert.deepEqual(activityEvents.map((row) => row.event_type), ["export_written"]);
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
