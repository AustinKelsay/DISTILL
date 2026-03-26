import { openDistillDatabase } from "./db";

const DEFAULT_LABELS = ["train", "holdout", "exclude", "sensitive", "favorite"] as const;

export function ensureDefaultLabels(): void {
  const distillDb = openDistillDatabase();
  try {
    const insert = distillDb.db.prepare(`
      INSERT INTO labels (name, scope)
      VALUES (?, 'session')
      ON CONFLICT(name) DO NOTHING
    `);

    for (const label of DEFAULT_LABELS) {
      insert.run(label);
    }
  } finally {
    distillDb.close();
  }
}

export function getDefaultLabelNames(): string[] {
  return [...DEFAULT_LABELS];
}

export function addSessionTag(sessionId: number, tagName: string): void {
  const normalized = tagName.trim().toLowerCase();
  if (!normalized) {
    return;
  }

  const distillDb = openDistillDatabase();
  try {
    const tagRow = distillDb.db
      .prepare(`
        INSERT INTO tags (name, kind)
        VALUES (?, 'manual')
        ON CONFLICT(name) DO UPDATE SET name = excluded.name
        RETURNING id
      `)
      .get(normalized) as { id: number };

    distillDb.db
      .prepare(`
        INSERT INTO tag_assignments (object_type, object_id, tag_id, origin)
        VALUES ('session', ?, ?, 'manual')
        ON CONFLICT(object_type, object_id, tag_id, origin) DO NOTHING
      `)
      .run(sessionId, tagRow.id);
  } finally {
    distillDb.close();
  }
}

export function removeSessionTag(sessionId: number, tagId: number): void {
  const distillDb = openDistillDatabase();
  try {
    distillDb.db
      .prepare(`
        DELETE FROM tag_assignments
        WHERE object_type = 'session'
        AND object_id = ?
        AND tag_id = ?
      `)
      .run(sessionId, tagId);
  } finally {
    distillDb.close();
  }
}

export function toggleSessionLabel(sessionId: number, labelName: string): void {
  const normalized = labelName.trim().toLowerCase();
  if (!normalized) {
    return;
  }

  ensureDefaultLabels();

  const distillDb = openDistillDatabase();
  try {
    const label = distillDb.db
      .prepare("SELECT id, name FROM labels WHERE name = ? LIMIT 1")
      .get(normalized) as { id: number; name: string } | undefined;

    if (!label) {
      return;
    }

    const existing = distillDb.db
      .prepare(`
        SELECT id
        FROM label_assignments
        WHERE object_type = 'session'
        AND object_id = ?
        AND label_id = ?
        LIMIT 1
      `)
      .get(sessionId, label.id) as { id: number } | undefined;

    if (existing) {
      distillDb.db.prepare("DELETE FROM label_assignments WHERE id = ?").run(existing.id);
      return;
    }

    distillDb.db
      .prepare(`
        INSERT INTO label_assignments (object_type, object_id, label_id, origin)
        VALUES ('session', ?, ?, 'manual')
      `)
      .run(sessionId, label.id);
  } finally {
    distillDb.close();
  }
}
