import fs from "node:fs";
import path from "node:path";
import { ensureDefaultLabels } from "./curation";
import { openDistillDatabase } from "./db";
import { ensureDirectory } from "./fs";
import { getDistillHome } from "./paths";
import { ExportReport } from "../shared/types";

type ExportSessionRow = {
  id: number;
  source_kind: string;
  external_session_id: string;
  title: string | null;
  project_path: string | null;
  updated_at: string | null;
  started_at: string | null;
  model: string | null;
  git_branch: string | null;
};

type ExportMessageRow = {
  ordinal: number;
  role: string;
  text: string;
  created_at: string | null;
};

function makeSafeStem(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9_-]+/g, "-");
}

function buildTurnPairs(messages: ExportMessageRow[]): Array<{
  user: string;
  assistant: string;
}> {
  const pairs: Array<{ user: string; assistant: string }> = [];
  let pendingUser: string | null = null;

  for (const message of messages) {
    if (message.role === "user") {
      pendingUser = message.text;
      continue;
    }

    if (message.role === "assistant" && pendingUser) {
      pairs.push({
        user: pendingUser,
        assistant: message.text
      });
      pendingUser = null;
    }
  }

  return pairs;
}

export function exportSessionsByLabel(label: string): ExportReport {
  const normalizedLabel = label.trim().toLowerCase();
  if (!normalizedLabel) {
    throw new Error("Label is required for export");
  }

  ensureDefaultLabels();

  const exportedAt = new Date().toISOString();
  const distillHome = getDistillHome();
  const exportsDir = path.join(distillHome, "exports");
  ensureDirectory(exportsDir);

  const timestampStem = exportedAt.replace(/[:.]/g, "-");
  const outputPath = path.join(exportsDir, `${makeSafeStem(normalizedLabel)}-sessions-${timestampStem}.jsonl`);
  const tempOutputPath = `${outputPath}.tmp`;

  const distillDb = openDistillDatabase();
  try {
    const sessionRows = distillDb.db
      .prepare(`
        SELECT
          s.id,
          so.kind AS source_kind,
          s.external_session_id,
          s.title,
          s.project_path,
          s.updated_at,
          s.started_at,
          s.model,
          s.git_branch
        FROM sessions s
        JOIN sources so ON so.id = s.source_id
        JOIN label_assignments la ON la.object_type = 'session' AND la.object_id = s.id
        JOIN labels l ON l.id = la.label_id
        WHERE l.name = ?
        ORDER BY COALESCE(s.updated_at, s.updated_recorded_at) DESC
      `)
      .all(normalizedLabel) as ExportSessionRow[];

    const lines: string[] = [];

    for (const session of sessionRows) {
      const messages = distillDb.db
        .prepare(`
          SELECT ordinal, role, text, created_at
          FROM messages
          WHERE session_id = ?
          ORDER BY ordinal ASC
        `)
        .all(session.id) as ExportMessageRow[];

      const tags = distillDb.db
        .prepare(`
          SELECT t.name
          FROM tag_assignments ta
          JOIN tags t ON t.id = ta.tag_id
          WHERE ta.object_type = 'session'
          AND ta.object_id = ?
          ORDER BY t.name ASC
        `)
        .all(session.id) as Array<{ name: string }>;

      const labels = distillDb.db
        .prepare(`
          SELECT l.name
          FROM label_assignments la
          JOIN labels l ON l.id = la.label_id
          WHERE la.object_type = 'session'
          AND la.object_id = ?
          ORDER BY l.name ASC
        `)
        .all(session.id) as Array<{ name: string }>;

      lines.push(
        JSON.stringify({
          exported_at: exportedAt,
          source: session.source_kind,
          external_session_id: session.external_session_id,
          title: session.title,
          project_path: session.project_path,
          updated_at: session.updated_at,
          started_at: session.started_at,
          model: session.model,
          git_branch: session.git_branch,
          tags: tags.map((tag) => tag.name),
          labels: labels.map((entry) => entry.name),
          messages: messages.map((message) => ({
            ordinal: message.ordinal,
            role: message.role,
            text: message.text,
            created_at: message.created_at
          })),
          turn_pairs: buildTurnPairs(messages)
        })
      );
    }

    fs.writeFileSync(tempOutputPath, lines.join("\n") + (lines.length ? "\n" : ""));

    let transactionOpen = false;

    try {
      distillDb.db.exec("BEGIN");
      transactionOpen = true;

      const exportInsert = distillDb.db
        .prepare(`
          INSERT INTO exports (export_type, label_filter, output_path, record_count, metadata_json)
          VALUES ('jsonl', ?, ?, ?, ?)
        `)
        .run(
          normalizedLabel,
          outputPath,
          sessionRows.length,
          JSON.stringify({ exportedAt })
        );

      distillDb.db
        .prepare(`
          INSERT INTO activity_events (
            event_type,
            object_type,
            object_id,
            payload_json
          ) VALUES (?, ?, ?, ?)
        `)
        .run(
          "export_written",
          "export",
          Number(exportInsert.lastInsertRowid),
          JSON.stringify({
            label: normalizedLabel,
            outputPath,
            recordCount: sessionRows.length,
            exportedAt
          })
        );

      distillDb.db.exec("COMMIT");
      transactionOpen = false;
      fs.renameSync(tempOutputPath, outputPath);
    } catch (error) {
      if (transactionOpen) {
        try {
          distillDb.db.exec("ROLLBACK");
        } catch {
          // Preserve the original export failure below.
        }
      }

      try {
        fs.unlinkSync(tempOutputPath);
      } catch {
        // Ignore cleanup failures so the export error remains primary.
      }

      throw error;
    }

    return {
      exportedAt,
      label: normalizedLabel,
      outputPath,
      recordCount: sessionRows.length
    };
  } finally {
    distillDb.close();
  }
}
