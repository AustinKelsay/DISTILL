import { DashboardData, DoctorReport, DiscoveredSource, SessionDetail, SessionListItem } from "../shared/types";

declare global {
  interface Window {
    distillApi: {
      getDoctorReport: () => DoctorReport;
      getDashboardData: () => DashboardData;
      getSessionDetail: (sessionId: number) => SessionDetail | undefined;
    };
  }
}

let dashboardData: DashboardData | null = null;

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
      <div class="message-list">${messages}</div>
    </div>
  `;
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

function renderReport(report: DashboardData): void {
  const scannedAt = document.querySelector<HTMLElement>("[data-scanned-at]");
  const sources = document.querySelector<HTMLElement>("[data-sources]");
  const sessions = document.querySelector<HTMLElement>("[data-sessions]");

  if (!scannedAt || !sources || !sessions) {
    return;
  }

  scannedAt.textContent = new Date(report.doctor.scannedAt).toLocaleString();
  sources.innerHTML = report.doctor.sources.map(renderSource).join("");
  sessions.innerHTML = report.sessions.map(renderSession).join("");
  bindSessionClicks();

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
