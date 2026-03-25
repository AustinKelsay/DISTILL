import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { ensureDirectory, getTextSha1 } from "./fs";
import { getDistillDatabasePath, getDistillHome } from "./paths";
import {
  DiscoveredSource,
  NormalizedArtifact,
  NormalizedMessage,
  NormalizedSession,
  ParsedCaptureRecord
} from "../shared/types";

type SourceRow = {
  id: number;
};

export type DistillDatabase = {
  db: DatabaseSync;
  databasePath: string;
  close: () => void;
};

function loadSchema(): string {
  const schemaPath = path.resolve(process.cwd(), "schema.sql");
  return fs.readFileSync(schemaPath, "utf8");
}

export function openDistillDatabase(): DistillDatabase {
  const distillHome = getDistillHome();
  ensureDirectory(distillHome);
  ensureDirectory(path.join(distillHome, "blobs"));
  ensureDirectory(path.join(distillHome, "imports"));
  ensureDirectory(path.join(distillHome, "exports"));

  const databasePath = getDistillDatabasePath();
  const db = new DatabaseSync(databasePath);
  db.exec(loadSchema());
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");

  return {
    db,
    databasePath,
    close: () => db.close()
  };
}

export function upsertSource(db: DatabaseSync, source: DiscoveredSource): number {
  const statement = db.prepare(`
    INSERT INTO sources (
      kind,
      display_name,
      executable_path,
      data_root,
      install_status,
      detected_at,
      metadata_json,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(kind) DO UPDATE SET
      display_name = excluded.display_name,
      executable_path = excluded.executable_path,
      data_root = excluded.data_root,
      install_status = excluded.install_status,
      detected_at = excluded.detected_at,
      metadata_json = excluded.metadata_json,
      updated_at = CURRENT_TIMESTAMP
    RETURNING id
  `);

  const row = statement.get(
    source.kind,
    source.displayName,
    source.executablePath ?? null,
    source.dataRoot ?? null,
    source.installStatus,
    new Date().toISOString(),
    JSON.stringify({
      checks: source.checks,
      ...source.metadata
    })
  ) as SourceRow;

  return row.id;
}

export function hasCapture(
  db: DatabaseSync,
  sourceId: number,
  sourcePath: string,
  rawSha256: string
): boolean {
  const row = db
    .prepare(
      "SELECT 1 FROM captures WHERE source_id = ? AND source_path = ? AND raw_sha256 = ? LIMIT 1"
    )
    .get(sourceId, sourcePath, rawSha256) as { 1: number } | undefined;

  return Boolean(row);
}

export function findCapture(
  db: DatabaseSync,
  sourceId: number,
  sourcePath: string,
  rawSha256: string
): { id: number; status: string } | undefined {
  return db
    .prepare(
      "SELECT id, status FROM captures WHERE source_id = ? AND source_path = ? AND raw_sha256 = ? LIMIT 1"
    )
    .get(sourceId, sourcePath, rawSha256) as { id: number; status: string } | undefined;
}

export function updateCaptureStatus(db: DatabaseSync, captureId: number, status: string): void {
  db.prepare("UPDATE captures SET status = ? WHERE id = ?").run(status, captureId);
}

export function insertCaptureRecords(
  db: DatabaseSync,
  captureId: number,
  records: ParsedCaptureRecord[]
): Map<number, number> {
  db.prepare("DELETE FROM capture_records WHERE capture_id = ?").run(captureId);

  const statement = db.prepare(`
    INSERT INTO capture_records (
      capture_id,
      line_no,
      record_type,
      record_timestamp,
      provider_message_id,
      parent_provider_message_id,
      role,
      is_meta,
      content_text,
      content_json,
      metadata_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    RETURNING id
  `);

  const lineToRecordId = new Map<number, number>();

  for (const record of records) {
    const row = statement.get(
      captureId,
      record.lineNo,
      record.recordType,
      record.recordTimestamp ?? null,
      record.providerMessageId ?? null,
      record.parentProviderMessageId ?? null,
      record.role ?? null,
      record.isMeta ? 1 : 0,
      record.contentText ?? null,
      JSON.stringify(record.contentJson),
      JSON.stringify(record.metadata)
    ) as { id: number };

    lineToRecordId.set(record.lineNo, row.id);
  }

  return lineToRecordId;
}

export function upsertSession(
  db: DatabaseSync,
  sourceId: number,
  session: NormalizedSession,
  messageCount: number
): number {
  const statement = db.prepare(`
    INSERT INTO sessions (
      source_id,
      external_session_id,
      title,
      project_path,
      source_url,
      model,
      model_provider,
      cli_version,
      git_branch,
      started_at,
      updated_at,
      message_count,
      raw_capture_count,
      summary,
      metadata_json,
      updated_recorded_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(source_id, external_session_id) DO UPDATE SET
      title = COALESCE(excluded.title, sessions.title),
      project_path = COALESCE(excluded.project_path, sessions.project_path),
      source_url = COALESCE(excluded.source_url, sessions.source_url),
      model = COALESCE(excluded.model, sessions.model),
      model_provider = COALESCE(excluded.model_provider, sessions.model_provider),
      cli_version = COALESCE(excluded.cli_version, sessions.cli_version),
      git_branch = COALESCE(excluded.git_branch, sessions.git_branch),
      started_at = COALESCE(sessions.started_at, excluded.started_at),
      updated_at = COALESCE(excluded.updated_at, sessions.updated_at),
      message_count = excluded.message_count,
      raw_capture_count = sessions.raw_capture_count + 1,
      summary = COALESCE(excluded.summary, sessions.summary),
      metadata_json = excluded.metadata_json,
      updated_recorded_at = CURRENT_TIMESTAMP
    RETURNING id
  `);

  const row = statement.get(
    sourceId,
    session.externalSessionId,
    session.title ?? null,
    session.projectPath ?? null,
    session.sourceUrl ?? null,
    session.model ?? null,
    session.modelProvider ?? null,
    session.cliVersion ?? null,
    session.gitBranch ?? null,
    session.startedAt ?? null,
    session.updatedAt ?? null,
    messageCount,
    session.summary ?? null,
    JSON.stringify(session.metadata)
  ) as { id: number };

  return row.id;
}

export function replaceSessionMessages(
  db: DatabaseSync,
  sessionId: number,
  messages: NormalizedMessage[],
  captureRecordIdsByLine: Map<number, number>
): void {
  db.prepare("DELETE FROM messages WHERE session_id = ?").run(sessionId);

  const insert = db.prepare(`
    INSERT INTO messages (
      session_id,
      capture_record_id,
      external_message_id,
      parent_external_message_id,
      ordinal,
      role,
      text,
      text_hash,
      created_at,
      message_kind,
      metadata_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  messages.forEach((message, index) => {
    insert.run(
      sessionId,
      captureRecordIdsByLine.get(message.sourceLineNo) ?? null,
      message.externalMessageId ?? null,
      message.parentExternalMessageId ?? null,
      index + 1,
      message.role,
      message.text,
      getTextSha1(message.text),
      message.createdAt ?? null,
      message.messageKind,
      JSON.stringify(message.metadata)
    );
  });
}

export function replaceSessionArtifacts(
  db: DatabaseSync,
  sessionId: number,
  artifacts: NormalizedArtifact[],
  captureRecordIdsByLine: Map<number, number>
): void {
  db.prepare("DELETE FROM artifacts WHERE session_id = ?").run(sessionId);

  const insert = db.prepare(`
    INSERT INTO artifacts (
      session_id,
      capture_record_id,
      kind,
      mime_type,
      metadata_json
    ) VALUES (?, ?, ?, ?, ?)
  `);

  for (const artifact of artifacts) {
    insert.run(
      sessionId,
      captureRecordIdsByLine.get(artifact.sourceLineNo) ?? null,
      artifact.kind,
      artifact.mimeType ?? null,
      JSON.stringify(artifact.payload)
    );
  }
}
