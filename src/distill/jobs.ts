import { openDistillDatabase } from "./db";
import { runImport } from "./import";
import { BackgroundSyncStatus, ImportFailureEntry, ImportReport, ImportSourceSummary } from "../shared/types";

type JobRow = {
  id: number;
  status: string;
  last_error: string | null;
  payload_json: string;
};

type SyncPayload = {
  reason?: string;
  startedAt?: string;
  finishedAt?: string;
  discoveredCaptures?: number;
  importedCaptures?: number;
  skippedCaptures?: number;
  failedCaptures?: number;
  summary?: string;
  sourceSummaries?: ImportSourceSummary[];
  failedEntries?: ImportFailureEntry[];
};

function parsePayload(payloadJson: string): SyncPayload {
  try {
    const parsed = JSON.parse(payloadJson) as SyncPayload;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function toStatus(row: JobRow | undefined): BackgroundSyncStatus {
  if (!row) {
    return {
      state: "idle",
      discoveredCaptures: 0,
      importedCaptures: 0,
      skippedCaptures: 0,
      failedCaptures: 0,
      summary: "Idle"
    };
  }

  const payload = parsePayload(row.payload_json);
  const state = row.status === "running" || row.status === "completed" || row.status === "failed"
    ? row.status
    : "idle";

  return {
    state,
    jobId: row.id,
    reason: payload.reason,
    startedAt: payload.startedAt,
    finishedAt: payload.finishedAt,
    discoveredCaptures: payload.discoveredCaptures ?? 0,
    importedCaptures: payload.importedCaptures ?? 0,
    skippedCaptures: payload.skippedCaptures ?? 0,
    failedCaptures: payload.failedCaptures ?? 0,
    summary: payload.summary ?? (state === "running" ? "Sync running" : "Idle"),
    errorText: row.last_error ?? undefined,
    sourceSummaries: payload.sourceSummaries,
    failedEntries: payload.failedEntries
  };
}

function summarizeImport(report: ImportReport): BackgroundSyncStatus {
  const discoveredCaptures = report.sourceSummaries.reduce((sum, source) => sum + source.discoveredCaptures, 0);
  const importedCaptures = report.sourceSummaries.reduce((sum, source) => sum + source.importedCaptures, 0);
  const skippedCaptures = report.sourceSummaries.reduce((sum, source) => sum + source.skippedCaptures, 0);
  const failedCaptures = report.sourceSummaries.reduce((sum, source) => sum + source.failedCaptures, 0);

  return {
    state: "completed",
    startedAt: report.importedAt,
    finishedAt: report.importedAt,
    discoveredCaptures,
    importedCaptures,
    skippedCaptures,
    failedCaptures,
    summary: `Sync complete: ${importedCaptures} imported, ${skippedCaptures} skipped, ${failedCaptures} failed across ${discoveredCaptures} captures`,
    sourceSummaries: report.sourceSummaries,
    failedEntries: report.failedEntries
  };
}

export function markStaleRunningSyncJobsFailed(): void {
  const distillDb = openDistillDatabase();
  try {
    distillDb.db.prepare(`
      UPDATE jobs
      SET status = 'failed',
          last_error = 'Interrupted before completion',
          updated_at = CURRENT_TIMESTAMP
      WHERE job_type = 'sync_sources'
      AND status = 'running'
    `).run();
  } finally {
    distillDb.close();
  }
}

export function enqueueSourceSyncJob(reason: string): number {
  const distillDb = openDistillDatabase();
  try {
    const row = distillDb.db.prepare(`
      INSERT INTO jobs (
        job_type,
        object_type,
        object_id,
        status,
        run_after,
        payload_json,
        updated_at
      ) VALUES ('sync_sources', 'system', 1, 'pending', CURRENT_TIMESTAMP, ?, CURRENT_TIMESTAMP)
      RETURNING id
    `).get(JSON.stringify({ reason, summary: `Queued sync: ${reason}` })) as { id: number };

    return row.id;
  } finally {
    distillDb.close();
  }
}

export function getBackgroundSyncStatus(): BackgroundSyncStatus {
  const distillDb = openDistillDatabase();
  try {
    const row = distillDb.db.prepare(`
      SELECT id, status, last_error, payload_json
      FROM jobs
      WHERE job_type = 'sync_sources'
      ORDER BY id DESC
      LIMIT 1
    `).get() as JobRow | undefined;

    return toStatus(row);
  } finally {
    distillDb.close();
  }
}

export function runNextSourceSyncJob(): BackgroundSyncStatus {
  const distillDb = openDistillDatabase();
  let jobId: number | undefined;
  let startedAt = new Date().toISOString();
  let reason: string | undefined;

  try {
    const row = distillDb.db.prepare(`
      SELECT id, payload_json
      FROM jobs
      WHERE job_type = 'sync_sources'
      AND status = 'pending'
      AND (run_after IS NULL OR run_after <= CURRENT_TIMESTAMP)
      ORDER BY id ASC
      LIMIT 1
    `).get() as { id: number; payload_json: string } | undefined;

    if (!row) {
      return getBackgroundSyncStatus();
    }

    jobId = row.id;
    const payload = parsePayload(row.payload_json);
    reason = payload.reason;
    startedAt = new Date().toISOString();

    distillDb.db.prepare(`
      UPDATE jobs
      SET status = 'running',
          attempts = attempts + 1,
          payload_json = ?,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(
      JSON.stringify({
        ...payload,
        startedAt,
        summary: `Sync running: ${payload.reason ?? "scheduled"}`
      }),
      row.id
    );
  } finally {
    distillDb.close();
  }

  try {
    const report = runImport();
    const status = summarizeImport(report);

    const completeDb = openDistillDatabase();
    try {
      completeDb.db.prepare(`
        UPDATE jobs
        SET status = 'completed',
            last_error = NULL,
            payload_json = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(
        JSON.stringify({
          startedAt,
          finishedAt: status.finishedAt,
          reason,
          discoveredCaptures: status.discoveredCaptures,
          importedCaptures: status.importedCaptures,
          skippedCaptures: status.skippedCaptures,
          failedCaptures: status.failedCaptures,
          summary: status.summary,
          sourceSummaries: status.sourceSummaries,
          failedEntries: status.failedEntries
        }),
        jobId
      );
    } finally {
      completeDb.close();
    }

    return {
      ...status,
      jobId
    };
  } catch (error) {
    const errorText = error instanceof Error ? error.message : String(error);
    const failedAt = new Date().toISOString();
    const failedDb = openDistillDatabase();

    try {
      failedDb.db.prepare(`
        UPDATE jobs
        SET status = 'failed',
            last_error = ?,
            payload_json = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(
        errorText,
        JSON.stringify({
          startedAt,
          finishedAt: failedAt,
          reason,
          summary: "Sync failed",
          failedEntries: []
        }),
        jobId
      );
    } finally {
      failedDb.close();
    }

    return {
      state: "failed",
      jobId,
      reason,
      startedAt,
      finishedAt: failedAt,
      discoveredCaptures: 0,
      importedCaptures: 0,
      skippedCaptures: 0,
      failedCaptures: 0,
      summary: "Sync failed",
      errorText,
      failedEntries: []
    };
  }
}
