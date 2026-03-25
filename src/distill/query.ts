import { openDistillDatabase } from "./db";
import { buildDoctorReport } from "./doctor";
import { DashboardData, SessionDetail, SessionDetailMessage, SessionListItem } from "../shared/types";

type SessionRow = {
  id: number;
  source_kind: SessionListItem["sourceKind"];
  title: string | null;
  project_path: string | null;
  updated_at: string | null;
  message_count: number;
  model: string | null;
  git_branch: string | null;
  first_user_text: string | null;
  first_assistant_text: string | null;
};

type SessionMessageRow = {
  id: number;
  ordinal: number;
  role: string;
  text: string;
  created_at: string | null;
};

function cleanExcerpt(text: string | null | undefined, maxLength: number): string | undefined {
  const cleaned = text?.replace(/\s+/g, " ").trim();
  if (!cleaned) {
    return undefined;
  }

  return cleaned.length > maxLength ? `${cleaned.slice(0, maxLength - 1).trimEnd()}…` : cleaned;
}

function deriveSessionTitle(row: SessionRow): string {
  const directTitle = row.title?.trim();
  if (directTitle) {
    return directTitle;
  }

  const previewTitle = cleanExcerpt(row.first_user_text, 160);
  if (previewTitle) {
    return previewTitle;
  }

  return "Untitled session";
}

function deriveSessionPreview(row: SessionRow): string | undefined {
  return cleanExcerpt(row.first_assistant_text, 280) ?? cleanExcerpt(row.first_user_text, 280);
}

export function listRecentSessions(limit = 24): SessionListItem[] {
  const distillDb = openDistillDatabase();
  try {
    const rows = distillDb.db
      .prepare(`
        SELECT
          s.id,
          so.kind AS source_kind,
          s.title,
          s.project_path,
          s.updated_at,
          s.message_count,
          s.model,
          s.git_branch,
          (
            SELECT m.text
            FROM messages m
            WHERE m.session_id = s.id
            AND m.role = 'user'
            ORDER BY m.ordinal ASC
            LIMIT 1
          ) AS first_user_text,
          (
            SELECT m.text
            FROM messages m
            WHERE m.session_id = s.id
            AND m.role = 'assistant'
            ORDER BY m.ordinal ASC
            LIMIT 1
          ) AS first_assistant_text
        FROM sessions s
        JOIN sources so ON so.id = s.source_id
        ORDER BY COALESCE(s.updated_at, s.updated_recorded_at) DESC
        LIMIT ?
      `)
      .all(limit) as SessionRow[];

    return rows.map((row) => ({
      id: row.id,
      sourceKind: row.source_kind,
      title: deriveSessionTitle(row),
      projectPath: row.project_path ?? undefined,
      updatedAt: row.updated_at ?? undefined,
      messageCount: row.message_count,
      model: row.model ?? undefined,
      gitBranch: row.git_branch ?? undefined,
      preview: deriveSessionPreview(row)
    }));
  } finally {
    distillDb.close();
  }
}

export function getSessionDetail(sessionId: number): SessionDetail | undefined {
  const distillDb = openDistillDatabase();
  try {
    const row = distillDb.db
      .prepare(`
        SELECT
          s.id,
          so.kind AS source_kind,
          s.title,
          s.project_path,
          s.updated_at,
          s.message_count,
          s.model,
          s.git_branch,
          (
            SELECT m.text
            FROM messages m
            WHERE m.session_id = s.id
            AND m.role = 'user'
            ORDER BY m.ordinal ASC
            LIMIT 1
          ) AS first_user_text,
          (
            SELECT m.text
            FROM messages m
            WHERE m.session_id = s.id
            AND m.role = 'assistant'
            ORDER BY m.ordinal ASC
            LIMIT 1
          ) AS first_assistant_text,
          (
            SELECT COUNT(*)
            FROM artifacts a
            WHERE a.session_id = s.id
          ) AS artifact_count
        FROM sessions s
        JOIN sources so ON so.id = s.source_id
        WHERE s.id = ?
      `)
      .get(sessionId) as (SessionRow & { artifact_count: number }) | undefined;

    if (!row) {
      return undefined;
    }

    const messages = distillDb.db
      .prepare(`
        SELECT id, ordinal, role, text, created_at
        FROM messages
        WHERE session_id = ?
        ORDER BY ordinal ASC
      `)
      .all(sessionId) as SessionMessageRow[];

    return {
      id: row.id,
      sourceKind: row.source_kind,
      title: deriveSessionTitle(row),
      projectPath: row.project_path ?? undefined,
      updatedAt: row.updated_at ?? undefined,
      messageCount: row.message_count,
      model: row.model ?? undefined,
      gitBranch: row.git_branch ?? undefined,
      preview: deriveSessionPreview(row),
      artifactCount: row.artifact_count,
      messages: messages.map(
        (message): SessionDetailMessage => ({
          id: message.id,
          ordinal: message.ordinal,
          role: message.role,
          text: message.text,
          createdAt: message.created_at ?? undefined
        })
      )
    };
  } finally {
    distillDb.close();
  }
}

export function getDashboardData(): DashboardData {
  return {
    doctor: buildDoctorReport(),
    sessions: listRecentSessions()
  };
}
