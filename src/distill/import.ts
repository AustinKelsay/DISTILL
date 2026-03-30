import { DatabaseSync } from "node:sqlite";
import { sourceConnectors } from "../connectors";
import { CaptureSnapshot, SourceConnector } from "../connectors/types";
import { getTextSha1, getTextSha256 } from "./fs";
import {
  findCapture,
  insertCaptureRecords,
  openDistillDatabase,
  replaceSessionArtifacts,
  replaceSessionMessages,
  updateCaptureFailure,
  updateCaptureStatus,
  upsertSession,
  upsertSource
} from "./db";
import { getDistillHome } from "./paths";
import {
  DiscoveredCapture,
  DiscoveredSource,
  ImportFailureEntry,
  ImportReport,
  ImportedCapture
} from "../shared/types";

const PARSER_VERSION = "v0";

function insertCapture(
  db: DatabaseSync,
  sourceId: number,
  capture: DiscoveredCapture,
  snapshot: Pick<CaptureSnapshot, "rawSha256" | "sourceModifiedAt" | "sourceSizeBytes">
): number {
  const result = db
    .prepare(`
      INSERT INTO captures (
        source_id,
        capture_kind,
        external_session_id,
        source_path,
        source_modified_at,
        source_size_bytes,
        raw_sha256,
        raw_payload_json,
        parser_version,
        status,
        captured_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      RETURNING id
    `)
    .get(
      sourceId,
      capture.captureKind,
      capture.externalSessionId ?? null,
      capture.sourcePath,
      snapshot.sourceModifiedAt ?? capture.sourceModifiedAt ?? null,
      snapshot.sourceSizeBytes ?? capture.sourceSizeBytes ?? null,
      snapshot.rawSha256,
      JSON.stringify({
        sourceKind: capture.sourceKind,
        metadata: capture.metadata
      }),
      PARSER_VERSION,
      "captured",
      new Date().toISOString()
    ) as { id: number };

  db.prepare(`
      INSERT INTO activity_events (
        event_type,
        object_type,
        object_id,
        payload_json
      ) VALUES (?, ?, ?, ?)
    `).run(
    "captured",
    "capture",
    result.id,
    JSON.stringify({
      sourceKind: capture.sourceKind,
      sourcePath: capture.sourcePath,
      externalSessionId: capture.externalSessionId ?? null
    })
  );

  return result.id;
}

function importSourceCaptures(
  db: DatabaseSync,
  connector: SourceConnector,
  source: DiscoveredSource,
  sourceId: number,
  captures: DiscoveredCapture[]
): {
  importedCaptures: number;
  skippedCaptures: number;
  failedCaptures: number;
  captures: ImportedCapture[];
  failedEntries: ImportFailureEntry[];
} {
  let importedCaptures = 0;
  let skippedCaptures = 0;
  let failedCaptures = 0;
  const imported: ImportedCapture[] = [];
  const failedEntries: ImportFailureEntry[] = [];

  for (const capture of captures) {
    let snapshot: CaptureSnapshot;

    try {
      snapshot = connector.snapshotCapture(capture);
    } catch (error) {
      const errorText = error instanceof Error ? error.message : String(error);
      const failedSnapshot = {
        rawSha256: getTextSha256(`snapshot-failure:${capture.sourcePath}:${capture.sourceModifiedAt ?? ""}:${errorText}`),
        sourceModifiedAt: capture.sourceModifiedAt,
        sourceSizeBytes: capture.sourceSizeBytes
      };
      const captureId =
        findCapture(db, sourceId, capture.sourcePath, failedSnapshot.rawSha256)?.id
        ?? insertCapture(db, sourceId, capture, failedSnapshot);
      updateCaptureFailure(db, captureId, errorText);
      imported.push({
        sourcePath: capture.sourcePath,
        externalSessionId: capture.externalSessionId,
        rawSha256: failedSnapshot.rawSha256,
        skipped: false,
        status: "failed",
        errorText
      });
      failedEntries.push({
        sourceKind: source.kind,
        sourcePath: capture.sourcePath,
        errorText
      });
      failedCaptures += 1;
      continue;
    }

    const existingCapture = findCapture(db, sourceId, capture.sourcePath, snapshot.rawSha256);

    if (existingCapture && existingCapture.status === "normalized") {
      skippedCaptures += 1;
      imported.push({
        sourcePath: capture.sourcePath,
        externalSessionId: capture.externalSessionId,
        rawSha256: snapshot.rawSha256,
        skipped: true,
        status: "skipped"
      });
      continue;
    }

    const captureId = existingCapture?.id ?? insertCapture(db, sourceId, capture, snapshot);

    try {
      const parsedCapture = connector.parseCapture(capture, snapshot);
      let transactionOpen = false;

      try {
        db.exec("BEGIN");
        transactionOpen = true;

        const captureRecordIdsByLine = insertCaptureRecords(db, captureId, parsedCapture.rawRecords);
        const sessionId = upsertSession(db, sourceId, parsedCapture.session, parsedCapture.messages.length);

        replaceSessionMessages(
          db,
          sessionId,
          parsedCapture.messages.map((message) => ({
            ...message,
            metadata: {
              ...message.metadata,
              textHash: getTextSha1(message.text)
            }
          })),
          captureRecordIdsByLine
        );
        replaceSessionArtifacts(db, sessionId, parsedCapture.artifacts, captureRecordIdsByLine);
        updateCaptureStatus(db, captureId, "normalized");
        db.exec("COMMIT");
        transactionOpen = false;
      } catch (error) {
        if (transactionOpen) {
          try {
            db.exec("ROLLBACK");
          } catch {
            // Preserve the original normalization error below.
          }
        }

        throw error;
      }
    } catch (error) {
      const errorText = error instanceof Error ? error.message : String(error);
      updateCaptureFailure(db, captureId, errorText);
      imported.push({
        sourcePath: capture.sourcePath,
        externalSessionId: capture.externalSessionId,
        rawSha256: snapshot.rawSha256,
        skipped: false,
        status: "failed",
        errorText
      });
      failedEntries.push({
        sourceKind: source.kind,
        sourcePath: capture.sourcePath,
        errorText
      });
      failedCaptures += 1;
      continue;
    }

    importedCaptures += 1;
    imported.push({
      sourcePath: capture.sourcePath,
      externalSessionId: capture.externalSessionId,
      rawSha256: snapshot.rawSha256,
      skipped: false,
      status: "imported"
    });
  }

  return {
    importedCaptures,
    skippedCaptures,
    failedCaptures,
    captures: imported,
    failedEntries
  };
}

export function runImport(): ImportReport {
  const distillDb = openDistillDatabase();
  try {
    const sourcesWithCaptures: Array<{
      connector: SourceConnector;
      source: DiscoveredSource;
      captures: DiscoveredCapture[];
    }> = sourceConnectors.map((connector) => ({
      connector,
      source: connector.detect(),
      captures: connector.discoverCaptures().sort((a, b) =>
          (a.sourceModifiedAt ?? "").localeCompare(b.sourceModifiedAt ?? "")
        )
    }));

    const sourceSummaries: ImportReport["sourceSummaries"] = [];
    const failedEntries: ImportReport["failedEntries"] = [];
    const captures: ImportedCapture[] = [];

    for (const entry of sourcesWithCaptures) {
      const sourceId = upsertSource(distillDb.db, entry.source);
      const result = importSourceCaptures(distillDb.db, entry.connector, entry.source, sourceId, entry.captures);

      sourceSummaries.push({
        kind: entry.source.kind,
        discoveredCaptures: entry.captures.length,
        importedCaptures: result.importedCaptures,
        skippedCaptures: result.skippedCaptures,
        failedCaptures: result.failedCaptures
      });

      captures.push(...result.captures);
      failedEntries.push(...result.failedEntries);
    }

    return {
      importedAt: new Date().toISOString(),
      databasePath: distillDb.databasePath,
      distillHome: getDistillHome(),
      sourceSummaries,
      failedEntries,
      captures
    };
  } finally {
    distillDb.close();
  }
}
