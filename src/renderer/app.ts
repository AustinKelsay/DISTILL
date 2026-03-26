import {
  AppSettingsSnapshot,
  BackgroundSyncStatus,
  DashboardData,
  DoctorReport,
  DiscoveredSource,
  ExportReport,
  SearchResult,
  SessionArtifact,
  SessionDetail,
  SessionListItem
} from "../shared/types";

declare global {
  interface Window {
    distillApi: {
      getDoctorReport: () => DoctorReport;
      getDashboardData: () => DashboardData;
      getSessionDetail: (sessionId: number) => SessionDetail | undefined;
      searchSessions: (query: string) => SearchResult[];
      addSessionTag: (sessionId: number, tagName: string) => void;
      removeSessionTag: (sessionId: number, tagId: number) => void;
      toggleSessionLabel: (sessionId: number, labelName: string) => void;
      getDefaultLabelNames: () => string[];
      exportSessionsByLabel: (label: string) => ExportReport;
      getAppSettings: () => AppSettingsSnapshot;
      getBackgroundSyncStatus: () => Promise<BackgroundSyncStatus>;
      requestBackgroundSync: () => Promise<BackgroundSyncStatus>;
      onBackgroundSyncStatus: (listener: (status: BackgroundSyncStatus) => void) => () => void;
    };
  }
}

let dashboardData: DashboardData | null = null;
let activeSessionId: number | null = null;
let exportTimeout: ReturnType<typeof setTimeout> | null = null;
let syncStatusUnsubscribe: (() => void) | null = null;
let isSettingsOpen = false;

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

function renderHelpTip(text: string, label = "?"): string {
  const safe = escapeHtml(text);
  return `<button class="help-tip" type="button" data-help-tip="${safe}" data-tooltip="${safe}" title="${safe}" aria-label="${safe}">${escapeHtml(label)}</button>`;
}

function tooltipAttrs(text: string): string {
  const safe = escapeHtml(text);
  return `data-tooltip="${safe}" title="${safe}"`;
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

function renderSyncStatus(status: BackgroundSyncStatus): void {
  const el = document.querySelector<HTMLElement>("[data-sync-status]");
  if (!el) return;

  const text =
    status.state === "running" ? "syncing..."
    : status.state === "failed" ? "sync failed"
    : status.finishedAt ? `synced ${timeAgo(status.finishedAt)}`
    : "idle";

  el.textContent = text;
  el.title = status.errorText ?? status.summary;
  el.dataset.state = status.state;
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
      <span class="source-name">${escapeHtml(source.displayName)} ${renderHelpTip(`Distill checks whether ${source.displayName} is installed locally and whether its expected data directories are present.`)}</span>
      <span class="source-path">${escapeHtml(source.dataRoot ?? "not found")}</span>
    </div>
    <div class="source-checks">${checks}</div>
  `;
}

/* Session list item */

function renderSessionItem(session: SessionListItem): string {
  const metaTooltip = `${session.sourceKind} session, ${session.messageCount} messages${session.model ? `, model ${session.model}` : ""}${session.gitBranch ? `, branch ${session.gitBranch}` : ""}`;
  return `
    <div class="session-item" data-session-id="${session.id}" ${tooltipAttrs(metaTooltip)}>
      <div class="session-item-title">${escapeHtml(session.title)}</div>
      <div class="session-item-meta">
        <span class="badge badge-source">${sourceLabel(session.sourceKind)}</span>
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
    <div class="session-item" data-session-id="${result.sessionId}" ${tooltipAttrs(`Search hit from ${result.sourceKind}. Click to open the full session transcript.`)}>
      <div class="session-item-title">${escapeHtml(result.title)}</div>
      <div class="session-item-meta">
        <span class="badge badge-source">${sourceLabel(result.sourceKind)}</span>
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
    <details class="artifact-card" ${tooltipAttrs("Expand to inspect the structured payload Distill extracted from the raw session capture.")}>
      <summary>
        <div class="artifact-title">${escapeHtml(artifact.summary)}</div>
        <div class="artifact-meta">${metaBits}</div>
        <div class="artifact-preview">${escapeHtml(artifact.payloadPreview)}</div>
      </summary>
      <pre class="artifact-payload">${escapeHtml(artifact.payloadJson)}</pre>
    </details>
  `;
}

function renderSettingsPanel(settings: AppSettingsSnapshot): string {
  const labels = settings.defaultLabels.map((label) => `<span class="chip chip-static" ${tooltipAttrs(`Default label: ${label}`)}>${escapeHtml(label)}</span>`).join("");
  const sources = settings.sourceKinds.map((source) =>
    `<div class="settings-row" ${tooltipAttrs(`${source} is part of the current local import pipeline.`)}><span>${escapeHtml(source)}</span><span class="settings-note">enabled</span></div>`
  ).join("");

  return `
    <div class="settings-overlay ${isSettingsOpen ? "visible" : ""}" data-settings-overlay>
      <section class="settings-panel" aria-hidden="${isSettingsOpen ? "false" : "true"}">
        <div class="settings-header">
          <div>
            <div class="section-title">Settings</div>
            <div class="settings-subtitle">Initial draft. Read-only for now.</div>
          </div>
          <button class="btn" type="button" data-settings-close ${tooltipAttrs("Close settings and return to the main transcript browser.")}>close</button>
        </div>

        <div class="settings-section">
          <div class="settings-section-title">Storage ${renderHelpTip("These are the local folders and database Distill is currently using. Environment variable overrides are shown so path issues are easier to diagnose.")}</div>
          <div class="settings-code" ${tooltipAttrs("Primary Distill working directory on this machine.")}>${escapeHtml(settings.distillHome)}</div>
          <div class="settings-row" ${tooltipAttrs("SQLite database path used for imported sessions, messages, artifacts, and curation state.")}><span>Database</span><span class="settings-note">${escapeHtml(settings.databasePath)}</span></div>
          <div class="settings-row" ${tooltipAttrs("Whether DISTILL_HOME is explicitly set in the environment instead of using the default ~/.distill path.")}><span>DISTILL_HOME override</span><span class="settings-note">${settings.envOverrides.distillHome ? "on" : "off"}</span></div>
        </div>

        <div class="settings-section">
          <div class="settings-section-title">Sources ${renderHelpTip("Distill currently reads from local Codex CLI, Claude Code, and OpenCode histories. These paths are where it expects to find those source files and databases.")}</div>
          ${sources}
          <div class="settings-row" ${tooltipAttrs("Local root used to discover Codex archived sessions and history files.")}><span>Codex root</span><span class="settings-note">${escapeHtml(settings.codexHome)}</span></div>
          <div class="settings-row" ${tooltipAttrs("Local root used to discover Claude Code project session files and history.")}><span>Claude root</span><span class="settings-note">${escapeHtml(settings.claudeHome)}</span></div>
          <div class="settings-row" ${tooltipAttrs("SQLite database path used to discover OpenCode sessions.")}><span>OpenCode DB</span><span class="settings-note">${escapeHtml(settings.opencodeDatabasePath)}</span></div>
          <div class="settings-row" ${tooltipAttrs("OpenCode config directory used for runtime configuration.")}><span>OpenCode config</span><span class="settings-note">${escapeHtml(settings.opencodeConfigDir)}</span></div>
          <div class="settings-row" ${tooltipAttrs("OpenCode state directory used for prompt history and related local state.")}><span>OpenCode state</span><span class="settings-note">${escapeHtml(settings.opencodeStateDir)}</span></div>
        </div>

        <div class="settings-section">
          <div class="settings-section-title">Sync ${renderHelpTip("Distill imports on startup and then checks for local changes on a fixed interval while the app is open.")}</div>
          <div class="settings-row" ${tooltipAttrs("How often Distill re-checks local source files while the app is open.")}><span>Background interval</span><span class="settings-note">every ${settings.backgroundSyncIntervalMinutes} min</span></div>
          <div class="settings-row" ${tooltipAttrs("You can force a refresh at any time with the sync button in the top bar.")}><span>Manual sync</span><span class="settings-note">top bar button</span></div>
        </div>

        <div class="settings-section">
          <div class="settings-section-title">Curation ${renderHelpTip("Labels are used for lightweight review states and export filters. They do not change the underlying transcript.")}</div>
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
    `<button class="chip ${activeLabels.has(name) ? "active" : ""}" data-toggle-label="${escapeHtml(name)}" ${tooltipAttrs(`${activeLabels.has(name) ? "Remove" : "Apply"} label "${name}" for export and review workflows.`)}>${escapeHtml(name)}</button>`
  ).join("");

  const tagChips = detail.tags.map((tag) =>
    `<button class="chip" data-remove-tag-id="${tag.id}" ${tooltipAttrs(`Remove tag "${tag.name}" from this session.`)}>#${escapeHtml(tag.name)} x</button>`
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
      <div class="detail-meta-inline">
        <span>${sourceLabel(detail.sourceKind)}</span>
        ${detail.model ? `<span>${escapeHtml(detail.model)}</span>` : ""}
        <span>${detail.messageCount} msgs</span>
        <span>${detail.artifactCount} artifacts ${renderHelpTip("Artifacts are non-message payloads such as images, tool calls, and tool results extracted from the raw capture.")}</span>
        ${detail.gitBranch ? `<span>\u2387 ${escapeHtml(detail.gitBranch)}</span>` : ""}
        ${detail.projectPath ? `<span>${escapeHtml(detail.projectPath)}</span>` : ""}
        <span>${timeAgo(detail.updatedAt)}</span>
      </div>
    </div>
    <div class="curation-bar">
      ${renderHelpTip("Use labels as lightweight review states for later export or filtering.")}
      ${labelChips}
      <span class="sep"></span>
      ${tagChips}
      <form data-tag-form style="display:inline-flex;gap:4px;margin:0">
        <input class="tag-input" type="text" name="tagName" placeholder="+ tag" ${tooltipAttrs("Add a free-form tag to this session, then press Enter.")} />
      </form>
    </div>
    ${artifacts}
    <div class="message-list">${messages}</div>
  `;

  bindDetailCuration(detail.id);
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

function bindExportActions(): void {
  for (const btn of document.querySelectorAll<HTMLElement>("[data-export-label]")) {
    btn.onclick = () => {
      const label = btn.dataset.exportLabel;
      if (!label) return;
      const report = window.distillApi.exportSessionsByLabel(label);
      showExportToast(`Exported ${report.recordCount} ${report.label} -> ${report.outputPath}`);
    };
  }

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

function bindHelpTips(): void {
  for (const tip of document.querySelectorAll<HTMLElement>("[data-help-tip]")) {
    tip.onclick = () => {
      const text = tip.dataset.helpTip;
      if (!text) return;
      showExportToast(text);
    };
  }
}

function bindTooltipPositions(): void {
  for (const el of document.querySelectorAll<HTMLElement>("[data-tooltip]")) {
    const updatePlacement = () => {
      const rect = el.getBoundingClientRect();
      if (rect.top < 72) {
        el.setAttribute("data-tooltip-below", "true");
      } else {
        el.removeAttribute("data-tooltip-below");
      }
    };

    el.onmouseenter = updatePlacement;
    el.onfocus = updatePlacement;
  }
}

function bindSettingsPanel(): void {
  const openBtn = document.querySelector<HTMLElement>("[data-settings-open]");
  const closeBtn = document.querySelector<HTMLElement>("[data-settings-close]");
  const overlay = document.querySelector<HTMLElement>("[data-settings-overlay]");

  if (openBtn) {
    openBtn.onclick = () => {
      isSettingsOpen = true;
      renderReport(window.distillApi.getDashboardData());
    };
  }

  if (closeBtn) {
    closeBtn.onclick = () => {
      isSettingsOpen = false;
      renderReport(window.distillApi.getDashboardData());
    };
  }

  if (overlay) {
    overlay.onclick = (event) => {
      if (event.target === overlay) {
        isSettingsOpen = false;
        renderReport(window.distillApi.getDashboardData());
      }
    };
  }
}

function refreshDashboard(): void {
  dashboardData = window.distillApi.getDashboardData();
  renderReport(dashboardData);
}

function bindBackgroundSync(): void {
  if (syncStatusUnsubscribe) {
    syncStatusUnsubscribe();
  }

  syncStatusUnsubscribe = window.distillApi.onBackgroundSyncStatus((status) => {
    renderSyncStatus(status);

    if (status.state === "completed") {
      refreshDashboard();
    }
  });
}

/* Main render */

function renderReport(report: DashboardData): void {
  const sources = document.querySelector<HTMLElement>("[data-sources]");
  const sessionsEl = document.querySelector<HTMLElement>("[data-sessions]");
  const statsEl = document.querySelector<HTMLElement>("[data-stats]");
  const countEl = document.querySelector<HTMLElement>("[data-session-count]");
  const scannedEl = document.querySelector<HTMLElement>("[data-scanned-at]");
  const onboarding = document.querySelector<HTMLElement>("[data-onboarding]");
  const settingsRoot = document.querySelector<HTMLElement>("[data-settings-root]");

  if (!sources || !sessionsEl || !settingsRoot) return;

  const totalSessions = report.sessions.length;
  const totalMessages = report.sessions.reduce((sum, session) => sum + session.messageCount, 0);
  const sourceCount = report.doctor.sources.filter((source) => source.installStatus === "installed").length;

  if (statsEl) {
    statsEl.innerHTML = `
      <span ${tooltipAttrs("Total imported sessions currently visible in Distill.")}><span class="stat-value">${totalSessions}</span> sessions</span>
      <span ${tooltipAttrs("Total normalized transcript messages across the current local database.")}><span class="stat-value">${totalMessages.toLocaleString()}</span> messages</span>
      <span ${tooltipAttrs("Number of supported local sources currently detected as installed.")}><span class="stat-value">${sourceCount}</span> sources</span>
    `;
  }

  if (countEl) countEl.textContent = `${totalSessions} sessions`;
  if (scannedEl) scannedEl.textContent = timeAgo(report.doctor.scannedAt);

  if (onboarding) {
    const needsOnboarding = totalSessions === 0;
    onboarding.classList.toggle("visible", needsOnboarding);
  }

  sources.innerHTML = report.doctor.sources.map(renderSource).join("");
  settingsRoot.innerHTML = renderSettingsPanel(window.distillApi.getAppSettings());
  const query = document.querySelector<HTMLInputElement>("[data-search-input]")?.value.trim() ?? "";
  const items = query ? window.distillApi.searchSessions(query) : report.sessions;
  renderSessionList(items);
  bindSearch(report);
  bindExportActions();
  bindSourcesToggle();
  bindHelpTips();
  bindTooltipPositions();
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

document.addEventListener("DOMContentLoaded", () => {
  dashboardData = window.distillApi.getDashboardData();
  renderReport(dashboardData);
  bindBackgroundSync();
  window.distillApi.getBackgroundSyncStatus().then(renderSyncStatus).catch(() => {
    renderSyncStatus({
      state: "failed",
      discoveredCaptures: 0,
      importedCaptures: 0,
      skippedCaptures: 0,
      summary: "Sync status unavailable",
      errorText: "Sync status unavailable"
    });
  });
});

export {};
