use std::cell::RefCell;
use std::path::PathBuf;
use std::rc::Rc;

use anyhow::{Context, Result};
use slint::{ComponentHandle, ModelRc, SharedString, VecModel};

use crate::data::{DbBrowseRequestVm, DesktopDataSource};
use crate::view_models::{
    AppRoute, AppSnapshotVm, DataSourceConfig, DbBrowseVm, DbExplorerVm, DbQueryVm, DbResultRowVm,
    DbTableVm, LogCardVm, LogDetailVm, LogFilter, SessionDetailVm, SessionLane, SessionListRowVm,
};
use crate::{
    AppWindow, ArtifactRowData, DbResultRowData, DbStore, KeyValueRowData, LogRowData, LogsStore,
    NavItemData, SessionLaneData, SessionListRowData, SessionsStore, TableRowData,
    TranscriptRowData,
};

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct DesktopPreferences {
    pub route: AppRoute,
    pub sessions_width: f32,
    pub logs_width: f32,
    pub db_tables_width: f32,
    pub db_rows_width: f32,
    pub selected_session_id: Option<i64>,
    pub selected_log_id: Option<String>,
    pub selected_table_name: Option<String>,
    pub db_query_sql: String,
}

impl Default for DesktopPreferences {
    fn default() -> Self {
        Self {
            route: AppRoute::Sessions,
            sessions_width: 380.0,
            logs_width: 420.0,
            db_tables_width: 240.0,
            db_rows_width: 420.0,
            selected_session_id: None,
            selected_log_id: None,
            selected_table_name: Some("sessions".to_string()),
            db_query_sql:
                "SELECT id, title, updated_at\nFROM sessions\nORDER BY updated_at DESC\nLIMIT 25;"
                    .to_string(),
        }
    }
}

#[derive(Clone, Debug)]
struct SessionsState {
    lane: SessionLane,
    query: String,
    rows: Vec<SessionListRowVm>,
    selected_id: Option<i64>,
    detail: SessionDetailVm,
    empty_title: String,
    empty_message: String,
}

impl Default for SessionsState {
    fn default() -> Self {
        Self {
            lane: SessionLane::All,
            query: String::new(),
            rows: Vec::new(),
            selected_id: None,
            detail: empty_session_detail(
                "No session selected",
                "Select a session from the left pane to inspect the current projection.",
            ),
            empty_title: String::new(),
            empty_message: String::new(),
        }
    }
}

#[derive(Clone, Debug)]
struct LogsState {
    filter: LogFilter,
    query: String,
    rows: Vec<LogCardVm>,
    selected_id: Option<String>,
    detail: LogDetailVm,
    empty_title: String,
    empty_message: String,
}

impl Default for LogsState {
    fn default() -> Self {
        Self {
            filter: LogFilter::All,
            query: String::new(),
            rows: Vec::new(),
            selected_id: None,
            detail: empty_log_detail(
                "Select a log entry to inspect the raw sync or export payload.",
            ),
            empty_title: String::new(),
            empty_message: String::new(),
        }
    }
}

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
enum SortDirection {
    Asc,
    #[default]
    Desc,
}

impl SortDirection {
    fn as_str(self) -> &'static str {
        match self {
            Self::Asc => "asc",
            Self::Desc => "desc",
        }
    }

    fn from_value(value: &str) -> Self {
        if value.eq_ignore_ascii_case("asc") {
            Self::Asc
        } else {
            Self::Desc
        }
    }
}

#[derive(Clone, Debug, Default)]
struct DbFilterState {
    column: String,
    operator: String,
    value: String,
}

#[derive(Clone, Debug, Default)]
struct DbSortState {
    column: String,
    direction: SortDirection,
}

#[derive(Clone, Debug)]
struct DbState {
    tables: Vec<DbTableVm>,
    selected_table_name: Option<String>,
    browse: DbBrowseVm,
    selected_row_index: Option<usize>,
    row_detail: String,
    filter: DbFilterState,
    sort: DbSortState,
    page: usize,
    query: DbQueryVm,
}

impl Default for DbState {
    fn default() -> Self {
        Self {
            tables: Vec::new(),
            selected_table_name: Some("sessions".to_string()),
            browse: DbBrowseVm::default(),
            selected_row_index: None,
            row_detail: String::new(),
            filter: DbFilterState {
                operator: "contains".to_string(),
                ..DbFilterState::default()
            },
            sort: DbSortState::default(),
            page: 1,
            query: default_db_query(),
        }
    }
}

#[derive(Clone, Debug)]
struct AppState {
    route: AppRoute,
    snapshot: AppSnapshotVm,
    app_status_text: String,
    source_badge_text: String,
    prefs: DesktopPreferences,
    sessions: SessionsState,
    logs: LogsState,
    db: DbState,
}

impl AppState {
    fn from_prefs(prefs: DesktopPreferences) -> Self {
        let mut db = DbState::default();
        db.selected_table_name = prefs.selected_table_name.clone();
        db.query.sql = prefs.db_query_sql.clone();

        Self {
            route: prefs.route,
            snapshot: AppSnapshotVm::default(),
            app_status_text: "Starting native shell…".to_string(),
            source_badge_text: "Desktop Native Shell".to_string(),
            sessions: SessionsState {
                selected_id: prefs.selected_session_id,
                ..SessionsState::default()
            },
            logs: LogsState {
                selected_id: prefs.selected_log_id.clone(),
                ..LogsState::default()
            },
            db,
            prefs,
        }
    }
}

pub struct DesktopController {
    window: AppWindow,
    source: DesktopDataSource,
    state: AppState,
    prefs_path: PathBuf,
}

impl DesktopController {
    pub fn new(
        window: &AppWindow,
        source_config: DataSourceConfig,
        prefs_path: PathBuf,
    ) -> Rc<RefCell<Self>> {
        let prefs = load_preferences(&prefs_path).unwrap_or_default();
        let controller = Rc::new(RefCell::new(Self {
            window: window.clone_strong(),
            source: DesktopDataSource::new(source_config),
            state: AppState::from_prefs(prefs),
            prefs_path,
        }));

        bind_callbacks(&controller);
        controller.borrow_mut().reload_all();
        controller
    }

    pub fn reload_all(&mut self) {
        self.load_snapshot();
        self.reload_sessions_state();
        self.reload_logs_state();
        self.reload_db_state();
        self.persist_preferences();
        self.render();
    }

    fn switch_route(&mut self, route: AppRoute) {
        self.state.route = route;
        self.persist_preferences();
        self.render();
    }

    fn update_global_search(&mut self, text: String) {
        match self.state.route {
            AppRoute::Sessions => {
                self.state.sessions.query = text;
                self.reload_sessions_state();
            }
            AppRoute::Logs => {
                self.state.logs.query = text;
                self.reload_logs_state();
            }
            AppRoute::Db => return,
        }

        self.persist_preferences();
        self.render();
    }

    fn set_session_lane(&mut self, lane: SessionLane) {
        self.state.sessions.lane = lane;
        self.reload_sessions_state();
        self.persist_preferences();
        self.render();
    }

    fn select_session(&mut self, session_id: i64) {
        if !self
            .state
            .sessions
            .rows
            .iter()
            .any(|row| row.id == session_id)
        {
            return;
        }

        self.state.sessions.selected_id = Some(session_id);
        mark_selected_session_rows(
            &mut self.state.sessions.rows,
            self.state.sessions.selected_id,
        );
        self.state.sessions.detail = self
            .source
            .load_session_detail(session_id)
            .unwrap_or_else(|error| error_session_detail(&error));
        self.persist_preferences();
        self.render();
    }

    fn set_log_filter(&mut self, filter: LogFilter) {
        self.state.logs.filter = filter;
        self.reload_logs_state();
        self.persist_preferences();
        self.render();
    }

    fn select_log(&mut self, log_id: String) {
        if !self.state.logs.rows.iter().any(|row| row.id == log_id) {
            return;
        }

        self.state.logs.selected_id = Some(log_id);
        self.reload_logs_state();
        self.persist_preferences();
        self.render();
    }

    fn select_db_table(&mut self, table_name: String) {
        self.state.db.selected_table_name = Some(table_name);
        self.state.db.page = 1;
        self.reload_db_state();
        self.persist_preferences();
        self.render();
    }

    fn set_db_filter_column(&mut self, column: String) {
        self.state.db.filter.column = column;
        self.persist_preferences();
        self.render();
    }

    fn set_db_filter_operator(&mut self, operator: String) {
        self.state.db.filter.operator = operator;
        self.persist_preferences();
        self.render();
    }

    fn set_db_filter_value(&mut self, value: String) {
        self.state.db.filter.value = value;
        self.persist_preferences();
        self.render();
    }

    fn set_db_sort_column(&mut self, column: String) {
        self.state.db.sort.column = column;
        self.persist_preferences();
        self.render();
    }

    fn set_db_sort_direction(&mut self, direction: SortDirection) {
        self.state.db.sort.direction = direction;
        self.persist_preferences();
        self.render();
    }

    fn apply_db_browse(&mut self) {
        self.state.db.page = self.state.db.page.max(1);
        self.reload_db_browse();
        self.persist_preferences();
        self.render();
    }

    fn clear_db_filter(&mut self) {
        self.state.db.filter.value.clear();
        self.state.db.filter.operator = "contains".to_string();
        self.state.db.page = 1;
        self.reload_db_browse();
        self.persist_preferences();
        self.render();
    }

    fn change_db_page(&mut self, delta: PageDelta) {
        match delta {
            PageDelta::Prev => {
                if self.state.db.page > 1 {
                    self.state.db.page -= 1;
                }
            }
            PageDelta::Next => {
                self.state.db.page = self.state.db.page.max(1) + 1;
            }
        }

        self.reload_db_browse();
        self.persist_preferences();
        self.render();
    }

    fn select_db_row(&mut self, row_index: usize) {
        if !self
            .state
            .db
            .browse
            .rows
            .iter()
            .any(|row| row.index == row_index)
        {
            return;
        }

        self.state.db.selected_row_index = Some(row_index);
        reconcile_db_row_selection(
            &mut self.state.db.browse.rows,
            &mut self.state.db.selected_row_index,
            &mut self.state.db.row_detail,
        );
        self.persist_preferences();
        self.render();
    }

    fn update_db_query(&mut self, sql: String) {
        self.state.db.query.sql = sql;
        self.persist_preferences();
        self.render();
    }

    fn run_db_query(&mut self) {
        self.state.db.query = self
            .source
            .run_read_only_query(&self.state.db.query.sql)
            .unwrap_or_else(|error| DbQueryVm {
                sql: self.state.db.query.sql.clone(),
                summary: String::new(),
                preview: String::new(),
                error: error.to_string(),
            });
        self.persist_preferences();
        self.render();
    }

    fn adjust_split(&mut self, pane: PaneWidth, delta: i32) {
        let delta = delta as f32;
        match pane {
            PaneWidth::Sessions => {
                self.state.prefs.sessions_width =
                    (self.state.prefs.sessions_width + delta).clamp(280.0, 520.0);
            }
            PaneWidth::Logs => {
                self.state.prefs.logs_width =
                    (self.state.prefs.logs_width + delta).clamp(320.0, 620.0);
            }
            PaneWidth::DbTables => {
                self.state.prefs.db_tables_width =
                    (self.state.prefs.db_tables_width + delta).clamp(180.0, 360.0);
            }
            PaneWidth::DbRows => {
                self.state.prefs.db_rows_width =
                    (self.state.prefs.db_rows_width + delta).clamp(280.0, 640.0);
            }
        }

        self.persist_preferences();
        self.render();
    }

    fn load_snapshot(&mut self) {
        match self.source.app_snapshot() {
            Ok(snapshot) => {
                self.state.app_status_text = snapshot.app_status_text.clone();
                self.state.source_badge_text = snapshot.source_badge_text.clone();
                self.state.snapshot = snapshot;
            }
            Err(error) => {
                self.state.snapshot = AppSnapshotVm::default();
                self.state.app_status_text = format!("snapshot: {error}");
                self.state.source_badge_text = "Desktop Native Shell".to_string();
            }
        }
    }

    fn reload_sessions_state(&mut self) {
        match self.source.load_sessions(
            self.state.sessions.lane,
            &self.state.sessions.query,
            self.state.sessions.selected_id,
        ) {
            Ok(page) => {
                self.state.sessions.rows = page.rows;
                self.state.sessions.empty_title = page.empty_title;
                self.state.sessions.empty_message = page.empty_message;
                self.state.sessions.selected_id = reconcile_session_selection(
                    &mut self.state.sessions.rows,
                    self.state.sessions.selected_id,
                );
                self.state.sessions.detail =
                    if let Some(session_id) = self.state.sessions.selected_id {
                        self.source
                            .load_session_detail(session_id)
                            .unwrap_or_else(|error| error_session_detail(&error))
                    } else {
                        empty_session_detail(
                            &self.state.sessions.empty_title,
                            &self.state.sessions.empty_message,
                        )
                    };
            }
            Err(error) => {
                self.state.app_status_text = format!("sessions: {error}");
                self.state.sessions.rows.clear();
                self.state.sessions.selected_id = None;
                self.state.sessions.empty_title = "Sessions unavailable".to_string();
                self.state.sessions.empty_message = error.to_string();
                self.state.sessions.detail =
                    empty_session_detail("Sessions unavailable", &error.to_string());
            }
        }
    }

    fn reload_logs_state(&mut self) {
        match self.source.load_logs(
            self.state.logs.filter,
            &self.state.logs.query,
            self.state.logs.selected_id.as_deref(),
        ) {
            Ok(page) => {
                self.state.logs.rows = page.rows;
                self.state.logs.empty_title = page.empty_title;
                self.state.logs.empty_message = page.empty_message;
                self.state.logs.selected_id = reconcile_log_selection(
                    &mut self.state.logs.rows,
                    self.state.logs.selected_id.take(),
                );
                self.state.logs.detail = if self.state.logs.selected_id.is_some() {
                    page.detail
                } else {
                    empty_log_detail(&self.state.logs.empty_message)
                };
            }
            Err(error) => {
                self.state.app_status_text = format!("logs: {error}");
                self.state.logs.rows.clear();
                self.state.logs.selected_id = None;
                self.state.logs.empty_title = "Logs unavailable".to_string();
                self.state.logs.empty_message = error.to_string();
                self.state.logs.detail = empty_log_detail(&error.to_string());
            }
        }
    }

    fn reload_db_state(&mut self) {
        match self
            .source
            .load_db_snapshot(self.state.db.selected_table_name.as_deref())
        {
            Ok(snapshot) => self.apply_db_snapshot(snapshot),
            Err(error) => {
                self.state.app_status_text = format!("db: {error}");
                self.state.db.tables.clear();
                self.state.db.selected_table_name = None;
                self.state.db.browse = DbBrowseVm {
                    error: error.to_string(),
                    ..DbBrowseVm::default()
                };
                self.state.db.selected_row_index = None;
                self.state.db.row_detail.clear();
            }
        }
    }

    fn apply_db_snapshot(&mut self, snapshot: DbExplorerVm) {
        self.state.db.tables = snapshot.tables;
        self.state.db.selected_table_name = snapshot.selected_table_name;
        if self.state.db.selected_table_name.is_none() {
            self.state.db.browse = DbBrowseVm::default();
            self.state.db.selected_row_index = None;
            self.state.db.row_detail.clear();
            return;
        }

        self.state.db.filter.column = choose_valid_value(
            self.state.db.filter.column.clone(),
            &snapshot.browse.available_filter_columns,
        );
        if self.state.db.filter.operator.is_empty() {
            self.state.db.filter.operator = "contains".to_string();
        }
        self.state.db.sort.column = choose_valid_value(
            self.state.db.sort.column.clone(),
            &snapshot.browse.available_sort_columns,
        );
        if self.state.db.sort.column.is_empty() {
            self.state.db.sort.column = choose_valid_value(
                snapshot.sort_column,
                &snapshot.browse.available_sort_columns,
            );
        }
        self.state.db.sort.direction = if snapshot.sort_direction.is_empty() {
            SortDirection::Desc
        } else {
            SortDirection::from_value(&snapshot.sort_direction)
        };
        self.state.db.page = self.state.db.page.max(1);

        self.reload_db_browse();
    }

    fn reload_db_browse(&mut self) {
        let Some(table_name) = self.state.db.selected_table_name.clone() else {
            self.state.db.browse = DbBrowseVm::default();
            self.state.db.selected_row_index = None;
            self.state.db.row_detail.clear();
            return;
        };

        match self.source.browse_db_table(DbBrowseRequestVm {
            table_name,
            filter_column: self.state.db.filter.column.clone(),
            filter_operator: self.state.db.filter.operator.clone(),
            filter_value: self.state.db.filter.value.clone(),
            sort_column: self.state.db.sort.column.clone(),
            sort_direction: self.state.db.sort.direction.as_str().to_string(),
            page: self.state.db.page.max(1),
        }) {
            Ok(mut browse) => {
                self.state.db.filter.column = choose_valid_value(
                    self.state.db.filter.column.clone(),
                    &browse.available_filter_columns,
                );
                self.state.db.sort.column = choose_valid_value(
                    self.state.db.sort.column.clone(),
                    &browse.available_sort_columns,
                );
                reconcile_db_row_selection(
                    &mut browse.rows,
                    &mut self.state.db.selected_row_index,
                    &mut self.state.db.row_detail,
                );
                self.state.db.browse = browse;
            }
            Err(error) => {
                self.state.app_status_text = format!("db: {error}");
                self.state.db.browse = DbBrowseVm {
                    error: error.to_string(),
                    ..DbBrowseVm::default()
                };
                self.state.db.selected_row_index = None;
                self.state.db.row_detail.clear();
            }
        }
    }

    fn render(&self) {
        self.render_shell();
        self.render_sessions();
        self.render_logs();
        self.render_db();
    }

    fn render_shell(&self) {
        let data_path = if self.state.snapshot.database_exists {
            self.state.snapshot.database_path.display().to_string()
        } else {
            self.state.snapshot.distill_home.display().to_string()
        };

        self.window.set_active_route(self.state.route.as_index());
        self.window
            .set_app_status_text(self.state.app_status_text.clone().into());
        self.window
            .set_source_badge_text(self.state.source_badge_text.clone().into());
        self.window
            .set_source_mode_text(self.state.snapshot.source_mode_label.clone().into());
        self.window.set_data_path_text(data_path.into());
        self.window
            .set_global_search(current_toolbar_search(&self.state).into());
        self.window
            .set_sessions_list_width(self.state.prefs.sessions_width);
        self.window.set_logs_list_width(self.state.prefs.logs_width);
        self.window
            .set_db_tables_width(self.state.prefs.db_tables_width);
        self.window
            .set_db_rows_width(self.state.prefs.db_rows_width);

        let nav_items = vec![
            NavItemData {
                label: SharedString::from("Sessions"),
                selected: matches!(self.state.route, AppRoute::Sessions),
            },
            NavItemData {
                label: SharedString::from("Logs"),
                selected: matches!(self.state.route, AppRoute::Logs),
            },
            NavItemData {
                label: SharedString::from("DB"),
                selected: matches!(self.state.route, AppRoute::Db),
            },
        ];
        self.window
            .set_nav_items(ModelRc::new(VecModel::from(nav_items)));
    }

    fn render_sessions(&self) {
        let sessions_store = self.window.global::<SessionsStore>();
        let lanes = SessionLane::ALL
            .iter()
            .map(|lane| SessionLaneData {
                label: SharedString::from(lane.label()),
                selected: *lane == self.state.sessions.lane,
            })
            .collect::<Vec<_>>();
        sessions_store.set_session_lanes(ModelRc::new(VecModel::from(lanes)));

        let rows = self
            .state
            .sessions
            .rows
            .iter()
            .map(|row| SessionListRowData {
                id: row.id as i32,
                title: row.title.clone().into(),
                preview: row.preview.clone().into(),
                meta: row.meta.clone().into(),
                source_label: row.source_label.clone().into(),
                workflow_label: row.workflow_label.clone().into(),
                labels_summary: row.labels_summary.clone().into(),
                selected: row.selected,
            })
            .collect::<Vec<_>>();
        sessions_store.set_session_rows(ModelRc::new(VecModel::from(rows)));

        let metadata_rows = self
            .state
            .sessions
            .detail
            .metadata_lines
            .iter()
            .map(|row| KeyValueRowData {
                key: row.key.clone().into(),
                value: row.value.clone().into(),
            })
            .collect::<Vec<_>>();
        sessions_store.set_session_metadata_rows(ModelRc::new(VecModel::from(metadata_rows)));

        let transcript_rows = self
            .state
            .sessions
            .detail
            .transcript_rows
            .iter()
            .map(|row| TranscriptRowData {
                heading: row.heading.clone().into(),
                detail: row.detail.clone().into(),
            })
            .collect::<Vec<_>>();
        sessions_store.set_transcript_rows(ModelRc::new(VecModel::from(transcript_rows)));

        let artifact_rows = self
            .state
            .sessions
            .detail
            .artifact_rows
            .iter()
            .map(|row| ArtifactRowData {
                heading: row.heading.clone().into(),
                detail: row.detail.clone().into(),
            })
            .collect::<Vec<_>>();
        sessions_store.set_artifact_rows(ModelRc::new(VecModel::from(artifact_rows)));

        sessions_store.set_sessions_empty_title(self.state.sessions.empty_title.clone().into());
        sessions_store.set_sessions_empty_message(self.state.sessions.empty_message.clone().into());
        let detail_title = match self.state.sessions.detail.id {
            Some(id) if !self.state.sessions.detail.title.is_empty() => {
                format!("{} · #{}", self.state.sessions.detail.title, id)
            }
            _ => self.state.sessions.detail.title.clone(),
        };
        sessions_store.set_session_detail_title(detail_title.into());
        sessions_store
            .set_session_detail_summary(self.state.sessions.detail.summary.clone().into());
        sessions_store
            .set_session_detail_labels(self.state.sessions.detail.labels_summary.clone().into());
        sessions_store
            .set_session_detail_tags(self.state.sessions.detail.tags_summary.clone().into());
        sessions_store
            .set_session_detail_empty_title(self.state.sessions.detail.empty_title.clone().into());
        sessions_store.set_session_detail_empty_message(
            self.state.sessions.detail.empty_message.clone().into(),
        );
    }

    fn render_logs(&self) {
        let logs_store = self.window.global::<LogsStore>();
        let rows = self
            .state
            .logs
            .rows
            .iter()
            .map(|row| LogRowData {
                id: row.id.clone().into(),
                title: row.title.clone().into(),
                subtitle: row.subtitle.clone().into(),
                status: row.status.clone().into(),
                selected: row.selected,
            })
            .collect::<Vec<_>>();
        logs_store.set_log_rows(ModelRc::new(VecModel::from(rows)));
        logs_store.set_logs_empty_title(self.state.logs.empty_title.clone().into());
        logs_store.set_logs_empty_message(self.state.logs.empty_message.clone().into());
        logs_store.set_log_detail_title(self.state.logs.detail.title.clone().into());
        logs_store.set_log_detail_status(self.state.logs.detail.status.clone().into());
        logs_store.set_log_detail_summary(self.state.logs.detail.summary.clone().into());
        logs_store.set_log_detail_metrics(self.state.logs.detail.metrics.clone().into());
        logs_store.set_log_detail_raw_json(self.state.logs.detail.raw_json.clone().into());
        logs_store
            .set_log_detail_empty_message(self.state.logs.detail.empty_message.clone().into());
        logs_store.set_active_log_filter(self.state.logs.filter.as_index());
    }

    fn render_db(&self) {
        let db_store = self.window.global::<DbStore>();
        let tables = self
            .state
            .db
            .tables
            .iter()
            .map(|row| TableRowData {
                name: row.name.clone().into(),
                kind: row.kind.clone().into(),
                selected: row.selected,
            })
            .collect::<Vec<_>>();
        db_store.set_db_tables(ModelRc::new(VecModel::from(tables)));

        let result_rows = self
            .state
            .db
            .browse
            .rows
            .iter()
            .map(|row| DbResultRowData {
                index: row.index as i32,
                preview: row.preview.clone().into(),
                selected: row.selected,
            })
            .collect::<Vec<_>>();
        db_store.set_db_result_rows(ModelRc::new(VecModel::from(result_rows)));

        let filter_columns = self
            .state
            .db
            .browse
            .available_filter_columns
            .iter()
            .map(|value| SharedString::from(value.as_str()))
            .collect::<Vec<_>>();
        db_store.set_db_filter_columns(ModelRc::new(VecModel::from(filter_columns)));

        let sort_columns = self
            .state
            .db
            .browse
            .available_sort_columns
            .iter()
            .map(|value| SharedString::from(value.as_str()))
            .collect::<Vec<_>>();
        db_store.set_db_sort_columns(ModelRc::new(VecModel::from(sort_columns)));

        let filter_ops = [
            "contains",
            "equals",
            "not_equals",
            "starts_with",
            "ends_with",
            "eq",
            "neq",
            "gt",
            "gte",
            "lt",
            "lte",
            "is_null",
            "is_not_null",
        ]
        .into_iter()
        .map(SharedString::from)
        .collect::<Vec<_>>();
        db_store.set_db_filter_operator_options(ModelRc::new(VecModel::from(filter_ops)));

        let sort_dirs = ["desc", "asc"]
            .into_iter()
            .map(SharedString::from)
            .collect::<Vec<_>>();
        db_store.set_db_sort_direction_options(ModelRc::new(VecModel::from(sort_dirs)));

        let summary = if self.state.db.browse.columns.is_empty() {
            self.state.db.browse.summary.clone()
        } else {
            format!(
                "{} · {} columns",
                self.state.db.browse.summary,
                self.state.db.browse.columns.len()
            )
        };
        db_store.set_db_summary(summary.into());
        db_store.set_db_error(self.state.db.browse.error.clone().into());
        db_store.set_db_row_detail(self.state.db.row_detail.clone().into());
        db_store.set_db_filter_column(self.state.db.filter.column.clone().into());
        db_store.set_db_filter_value(self.state.db.filter.value.clone().into());
        db_store.set_db_filter_operator(self.state.db.filter.operator.clone().into());
        db_store.set_db_sort_column(self.state.db.sort.column.clone().into());
        db_store.set_db_sort_direction(self.state.db.sort.direction.as_str().into());
        db_store.set_db_page_label(format!("Page {}", self.state.db.page.max(1)).into());
        db_store.set_db_query_sql(self.state.db.query.sql.clone().into());
        db_store.set_db_query_summary(self.state.db.query.summary.clone().into());
        db_store.set_db_query_preview(self.state.db.query.preview.clone().into());
        db_store.set_db_query_error(self.state.db.query.error.clone().into());
    }

    fn persist_preferences(&mut self) {
        self.state.prefs.route = self.state.route;
        self.state.prefs.selected_session_id = self.state.sessions.selected_id;
        self.state.prefs.selected_log_id = self.state.logs.selected_id.clone();
        self.state.prefs.selected_table_name = self.state.db.selected_table_name.clone();
        self.state.prefs.db_query_sql = self.state.db.query.sql.clone();
        let _ = save_preferences(&self.prefs_path, &self.state.prefs);
    }
}

#[derive(Clone, Copy, Debug)]
enum PaneWidth {
    Sessions,
    Logs,
    DbTables,
    DbRows,
}

#[derive(Clone, Copy, Debug)]
enum PageDelta {
    Prev,
    Next,
}

fn bind_callbacks(controller: &Rc<RefCell<DesktopController>>) {
    let window = controller.borrow().window.clone_strong();
    let sessions_store = window.global::<SessionsStore>();
    let logs_store = window.global::<LogsStore>();
    let db_store = window.global::<DbStore>();

    {
        let controller = Rc::downgrade(controller);
        window.on_nav_selected(move |index| {
            if let Some(controller) = controller.upgrade() {
                controller
                    .borrow_mut()
                    .switch_route(AppRoute::from_index(index));
            }
        });
    }

    {
        let controller = Rc::downgrade(controller);
        window.on_reload_requested(move || {
            if let Some(controller) = controller.upgrade() {
                controller.borrow_mut().reload_all();
            }
        });
    }

    {
        let controller = Rc::downgrade(controller);
        window.on_settings_requested(move || {
            if let Some(controller) = controller.upgrade() {
                let mut controller = controller.borrow_mut();
                controller.state.app_status_text =
                    "Settings persistence is wired, but the settings panel is not yet implemented."
                        .to_string();
                controller.render();
            }
        });
    }

    {
        let controller = Rc::downgrade(controller);
        window.on_global_search_edited(move |text| {
            if let Some(controller) = controller.upgrade() {
                controller
                    .borrow_mut()
                    .update_global_search(text.to_string());
            }
        });
    }

    {
        let controller = Rc::downgrade(controller);
        sessions_store.on_session_lane_selected(move |index| {
            if let Some(controller) = controller.upgrade() {
                controller
                    .borrow_mut()
                    .set_session_lane(SessionLane::from_index(index));
            }
        });
    }

    {
        let controller = Rc::downgrade(controller);
        sessions_store.on_session_selected(move |session_id| {
            if let Some(controller) = controller.upgrade() {
                controller.borrow_mut().select_session(session_id.into());
            }
        });
    }

    {
        let controller = Rc::downgrade(controller);
        logs_store.on_logs_filter_selected(move |index| {
            if let Some(controller) = controller.upgrade() {
                controller
                    .borrow_mut()
                    .set_log_filter(LogFilter::from_index(index));
            }
        });
    }

    {
        let controller = Rc::downgrade(controller);
        logs_store.on_log_selected(move |index| {
            if let Some(controller) = controller.upgrade() {
                let selected = controller
                    .borrow()
                    .state
                    .logs
                    .rows
                    .get(index as usize)
                    .map(|row| row.id.clone());
                if let Some(log_id) = selected {
                    controller.borrow_mut().select_log(log_id);
                }
            }
        });
    }

    {
        let controller = Rc::downgrade(controller);
        db_store.on_db_table_selected(move |index| {
            if let Some(controller) = controller.upgrade() {
                let selected = controller
                    .borrow()
                    .state
                    .db
                    .tables
                    .get(index as usize)
                    .map(|table| table.name.clone());
                if let Some(table_name) = selected {
                    controller.borrow_mut().select_db_table(table_name);
                }
            }
        });
    }

    {
        let controller = Rc::downgrade(controller);
        db_store.on_db_result_row_selected(move |index| {
            if let Some(controller) = controller.upgrade() {
                controller.borrow_mut().select_db_row(index as usize);
            }
        });
    }

    {
        let controller = Rc::downgrade(controller);
        db_store.on_db_filter_column_selected(move |value| {
            if let Some(controller) = controller.upgrade() {
                controller
                    .borrow_mut()
                    .set_db_filter_column(value.to_string());
            }
        });
    }

    {
        let controller = Rc::downgrade(controller);
        db_store.on_db_filter_operator_selected(move |value| {
            if let Some(controller) = controller.upgrade() {
                controller
                    .borrow_mut()
                    .set_db_filter_operator(value.to_string());
            }
        });
    }

    {
        let controller = Rc::downgrade(controller);
        db_store.on_db_filter_value_edited(move |value| {
            if let Some(controller) = controller.upgrade() {
                controller
                    .borrow_mut()
                    .set_db_filter_value(value.to_string());
            }
        });
    }

    {
        let controller = Rc::downgrade(controller);
        db_store.on_db_sort_column_selected(move |value| {
            if let Some(controller) = controller.upgrade() {
                controller
                    .borrow_mut()
                    .set_db_sort_column(value.to_string());
            }
        });
    }

    {
        let controller = Rc::downgrade(controller);
        db_store.on_db_sort_direction_selected(move |value| {
            if let Some(controller) = controller.upgrade() {
                controller
                    .borrow_mut()
                    .set_db_sort_direction(SortDirection::from_value(&value));
            }
        });
    }

    {
        let controller = Rc::downgrade(controller);
        db_store.on_db_query_sql_edited(move |value| {
            if let Some(controller) = controller.upgrade() {
                controller.borrow_mut().update_db_query(value.to_string());
            }
        });
    }

    {
        let controller = Rc::downgrade(controller);
        db_store.on_db_apply_filter_requested(move || {
            if let Some(controller) = controller.upgrade() {
                controller.borrow_mut().apply_db_browse();
            }
        });
    }

    {
        let controller = Rc::downgrade(controller);
        db_store.on_db_clear_filter_requested(move || {
            if let Some(controller) = controller.upgrade() {
                controller.borrow_mut().clear_db_filter();
            }
        });
    }

    {
        let controller = Rc::downgrade(controller);
        db_store.on_db_prev_page_requested(move || {
            if let Some(controller) = controller.upgrade() {
                controller.borrow_mut().change_db_page(PageDelta::Prev);
            }
        });
    }

    {
        let controller = Rc::downgrade(controller);
        db_store.on_db_next_page_requested(move || {
            if let Some(controller) = controller.upgrade() {
                controller.borrow_mut().change_db_page(PageDelta::Next);
            }
        });
    }

    {
        let controller = Rc::downgrade(controller);
        db_store.on_db_run_query_requested(move || {
            if let Some(controller) = controller.upgrade() {
                controller.borrow_mut().run_db_query();
            }
        });
    }

    {
        let controller = Rc::downgrade(controller);
        sessions_store.on_adjust_sessions_width(move |delta| {
            if let Some(controller) = controller.upgrade() {
                controller
                    .borrow_mut()
                    .adjust_split(PaneWidth::Sessions, delta);
            }
        });
    }

    {
        let controller = Rc::downgrade(controller);
        logs_store.on_adjust_logs_width(move |delta| {
            if let Some(controller) = controller.upgrade() {
                controller.borrow_mut().adjust_split(PaneWidth::Logs, delta);
            }
        });
    }

    {
        let controller = Rc::downgrade(controller);
        db_store.on_adjust_db_tables_width(move |delta| {
            if let Some(controller) = controller.upgrade() {
                controller
                    .borrow_mut()
                    .adjust_split(PaneWidth::DbTables, delta);
            }
        });
    }

    {
        let controller = Rc::downgrade(controller);
        db_store.on_adjust_db_rows_width(move |delta| {
            if let Some(controller) = controller.upgrade() {
                controller
                    .borrow_mut()
                    .adjust_split(PaneWidth::DbRows, delta);
            }
        });
    }
}

fn current_toolbar_search(state: &AppState) -> String {
    match state.route {
        AppRoute::Sessions => state.sessions.query.clone(),
        AppRoute::Logs => state.logs.query.clone(),
        AppRoute::Db => String::new(),
    }
}

fn reconcile_session_selection(rows: &mut [SessionListRowVm], current: Option<i64>) -> Option<i64> {
    let selected_id = current
        .filter(|candidate| rows.iter().any(|row| row.id == *candidate))
        .or_else(|| rows.first().map(|row| row.id));
    mark_selected_session_rows(rows, selected_id);
    selected_id
}

fn mark_selected_session_rows(rows: &mut [SessionListRowVm], selected_id: Option<i64>) {
    for row in rows {
        row.selected = Some(row.id) == selected_id;
    }
}

fn reconcile_log_selection(rows: &mut [LogCardVm], current: Option<String>) -> Option<String> {
    let selected_id = current
        .filter(|candidate| rows.iter().any(|row| row.id == *candidate))
        .or_else(|| rows.first().map(|row| row.id.clone()));
    for row in rows {
        row.selected = selected_id.as_deref() == Some(row.id.as_str());
    }
    selected_id
}

fn reconcile_db_row_selection(
    rows: &mut [DbResultRowVm],
    selected_row_index: &mut Option<usize>,
    row_detail: &mut String,
) {
    *selected_row_index = selected_row_index
        .filter(|candidate| rows.iter().any(|row| row.index == *candidate))
        .or_else(|| rows.first().map(|row| row.index));

    for row in rows.iter_mut() {
        row.selected = Some(row.index) == *selected_row_index;
    }

    *row_detail = rows
        .iter()
        .find(|row| Some(row.index) == *selected_row_index)
        .map(|row| row.detail.clone())
        .unwrap_or_default();
}

fn choose_valid_value(current: String, options: &[String]) -> String {
    if options.is_empty() {
        return String::new();
    }

    if options.iter().any(|option| option == &current) {
        current
    } else {
        options[0].clone()
    }
}

fn default_db_query() -> DbQueryVm {
    DbQueryVm {
        sql: "SELECT id, title, updated_at\nFROM sessions\nORDER BY updated_at DESC\nLIMIT 25;"
            .to_string(),
        ..DbQueryVm::default()
    }
}

fn empty_session_detail(title: &str, message: &str) -> SessionDetailVm {
    SessionDetailVm {
        empty_title: title.to_string(),
        empty_message: message.to_string(),
        ..SessionDetailVm::default()
    }
}

fn error_session_detail(error: &anyhow::Error) -> SessionDetailVm {
    SessionDetailVm {
        empty_title: "Session detail unavailable".to_string(),
        empty_message: error.to_string(),
        ..SessionDetailVm::default()
    }
}

fn empty_log_detail(message: &str) -> LogDetailVm {
    LogDetailVm {
        empty_message: message.to_string(),
        ..LogDetailVm::default()
    }
}

fn load_preferences(path: &std::path::Path) -> Result<DesktopPreferences> {
    if !path.exists() {
        return Ok(DesktopPreferences::default());
    }

    let bytes =
        std::fs::read(path).with_context(|| format!("failed to read {}", path.display()))?;
    let prefs = serde_json::from_slice(&bytes)
        .with_context(|| format!("failed to parse {}", path.display()))?;
    Ok(prefs)
}

fn save_preferences(path: &std::path::Path, prefs: &DesktopPreferences) -> Result<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .with_context(|| format!("failed to create {}", parent.display()))?;
    }
    let bytes = serde_json::to_vec_pretty(prefs)?;
    std::fs::write(path, bytes).with_context(|| format!("failed to write {}", path.display()))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{reconcile_db_row_selection, reconcile_log_selection, reconcile_session_selection};
    use crate::view_models::{DbResultRowVm, LogCardVm, SessionListRowVm};

    #[test]
    fn session_selection_falls_back_to_first_visible_row() {
        let mut rows = vec![
            SessionListRowVm {
                id: 7,
                ..SessionListRowVm::default()
            },
            SessionListRowVm {
                id: 8,
                ..SessionListRowVm::default()
            },
        ];

        let selected = reconcile_session_selection(&mut rows, Some(42));

        assert_eq!(selected, Some(7));
        assert!(rows[0].selected);
        assert!(!rows[1].selected);
    }

    #[test]
    fn log_selection_clears_when_no_rows_remain() {
        let mut rows = Vec::<LogCardVm>::new();

        let selected = reconcile_log_selection(&mut rows, Some("sync-9".to_string()));

        assert_eq!(selected, None);
    }

    #[test]
    fn db_row_selection_clears_stale_detail_when_rows_disappear() {
        let mut rows = Vec::<DbResultRowVm>::new();
        let mut selected_row_index = Some(4);
        let mut row_detail = "stale".to_string();

        reconcile_db_row_selection(&mut rows, &mut selected_row_index, &mut row_detail);

        assert_eq!(selected_row_index, None);
        assert!(row_detail.is_empty());
    }
}
