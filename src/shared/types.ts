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

export type ImportedCaptureStatus = "imported" | "failed" | "skipped";

export type ImportedCapture = {
  sourcePath: string;
  externalSessionId?: string;
  rawSha256: string;
  skipped: boolean;
  status: ImportedCaptureStatus;
  errorText?: string;
};

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
  sourceSummaries: Array<{
    kind: SourceKind;
    discoveredCaptures: number;
    importedCaptures: number;
    skippedCaptures: number;
  }>;
  captures: ImportedCapture[];
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
  startedAt?: string;
  finishedAt?: string;
  discoveredCaptures: number;
  importedCaptures: number;
  skippedCaptures: number;
  summary: string;
  errorText?: string;
};

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
