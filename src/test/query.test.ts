import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { openDistillDatabase } from "../distill/db";
import { listRecentSessions, getSessionDetail } from "../distill/query";

function withTempDistill<T>(fn: (root: string) => T): T {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "distill-query-"));
  const previous = process.env.DISTILL_HOME;
  process.env.DISTILL_HOME = path.join(tempRoot, ".distill");

  try {
    return fn(tempRoot);
  } finally {
    process.env.DISTILL_HOME = previous;
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

test("query layer derives a fallback title from normalized messages", () => {
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
      ) VALUES (10, 1, 'session-1', NULL, '/tmp/demo', '2026-03-25T12:00:00Z', 2, 1, '{}')
    `).run();

    db.prepare(`
      INSERT INTO messages (
        session_id, ordinal, role, text, text_hash, created_at, message_kind, metadata_json
      ) VALUES
      (10, 1, 'user', 'Please tighten the layout and spacing.', 'a', '2026-03-25T12:00:00Z', 'text', '{}'),
      (10, 2, 'assistant', 'I will update the styles.', 'b', '2026-03-25T12:01:00Z', 'text', '{}')
    `).run();

    const sessions = listRecentSessions();
    const detail = getSessionDetail(10);

    assert.equal(sessions[0]?.title, "Please tighten the layout and spacing.");
    assert.equal(sessions[0]?.preview, "I will update the styles.");
    assert.equal(detail?.title, "Please tighten the layout and spacing.");
    assert.equal(detail?.preview, "I will update the styles.");

    distillDb.close();
  });
});
