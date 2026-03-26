import { openDistillDatabase } from "./db";
import { buildDoctorReport } from "./doctor";
import {
  DashboardData,
  SearchResult,
  SessionArtifact,
  SessionDetail,
  SessionDetailMessage,
  SessionLabel,
  SessionListItem,
  SessionTag
} from "../shared/types";

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

type SessionTagRow = {
  id: number;
  name: string;
  kind: string;
  origin: string;
};

type SessionLabelRow = {
  id: number;
  name: string;
  scope: string;
  origin: string;
};

type SessionArtifactRow = {
  id: number;
  kind: string;
  mime_type: string | null;
  metadata_json: string;
  created_at: string | null;
  source_line_no: number | null;
  message_ordinal: number | null;
  message_role: string | null;
};

type SearchRow = {
  session_id: number;
  source_kind: SearchResult["sourceKind"];
  title: string | null;
  project_path: string | null;
  updated_at: string | null;
  first_user_text: string | null;
};

type SearchHitRow = {
  session_id: number;
  title: string | null;
  project_path: string | null;
  role: string | null;
  text: string;
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

function normalizeSearchQuery(query: string): string {
  const tokens = query.match(/[\p{L}\p{N}_-]+/gu) ?? [];

  return tokens.map((token) => `"${token.replace(/"/g, "\"\"")}"`).join(" AND ");
}

function clampValue(value: unknown, depth = 0): unknown {
  if (depth > 4) {
    return "[truncated]";
  }

  if (typeof value === "string") {
    return value.length > 320 ? `${value.slice(0, 317)}...` : value;
  }

  if (Array.isArray(value)) {
    return value.slice(0, 12).map((entry) => clampValue(entry, depth + 1));
  }

  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).slice(0, 20);
    return Object.fromEntries(entries.map(([key, entry]) => [key, clampValue(entry, depth + 1)]));
  }

  return value;
}

function parseArtifactPayload(metadataJson: string): Record<string, unknown> {
  try {
    const payload = JSON.parse(metadataJson) as Record<string, unknown>;
    return payload && typeof payload === "object" ? payload : {};
  } catch {
    return {};
  }
}

function payloadText(payload: Record<string, unknown>): string | undefined {
  const content = payload.content;

  if (typeof payload.text === "string" && payload.text.trim()) {
    return payload.text.trim();
  }

  if (!Array.isArray(content)) {
    return undefined;
  }

  const text = content
    .flatMap((entry) => {
      if (!entry || typeof entry !== "object") {
        return [];
      }

      const row = entry as Record<string, unknown>;
      return typeof row.text === "string" && row.text.trim() ? [row.text.trim()] : [];
    })
    .join(" ");

  return text || undefined;
}

function summarizeArtifact(row: SessionArtifactRow, payload: Record<string, unknown>): string {
  if (row.kind === "tool_call") {
    const name = typeof payload.name === "string" ? payload.name : undefined;
    return name ? `Tool call: ${name}` : "Tool call";
  }

  if (row.kind === "tool_result") {
    const text = cleanExcerpt(payloadText(payload), 140);
    return text ? `Tool result: ${text}` : "Tool result";
  }

  if (row.kind === "image") {
    return row.mime_type ? `Image: ${row.mime_type}` : "Image artifact";
  }

  return row.kind.replace(/_/g, " ");
}

function artifactPreview(payload: Record<string, unknown>): string {
  const text = cleanExcerpt(payloadText(payload), 220);
  if (text) {
    return text;
  }

  return JSON.stringify(clampValue(payload)) || "{}";
}

function mapArtifact(row: SessionArtifactRow): SessionArtifact {
  const payload = parseArtifactPayload(row.metadata_json);

  return {
    id: row.id,
    kind: row.kind,
    mimeType: row.mime_type ?? undefined,
    sourceLineNo: row.source_line_no ?? undefined,
    messageOrdinal: row.message_ordinal ?? undefined,
    messageRole: row.message_role ?? undefined,
    createdAt: row.created_at ?? undefined,
    summary: summarizeArtifact(row, payload),
    payloadPreview: artifactPreview(payload),
    payloadJson: JSON.stringify(clampValue(payload), null, 2)
  };
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

    const tags = distillDb.db
      .prepare(`
        SELECT t.id, t.name, t.kind, ta.origin
        FROM tag_assignments ta
        JOIN tags t ON t.id = ta.tag_id
        WHERE ta.object_type = 'session'
        AND ta.object_id = ?
        ORDER BY t.name ASC
      `)
      .all(sessionId) as SessionTagRow[];

    const labels = distillDb.db
      .prepare(`
        SELECT l.id, l.name, l.scope, la.origin
        FROM label_assignments la
        JOIN labels l ON l.id = la.label_id
        WHERE la.object_type = 'session'
        AND la.object_id = ?
        ORDER BY l.name ASC
      `)
      .all(sessionId) as SessionLabelRow[];

    const artifacts = distillDb.db
      .prepare(`
        SELECT
          a.id,
          a.kind,
          a.mime_type,
          a.metadata_json,
          a.created_at,
          cr.line_no AS source_line_no,
          m.ordinal AS message_ordinal,
          m.role AS message_role
        FROM artifacts a
        LEFT JOIN capture_records cr ON cr.id = a.capture_record_id
        LEFT JOIN messages m ON m.capture_record_id = a.capture_record_id
          AND m.session_id = a.session_id
        WHERE a.session_id = ?
        ORDER BY COALESCE(m.ordinal, 999999), COALESCE(cr.line_no, 999999), a.id
      `)
      .all(sessionId) as SessionArtifactRow[];

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
      tags: tags.map(
        (tag): SessionTag => ({
          id: tag.id,
          name: tag.name,
          kind: tag.kind,
          origin: tag.origin
        })
      ),
      labels: labels.map(
        (label): SessionLabel => ({
          id: label.id,
          name: label.name,
          scope: label.scope,
          origin: label.origin
        })
      ),
      artifacts: artifacts.map(mapArtifact),
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

export function searchSessions(query: string, limit = 20): SearchResult[] {
  const normalizedQuery = normalizeSearchQuery(query);
  if (!normalizedQuery) {
    return [];
  }

  const distillDb = openDistillDatabase();
  try {
    const hitRows = distillDb.db
      .prepare(`
        SELECT
          CAST(session_id AS INTEGER) AS session_id,
          title,
          project_path,
          role,
          text
        FROM message_fts
        WHERE message_fts MATCH ?
        LIMIT ?
      `)
      .all(normalizedQuery, limit * 8) as SearchHitRow[];

    const firstHitBySession = new Map<number, SearchHitRow>();
    for (const row of hitRows) {
      if (!firstHitBySession.has(row.session_id)) {
        firstHitBySession.set(row.session_id, row);
      }
      if (firstHitBySession.size >= limit) {
        break;
      }
    }

    const sessionIds = [...firstHitBySession.keys()];
    if (sessionIds.length === 0) {
      return [];
    }

    const placeholders = sessionIds.map(() => "?").join(", ");
    const sessionRows = distillDb.db
      .prepare(`
        SELECT
          s.id AS session_id,
          so.kind AS source_kind,
          s.title,
          s.project_path,
          s.updated_at,
          (
            SELECT m.text
            FROM messages m
            WHERE m.session_id = s.id
            AND m.role = 'user'
            ORDER BY m.ordinal ASC
            LIMIT 1
          ) AS first_user_text
        FROM sessions s
        JOIN sources so ON so.id = s.source_id
        WHERE s.id IN (${placeholders})
      `)
      .all(...sessionIds) as SearchRow[];

    const sessionRowById = new Map(sessionRows.map((row) => [row.session_id, row]));

    return sessionIds.flatMap((sessionId) => {
      const row = sessionRowById.get(sessionId);
      const hit = firstHitBySession.get(sessionId);
      if (!row || !hit) {
        return [];
      }

      return [
        {
          sessionId: row.session_id,
          sourceKind: row.source_kind,
          title: row.title?.trim() || cleanExcerpt(row.first_user_text, 160) || "Untitled session",
          projectPath: row.project_path ?? undefined,
          updatedAt: row.updated_at ?? undefined,
          snippet: cleanExcerpt(hit.text, 280) ?? ""
        }
      ];
    });
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
