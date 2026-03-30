import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { ensureDefaultLabels, toggleSessionLabel } from "../distill/curation";
import { openDistillDatabase } from "../distill/db";
import { exportSessionsByLabel } from "../distill/export";
import { getLogsPageData } from "../distill/logs";

function withTempDistill<T>(fn: (root: string) => T): T {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "distill-logs-"));
  const previous = process.env.DISTILL_HOME;
  process.env.DISTILL_HOME = path.join(tempRoot, ".distill");

  try {
    return fn(tempRoot);
  } finally {
    process.env.DISTILL_HOME = previous;
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

test("getLogsPageData normalizes mixed sync and export entries", () => {
  withTempDistill(() => {
    const distillDb = openDistillDatabase();
    const db = distillDb.db;

    db.prepare(`
      INSERT INTO jobs (
        id, job_type, object_type, object_id, status, attempts, run_after, last_error, payload_json, created_at, updated_at
      ) VALUES
      (1, 'sync_sources', 'system', 1, 'completed', 1, CURRENT_TIMESTAMP, NULL, '{}', '2026-03-25T10:00:00Z', '2026-03-25T10:05:00Z'),
      (2, 'sync_sources', 'system', 1, 'failed', 1, CURRENT_TIMESTAMP, 'connector exploded', ?, '2026-03-26T09:00:00Z', '2026-03-26T09:02:00Z')
    `).run(
      JSON.stringify({
        reason: "manual",
        startedAt: "2026-03-26T09:00:00Z",
        finishedAt: "2026-03-26T09:02:00Z",
        discoveredCaptures: 4,
        importedCaptures: 3,
        skippedCaptures: 0,
        failedCaptures: 1,
        summary: "Sync failed",
        failedEntries: [
          {
            sourceKind: "codex",
            sourcePath: "/tmp/demo.jsonl",
            errorText: "connector exploded"
          }
        ]
      })
    );

    db.prepare(`
      INSERT INTO exports (
        id, export_type, label_filter, output_path, record_count, metadata_json, created_at
      ) VALUES (10, 'jsonl', 'train', '/tmp/train.jsonl', 7, ?, '2026-03-27T10:00:00Z')
    `).run(JSON.stringify({ exportedAt: "2026-03-27T10:00:00Z" }));

    distillDb.close();

    const logs = getLogsPageData();

    assert.equal(logs.counts.total, 3);
    assert.equal(logs.counts.errors, 1);
    assert.equal(logs.entries[0]?.kind, "export");
    assert.equal(logs.entries[1]?.kind, "sync");
    assert.equal(logs.entries[1]?.status, "failed");
    assert.equal(logs.entries[1]?.details?.failedEntries?.[0]?.sourcePath, "/tmp/demo.jsonl");
    assert.equal(logs.entries[2]?.summary, "Sync completed");
  });
});

test("exportSessionsByLabel entries appear in the logs feed", () => {
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
    toggleSessionLabel(40, "train");

    const report = exportSessionsByLabel("train");
    const logs = getLogsPageData();
    const exportEntry = logs.entries.find((entry) => entry.kind === "export");

    assert.ok(exportEntry);
    assert.equal(exportEntry?.details?.label, "train");
    assert.equal(exportEntry?.details?.outputPath, report.outputPath);
    assert.equal(exportEntry?.metrics?.recordCount, 1);
  });
});
