import { DatabaseSync } from "node:sqlite";
import { insertActivityEvent, openDistillDatabase } from "./db";

const DEFAULT_LABELS = ["train", "holdout", "exclude", "sensitive", "favorite"] as const;

function withTransaction<T>(db: DatabaseSync, fn: () => T): T {
  let transactionOpen = false;

  try {
    db.exec("BEGIN");
    transactionOpen = true;
    const result = fn();
    db.exec("COMMIT");
    transactionOpen = false;
    return result;
  } catch (error) {
    if (transactionOpen) {
      try {
        db.exec("ROLLBACK");
      } catch {
        // Preserve the original transaction error below.
      }
    }

    throw error;
  }
}

function sessionExists(db: DatabaseSync, sessionId: number): boolean {
  const row = db
    .prepare("SELECT 1 FROM sessions WHERE id = ? LIMIT 1")
    .get(sessionId) as { 1: number } | undefined;

  return Boolean(row);
}

function ensureDefaultLabelsInDb(db: DatabaseSync): void {
  const insert = db.prepare(`
    INSERT INTO labels (name, scope)
    VALUES (?, 'session')
    ON CONFLICT(name) DO NOTHING
  `);

  for (const label of DEFAULT_LABELS) {
    insert.run(label);
  }
}

export function ensureDefaultLabels(): void {
  const distillDb = openDistillDatabase();
  try {
    ensureDefaultLabelsInDb(distillDb.db);
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
    withTransaction(distillDb.db, () => {
      if (!sessionExists(distillDb.db, sessionId)) {
        return;
      }

      const tagRow = distillDb.db
        .prepare(`
          INSERT INTO tags (name, kind)
          VALUES (?, 'manual')
          ON CONFLICT(name) DO UPDATE SET name = excluded.name
          RETURNING id, name
        `)
        .get(normalized) as { id: number; name: string };

      const assignment = distillDb.db
        .prepare(`
          INSERT INTO tag_assignments (object_type, object_id, tag_id, origin)
          VALUES ('session', ?, ?, 'manual')
          ON CONFLICT(object_type, object_id, tag_id, origin) DO NOTHING
          RETURNING id
        `)
        .get(sessionId, tagRow.id) as { id: number } | undefined;

      if (!assignment) {
        return;
      }

      insertActivityEvent(distillDb.db, {
        eventType: "tag_added",
        objectType: "session",
        objectId: sessionId,
        sessionId,
        payload: {
          tagId: tagRow.id,
          tagName: tagRow.name,
          origin: "manual"
        }
      });
    });
  } finally {
    distillDb.close();
  }
}

export function removeSessionTag(sessionId: number, tagId: number): void {
  const distillDb = openDistillDatabase();
  try {
    withTransaction(distillDb.db, () => {
      if (!sessionExists(distillDb.db, sessionId)) {
        return;
      }

      const assignment = distillDb.db
        .prepare(`
          SELECT ta.id, t.name
          FROM tag_assignments ta
          JOIN tags t ON t.id = ta.tag_id
          WHERE ta.object_type = 'session'
          AND ta.object_id = ?
          AND ta.tag_id = ?
          LIMIT 1
        `)
        .get(sessionId, tagId) as { id: number; name: string } | undefined;

      if (!assignment) {
        return;
      }

      const result = distillDb.db.prepare("DELETE FROM tag_assignments WHERE id = ?").run(assignment.id);
      if (result.changes === 0) {
        return;
      }

      insertActivityEvent(distillDb.db, {
        eventType: "tag_removed",
        objectType: "session",
        objectId: sessionId,
        sessionId,
        payload: {
          tagId,
          tagName: assignment.name,
          origin: "manual"
        }
      });
    });
  } finally {
    distillDb.close();
  }
}

export function toggleSessionLabel(sessionId: number, labelName: string): void {
  const normalized = labelName.trim().toLowerCase();
  if (!normalized) {
    return;
  }

  const distillDb = openDistillDatabase();
  try {
    withTransaction(distillDb.db, () => {
      if (!sessionExists(distillDb.db, sessionId)) {
        return;
      }

      ensureDefaultLabelsInDb(distillDb.db);

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
        const deleted = distillDb.db.prepare("DELETE FROM label_assignments WHERE id = ?").run(existing.id);
        if (deleted.changes === 0) {
          return;
        }

        insertActivityEvent(distillDb.db, {
          eventType: "label_toggled",
          objectType: "session",
          objectId: sessionId,
          sessionId,
          payload: {
            labelId: label.id,
            labelName: label.name,
            origin: "manual",
            enabled: false
          }
        });
        return;
      }

      const inserted = distillDb.db
        .prepare(`
          INSERT INTO label_assignments (object_type, object_id, label_id, origin)
          VALUES ('session', ?, ?, 'manual')
          RETURNING id
        `)
        .get(sessionId, label.id) as { id: number } | undefined;

      if (!inserted) {
        return;
      }

      insertActivityEvent(distillDb.db, {
        eventType: "label_toggled",
        objectType: "session",
        objectId: sessionId,
        sessionId,
        payload: {
          labelId: label.id,
          labelName: label.name,
          origin: "manual",
          enabled: true
        }
      });
    });
  } finally {
    distillDb.close();
  }
}
