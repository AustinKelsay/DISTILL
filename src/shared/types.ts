export type SourceKind = "codex" | "claude_code";

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
