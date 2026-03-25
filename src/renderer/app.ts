import { DoctorReport, DiscoveredSource } from "../shared/types";

declare global {
  interface Window {
    distillApi: {
      getDoctorReport: () => DoctorReport;
    };
  }
}

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

function renderReport(report: DoctorReport): void {
  const scannedAt = document.querySelector<HTMLElement>("[data-scanned-at]");
  const sources = document.querySelector<HTMLElement>("[data-sources]");

  if (!scannedAt || !sources) {
    return;
  }

  scannedAt.textContent = new Date(report.scannedAt).toLocaleString();
  sources.innerHTML = report.sources.map(renderSource).join("");
}

document.addEventListener("DOMContentLoaded", () => {
  renderReport(window.distillApi.getDoctorReport());
});

export {};
