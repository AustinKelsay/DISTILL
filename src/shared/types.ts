export type SourceKind = "codex" | "claude_code" | "opencode";

export type InstallStatus = "installed" | "not_found" | "partial";

export type SourcePathCheck = {
  label: string;
  path: string;
  exists: boolean;
  fileCount?: number;
};

export type DiscoveredSource = {
  kind: SourceKind;
  displayName: string;
  executablePath?: string;
  dataRoot?: string;
  installStatus: InstallStatus;
  checks: SourcePathCheck[];
  metadata: Record<string, unknown>;
};

export type DoctorReport = {
  scannedAt: string;
  sources: DiscoveredSource[];
};

export type DiscoveredCapture = {
  sourceKind: SourceKind;
  captureKind: string;
  sourcePath: string;
  externalSessionId?: string;
  sourceModifiedAt?: string;
  sourceSizeBytes?: number;
  metadata: Record<string, unknown>;
};

type ImportedCaptureBase = {
  sourcePath: string;
  externalSessionId?: string;
  rawSha256: string;
};

export type ImportedCapture =
  | (ImportedCaptureBase & {
    status: "imported";
    skipped?: false;
    errorText?: undefined;
  })
  | (ImportedCaptureBase & {
    status: "failed";
    skipped?: false;
    errorText: string;
  })
  | (ImportedCaptureBase & {
    status: "skipped";
    skipped: true;
    errorText?: undefined;
  });

export type ImportedCaptureStatus = ImportedCapture["status"];

export type ParsedCaptureRecord = {
  lineNo: number;
  recordType: string;
  recordTimestamp?: string;
  providerMessageId?: string;
  parentProviderMessageId?: string;
  role?: string;
  isMeta: boolean;
  contentText?: string;
  contentJson: Record<string, unknown>;
  metadata: Record<string, unknown>;
};

export type NormalizedSession = {
  sourceKind: SourceKind;
  externalSessionId: string;
  title?: string;
  projectPath?: string;
  sourceUrl?: string;
  model?: string;
  modelProvider?: string;
  cliVersion?: string;
  gitBranch?: string;
  startedAt?: string;
  updatedAt?: string;
  summary?: string;
  metadata: Record<string, unknown>;
};

export type NormalizedMessage = {
  sourceLineNo: number;
  externalMessageId?: string;
  parentExternalMessageId?: string;
  role: "user" | "assistant" | "system" | "tool";
  text: string;
  createdAt?: string;
  messageKind: "text" | "meta";
  metadata: Record<string, unknown>;
};

export type NormalizedArtifact = {
  sourceLineNo: number;
  externalMessageId?: string;
  kind: "image" | "file" | "tool_call" | "tool_result" | "raw_json";
  mimeType?: string;
  payload: Record<string, unknown>;
};

export type ParsedCapture = {
  session: NormalizedSession;
  messages: NormalizedMessage[];
  artifacts: NormalizedArtifact[];
  rawRecords: ParsedCaptureRecord[];
};

export type ImportReport = {
  importedAt: string;
  databasePath: string;
  distillHome: string;
  sourceSummaries: ImportSourceSummary[];
  failedEntries: ImportFailureEntry[];
  captures: ImportedCapture[];
};

export type ImportSourceSummary = {
  kind: SourceKind;
  discoveredCaptures: number;
  importedCaptures: number;
  skippedCaptures: number;
  failedCaptures: number;
};

export type ImportFailureEntry = {
  sourceKind: SourceKind;
  sourcePath: string;
  errorText: string;
};

export type ExportReport = {
  exportedAt: string;
  label: string;
  outputPath: string;
  recordCount: number;
};

export type BackgroundSyncStatus = {
  state: "idle" | "running" | "completed" | "failed";
  jobId?: number;
  reason?: string;
  startedAt?: string;
  finishedAt?: string;
  discoveredCaptures: number;
  importedCaptures: number;
  skippedCaptures: number;
  failedCaptures: number;
  summary: string;
  errorText?: string;
  sourceSummaries?: ImportSourceSummary[];
  failedEntries?: ImportFailureEntry[];
};

export type AppView = "sessions" | "logs";

export type LogEntryKind = "sync" | "export";

export type LogEntryStatus = "queued" | "running" | "completed" | "failed";

export type LogEntryLevel = "info" | "error";

export type LogEntry = {
  id: string;
  kind: LogEntryKind;
  status: LogEntryStatus;
  level: LogEntryLevel;
  title: string;
  summary: string;
  createdAt: string;
  updatedAt?: string;
  sourceLabel?: string;
  metrics?: {
    discoveredCaptures?: number;
    importedCaptures?: number;
    skippedCaptures?: number;
    failedCaptures?: number;
    recordCount?: number;
  };
  details?: {
    reason?: string;
    outputPath?: string;
    label?: string;
    sourceSummaries?: ImportSourceSummary[];
    failedEntries?: ImportFailureEntry[];
  };
  rawJson: string;
};

export type LogsPageData = {
  entries: LogEntry[];
  counts: {
    total: number;
    errors: number;
    running: number;
  };
  lastSyncStatus?: BackgroundSyncStatus;
};

export type SourceColors = Record<string, string>;

export type AppSettingsSnapshot = {
  distillHome: string;
  databasePath: string;
  codexHome: string;
  claudeHome: string;
  opencodeDatabasePath: string;
  opencodeConfigDir: string;
  opencodeStateDir: string;
  sourceKinds: SourceKind[];
  defaultLabels: string[];
  backgroundSyncIntervalMinutes: number;
  envOverrides: {
    distillHome: boolean;
    codexHome: boolean;
    claudeHome: boolean;
    opencodeConfigDir: boolean;
  };
  sourceColors: SourceColors;
};

export type SessionListItem = {
  id: number;
  sourceKind: SourceKind;
  title: string;
  projectPath?: string;
  updatedAt?: string;
  messageCount: number;
  model?: string;
  gitBranch?: string;
  preview?: string;
};

export type DashboardData = {
  doctor: DoctorReport;
  sessions: SessionListItem[];
};

export type SearchResult = {
  sessionId: number;
  sourceKind: SourceKind;
  title: string;
  projectPath?: string;
  updatedAt?: string;
  snippet: string;
};

export type SessionTag = {
  id: number;
  name: string;
  kind: string;
  origin: string;
};

export type SessionLabel = {
  id: number;
  name: string;
  scope: string;
  origin: string;
};

export type SessionDetailMessage = {
  id: number;
  ordinal: number;
  role: string;
  text: string;
  createdAt?: string;
  messageKind: "text" | "meta";
};

export type SessionArtifact = {
  id: number;
  kind: string;
  mimeType?: string;
  sourceLineNo?: number;
  messageOrdinal?: number;
  messageRole?: string;
  createdAt?: string;
  summary: string;
  payloadPreview: string;
  payloadJson: string;
};

export type SessionDetail = {
  id: number;
  sourceKind: SourceKind;
  title: string;
  projectPath?: string;
  updatedAt?: string;
  messageCount: number;
  model?: string;
  gitBranch?: string;
  preview?: string;
  artifactCount: number;
  tags: SessionTag[];
  labels: SessionLabel[];
  artifacts: SessionArtifact[];
  messages: SessionDetailMessage[];
};
