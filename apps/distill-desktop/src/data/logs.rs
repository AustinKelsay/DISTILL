use anyhow::Result;
use rusqlite::Connection;
use serde::{Deserialize, Serialize};

use crate::view_models::{LogCardVm, LogDetailVm, LogFilter, LogsPageVm};

use super::{DesktopDataSource, matches_query, truncate_inline};

#[derive(Clone, Debug)]
struct LogRow {
    id: String,
    title: String,
    subtitle: String,
    summary: String,
    status: String,
    level: String,
    metrics: String,
    raw_json: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, Default)]
struct JobPayload {
    #[serde(default)]
    reason: Option<String>,
    #[serde(default)]
    summary: Option<String>,
    #[serde(default, rename = "startedAt")]
    started_at: Option<String>,
    #[serde(default, rename = "finishedAt")]
    finished_at: Option<String>,
    #[serde(default, rename = "discoveredCaptures")]
    discovered_captures: Option<i64>,
    #[serde(default, rename = "importedCaptures")]
    imported_captures: Option<i64>,
    #[serde(default, rename = "skippedCaptures")]
    skipped_captures: Option<i64>,
    #[serde(default, rename = "failedCaptures")]
    failed_captures: Option<i64>,
    #[serde(default)]
    outcome: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, Default)]
struct ExportPayload {
    #[serde(default, rename = "exportedAt")]
    exported_at: Option<String>,
    #[serde(default)]
    dataset: Option<String>,
}

impl DesktopDataSource {
    pub fn load_logs(
        &self,
        filter: LogFilter,
        query: &str,
        selected_log_id: Option<&str>,
    ) -> Result<LogsPageVm> {
        if !self.database_exists() {
            return Ok(LogsPageVm {
                rows: Vec::new(),
                detail: LogDetailVm {
                    empty_message: match self.source_mode() {
                        crate::config::SourceMode::RustOwned => {
                            "Initialize or import into a Rust-owned Distill store to inspect sync and export history."
                                .to_string()
                        }
                        crate::config::SourceMode::ElectronCompatReadOnly => {
                            "Open a compatible Distill Electron database to inspect sync and export history."
                                .to_string()
                        }
                    },
                    ..LogDetailVm::default()
                },
                empty_title: "No log history".to_string(),
                empty_message: match self.source_mode() {
                    crate::config::SourceMode::RustOwned => {
                        "The Rust-owned Distill store has not been initialized yet.".to_string()
                    }
                    crate::config::SourceMode::ElectronCompatReadOnly => {
                        "This starter only reads from an existing Distill Electron home."
                            .to_string()
                    }
                },
            });
        }

        let conn = self.open_read_only()?;
        let mut rows = self.load_log_rows(&conn)?;
        rows.retain(|row| {
            matches_log_filter(row, filter)
                && matches_query(query, &[&row.title, &row.summary, &row.raw_json])
        });
        rows.sort_by(|left, right| right.subtitle.cmp(&left.subtitle));

        let selected_id = selected_log_id
            .filter(|candidate| rows.iter().any(|row| row.id == *candidate))
            .map(ToOwned::to_owned)
            .or_else(|| rows.first().map(|row| row.id.clone()));

        let detail = selected_id
            .as_deref()
            .and_then(|selected_id| rows.iter().find(|row| row.id == selected_id))
            .map(|row| LogDetailVm {
                title: row.title.clone(),
                status: row.status.clone(),
                summary: row.summary.clone(),
                metrics: row.metrics.clone(),
                raw_json: row.raw_json.clone(),
                empty_message: String::new(),
            })
            .unwrap_or_else(|| LogDetailVm {
                empty_message: "Select a log entry to inspect the raw sync or export payload."
                    .to_string(),
                ..LogDetailVm::default()
            });

        let list_rows = rows
            .into_iter()
            .map(|row| LogCardVm {
                selected: selected_id.as_deref() == Some(row.id.as_str()),
                id: row.id,
                title: row.title,
                subtitle: row.subtitle,
                status: row.status,
            })
            .collect::<Vec<_>>();

        let (empty_title, empty_message) = if list_rows.is_empty() {
            if query.trim().is_empty() && matches!(filter, LogFilter::All) {
                (
                    "No logs yet".to_string(),
                    match self.source_mode() {
                        crate::config::SourceMode::RustOwned => {
                            "Sync jobs and exports from the Rust-owned Distill store will appear here when present."
                                .to_string()
                        }
                        crate::config::SourceMode::ElectronCompatReadOnly => {
                            "Sync jobs and exports from Distill Electron will appear here when present."
                                .to_string()
                        }
                    },
                )
            } else {
                (
                    "No matching logs".to_string(),
                    "Adjust the search text or filter lane.".to_string(),
                )
            }
        } else {
            (String::new(), String::new())
        };

        Ok(LogsPageVm {
            rows: list_rows,
            detail,
            empty_title,
            empty_message,
        })
    }

    fn load_log_rows(&self, conn: &Connection) -> Result<Vec<LogRow>> {
        let mut rows = Vec::new();

        let mut job_stmt = conn.prepare(
            r#"
            SELECT id, status, last_error, payload_json, created_at, updated_at
            FROM jobs
            WHERE job_type = 'sync_sources'
            ORDER BY COALESCE(updated_at, created_at) DESC
            "#,
        )?;
        let mut job_rows = job_stmt.query([])?;
        while let Some(row) = job_rows.next()? {
            let id: i64 = row.get(0)?;
            let status: String = row.get(1)?;
            let last_error: Option<String> = row.get(2)?;
            let payload_json: String = row.get(3)?;
            let created_at: String = row.get(4)?;
            let updated_at: Option<String> = row.get(5)?;
            let payload = serde_json::from_str::<JobPayload>(&payload_json).unwrap_or_default();
            let normalized = normalize_sync_status(&status, &payload);
            let metrics = format!(
                "{} found · {} imported · {} skipped · {} failed",
                payload.discovered_captures.unwrap_or(0),
                payload.imported_captures.unwrap_or(0),
                payload.skipped_captures.unwrap_or(0),
                payload.failed_captures.unwrap_or(0)
            );
            rows.push(LogRow {
                id: format!("sync-{id}"),
                title: "Background sync".to_string(),
                subtitle: updated_at.unwrap_or(created_at),
                summary: payload.summary.clone().unwrap_or_else(|| {
                    payload
                        .reason
                        .clone()
                        .unwrap_or_else(|| "Sync activity".to_string())
                }),
                status: normalized.clone(),
                level: if normalized == "failed" {
                    "error".to_string()
                } else {
                    "info".to_string()
                },
                metrics,
                raw_json: serde_json::to_string_pretty(&serde_json::json!({
                    "jobId": id,
                    "status": status,
                    "lastError": last_error,
                    "payload": payload,
                }))
                .unwrap_or_else(|_| payload_json.clone()),
            });
        }

        let mut export_stmt = conn.prepare(
            r#"
            SELECT id, export_type, label_filter, output_path, record_count, metadata_json, created_at
            FROM exports
            ORDER BY created_at DESC
            "#,
        )?;
        let mut export_rows = export_stmt.query([])?;
        while let Some(row) = export_rows.next()? {
            let id: i64 = row.get(0)?;
            let export_type: String = row.get(1)?;
            let label_filter: Option<String> = row.get(2)?;
            let output_path: String = row.get(3)?;
            let record_count: i64 = row.get(4)?;
            let metadata_json: String = row.get(5)?;
            let created_at: String = row.get(6)?;
            let payload = serde_json::from_str::<ExportPayload>(&metadata_json).unwrap_or_default();
            let dataset = payload
                .dataset
                .clone()
                .or(label_filter.clone())
                .unwrap_or_else(|| "all".to_string());
            rows.push(LogRow {
                id: format!("export-{id}"),
                title: "Export".to_string(),
                subtitle: created_at,
                summary: format!("Exported {record_count} {dataset} records"),
                status: "completed".to_string(),
                level: "info".to_string(),
                metrics: format!(
                    "type={export_type} · output={}",
                    truncate_inline(&output_path, 48)
                ),
                raw_json: serde_json::to_string_pretty(&serde_json::json!({
                    "exportId": id,
                    "exportType": export_type,
                    "dataset": dataset,
                    "outputPath": output_path,
                    "recordCount": record_count,
                    "payload": payload,
                }))
                .unwrap_or_else(|_| metadata_json.clone()),
            });
        }

        Ok(rows)
    }
}

fn normalize_sync_status(status: &str, payload: &JobPayload) -> String {
    match status {
        "pending" => "queued".to_string(),
        "running" | "warning" | "failed" => status.to_string(),
        "completed" => {
            if let Some(outcome) = payload.outcome.as_deref() {
                outcome.to_string()
            } else if payload.failed_captures.unwrap_or(0) > 0 {
                "warning".to_string()
            } else {
                "completed".to_string()
            }
        }
        other => other.to_string(),
    }
}

fn matches_log_filter(row: &LogRow, filter: LogFilter) -> bool {
    match filter {
        LogFilter::All => true,
        LogFilter::Sync => row.id.starts_with("sync-"),
        LogFilter::Export => row.id.starts_with("export-"),
        LogFilter::Errors => row.level == "error",
    }
}
