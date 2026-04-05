use std::path::PathBuf;

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq, serde::Serialize, serde::Deserialize)]
pub enum AppRoute {
    #[default]
    Sessions,
    Logs,
    Db,
}

impl AppRoute {
    pub fn as_index(self) -> i32 {
        match self {
            Self::Sessions => 0,
            Self::Logs => 1,
            Self::Db => 2,
        }
    }

    pub fn from_index(index: i32) -> Self {
        match index {
            1 => Self::Logs,
            2 => Self::Db,
            _ => Self::Sessions,
        }
    }
}

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub enum SessionLane {
    #[default]
    All,
    NeedsReview,
    TrainReady,
    HoldoutReady,
    Favorite,
}

impl SessionLane {
    pub const ALL: [Self; 5] = [
        Self::All,
        Self::NeedsReview,
        Self::TrainReady,
        Self::HoldoutReady,
        Self::Favorite,
    ];

    pub fn label(self) -> &'static str {
        match self {
            Self::All => "All",
            Self::NeedsReview => "Needs Review",
            Self::TrainReady => "Train Ready",
            Self::HoldoutReady => "Holdout Ready",
            Self::Favorite => "Favorites",
        }
    }

    pub fn from_index(index: i32) -> Self {
        match index {
            1 => Self::NeedsReview,
            2 => Self::TrainReady,
            3 => Self::HoldoutReady,
            4 => Self::Favorite,
            _ => Self::All,
        }
    }
}

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub enum SessionWorkflowState {
    NeedsReview,
    TrainReady,
    HoldoutReady,
    Favorite,
    #[default]
    Neutral,
}

impl SessionWorkflowState {
    pub fn label(self) -> &'static str {
        match self {
            Self::NeedsReview => "Needs Review",
            Self::TrainReady => "Train Ready",
            Self::HoldoutReady => "Holdout Ready",
            Self::Favorite => "Favorite",
            Self::Neutral => "Neutral",
        }
    }
}

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub enum LogFilter {
    #[default]
    All,
    Sync,
    Export,
    Errors,
}

impl LogFilter {
    pub fn from_index(index: i32) -> Self {
        match index {
            1 => Self::Sync,
            2 => Self::Export,
            3 => Self::Errors,
            _ => Self::All,
        }
    }

    pub fn as_index(self) -> i32 {
        match self {
            Self::All => 0,
            Self::Sync => 1,
            Self::Export => 2,
            Self::Errors => 3,
        }
    }
}

#[derive(Clone, Debug, Default)]
pub struct DataSourceConfig {
    pub distill_home: PathBuf,
    pub mode: DataSourceMode,
}

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub enum DataSourceMode {
    #[default]
    ElectronCompatReadOnly,
}

#[derive(Clone, Debug, Default)]
pub struct AppSnapshotVm {
    pub distill_home: PathBuf,
    pub database_path: PathBuf,
    pub database_exists: bool,
    pub source_mode_label: String,
    pub app_status_text: String,
    pub source_badge_text: String,
    pub session_count: usize,
    pub log_count: usize,
    pub table_count: usize,
}

#[derive(Clone, Debug, Default)]
pub struct SessionsPageVm {
    pub rows: Vec<SessionListRowVm>,
    pub empty_title: String,
    pub empty_message: String,
}

#[derive(Clone, Debug, Default)]
pub struct SessionListRowVm {
    pub id: i64,
    pub title: String,
    pub preview: String,
    pub meta: String,
    pub source_label: String,
    pub workflow_label: String,
    pub labels_summary: String,
    pub selected: bool,
}

#[derive(Clone, Debug, Default)]
pub struct SessionDetailVm {
    pub id: Option<i64>,
    pub title: String,
    pub summary: String,
    pub metadata_lines: Vec<KeyValueRowVm>,
    pub labels_summary: String,
    pub tags_summary: String,
    pub transcript_rows: Vec<TranscriptRowVm>,
    pub artifact_rows: Vec<ArtifactRowVm>,
    pub empty_title: String,
    pub empty_message: String,
}

#[derive(Clone, Debug, Default)]
pub struct KeyValueRowVm {
    pub key: String,
    pub value: String,
}

#[derive(Clone, Debug, Default)]
pub struct TranscriptRowVm {
    pub heading: String,
    pub detail: String,
}

#[derive(Clone, Debug, Default)]
pub struct ArtifactRowVm {
    pub heading: String,
    pub detail: String,
}

#[derive(Clone, Debug, Default)]
pub struct LogsPageVm {
    pub rows: Vec<LogCardVm>,
    pub detail: LogDetailVm,
    pub empty_title: String,
    pub empty_message: String,
}

#[derive(Clone, Debug, Default)]
pub struct LogCardVm {
    pub id: String,
    pub title: String,
    pub subtitle: String,
    pub status: String,
    pub selected: bool,
}

#[derive(Clone, Debug, Default)]
pub struct LogDetailVm {
    pub title: String,
    pub status: String,
    pub summary: String,
    pub metrics: String,
    pub raw_json: String,
    pub empty_message: String,
}

#[derive(Clone, Debug, Default)]
pub struct DbExplorerVm {
    pub tables: Vec<DbTableVm>,
    pub selected_table_name: Option<String>,
    pub filter_column: String,
    pub sort_column: String,
    pub sort_direction: String,
    pub browse: DbBrowseVm,
}

#[derive(Clone, Debug, Default)]
pub struct DbTableVm {
    pub name: String,
    pub kind: String,
    pub selected: bool,
}

#[derive(Clone, Debug, Default)]
pub struct DbBrowseVm {
    pub columns: Vec<String>,
    pub rows: Vec<DbResultRowVm>,
    pub summary: String,
    pub error: String,
    pub available_filter_columns: Vec<String>,
    pub available_sort_columns: Vec<String>,
}

#[derive(Clone, Debug, Default)]
pub struct DbResultRowVm {
    pub index: usize,
    pub preview: String,
    pub detail: String,
    pub selected: bool,
}

#[derive(Clone, Debug, Default)]
pub struct DbQueryVm {
    pub sql: String,
    pub summary: String,
    pub preview: String,
    pub error: String,
}
