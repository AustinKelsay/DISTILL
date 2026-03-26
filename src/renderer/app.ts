import {
  DashboardData,
  DoctorReport,
  DiscoveredSource,
  ExportReport,
  SearchResult,
  SessionDetail,
  SessionLabel,
  SessionListItem
} from "../shared/types";
import { escapeHtml } from "../shared/html";

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
    };
  }
}

let dashboardData: DashboardData | null = null;
let activeSessionId: number | null = null;
let exportTimeout: ReturnType<typeof setTimeout> | null = null;

/* Helpers */

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

/* Sources */

function renderSource(source: DiscoveredSource): string {
  const dot = source.installStatus === "installed" ? "ok"
    : source.installStatus === "partial" ? "warn" : "miss";

  const checks = source.checks.map((check) => {
    const pillClass = check.exists ? "pill-ok" : "pill-miss";
    const pillText = check.exists ? "\u2713" : "\u2717";
    const count = typeof check.fileCount === "number" ? `${check.fileCount} files` : "";
    return `<div>
      <span class="pill ${pillClass}">${pillText}</span>
      ${escapeHtml(check.label)} <span style="color:var(--dim)">${escapeHtml(count)}</span>
    </div>`;
  }).join("");

  return `
    <div class="source-row">
      <span class="status-dot ${dot}"></span>
      <span class="source-name">${escapeHtml(source.displayName)}</span>
      <span class="source-path">${escapeHtml(source.dataRoot ?? "not found")}</span>
    </div>
    <div class="source-checks">${checks}</div>
  `;
}

/* Session list item */

function renderSessionItem(session: SessionListItem): string {
  return `
    <div class="session-item" data-session-id="${session.id}">
      <div class="session-item-title">${escapeHtml(session.title)}</div>
      <div class="session-item-meta">
        <span class="badge badge-source">${session.sourceKind === "claude_code" ? "claude" : "codex"}</span>
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
        <span class="badge badge-source">${result.sourceKind === "claude_code" ? "claude" : "codex"}</span>
        <span>${timeAgo(result.updatedAt)}</span>
      </div>
      <div class="session-item-preview">${escapeHtml(result.snippet)}</div>
    </div>
  `;
}

/* Session detail pane */

function renderSessionDetail(detail: SessionDetail | undefined): void {
  const root = document.querySelector<HTMLElement>("[data-session-detail]");
  if (!root) return;

  if (!detail) {
    root.innerHTML = `<div class="detail-empty">Select a session</div>`;
    activeSessionId = null;
    return;
  }

  activeSessionId = detail.id;

  const defaultLabels = window.distillApi.getDefaultLabelNames();
  const activeLabels = new Set(detail.labels.map((label) => label.name));
  const labelChips = defaultLabels.map((name) =>
    `<button class="chip ${activeLabels.has(name) ? "active" : ""}" data-toggle-label="${escapeHtml(name)}">${escapeHtml(name)}</button>`
  ).join("");

  const tagChips = detail.tags.map((tag) =>
    `<button class="chip" data-remove-tag-id="${tag.id}">#${escapeHtml(tag.name)} x</button>`
  ).join("");

  const messages = detail.messages.map((msg) => {
    const roleClass = msg.role === "user" ? "msg-user"
      : msg.role === "assistant" ? "msg-assistant" : "msg-system";
    return `
      <div class="msg ${roleClass}">
        <div class="msg-header">
          <span class="role">${escapeHtml(msg.role)}</span>
          <span>#${msg.ordinal}</span>
          <span>${timeAgo(msg.createdAt)}</span>
        </div>
        <div>${escapeHtml(msg.text)}</div>
      </div>
    `;
  }).join("");

  root.innerHTML = `
    <div class="detail-toolbar">
      <span class="detail-title">${escapeHtml(detail.title)}</span>
      <div class="detail-meta-inline">
        <span>${detail.sourceKind === "claude_code" ? "claude" : "codex"}</span>
        ${detail.model ? `<span>${escapeHtml(detail.model)}</span>` : ""}
        <span>${detail.messageCount} msgs</span>
        <span>${detail.artifactCount} artifacts</span>
        ${detail.gitBranch ? `<span>\u2387 ${escapeHtml(detail.gitBranch)}</span>` : ""}
        ${detail.projectPath ? `<span>${escapeHtml(detail.projectPath)}</span>` : ""}
        <span>${timeAgo(detail.updatedAt)}</span>
      </div>
    </div>
    <div class="curation-bar">
      ${labelChips}
      <span class="sep"></span>
      ${tagChips}
      <form data-tag-form style="display:inline-flex;gap:4px;margin:0">
        <input class="tag-input" type="text" name="tagName" placeholder="+ tag" />
      </form>
    </div>
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

  input.addEventListener("input", () => {
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
  });
}

function bindExportActions(): void {
  for (const btn of document.querySelectorAll<HTMLElement>("[data-export-label]")) {
    btn.addEventListener("click", () => {
      const label = btn.dataset.exportLabel;
      if (!label) return;
      const report = window.distillApi.exportSessionsByLabel(label);
      showExportToast(`Exported ${report.recordCount} ${report.label} -> ${report.outputPath}`);
    });
  }
}

function bindSourcesToggle(): void {
  const toggle = document.querySelector<HTMLElement>("[data-sources-toggle]");
  const panel = document.querySelector<HTMLElement>("[data-sources]");
  if (!toggle || !panel) return;

  toggle.addEventListener("click", () => {
    toggle.classList.toggle("open");
    panel.classList.toggle("visible");
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
  renderSessionList(report.sessions);
  bindSearch(report);
  bindExportActions();
  bindSourcesToggle();

  const first = report.sessions[0];
  if (first) {
    renderSessionDetail(window.distillApi.getSessionDetail(first.id));
    document.querySelector<HTMLElement>(`[data-session-id="${first.id}"]`)?.classList.add("selected");
  }
}

document.addEventListener("DOMContentLoaded", () => {
  dashboardData = window.distillApi.getDashboardData();
  renderReport(dashboardData);
});

export {};
