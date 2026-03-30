import {
  AppView,
  AppSettingsSnapshot,
  BackgroundSyncStatus,
  DashboardData,
  DoctorReport,
  DiscoveredSource,
  ExportReport,
  LogEntry,
  LogsPageData,
  SearchResult,
  SessionArtifact,
  SessionDetail,
  SessionListItem,
  SourceColors
} from "../shared/types";

declare global {
  interface Window {
    distillApi: {
      getDoctorReport: () => DoctorReport;
      getDashboardData: () => DashboardData;
      getSessionDetail: (sessionId: number) => SessionDetail | undefined;
      searchSessions: (query: string) => SearchResult[];
      getLogsPageData: () => LogsPageData;
      addSessionTag: (sessionId: number, tagName: string) => void;
      removeSessionTag: (sessionId: number, tagId: number) => void;
      toggleSessionLabel: (sessionId: number, labelName: string) => void;
      getDefaultLabelNames: () => string[];
      exportSessionsByLabel: (label: string) => ExportReport;
      setSourceColor: (sourceKind: string, color: string) => SourceColors;
      getAppSettings: () => AppSettingsSnapshot;
      getBackgroundSyncStatus: () => Promise<BackgroundSyncStatus>;
      requestBackgroundSync: () => Promise<BackgroundSyncStatus>;
      onBackgroundSyncStatus: (listener: (status: BackgroundSyncStatus) => void) => () => void;
    };
  }
}

let dashboardData: DashboardData | null = null;
let logsPageData: LogsPageData | null = null;
let activeSessionId: number | null = null;
let exportTimeout: ReturnType<typeof setTimeout> | null = null;
let syncStatusUnsubscribe: (() => void) | null = null;
let isSettingsOpen = false;
let tooltipPositionsBound = false;
let activeView: AppView = "sessions";
let logsSearchQuery = "";
let activeLogsFilter: "all" | "sync" | "export" | "errors" = "all";
let exportDropdownDismissBound = false;

/* Helpers */

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function timeAgo(dateStr: string | undefined): string {
  if (!dateStr) return "-";
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

function showExportToast(message: string): void {
  const el = document.querySelector<HTMLElement>("[data-export-status]");
  if (!el) return;
  el.textContent = message;
  el.classList.add("visible");
  if (exportTimeout) clearTimeout(exportTimeout);
  exportTimeout = setTimeout(() => el.classList.remove("visible"), 4000);
}

function renderHelpTip(text: string, title?: string, label = "?"): string {
  const safe = escapeHtml(text);
  const safeTitle = title ? ` data-help-title="${escapeHtml(title)}"` : "";
  return `<button class="help-tip" type="button" data-help-tip="${safe}"${safeTitle} aria-label="${safe}">${escapeHtml(label)}</button>`;
}

function tooltipAttrs(text: string): string {
  const safe = escapeHtml(text);
  return `data-tooltip="${safe}" title="${safe}"`;
}

function titleAttr(text: string): string {
  return `title="${escapeHtml(text)}"`;
}

function sourceLabel(sourceKind: SessionListItem["sourceKind"] | SearchResult["sourceKind"] | SessionDetail["sourceKind"]): string {
  if (sourceKind === "claude_code") {
    return "claude";
  }

  if (sourceKind === "opencode") {
    return "opencode";
  }

  return "codex";
}

function sourceBadgeClass(sourceKind: SessionListItem["sourceKind"] | SearchResult["sourceKind"] | SessionDetail["sourceKind"]): string {
  if (sourceKind === "claude_code") return "badge-source-claude";
  if (sourceKind === "opencode") return "badge-source-opencode";
  return "badge-source-codex";
}

function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function applySourceColors(colors: SourceColors): void {
  const root = document.documentElement;
  root.style.setProperty("--source-codex", colors.codex ?? "#3dbf9a");
  root.style.setProperty("--source-codex-bg", hexToRgba(colors.codex ?? "#3dbf9a", 0.14));
  root.style.setProperty("--source-claude", colors.claude_code ?? "#d4944a");
  root.style.setProperty("--source-claude-bg", hexToRgba(colors.claude_code ?? "#d4944a", 0.14));
  root.style.setProperty("--source-opencode", colors.opencode ?? "#a88cd4");
  root.style.setProperty("--source-opencode-bg", hexToRgba(colors.opencode ?? "#a88cd4", 0.14));
}

function renderSyncStatus(status: BackgroundSyncStatus): void {
  const el = document.querySelector<HTMLElement>("[data-sync-status]");
  if (!el) return;

  el.textContent = syncStatusText(status);
  el.title = status.errorText ?? status.summary;
  el.dataset.state = status.state;
}

function syncStatusText(status: BackgroundSyncStatus | undefined): string {
  if (!status) return "idle";

  return status.state === "running" ? "syncing..."
    : status.state === "failed" ? "sync failed"
    : status.finishedAt ? `synced ${timeAgo(status.finishedAt)}`
    : "idle";
}

function formatDateTime(dateStr: string | undefined): string {
  if (!dateStr) return "-";
  return new Date(dateStr).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}

function logStatusBadgeClass(entry: LogEntry): string {
  if (entry.status === "failed") return "badge-status-failed";
  if (entry.status === "running") return "badge-status-running";
  if (entry.status === "queued") return "badge-status-queued";
  if (entry.level === "error") return "badge-status-failed";
  return "badge-status-completed";
}

function renderLogMetrics(entry: LogEntry): string {
  if (!entry.metrics) {
    return "";
  }

  if (entry.kind === "sync") {
    const d = entry.metrics.discoveredCaptures ?? 0;
    const i = entry.metrics.importedCaptures ?? 0;
    const s = entry.metrics.skippedCaptures ?? 0;
    const f = entry.metrics.failedCaptures ?? 0;
    return `
      <div class="log-metrics">
        <span ${tooltipAttrs("Captures discovered from source directories")}>${d} found</span>
        <span ${tooltipAttrs("Captures imported into the database")}>${i} imported</span>
        <span ${tooltipAttrs("Captures already imported, unchanged")}>${s} skipped</span>
        <span ${tooltipAttrs("Captures that failed to parse or import")}>${f} failed</span>
      </div>
    `;
  }

  return `
    <div class="log-metrics">
      <span>${entry.sourceLabel ?? "export"}</span>
      <span>${entry.metrics.recordCount ?? 0} records</span>
    </div>
  `;
}

function renderLogEntry(entry: LogEntry): string {
  const details = entry.details;
  const sourceSummaries = details?.sourceSummaries?.length
    ? `
      <section class="log-detail-section">
        <div class="log-detail-title">Source Summary</div>
        <div class="log-source-summary-list">
          ${details.sourceSummaries.map((summary) => `
            <div class="log-source-summary">
              <span class="badge ${sourceBadgeClass(summary.kind)}">${sourceLabel(summary.kind)}</span>
              <span>${summary.discoveredCaptures} found</span>
              <span>${summary.importedCaptures} imported</span>
              <span>${summary.skippedCaptures} skipped</span>
              <span>${summary.failedCaptures} failed</span>
            </div>
          `).join("")}
        </div>
      </section>
    `
    : "";
  const failedEntries = details?.failedEntries?.length
    ? `
      <section class="log-detail-section">
        <div class="log-detail-title">Failures</div>
        <div class="log-failure-list">
          ${details.failedEntries.map((failure) => `
            <div class="log-failure-item">
              <div class="log-failure-head">
                <span class="badge ${sourceBadgeClass(failure.sourceKind)}">${sourceLabel(failure.sourceKind)}</span>
                <span class="log-failure-path">${escapeHtml(failure.sourcePath)}</span>
              </div>
              <div class="log-failure-copy">${escapeHtml(failure.errorText)}</div>
            </div>
          `).join("")}
        </div>
      </section>
    `
    : "";
  const detailRows = [
    details?.reason ? `<div class="log-detail-row"><span class="log-detail-key">Reason</span><span class="log-detail-value">${escapeHtml(details.reason)}</span></div>` : "",
    details?.label ? `<div class="log-detail-row"><span class="log-detail-key">Label</span><span class="log-detail-value">${escapeHtml(details.label)}</span></div>` : "",
    details?.outputPath ? `<div class="log-detail-row"><span class="log-detail-key">Output</span><span class="log-detail-value">${escapeHtml(details.outputPath)}</span></div>` : ""
  ].filter(Boolean).join("");

  return `
    <details class="log-card ${entry.level === "error" ? "is-error" : ""}">
      <summary>
        <div class="log-card-topline">
          <span class="log-timestamp">${escapeHtml(formatDateTime(entry.updatedAt ?? entry.createdAt))}</span>
          <span class="badge badge-log-kind">${escapeHtml(entry.kind)}</span>
          <span class="badge ${logStatusBadgeClass(entry)}">${escapeHtml(entry.status)}</span>
          ${entry.sourceLabel ? `<span class="log-source-label">${escapeHtml(entry.sourceLabel)}</span>` : ""}
        </div>
        <div class="log-card-title">${escapeHtml(entry.summary)}</div>
        <div class="log-card-subtitle">
          <span>${escapeHtml(entry.title)}</span>
          ${renderLogMetrics(entry)}
        </div>
      </summary>
      <div class="log-card-body">
        ${detailRows ? `<section class="log-detail-section">${detailRows}</section>` : ""}
        ${sourceSummaries}
        ${failedEntries}
        <section class="log-detail-section">
          <div class="log-detail-title">Raw</div>
          <pre class="log-raw">${escapeHtml(entry.rawJson)}</pre>
        </section>
      </div>
    </details>
  `;
}

function filteredLogEntries(data: LogsPageData): LogEntry[] {
  const query = logsSearchQuery.trim().toLowerCase();
  return data.entries.filter((entry) => {
    if (activeLogsFilter === "sync" && entry.kind !== "sync") return false;
    if (activeLogsFilter === "export" && entry.kind !== "export") return false;
    if (activeLogsFilter === "errors" && entry.level !== "error") return false;

    if (!query) return true;

    const haystack = [
      entry.kind,
      entry.status,
      entry.title,
      entry.summary,
      entry.sourceLabel,
      entry.details?.reason,
      entry.details?.label,
      entry.details?.outputPath,
      entry.rawJson,
      ...(entry.details?.failedEntries ?? []).flatMap((failure) => [failure.sourceKind, failure.sourcePath, failure.errorText])
    ]
      .filter(Boolean)
      .join("\n")
      .toLowerCase();

    return haystack.includes(query);
  });
}

function renderLogsView(data: LogsPageData): void {
  const root = document.querySelector<HTMLElement>("[data-session-detail]");
  if (!root) return;

  const entries = filteredLogEntries(data);
  const lastSyncLabel = syncStatusText(data.lastSyncStatus);
  const emptyState = data.entries.length === 0
    ? `
      <div class="detail-empty">
        <div class="empty-state">
          <div class="empty-title">No logs yet</div>
          <div class="empty-copy">Sync and export activity will show up here once Distill has operational history to surface.</div>
        </div>
      </div>
    `
    : `
      <div class="detail-empty">
        <div class="empty-state">
          <div class="empty-title">No matching logs</div>
          <div class="empty-copy">Adjust the log search or filters to widen the current result set.</div>
        </div>
      </div>
    `;

  root.innerHTML = `
    <div class="logs-view">
      <div class="logs-header">
        <div>
          <div class="detail-title">Logs</div>
          <div class="logs-subtitle">Operational sync and export history that normally only shows up in the shell.</div>
        </div>
        <div class="logs-summary">
          <span class="log-summary-chip">${data.counts.total} entries</span>
          <span class="log-summary-chip ${data.counts.errors ? "is-error" : ""}">${data.counts.errors} errors</span>
          <span class="log-summary-chip">${escapeHtml(lastSyncLabel)}</span>
        </div>
      </div>
      <div class="logs-controls">
        <input class="logs-search-input" type="search" placeholder="Search logs…" value="${escapeHtml(logsSearchQuery)}" data-logs-search />
        <div class="logs-filter-row">
          <button class="chip ${activeLogsFilter === "all" ? "active" : ""}" type="button" data-logs-filter="all">All</button>
          <button class="chip ${activeLogsFilter === "sync" ? "active" : ""}" type="button" data-logs-filter="sync">Sync</button>
          <button class="chip ${activeLogsFilter === "export" ? "active" : ""}" type="button" data-logs-filter="export">Exports</button>
          <button class="chip ${activeLogsFilter === "errors" ? "active" : ""}" type="button" data-logs-filter="errors">Errors</button>
        </div>
      </div>
      <div class="logs-list">
        ${entries.length ? entries.map(renderLogEntry).join("") : emptyState}
      </div>
    </div>
  `;

  bindLogsControls();
}

/* Sources */

function renderSource(source: DiscoveredSource): string {
  const dot = source.installStatus === "installed" ? "ok"
    : source.installStatus === "partial" ? "warn" : "miss";

  const checks = source.checks.map((check) => {
    const pillClass = check.exists ? "pill-ok" : "pill-miss";
    const pillText = check.exists ? "\u2713" : "\u2717";
    const count = typeof check.fileCount === "number" ? `${check.fileCount} files` : "";
    return `<div>
      <span class="pill ${pillClass}" ${tooltipAttrs(`${check.label}: ${check.exists ? "found" : "missing"} ${count}`.trim())}>${pillText}</span>
      ${escapeHtml(check.label)} <span style="color:var(--dim)">${escapeHtml(count)}</span>
    </div>`;
  }).join("");

  return `
    <div class="source-row" ${tooltipAttrs(`Source root: ${source.dataRoot ?? "not found"}`)}>
      <span class="status-dot ${dot}"></span>
      <span class="source-name">${escapeHtml(source.displayName)}</span>
      <span class="source-path">${escapeHtml(source.dataRoot ?? "not found")}</span>
    </div>
    <div class="source-checks">${checks}</div>
  `;
}

/* Session list item */

function renderSessionItem(session: SessionListItem): string {
  const metaTooltip = `${session.sourceKind} session, ${session.messageCount} messages${session.model ? `, model ${session.model}` : ""}${session.gitBranch ? `, branch ${session.gitBranch}` : ""}`;
  return `
    <div class="session-item" data-session-id="${session.id}" ${titleAttr(metaTooltip)}>
      <div class="session-item-title">${escapeHtml(session.title)}</div>
      <div class="session-item-meta">
        <span class="badge ${sourceBadgeClass(session.sourceKind)}">${sourceLabel(session.sourceKind)}</span>
        ${session.model ? `<span class="badge badge-model">${escapeHtml(session.model)}</span>` : ""}
        <span>${session.messageCount} msgs</span>
        <span>${timeAgo(session.updatedAt)}</span>
        ${session.gitBranch ? `<span>\u2387 ${escapeHtml(session.gitBranch)}</span>` : ""}
      </div>
      ${session.preview ? `<div class="session-item-preview">${escapeHtml(session.preview.slice(0, 140))}</div>` : ""}
    </div>
  `;
}

function renderSearchItem(result: SearchResult): string {
  return `
    <div class="session-item" data-session-id="${result.sessionId}">
      <div class="session-item-title">${escapeHtml(result.title)}</div>
      <div class="session-item-meta">
        <span class="badge ${sourceBadgeClass(result.sourceKind)}">${sourceLabel(result.sourceKind)}</span>
        <span>${timeAgo(result.updatedAt)}</span>
      </div>
      <div class="session-item-preview">${escapeHtml(result.snippet)}</div>
    </div>
  `;
}

function renderArtifact(artifact: SessionArtifact): string {
  const metaBits = [
    artifact.kind,
    artifact.mimeType,
    typeof artifact.messageOrdinal === "number" ? `msg #${artifact.messageOrdinal}` : undefined,
    typeof artifact.sourceLineNo === "number" ? `line ${artifact.sourceLineNo}` : undefined,
    artifact.createdAt ? timeAgo(artifact.createdAt) : undefined
  ].filter(Boolean).map((part) => `<span>${escapeHtml(String(part))}</span>`).join("");

  return `
    <details class="artifact-card">
      <summary>
        <div class="artifact-title">${escapeHtml(artifact.summary)}</div>
        <div class="artifact-meta">${metaBits}</div>
        <div class="artifact-preview">${escapeHtml(artifact.payloadPreview)}</div>
      </summary>
      <pre class="artifact-payload">${escapeHtml(artifact.payloadJson)}</pre>
    </details>
  `;
}

function renderSourceColorRow(sourceKind: string, displayName: string, color: string): string {
  return `
    <div class="color-picker-row">
      <span class="color-picker-label">${escapeHtml(displayName)}</span>
      <span class="color-picker-preview" style="background:${hexToRgba(color, 0.14)};color:${escapeHtml(color)}">${escapeHtml(displayName)}</span>
      <input type="color" class="color-picker-swatch" value="${escapeHtml(color)}" data-source-color="${escapeHtml(sourceKind)}" />
    </div>
  `;
}

function renderSettingsPanel(settings: AppSettingsSnapshot): string {
  const labels = settings.defaultLabels.map((label) => `<span class="chip chip-static">${escapeHtml(label)}</span>`).join("");
  const sources = settings.sourceKinds.map((source) =>
    `<div class="settings-row" ${tooltipAttrs(`${source} is part of the current local import pipeline.`)}><span>${escapeHtml(source)}</span><span class="settings-note">enabled</span></div>`
  ).join("");

  const colors = settings.sourceColors;
  const colorRows = [
    renderSourceColorRow("codex", "Codex", colors.codex ?? "#3dbf9a"),
    renderSourceColorRow("claude_code", "Claude", colors.claude_code ?? "#d4944a"),
    renderSourceColorRow("opencode", "OpenCode", colors.opencode ?? "#a88cd4")
  ].join("");

  return `
    <div class="settings-overlay ${isSettingsOpen ? "visible" : ""}" data-settings-overlay>
      <section class="settings-panel" aria-hidden="${isSettingsOpen ? "false" : "true"}">
        <div class="settings-header">
          <div>
            <div class="section-title">Settings</div>
            <div class="settings-subtitle">Source colors are editable. Other settings are read-only for now.</div>
          </div>
          <button class="btn-ghost" type="button" data-settings-close title="Close settings">\u2715</button>
        </div>

        <div class="settings-section">
          <div class="settings-section-title">Storage</div>
          <div class="settings-code">${escapeHtml(settings.distillHome)}</div>
          <div class="settings-row" ${tooltipAttrs("SQLite database path used for imported sessions, messages, artifacts, and curation state.")}><span>Database</span><span class="settings-note">${escapeHtml(settings.databasePath)}</span></div>
          <div class="settings-row" ${tooltipAttrs("Whether DISTILL_HOME is explicitly set in the environment instead of using the default ~/.distill path.")}><span>DISTILL_HOME override</span><span class="settings-note">${settings.envOverrides.distillHome ? "on" : "off"}</span></div>
        </div>

        <div class="settings-section">
          <div class="settings-section-title">Sources</div>
          ${sources}
          <div class="settings-row" ${tooltipAttrs("Local root used to discover Codex archived sessions and history files.")}><span>Codex root</span><span class="settings-note">${escapeHtml(settings.codexHome)}</span></div>
          <div class="settings-row" ${tooltipAttrs("Local root used to discover Claude Code project session files and history.")}><span>Claude root</span><span class="settings-note">${escapeHtml(settings.claudeHome)}</span></div>
          <div class="settings-row" ${tooltipAttrs("SQLite database path used to discover OpenCode sessions.")}><span>OpenCode DB</span><span class="settings-note">${escapeHtml(settings.opencodeDatabasePath)}</span></div>
          <div class="settings-row" ${tooltipAttrs("OpenCode config directory used for runtime configuration.")}><span>OpenCode config</span><span class="settings-note">${escapeHtml(settings.opencodeConfigDir)}</span></div>
          <div class="settings-row" ${tooltipAttrs("OpenCode state directory used for prompt history and related local state.")}><span>OpenCode state</span><span class="settings-note">${escapeHtml(settings.opencodeStateDir)}</span></div>
        </div>

        <div class="settings-section">
          <div class="settings-section-title">Source Colors</div>
          ${colorRows}
        </div>

        <div class="settings-section">
          <div class="settings-section-title">Sync</div>
          <div class="settings-row" ${tooltipAttrs("How often Distill re-checks local source files while the app is open.")}><span>Background interval</span><span class="settings-note">every ${settings.backgroundSyncIntervalMinutes} min</span></div>
          <div class="settings-row" ${tooltipAttrs("You can force a refresh at any time with the sync button in the top bar.")}><span>Manual sync</span><span class="settings-note">top bar button</span></div>
        </div>

        <div class="settings-section">
          <div class="settings-section-title">Curation</div>
          <div class="settings-chip-row">${labels}</div>
        </div>
      </section>
    </div>
  `;
}

/* Session detail pane */

function renderSessionDetail(detail: SessionDetail | undefined): void {
  const root = document.querySelector<HTMLElement>("[data-session-detail]");
  if (!root) return;

  if (!detail) {
    root.innerHTML = `
      <div class="detail-empty">
        <div class="empty-state">
          <div class="empty-title">Select a session</div>
          <div class="empty-copy">Choose a conversation from the left to inspect the transcript, labels, tags, and artifacts.</div>
        </div>
      </div>
    `;
    activeSessionId = null;
    return;
  }

  activeSessionId = detail.id;

  const defaultLabels = window.distillApi.getDefaultLabelNames();
  const activeLabels = new Set(detail.labels.map((label) => label.name));
  const labelChips = defaultLabels.map((name) =>
    `<button class="chip ${activeLabels.has(name) ? "active" : ""}" data-toggle-label="${escapeHtml(name)}" ${titleAttr(`${activeLabels.has(name) ? "Remove" : "Apply"} label "${name}"`)}>${escapeHtml(name)}</button>`
  ).join("");

  const tagChips = detail.tags.map((tag) =>
    `<span class="tag-chip"><span>#${escapeHtml(tag.name)}</span><button class="tag-remove" data-remove-tag-id="${tag.id}" title="Remove tag ${escapeHtml(tag.name)}">\u2715</button></span>`
  ).join("");

  const messages = detail.messages.map((msg) => {
    const roleClass = msg.role === "user" ? "msg-user"
      : msg.role === "assistant" ? "msg-assistant"
      : msg.role === "tool" ? "msg-tool" : "msg-system";
    return `
      <div class="msg ${roleClass} ${msg.messageKind === "meta" ? "msg-meta" : ""}">
        <div class="msg-header">
          <span class="role">${escapeHtml(msg.role)}</span>
          <span class="kind">${escapeHtml(msg.messageKind)}</span>
          <span>#${msg.ordinal}</span>
          <span>${timeAgo(msg.createdAt)}</span>
        </div>
        <div>${escapeHtml(msg.text)}</div>
      </div>
    `;
  }).join("");

  const artifacts = detail.artifacts.length
    ? `
      <section class="artifact-list">
        <div class="section-title">Artifacts</div>
        ${detail.artifacts.map(renderArtifact).join("")}
      </section>
    `
    : "";

  root.innerHTML = `
    <div class="detail-toolbar">
      <span class="detail-title">${escapeHtml(detail.title)}</span>
      <div class="dropdown" data-export-dropdown>
        <button class="btn btn-secondary" data-export-toggle>\u2913 Export</button>
        <div class="dropdown-menu" data-export-menu>
          <button class="dropdown-item" data-export-label="train">Export training set</button>
          <button class="dropdown-item" data-export-label="holdout">Export holdout set</button>
          <button class="dropdown-item" data-export-label="favorite">Export favorites</button>
        </div>
      </div>
      <div class="detail-meta-secondary">
        <span class="badge ${sourceBadgeClass(detail.sourceKind)}">${sourceLabel(detail.sourceKind)}</span>
        ${detail.model ? `<span>${escapeHtml(detail.model)}</span>` : ""}
        <span>${detail.messageCount} msgs</span>
        <span>${detail.artifactCount} artifacts ${renderHelpTip("Artifacts are tool calls, tool results, images, and files extracted from the conversation.", "Artifacts")}</span>
        ${detail.gitBranch ? `<span>\u2387 ${escapeHtml(detail.gitBranch)}</span>` : ""}
        ${detail.projectPath ? `<span>${escapeHtml(detail.projectPath)}</span>` : ""}
        <span>${timeAgo(detail.updatedAt)}</span>
      </div>
    </div>
    <div class="curation-bar">
      <div class="curation-group">
        <span class="curation-group-label">Labels</span>
        ${labelChips}
        ${renderHelpTip("Labels (train, holdout, favorite) control which export set a session belongs to. Tags are free-form notes you can add for your own organization.", "Labels & Tags")}
      </div>
      <div class="curation-group">
        <span class="curation-group-label">Tags</span>
        ${tagChips}
        <form data-tag-form style="display:inline-flex;gap:6px;margin:0;align-items:center">
          <input class="tag-input" type="text" name="tagName" placeholder="Add tag..." />
        </form>
      </div>
    </div>
    ${artifacts}
    <div class="message-list">${messages}</div>
  `;

  bindDetailCuration(detail.id);
  bindExportDropdown();
}

function refreshActiveSession(): void {
  if (activeSessionId === null) return;
  renderSessionDetail(window.distillApi.getSessionDetail(activeSessionId));
}

/* Event binding */

function bindDetailCuration(sessionId: number): void {
  for (const btn of document.querySelectorAll<HTMLElement>("[data-toggle-label]")) {
    btn.addEventListener("click", () => {
      const label = btn.dataset.toggleLabel;
      if (!label) return;
      window.distillApi.toggleSessionLabel(sessionId, label);
      refreshActiveSession();
    });
  }

  for (const btn of document.querySelectorAll<HTMLElement>("[data-remove-tag-id]")) {
    btn.addEventListener("click", () => {
      const tagId = Number(btn.dataset.removeTagId);
      if (!Number.isFinite(tagId)) return;
      window.distillApi.removeSessionTag(sessionId, tagId);
      refreshActiveSession();
    });
  }

  const form = document.querySelector<HTMLFormElement>("[data-tag-form]");
  if (form) {
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const input = form.elements.namedItem("tagName");
      if (!(input instanceof HTMLInputElement)) return;
      const name = input.value.trim();
      if (!name) return;
      window.distillApi.addSessionTag(sessionId, name);
      input.value = "";
      refreshActiveSession();
    });
  }
}

function bindSessionClicks(): void {
  const items = document.querySelectorAll<HTMLElement>("[data-session-id]");
  for (const item of items) {
    item.addEventListener("click", () => {
      const id = Number(item.dataset.sessionId);
      if (!Number.isFinite(id)) return;
      renderSessionDetail(window.distillApi.getSessionDetail(id));
      for (const other of items) other.classList.toggle("selected", other === item);
    });
  }
}

function renderSessionList(items: Array<SessionListItem | SearchResult>): void {
  const container = document.querySelector<HTMLElement>("[data-sessions]");
  if (!container) return;

  const query = document.querySelector<HTMLInputElement>("[data-search-input]")?.value.trim() ?? "";
  container.innerHTML = query
    ? (items as SearchResult[]).map(renderSearchItem).join("")
    : (items as SessionListItem[]).map(renderSessionItem).join("");

  bindSessionClicks();
}

function bindSearch(report: DashboardData): void {
  const input = document.querySelector<HTMLInputElement>("[data-search-input]");
  if (!input) return;

  input.oninput = () => {
    const q = input.value.trim();
    const items = q ? window.distillApi.searchSessions(q) : report.sessions;
    renderSessionList(items);

    const first = items[0];
    const firstId = first ? ("id" in first ? first.id : first.sessionId) : undefined;
    renderSessionDetail(firstId !== undefined ? window.distillApi.getSessionDetail(firstId) : undefined);

    if (firstId !== undefined) {
      document.querySelector<HTMLElement>(`[data-session-id="${firstId}"]`)?.classList.add("selected");
    }

    const countEl = document.querySelector<HTMLElement>("[data-session-count]");
    if (countEl) countEl.textContent = q ? `${items.length} results` : `${items.length} sessions`;
  };
}

function bindExportDropdown(): void {
  const toggle = document.querySelector<HTMLElement>("[data-export-toggle]");
  const menu = document.querySelector<HTMLElement>("[data-export-menu]");
  if (!toggle || !menu) return;

  toggle.onclick = (e) => {
    e.stopPropagation();
    menu.classList.toggle("visible");
  };

  for (const btn of menu.querySelectorAll<HTMLElement>("[data-export-label]")) {
    btn.onclick = () => {
      const label = btn.dataset.exportLabel;
      if (!label) return;
      const report = window.distillApi.exportSessionsByLabel(label);
      refreshLogsData(false);
      showExportToast(`Exported ${report.recordCount} ${report.label} \u2192 ${report.outputPath}`);
      menu.classList.remove("visible");
    };
  }

  if (!exportDropdownDismissBound) {
    document.addEventListener("click", (e) => {
      if (!(e.target instanceof Element)) return;
      if (!e.target.closest("[data-export-dropdown]")) {
        document.querySelector<HTMLElement>("[data-export-menu]")?.classList.remove("visible");
      }
    });
    exportDropdownDismissBound = true;
  }
}

function bindSyncButton(): void {
  const syncBtn = document.querySelector<HTMLElement>("[data-sync-now]");
  if (syncBtn) {
    syncBtn.onclick = async () => {
      syncBtn.setAttribute("disabled", "true");
      try {
        const status = await window.distillApi.requestBackgroundSync();
        renderSyncStatus(status);
      } finally {
        syncBtn.removeAttribute("disabled");
      }
    };
  }
}

function bindSourcesToggle(): void {
  const toggle = document.querySelector<HTMLElement>("[data-sources-toggle]");
  const panel = document.querySelector<HTMLElement>("[data-sources]");
  if (!toggle || !panel) return;

  toggle.onclick = () => {
    toggle.classList.toggle("open");
    panel.classList.toggle("visible");
  };
}

function positionFloating(floatEl: HTMLElement, anchorRect: DOMRect, preferAbove = true): void {
  const gap = 8;
  const pad = 12;

  // Reset so we can measure
  floatEl.style.left = "0px";
  floatEl.style.top = "0px";
  const floatRect = floatEl.getBoundingClientRect();
  const fw = floatRect.width;
  const fh = floatRect.height;
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  // Horizontal: center on anchor, clamp to viewport
  let left = anchorRect.left + anchorRect.width / 2 - fw / 2;
  left = Math.max(pad, Math.min(left, vw - fw - pad));

  // Vertical: prefer above, fall back to below
  let top: number;
  if (preferAbove && anchorRect.top - fh - gap >= pad) {
    top = anchorRect.top - fh - gap;
  } else if (anchorRect.bottom + fh + gap <= vh - pad) {
    top = anchorRect.bottom + gap;
  } else {
    // Last resort: whichever side has more room
    top = anchorRect.top - fh - gap >= 0
      ? Math.max(pad, anchorRect.top - fh - gap)
      : Math.min(vh - fh - pad, anchorRect.bottom + gap);
  }

  floatEl.style.left = `${left}px`;
  floatEl.style.top = `${top}px`;
}

function bindTooltips(): void {
  if (tooltipPositionsBound) return;

  const maybeFloat = document.querySelector<HTMLElement>("[data-tooltip-float]");
  if (!maybeFloat) return;
  const floatEl: HTMLElement = maybeFloat;

  let showTimeout: ReturnType<typeof setTimeout> | null = null;
  let activeEl: HTMLElement | null = null;

  function show(el: HTMLElement): void {
    const text = el.dataset.tooltip;
    if (!text) return;
    activeEl = el;
    floatEl.textContent = text;
    floatEl.classList.add("visible");
    positionFloating(floatEl, el.getBoundingClientRect(), true);
  }

  function hide(): void {
    if (showTimeout) { clearTimeout(showTimeout); showTimeout = null; }
    floatEl.classList.remove("visible");
    activeEl = null;
  }

  document.addEventListener("mouseenter", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const el = target.closest<HTMLElement>("[data-tooltip]");
    if (!el) return;
    hide();
    showTimeout = setTimeout(() => show(el), 250);
  }, true);

  document.addEventListener("mouseleave", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const el = target.closest<HTMLElement>("[data-tooltip]");
    if (el && el === activeEl) hide();
  }, true);

  document.addEventListener("scroll", hide, true);
  tooltipPositionsBound = true;
}

let helpTipsBound = false;

function bindHelpTips(): void {
  if (helpTipsBound) return;

  const maybePopover = document.querySelector<HTMLElement>("[data-help-popover]");
  if (!maybePopover) return;
  const popoverEl: HTMLElement = maybePopover;

  let activeHelpTip: HTMLElement | null = null;

  function dismissPopover(): void {
    popoverEl.classList.remove("visible");
    activeHelpTip = null;
  }

  // Event delegation: handles any [data-help-tip] click, including dynamically rendered ones
  document.addEventListener("click", (e) => {
    const target = e.target;
    if (!(target instanceof Element)) return;

    const tip = target.closest<HTMLElement>("[data-help-tip]");
    if (tip) {
      e.stopPropagation();
      const text = tip.dataset.helpTip;
      if (!text) return;

      // Toggle if clicking the same tip
      if (activeHelpTip === tip) {
        dismissPopover();
        return;
      }

      activeHelpTip = tip;
      const popoverTitle = tip.dataset.helpTitle || "Help";
      popoverEl.innerHTML = `<div class="help-popover-title">${escapeHtml(popoverTitle)}</div><div>${escapeHtml(text)}</div>`;
      popoverEl.classList.add("visible");
      positionFloating(popoverEl, tip.getBoundingClientRect(), true);
      return;
    }

    // Click-away dismissal
    if (!activeHelpTip) return;
    if (popoverEl.contains(target)) return;
    dismissPopover();
  });

  // Dismiss on scroll
  document.addEventListener("scroll", () => {
    if (activeHelpTip) dismissPopover();
  }, true);

  helpTipsBound = true;
}

function bindSourceColorPickers(): void {
  for (const input of document.querySelectorAll<HTMLInputElement>("[data-source-color]")) {
    input.oninput = () => {
      const sourceKind = input.dataset.sourceColor;
      if (!sourceKind) return;
      const colors = window.distillApi.setSourceColor(sourceKind, input.value);
      applySourceColors(colors);

      // Update the inline preview badge next to this picker
      const row = input.closest(".color-picker-row");
      const preview = row?.querySelector<HTMLElement>(".color-picker-preview");
      if (preview) {
        preview.style.background = hexToRgba(input.value, 0.14);
        preview.style.color = input.value;
      }
    };
  }
}

function bindSettingsPanel(): void {
  const openBtn = document.querySelector<HTMLElement>("[data-settings-open]");
  const closeBtn = document.querySelector<HTMLElement>("[data-settings-close]");
  const overlay = document.querySelector<HTMLElement>("[data-settings-overlay]");

  if (openBtn) {
    openBtn.onclick = () => {
      isSettingsOpen = true;
      renderCurrentView();
    };
  }

  if (closeBtn) {
    closeBtn.onclick = () => {
      isSettingsOpen = false;
      renderCurrentView();
    };
  }

  if (overlay) {
    overlay.onclick = (event) => {
      if (event.target === overlay) {
        isSettingsOpen = false;
        renderCurrentView();
      }
    };
  }

  bindSourceColorPickers();
}

function refreshDashboard(): void {
  dashboardData = window.distillApi.getDashboardData();
  if (activeView === "sessions") {
    renderCurrentView();
  }
}

function refreshLogsData(shouldRender = activeView === "logs"): void {
  logsPageData = window.distillApi.getLogsPageData();
  if (shouldRender) {
    renderCurrentView();
  }
}

function bindViewSwitch(): void {
  for (const btn of document.querySelectorAll<HTMLElement>("[data-view-target]")) {
    btn.onclick = () => {
      const target = btn.dataset.viewTarget;
      if (target !== "sessions" && target !== "logs") return;
      if (activeView === target) return;
      activeView = target;
      if (activeView === "logs") {
        refreshLogsData(false);
      }
      renderCurrentView();
    };
  }
}

function bindLogsControls(): void {
  const input = document.querySelector<HTMLInputElement>("[data-logs-search]");
  if (input) {
    input.oninput = () => {
      logsSearchQuery = input.value;
      if (logsPageData) {
        renderLogsView(logsPageData);
      }
    };
  }

  for (const btn of document.querySelectorAll<HTMLElement>("[data-logs-filter]")) {
    btn.onclick = () => {
      const filter = btn.dataset.logsFilter;
      if (filter !== "all" && filter !== "sync" && filter !== "export" && filter !== "errors") return;
      activeLogsFilter = filter;
      if (logsPageData) {
        renderLogsView(logsPageData);
      }
    };
  }
}

function bindBackgroundSync(): void {
  if (syncStatusUnsubscribe) {
    syncStatusUnsubscribe();
  }

  syncStatusUnsubscribe = window.distillApi.onBackgroundSyncStatus((status) => {
    renderSyncStatus(status);
    refreshLogsData(false);

    if (status.state === "completed") {
      dashboardData = window.distillApi.getDashboardData();
    }

    if (activeView === "logs" || status.state === "completed") {
      renderCurrentView();
    }
  });
}

/* Main render */

function renderSessionsView(report: DashboardData): void {
  const sources = document.querySelector<HTMLElement>("[data-sources]");
  const sessionsEl = document.querySelector<HTMLElement>("[data-sessions]");
  const statsEl = document.querySelector<HTMLElement>("[data-stats]");
  const countEl = document.querySelector<HTMLElement>("[data-session-count]");
  const scannedEl = document.querySelector<HTMLElement>("[data-scanned-at]");
  const onboarding = document.querySelector<HTMLElement>("[data-onboarding]");

  if (!sources || !sessionsEl) return;

  const totalSessions = report.sessions.length;
  const totalMessages = report.sessions.reduce((sum, session) => sum + session.messageCount, 0);
  const sourceCount = report.doctor.sources.filter((source) => source.installStatus === "installed").length;

  if (statsEl) {
    statsEl.innerHTML = `
      <span><span class="stat-value">${totalSessions}</span> sessions</span>
      <span><span class="stat-value">${totalMessages.toLocaleString()}</span> messages</span>
      <span><span class="stat-value">${sourceCount}</span> sources</span>
    `;
  }

  if (countEl) countEl.textContent = `${totalSessions} sessions`;
  if (scannedEl) scannedEl.textContent = timeAgo(report.doctor.scannedAt);

  if (onboarding) {
    const needsOnboarding = totalSessions === 0;
    onboarding.classList.toggle("visible", needsOnboarding);
  }

  sources.innerHTML = report.doctor.sources.map(renderSource).join("");
  const query = document.querySelector<HTMLInputElement>("[data-search-input]")?.value.trim() ?? "";
  const items = query ? window.distillApi.searchSessions(query) : report.sessions;
  renderSessionList(items);
  bindSearch(report);
  bindSyncButton();
  bindSourcesToggle();
  bindHelpTips();
  bindTooltips();
  bindSettingsPanel();

  if (countEl) countEl.textContent = query ? `${items.length} results` : `${totalSessions} sessions`;

  const preferredId =
    activeSessionId !== null && window.distillApi.getSessionDetail(activeSessionId)
      ? activeSessionId
      : items[0] ? ("id" in items[0] ? items[0].id : items[0].sessionId) : undefined;

  if (preferredId !== undefined) {
    renderSessionDetail(window.distillApi.getSessionDetail(preferredId));
    document.querySelector<HTMLElement>(`[data-session-id="${preferredId}"]`)?.classList.add("selected");
  } else {
    renderSessionDetail(undefined);
  }
}

function renderCurrentView(): void {
  const app = document.querySelector<HTMLElement>("[data-app-shell]");
  const onboarding = document.querySelector<HTMLElement>("[data-onboarding]");
  const searchInput = document.querySelector<HTMLInputElement>("[data-search-input]");
  const statsEl = document.querySelector<HTMLElement>("[data-stats]");
  const settingsRoot = document.querySelector<HTMLElement>("[data-settings-root]");
  const appSettings = window.distillApi.getAppSettings();

  if (document.body) {
    document.body.dataset.appView = activeView;
  }

  app?.classList.toggle("logs-mode", activeView === "logs");
  searchInput?.classList.toggle("is-hidden", activeView === "logs");

  for (const btn of document.querySelectorAll<HTMLElement>("[data-view-target]")) {
    btn.classList.toggle("active", btn.dataset.viewTarget === activeView);
  }

  if (activeView === "logs") {
    onboarding?.classList.remove("visible");
    if (statsEl) {
      statsEl.innerHTML = "";
    }
    if (logsPageData) {
      renderLogsView(logsPageData);
    } else {
      refreshLogsData(false);
      renderLogsView(logsPageData ?? { entries: [], counts: { total: 0, errors: 0, running: 0 } });
    }
  } else if (dashboardData) {
    renderSessionsView(dashboardData);
  }

  if (settingsRoot) {
    settingsRoot.innerHTML = renderSettingsPanel(appSettings);
  }
  applySourceColors(appSettings.sourceColors);
  bindSyncButton();
  bindViewSwitch();
  bindHelpTips();
  bindTooltips();
  bindSettingsPanel();
}

document.addEventListener("DOMContentLoaded", () => {
  dashboardData = window.distillApi.getDashboardData();
  logsPageData = window.distillApi.getLogsPageData();
  renderCurrentView();
  bindBackgroundSync();
  window.distillApi.getBackgroundSyncStatus().then(renderSyncStatus).catch(() => {
    renderSyncStatus({
      state: "failed",
      discoveredCaptures: 0,
      importedCaptures: 0,
      skippedCaptures: 0,
      failedCaptures: 0,
      summary: "Sync status unavailable",
      errorText: "Sync status unavailable"
    });
  });
});

export {};
