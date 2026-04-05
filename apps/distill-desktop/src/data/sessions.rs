use std::fmt::Write as _;

use anyhow::Result;
use rusqlite::{Connection, OptionalExtension};

use crate::view_models::{
    ArtifactRowVm, SessionDetailVm, SessionLane, SessionListRowVm, SessionWorkflowState,
    SessionsPageVm, TranscriptRowVm,
};

use super::{
    DesktopDataSource, derive_session_preview, derive_session_title, join_or_none, key_value,
    matches_query, parse_json_object, prettify_source, push_if_some, truncate_inline,
    uppercase_role,
};

#[derive(Clone, Debug)]
struct SessionListRow {
    id: i64,
    source_kind: String,
    title: Option<String>,
    project_path: Option<String>,
    updated_at: Option<String>,
    message_count: i64,
    model: Option<String>,
    git_branch: Option<String>,
    first_user_text: Option<String>,
    first_assistant_text: Option<String>,
    labels_summary: Option<String>,
}

#[derive(Clone, Debug)]
struct SessionDetailRow {
    id: i64,
    source_kind: String,
    external_session_id: String,
    title: Option<String>,
    project_path: Option<String>,
    source_url: Option<String>,
    started_at: Option<String>,
    updated_at: Option<String>,
    message_count: i64,
    raw_capture_count: i64,
    model: Option<String>,
    git_branch: Option<String>,
    summary: Option<String>,
    metadata_json: Option<String>,
    first_user_text: Option<String>,
    first_assistant_text: Option<String>,
    artifact_count: i64,
}

#[derive(Clone, Debug)]
struct MessageRow {
    ordinal: i64,
    role: String,
    text: String,
    created_at: Option<String>,
    message_kind: String,
}

#[derive(Clone, Debug)]
struct ArtifactRow {
    kind: String,
    mime_type: Option<String>,
    metadata_json: String,
    created_at: Option<String>,
    source_line_no: Option<i64>,
    message_ordinal: Option<i64>,
    message_role: Option<String>,
}

#[derive(Clone, Debug)]
struct TagRow {
    name: String,
}

#[derive(Clone, Debug)]
struct LabelRow {
    name: String,
}

impl DesktopDataSource {
    pub fn load_sessions(
        &self,
        lane: SessionLane,
        query: &str,
        selected_session_id: Option<i64>,
    ) -> Result<SessionsPageVm> {
        if !self.database_exists() {
            return Ok(SessionsPageVm {
                rows: Vec::new(),
                empty_title: match self.source_mode() {
                    crate::config::SourceMode::RustOwned => "Rust store unavailable".to_string(),
                    crate::config::SourceMode::ElectronCompatReadOnly => {
                        "No Distill data yet".to_string()
                    }
                },
                empty_message: match self.source_mode() {
                    crate::config::SourceMode::RustOwned => {
                        format!(
                            "Expected a Rust-owned Distill database at {}.",
                            self.database_path().display()
                        )
                    }
                    crate::config::SourceMode::ElectronCompatReadOnly => {
                        format!(
                            "Expected a read-only Distill Electron database at {}.",
                            self.database_path().display()
                        )
                    }
                },
            });
        }

        let conn = self.open_read_only()?;
        let rows = self.list_sessions_from_db(&conn)?;
        let filtered = rows
            .into_iter()
            .filter(|row| {
                matches_session_lane(workflow_state_from_label(&row.workflow_label), lane)
            })
            .filter(|row| {
                matches_query(
                    query,
                    &[&row.title, &row.preview, &row.meta, &row.labels_summary],
                )
            })
            .map(|row| SessionListRowVm {
                selected: Some(row.id) == selected_session_id,
                ..row
            })
            .collect::<Vec<_>>();

        let (empty_title, empty_message) = if filtered.is_empty() {
            if query.trim().is_empty() {
                (
                    format!("No sessions in {}", lane.label()),
                    match self.source_mode() {
                        crate::config::SourceMode::RustOwned => {
                            "Import or sync data into the Rust-owned Distill store to populate this view."
                                .to_string()
                        }
                        crate::config::SourceMode::ElectronCompatReadOnly => {
                            "Import data in Distill Electron, then reopen this desktop shell."
                                .to_string()
                        }
                    },
                )
            } else {
                (
                    "No matching sessions".to_string(),
                    "Change the search text or switch lanes to widen the result set.".to_string(),
                )
            }
        } else {
            (String::new(), String::new())
        };

        Ok(SessionsPageVm {
            rows: filtered,
            empty_title,
            empty_message,
        })
    }

    pub fn load_session_detail(&self, session_id: i64) -> Result<SessionDetailVm> {
        if !self.database_exists() {
            return Ok(SessionDetailVm {
                empty_title: "No session selected".to_string(),
                empty_message: match self.source_mode() {
                    crate::config::SourceMode::RustOwned => {
                        "The desktop shell has not initialized a Rust-owned Distill database yet."
                            .to_string()
                    }
                    crate::config::SourceMode::ElectronCompatReadOnly => {
                        "The desktop shell has not found a compatible Distill Electron database yet."
                            .to_string()
                    }
                },
                ..SessionDetailVm::default()
            });
        }

        let conn = self.open_read_only()?;
        let row = conn
            .query_row(
                r#"
                SELECT
                  s.id,
                  so.kind AS source_kind,
                  s.external_session_id,
                  s.title,
                  s.project_path,
                  s.source_url,
                  s.started_at,
                  s.updated_at,
                  s.message_count,
                  s.raw_capture_count,
                  s.model,
                  s.git_branch,
                  s.summary,
                  s.metadata_json,
                  (
                    SELECT m.text
                    FROM messages m
                    WHERE m.session_id = s.id AND m.role = 'user' AND m.message_kind = 'text'
                    ORDER BY m.ordinal ASC
                    LIMIT 1
                  ) AS first_user_text,
                  (
                    SELECT m.text
                    FROM messages m
                    WHERE m.session_id = s.id AND m.role = 'assistant' AND m.message_kind = 'text'
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
                "#,
                [session_id],
                |row| {
                    Ok(SessionDetailRow {
                        id: row.get(0)?,
                        source_kind: row.get(1)?,
                        external_session_id: row.get(2)?,
                        title: row.get(3)?,
                        project_path: row.get(4)?,
                        source_url: row.get(5)?,
                        started_at: row.get(6)?,
                        updated_at: row.get(7)?,
                        message_count: row.get(8)?,
                        raw_capture_count: row.get(9)?,
                        model: row.get(10)?,
                        git_branch: row.get(11)?,
                        summary: row.get(12)?,
                        metadata_json: row.get(13)?,
                        first_user_text: row.get(14)?,
                        first_assistant_text: row.get(15)?,
                        artifact_count: row.get(16)?,
                    })
                },
            )
            .optional()?;

        let Some(row) = row else {
            return Ok(SessionDetailVm {
                empty_title: "Session missing".to_string(),
                empty_message:
                    "The selected session could not be loaded from the current projection."
                        .to_string(),
                ..SessionDetailVm::default()
            });
        };

        let metadata = parse_json_object(row.metadata_json.as_deref());
        let messages = self.load_messages(&conn, session_id)?;
        let artifacts = self.load_artifacts(&conn, session_id)?;
        let tags = self.load_tags(&conn, session_id)?;
        let labels = self.load_labels(&conn, session_id)?;

        let mut metadata_lines = vec![
            key_value("Source", prettify_source(&row.source_kind)),
            key_value("External Session", row.external_session_id.as_str()),
            key_value("Messages", &row.message_count.to_string()),
            key_value("Raw Captures", &row.raw_capture_count.to_string()),
            key_value("Artifacts", &row.artifact_count.to_string()),
        ];
        push_if_some(&mut metadata_lines, "Project", row.project_path.as_deref());
        push_if_some(&mut metadata_lines, "Started", row.started_at.as_deref());
        push_if_some(&mut metadata_lines, "Updated", row.updated_at.as_deref());
        push_if_some(&mut metadata_lines, "Model", row.model.as_deref());
        push_if_some(&mut metadata_lines, "Git Branch", row.git_branch.as_deref());
        push_if_some(&mut metadata_lines, "Source URL", row.source_url.as_deref());

        for (key, value) in metadata.into_iter().take(8) {
            metadata_lines.push(key_value(
                &format!("meta.{key}"),
                &serde_json::to_string_pretty(&value).unwrap_or_else(|_| value.to_string()),
            ));
        }

        let transcript_rows = messages
            .into_iter()
            .map(|message| TranscriptRowVm {
                heading: format!(
                    "{} #{} · {}{}",
                    uppercase_role(&message.role),
                    message.ordinal,
                    message
                        .created_at
                        .clone()
                        .unwrap_or_else(|| "undated".to_string()),
                    if message.message_kind == "meta" {
                        " · meta"
                    } else {
                        ""
                    }
                ),
                detail: message.text,
            })
            .collect::<Vec<_>>();

        let artifact_rows = artifacts
            .into_iter()
            .map(|artifact| ArtifactRowVm {
                heading: artifact_summary(&artifact),
                detail: artifact_detail(&artifact),
            })
            .collect::<Vec<_>>();

        let empty_message = if transcript_rows.is_empty() {
            "No projected transcript messages were found for this session.".to_string()
        } else {
            String::new()
        };

        Ok(SessionDetailVm {
            id: Some(row.id),
            title: derive_session_title(row.title.as_deref(), row.first_user_text.as_deref()),
            summary: row
                .summary
                .or_else(|| {
                    derive_session_preview(
                        row.first_assistant_text.as_deref(),
                        row.first_user_text.as_deref(),
                    )
                })
                .unwrap_or_else(|| {
                    "No session summary is available for the current projection.".to_string()
                }),
            metadata_lines,
            labels_summary: join_or_none(labels.iter().map(|row| row.name.as_str())),
            tags_summary: join_or_none(tags.iter().map(|row| row.name.as_str())),
            transcript_rows,
            artifact_rows,
            empty_title: String::new(),
            empty_message,
        })
    }

    fn list_sessions_from_db(&self, conn: &Connection) -> Result<Vec<SessionListRowVm>> {
        let mut statement = conn.prepare(
            r#"
            WITH
            first_user_message AS (
              SELECT session_id, text
              FROM (
                SELECT
                  session_id,
                  text,
                  ROW_NUMBER() OVER (PARTITION BY session_id ORDER BY ordinal ASC) AS row_no
                FROM messages
                WHERE role = 'user' AND message_kind = 'text'
              )
              WHERE row_no = 1
            ),
            first_assistant_message AS (
              SELECT session_id, text
              FROM (
                SELECT
                  session_id,
                  text,
                  ROW_NUMBER() OVER (PARTITION BY session_id ORDER BY ordinal ASC) AS row_no
                FROM messages
                WHERE role = 'assistant' AND message_kind = 'text'
              )
              WHERE row_no = 1
            ),
            session_labels AS (
              SELECT
                session_id,
                GROUP_CONCAT(name, ', ') AS labels_summary
              FROM (
                SELECT
                  la.object_id AS session_id,
                  l.name AS name
                FROM label_assignments la
                JOIN labels l ON l.id = la.label_id
                WHERE la.object_type = 'session' AND la.origin = 'manual'
                ORDER BY la.object_id, l.name
              )
              GROUP BY session_id
            )
            SELECT
              s.id,
              so.kind AS source_kind,
              s.title,
              s.project_path,
              s.updated_at,
              s.message_count,
              s.model,
              s.git_branch,
              fu.text AS first_user_text,
              fa.text AS first_assistant_text,
              sl.labels_summary
            FROM sessions s
            JOIN sources so ON so.id = s.source_id
            LEFT JOIN first_user_message fu ON fu.session_id = s.id
            LEFT JOIN first_assistant_message fa ON fa.session_id = s.id
            LEFT JOIN session_labels sl ON sl.session_id = s.id
            ORDER BY COALESCE(s.updated_at, s.updated_recorded_at) DESC
            "#,
        )?;
        let mut rows = statement.query([])?;
        let mut sessions = Vec::new();
        while let Some(row) = rows.next()? {
            let item = SessionListRow {
                id: row.get(0)?,
                source_kind: row.get(1)?,
                title: row.get(2)?,
                project_path: row.get(3)?,
                updated_at: row.get(4)?,
                message_count: row.get(5)?,
                model: row.get(6)?,
                git_branch: row.get(7)?,
                first_user_text: row.get(8)?,
                first_assistant_text: row.get(9)?,
                labels_summary: row.get(10)?,
            };
            let labels = split_labels_summary(item.labels_summary.as_deref());
            let preview = derive_session_preview(
                item.first_assistant_text.as_deref(),
                item.first_user_text.as_deref(),
            )
            .unwrap_or_else(|| "No assistant preview".to_string());
            let mut meta_parts = Vec::new();
            if let Some(updated_at) = item.updated_at.as_deref() {
                meta_parts.push(updated_at.to_string());
            }
            if let Some(project_path) = item.project_path.as_deref() {
                meta_parts.push(truncate_inline(project_path, 42));
            }
            if let Some(model) = item.model.as_deref() {
                meta_parts.push(model.to_string());
            }
            if let Some(git_branch) = item.git_branch.as_deref() {
                meta_parts.push(format!("git:{git_branch}"));
            }
            meta_parts.push(format!("{} msgs", item.message_count));
            let workflow_state = derive_workflow_state(&labels);
            let title =
                derive_session_title(item.title.as_deref(), item.first_user_text.as_deref());
            let labels_summary = join_or_none(labels.iter().map(|label| label.as_str()));
            let token_count = preview.split_whitespace().count();
            sessions.push(SessionListRowVm {
                id: item.id,
                title,
                preview,
                meta: if token_count == 0 {
                    meta_parts.join(" · ")
                } else {
                    format!("{} · {} tokens", meta_parts.join(" · "), token_count)
                },
                source_label: prettify_source(&item.source_kind).to_string(),
                workflow_label: workflow_state.label().to_string(),
                labels_summary,
                selected: false,
            });
        }
        Ok(sessions)
    }

    fn load_messages(&self, conn: &Connection, session_id: i64) -> Result<Vec<MessageRow>> {
        let mut statement = conn.prepare(
            r#"
            SELECT ordinal, role, text, created_at, message_kind
            FROM messages
            WHERE session_id = ?
            ORDER BY ordinal ASC
            "#,
        )?;
        let mut rows = statement.query([session_id])?;
        let mut messages = Vec::new();
        while let Some(row) = rows.next()? {
            messages.push(MessageRow {
                ordinal: row.get(0)?,
                role: row.get(1)?,
                text: row.get(2)?,
                created_at: row.get(3)?,
                message_kind: row.get(4)?,
            });
        }
        Ok(messages)
    }

    fn load_artifacts(&self, conn: &Connection, session_id: i64) -> Result<Vec<ArtifactRow>> {
        let mut statement = conn.prepare(
            r#"
            SELECT
              a.kind,
              a.mime_type,
              a.metadata_json,
              a.created_at,
              cr.line_no AS source_line_no,
              m.ordinal AS message_ordinal,
              m.role AS message_role
            FROM artifacts a
            LEFT JOIN capture_records cr ON cr.id = a.capture_record_id
            LEFT JOIN messages m ON m.id = a.message_id
            WHERE a.session_id = ?
            ORDER BY COALESCE(m.ordinal, 999999), COALESCE(cr.line_no, 999999), a.id
            "#,
        )?;
        let mut rows = statement.query([session_id])?;
        let mut artifacts = Vec::new();
        while let Some(row) = rows.next()? {
            artifacts.push(ArtifactRow {
                kind: row.get(0)?,
                mime_type: row.get(1)?,
                metadata_json: row.get(2)?,
                created_at: row.get(3)?,
                source_line_no: row.get(4)?,
                message_ordinal: row.get(5)?,
                message_role: row.get(6)?,
            });
        }
        Ok(artifacts)
    }

    fn load_tags(&self, conn: &Connection, session_id: i64) -> Result<Vec<TagRow>> {
        let mut statement = conn.prepare(
            r#"
            SELECT t.name
            FROM tag_assignments ta
            JOIN tags t ON t.id = ta.tag_id
            WHERE ta.object_type = 'session'
              AND ta.object_id = ?
            ORDER BY t.name ASC
            "#,
        )?;
        let mut rows = statement.query([session_id])?;
        let mut tags = Vec::new();
        while let Some(row) = rows.next()? {
            tags.push(TagRow { name: row.get(0)? });
        }
        Ok(tags)
    }

    fn load_labels(&self, conn: &Connection, session_id: i64) -> Result<Vec<LabelRow>> {
        let mut statement = conn.prepare(
            r#"
            SELECT l.name
            FROM label_assignments la
            JOIN labels l ON l.id = la.label_id
            WHERE la.object_type = 'session'
              AND la.object_id = ?
              AND la.origin = 'manual'
            ORDER BY l.name ASC
            "#,
        )?;
        let mut rows = statement.query([session_id])?;
        let mut labels = Vec::new();
        while let Some(row) = rows.next()? {
            labels.push(LabelRow { name: row.get(0)? });
        }
        Ok(labels)
    }
}

fn split_labels_summary(raw: Option<&str>) -> Vec<String> {
    raw.unwrap_or_default()
        .split(',')
        .map(str::trim)
        .filter(|label| !label.is_empty())
        .map(ToOwned::to_owned)
        .collect()
}

fn derive_workflow_state(labels: &[String]) -> SessionWorkflowState {
    let has_train = labels.iter().any(|label| label == "train");
    let has_holdout = labels.iter().any(|label| label == "holdout");
    let has_exclude = labels.iter().any(|label| label == "exclude");
    let has_sensitive = labels.iter().any(|label| label == "sensitive");
    let has_favorite = labels.iter().any(|label| label == "favorite");

    if has_exclude || has_sensitive || (has_train && has_holdout) {
        SessionWorkflowState::NeedsReview
    } else if has_train {
        SessionWorkflowState::TrainReady
    } else if has_holdout {
        SessionWorkflowState::HoldoutReady
    } else if has_favorite {
        SessionWorkflowState::Favorite
    } else {
        SessionWorkflowState::Neutral
    }
}

fn workflow_state_from_label(label: &str) -> SessionWorkflowState {
    match label {
        "Needs Review" => SessionWorkflowState::NeedsReview,
        "Train Ready" => SessionWorkflowState::TrainReady,
        "Holdout Ready" => SessionWorkflowState::HoldoutReady,
        "Favorite" => SessionWorkflowState::Favorite,
        _ => SessionWorkflowState::Neutral,
    }
}

fn matches_session_lane(workflow: SessionWorkflowState, lane: SessionLane) -> bool {
    match lane {
        SessionLane::All => true,
        SessionLane::NeedsReview => matches!(workflow, SessionWorkflowState::NeedsReview),
        SessionLane::TrainReady => matches!(workflow, SessionWorkflowState::TrainReady),
        SessionLane::HoldoutReady => matches!(workflow, SessionWorkflowState::HoldoutReady),
        SessionLane::Favorite => matches!(workflow, SessionWorkflowState::Favorite),
    }
}

fn artifact_summary(row: &ArtifactRow) -> String {
    let mut summary = row.kind.replace('_', " ");
    if let Some(mime_type) = row.mime_type.as_deref() {
        summary.push_str(" · ");
        summary.push_str(mime_type);
    }
    if let Some(message_ordinal) = row.message_ordinal {
        let _ = write!(summary, " · msg #{message_ordinal}");
    }
    summary
}

fn artifact_detail(row: &ArtifactRow) -> String {
    let payload = parse_json_object(Some(&row.metadata_json));
    let payload_text =
        serde_json::to_string_pretty(&payload).unwrap_or_else(|_| row.metadata_json.clone());
    let mut parts = Vec::new();
    if let Some(created_at) = row.created_at.as_deref() {
        parts.push(format!("created_at: {created_at}"));
    }
    if let Some(source_line_no) = row.source_line_no {
        parts.push(format!("source_line: {source_line_no}"));
    }
    if let Some(message_role) = row.message_role.as_deref() {
        parts.push(format!("message_role: {message_role}"));
    }
    if !parts.is_empty() {
        parts.push(String::new());
    }
    parts.push(payload_text);
    parts.join("\n")
}
