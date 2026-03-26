import {
  DashboardData,
  DoctorReport,
  DiscoveredSource,
  SearchResult,
  SessionDetail,
  SessionLabel,
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
    };
  }
}

let dashboardData: DashboardData | null = null;
let activeSessionId: number | null = null;

function renderSource(source: DiscoveredSource): string {
  const checks = source.checks
    .map((check) => {
      const count = typeof check.fileCount === "number" ? `<span class="count">${check.fileCount} files</span>` : "";
      const statusClass = check.exists ? "ok" : "missing";
      const statusLabel = check.exists ? "Found" : "Missing";

      return `
        <li class="check-row">
          <div>
            <div class="check-label">${check.label}</div>
            <div class="check-path">${check.path}</div>
          </div>
          <div class="check-meta">
            <span class="pill ${statusClass}">${statusLabel}</span>
            ${count}
          </div>
        </li>
      `;
    })
    .join("");

  return `
    <section class="source-card">
      <div class="source-header">
        <div>
          <p class="eyebrow">${source.kind}</p>
          <h2>${source.displayName}</h2>
        </div>
        <span class="status ${source.installStatus}">${source.installStatus.replace("_", " ")}</span>
      </div>
      <dl class="meta-grid">
        <div>
          <dt>Executable</dt>
          <dd>${source.executablePath ?? "Not found"}</dd>
        </div>
        <div>
          <dt>Data Root</dt>
          <dd>${source.dataRoot ?? "Unknown"}</dd>
        </div>
      </dl>
      <ul class="checks">${checks}</ul>
    </section>
  `;
}

function renderSession(session: SessionListItem): string {
  const updatedAt = session.updatedAt ? new Date(session.updatedAt).toLocaleString() : "Unknown";
  const preview = session.preview ? session.preview.slice(0, 220) : "No preview yet.";

  return `
    <article class="session-card" data-session-id="${session.id}">
      <div class="session-header">
        <span class="pill ok">${session.sourceKind}</span>
        <span class="count">${session.messageCount} msgs</span>
      </div>
      <h3>${session.title}</h3>
      <p class="session-project">${session.projectPath ?? "Unknown project"}</p>
      <p class="session-preview">${preview}</p>
      <dl class="session-meta">
        <div>
          <dt>Updated</dt>
          <dd>${updatedAt}</dd>
        </div>
        <div>
          <dt>Model</dt>
          <dd>${session.model ?? "Unknown"}</dd>
        </div>
        <div>
          <dt>Branch</dt>
          <dd>${session.gitBranch ?? "Unknown"}</dd>
        </div>
      </dl>
    </article>
  `;
}

function renderSearchResult(result: SearchResult): string {
  const updatedAt = result.updatedAt ? new Date(result.updatedAt).toLocaleString() : "Unknown";

  return `
    <article class="session-card search-result" data-session-id="${result.sessionId}">
      <div class="session-header">
        <span class="pill ok">${result.sourceKind}</span>
        <span class="count">${updatedAt}</span>
      </div>
      <h3>${result.title}</h3>
      <p class="session-project">${result.projectPath ?? "Unknown project"}</p>
      <p class="session-preview">${result.snippet}</p>
    </article>
  `;
}

function renderSessionDetail(detail: SessionDetail | undefined): void {
  const detailRoot = document.querySelector<HTMLElement>("[data-session-detail]");
  if (!detailRoot) {
    return;
  }

  if (!detail) {
    detailRoot.innerHTML = `
      <div class="detail-empty">
        <p class="eyebrow">Session Detail</p>
        <h2>Select a session</h2>
        <p>Choose any normalized conversation to inspect the transcript and metadata.</p>
      </div>
    `;
    return;
  }

  activeSessionId = detail.id;

  const tags = detail.tags.length
    ? detail.tags
        .map(
          (tag) => `
            <button class="tag-chip" data-remove-tag-id="${tag.id}" type="button">
              #${tag.name}
            </button>
          `
        )
        .join("")
    : `<span class="empty-note">No tags yet.</span>`;

  const defaultLabels = window.distillApi.getDefaultLabelNames();
  const activeLabels = new Set(detail.labels.map((label) => label.name));
  const labelButtons = defaultLabels
    .map((labelName) => {
      const active = activeLabels.has(labelName);
      return `
        <button class="label-chip ${active ? "active" : ""}" data-toggle-label="${labelName}" type="button">
          ${labelName}
        </button>
      `;
    })
    .join("");

  const messages = detail.messages
    .map((message) => {
      const createdAt = message.createdAt ? new Date(message.createdAt).toLocaleString() : "Unknown";
      return `
        <article class="message-row ${message.role}">
          <div class="message-meta">
            <span class="pill ok">${message.role}</span>
            <span class="count">#${message.ordinal}</span>
            <span class="count">${createdAt}</span>
          </div>
          <p>${message.text}</p>
        </article>
      `;
    })
    .join("");

  detailRoot.innerHTML = `
    <div class="detail-shell">
      <div class="detail-head">
        <div>
          <p class="eyebrow">Session Detail</p>
          <h2>${detail.title}</h2>
          <p class="detail-project">${detail.projectPath ?? "Unknown project"}</p>
        </div>
        <div class="detail-summary">
          <span class="pill ok">${detail.sourceKind}</span>
          <span class="count">${detail.messageCount} msgs</span>
          <span class="count">${detail.artifactCount} artifacts</span>
        </div>
      </div>
      <dl class="detail-meta">
        <div>
          <dt>Updated</dt>
          <dd>${detail.updatedAt ? new Date(detail.updatedAt).toLocaleString() : "Unknown"}</dd>
        </div>
        <div>
          <dt>Model</dt>
          <dd>${detail.model ?? "Unknown"}</dd>
        </div>
        <div>
          <dt>Branch</dt>
          <dd>${detail.gitBranch ?? "Unknown"}</dd>
        </div>
      </dl>
      <section class="curation-block">
        <div>
          <p class="eyebrow">Labels</p>
          <div class="chip-row">${labelButtons}</div>
        </div>
        <div>
          <p class="eyebrow">Tags</p>
          <div class="chip-row">${tags}</div>
          <form class="tag-form" data-tag-form>
            <input type="text" name="tagName" placeholder="Add a tag" />
            <button type="submit">Add tag</button>
          </form>
        </div>
      </section>
      <div class="message-list">${messages}</div>
    </div>
  `;

  bindDetailCuration(detail.id);
}

function refreshActiveSession(): void {
  if (activeSessionId === null) {
    return;
  }

  renderSessionDetail(window.distillApi.getSessionDetail(activeSessionId));
}

function bindDetailCuration(sessionId: number): void {
  const labelButtons = document.querySelectorAll<HTMLElement>("[data-toggle-label]");
  for (const button of labelButtons) {
    button.addEventListener("click", () => {
      const labelName = button.dataset.toggleLabel;
      if (!labelName) {
        return;
      }

      window.distillApi.toggleSessionLabel(sessionId, labelName);
      refreshActiveSession();
    });
  }

  const tagButtons = document.querySelectorAll<HTMLElement>("[data-remove-tag-id]");
  for (const button of tagButtons) {
    button.addEventListener("click", () => {
      const tagId = Number(button.dataset.removeTagId);
      if (!Number.isFinite(tagId)) {
        return;
      }

      window.distillApi.removeSessionTag(sessionId, tagId);
      refreshActiveSession();
    });
  }

  const form = document.querySelector<HTMLFormElement>("[data-tag-form]");
  if (form) {
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const input = form.elements.namedItem("tagName");
      if (!(input instanceof HTMLInputElement)) {
        return;
      }

      const tagName = input.value.trim();
      if (!tagName) {
        return;
      }

      window.distillApi.addSessionTag(sessionId, tagName);
      input.value = "";
      refreshActiveSession();
    });
  }
}

function bindSessionClicks(): void {
  const cards = document.querySelectorAll<HTMLElement>("[data-session-id]");
  for (const card of cards) {
    card.addEventListener("click", () => {
      const sessionId = Number(card.dataset.sessionId);
      if (!Number.isFinite(sessionId)) {
        return;
      }

      renderSessionDetail(window.distillApi.getSessionDetail(sessionId));

      for (const other of cards) {
        other.classList.toggle("selected", other === card);
      }
    });
  }
}

function renderSessionCollection(sessionsOrResults: Array<SessionListItem | SearchResult>): void {
  const sessions = document.querySelector<HTMLElement>("[data-sessions]");
  const sessionLead = document.querySelector<HTMLElement>("[data-session-lead]");
  if (!sessions || !sessionLead) {
    return;
  }

  const queryValue = document.querySelector<HTMLInputElement>("[data-search-input]")?.value.trim() ?? "";
  if (queryValue) {
    sessionLead.textContent = `Showing matches for "${queryValue}".`;
    sessions.innerHTML = (sessionsOrResults as SearchResult[]).map(renderSearchResult).join("");
  } else {
    sessionLead.textContent = "Browse the most recent normalized conversations from your local database.";
    sessions.innerHTML = (sessionsOrResults as SessionListItem[]).map(renderSession).join("");
  }

  bindSessionClicks();
}

function bindSearch(report: DashboardData): void {
  const input = document.querySelector<HTMLInputElement>("[data-search-input]");
  if (!input) {
    return;
  }

  input.addEventListener("input", () => {
    const query = input.value.trim();
    const collection = query ? window.distillApi.searchSessions(query) : report.sessions;
    renderSessionCollection(collection);

    const first = collection[0];
    renderSessionDetail(first ? window.distillApi.getSessionDetail("id" in first ? first.id : first.sessionId) : undefined);

    const firstId = first ? ("id" in first ? first.id : first.sessionId) : undefined;
    if (firstId !== undefined) {
      const firstCard = document.querySelector<HTMLElement>(`[data-session-id="${firstId}"]`);
      firstCard?.classList.add("selected");
    }
  });
}

function renderReport(report: DashboardData): void {
  const scannedAt = document.querySelector<HTMLElement>("[data-scanned-at]");
  const sources = document.querySelector<HTMLElement>("[data-sources]");
  const sessions = document.querySelector<HTMLElement>("[data-sessions]");

  if (!scannedAt || !sources || !sessions) {
    return;
  }

  scannedAt.textContent = new Date(report.doctor.scannedAt).toLocaleString();
  sources.innerHTML = report.doctor.sources.map(renderSource).join("");
  renderSessionCollection(report.sessions);
  bindSearch(report);

  const firstSession = report.sessions[0];
  renderSessionDetail(firstSession ? window.distillApi.getSessionDetail(firstSession.id) : undefined);

  if (firstSession) {
    const firstCard = document.querySelector<HTMLElement>(`[data-session-id="${firstSession.id}"]`);
    firstCard?.classList.add("selected");
  }
}

document.addEventListener("DOMContentLoaded", () => {
  dashboardData = window.distillApi.getDashboardData();
  renderReport(dashboardData);
});

export {};
