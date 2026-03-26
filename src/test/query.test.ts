import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { addSessionTag, ensureDefaultLabels, toggleSessionLabel } from "../distill/curation";
import { openDistillDatabase } from "../distill/db";
import { getSessionDetail, listRecentSessions, searchSessions } from "../distill/query";
import { escapeHtml } from "../shared/html";

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

test("query layer searches normalized sessions through FTS", () => {
  withTempDistill(() => {
    const distillDb = openDistillDatabase();
    const db = distillDb.db;

    db.prepare(`
      INSERT INTO sources (id, kind, display_name, install_status, detected_at, metadata_json)
      VALUES (1, 'codex', 'Codex', 'installed', '2026-03-25T00:00:00Z', '{}')
    `).run();

    db.prepare(`
      INSERT INTO sessions (
        id, source_id, external_session_id, title, project_path, updated_at,
        message_count, raw_capture_count, metadata_json
      ) VALUES (20, 1, 'session-2', 'Search target', '/tmp/demo', '2026-03-25T13:00:00Z', 2, 1, '{}')
    `).run();

    db.prepare(`
      INSERT INTO messages (
        id, session_id, ordinal, role, text, text_hash, created_at, message_kind, metadata_json
      ) VALUES
      (100, 20, 1, 'user', 'Please investigate the analytics regression.', 'aa', '2026-03-25T13:00:00Z', 'text', '{}'),
      (101, 20, 2, 'assistant', 'I will inspect the analytics pipeline and isolate the regression.', 'bb', '2026-03-25T13:01:00Z', 'text', '{}')
    `).run();

    const results = searchSessions("analytics regression");
    assert.equal(results.length, 1);
    assert.equal(results[0]?.sessionId, 20);
    assert.equal(results[0]?.title, "Search target");
    assert.match(results[0]?.snippet ?? "", /analytics/i);

    distillDb.close();
  });
});

test("query layer normalizes punctuation-heavy search input into a safe FTS query", () => {
  withTempDistill(() => {
    const distillDb = openDistillDatabase();
    const db = distillDb.db;

    db.prepare(`
      INSERT INTO sources (id, kind, display_name, install_status, detected_at, metadata_json)
      VALUES (1, 'codex', 'Codex', 'installed', '2026-03-25T00:00:00Z', '{}')
    `).run();

    db.prepare(`
      INSERT INTO sessions (
        id, source_id, external_session_id, title, project_path, updated_at,
        message_count, raw_capture_count, metadata_json
      ) VALUES (21, 1, 'session-2b', 'Quoted target', '/tmp/demo', '2026-03-25T13:30:00Z', 1, 1, '{}')
    `).run();

    db.prepare(`
      INSERT INTO messages (
        id, session_id, ordinal, role, text, text_hash, created_at, message_kind, metadata_json
      ) VALUES
      (102, 21, 1, 'user', 'analytics-regression in beta env', 'cc', '2026-03-25T13:30:00Z', 'text', '{}')
    `).run();

    const results = searchSessions("analytics-regression: \"beta\" env");
    assert.equal(results.length, 1);
    assert.equal(results[0]?.sessionId, 21);

    distillDb.close();
  });
});

test("query layer returns session tags and labels after manual curation", () => {
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
      ) VALUES (30, 1, 'session-3', 'Curated session', '/tmp/demo', '2026-03-25T14:00:00Z', 1, 1, '{}')
    `).run();

    db.close();

    ensureDefaultLabels();
    addSessionTag(30, "distill");
    toggleSessionLabel(30, "train");

    const detail = getSessionDetail(30);
    assert.equal(detail?.tags.length, 1);
    assert.equal(detail?.tags[0]?.name, "distill");
    assert.equal(detail?.labels.length, 1);
    assert.equal(detail?.labels[0]?.name, "train");
  });
});

test("escapeHtml encodes transcript text before renderer interpolation", () => {
  assert.equal(
    escapeHtml(`<script>alert("x")</script> & 'quoted'`),
    "&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &#39;quoted&#39;"
  );
});
