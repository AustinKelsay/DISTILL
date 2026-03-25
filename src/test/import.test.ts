import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { runImport } from "../distill/import";
import { ensureDirectory } from "../distill/fs";

function withTempEnv<T>(fn: (root: string) => T): T {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "distill-test-"));
  const previous = {
    DISTILL_HOME: process.env.DISTILL_HOME,
    CODEX_HOME: process.env.CODEX_HOME,
    CLAUDE_HOME: process.env.CLAUDE_HOME
  };

  process.env.DISTILL_HOME = path.join(tempRoot, ".distill");
  process.env.CODEX_HOME = path.join(tempRoot, ".codex");
  process.env.CLAUDE_HOME = path.join(tempRoot, ".claude");

  try {
    return fn(tempRoot);
  } finally {
    process.env.DISTILL_HOME = previous.DISTILL_HOME;
    process.env.CODEX_HOME = previous.CODEX_HOME;
    process.env.CLAUDE_HOME = previous.CLAUDE_HOME;
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

function writeFixtureFiles(root: string): void {
  const codexPath = path.join(root, ".codex", "archived_sessions");
  const claudePath = path.join(root, ".claude", "projects", "demo-project");

  ensureDirectory(codexPath);
  ensureDirectory(claudePath);

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

    assert.equal(sourceCount.count, 2);
    assert.equal(captureCount.count, 2);
    assert.ok(captureRecordCount.count >= 2);
    assert.equal(sessionCount.count, 2);
    assert.ok(messageCount.count >= 2);
    assert.equal(activityCount.count, 2);
    assert.equal(report.sourceSummaries.length, 2);

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
    assert.equal(second.sourceSummaries.every((summary) => summary.skippedCaptures >= 1), true);

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
