import { Hono } from "hono";
import { layout, escapeHtml } from "../views/layout.ts";
import { listRuns, getRunById, getResultsByRunId, countRuns } from "../../db/queries.ts";
import { formatDuration } from "../../core/reporter/console.ts";

const runs = new Hono();

const PAGE_SIZE = 20;

function statusBadge(total: number, passed: number, failed: number): string {
  if (total === 0) return `<span class="badge badge-skip">empty</span>`;
  if (failed > 0) return `<span class="badge badge-fail">fail</span>`;
  return `<span class="badge badge-pass">pass</span>`;
}

function stepStatusBadge(status: string): string {
  switch (status) {
    case "pass":
      return `<span class="badge badge-pass">✓</span>`;
    case "fail":
      return `<span class="badge badge-fail">✗</span>`;
    case "skip":
      return `<span class="badge badge-skip">○</span>`;
    case "error":
      return `<span class="badge badge-error">✗</span>`;
    default:
      return `<span class="badge">${escapeHtml(status)}</span>`;
  }
}

runs.get("/runs", (c) => {
  const page = Math.max(1, parseInt(c.req.query("page") ?? "1", 10) || 1);
  const offset = (page - 1) * PAGE_SIZE;
  const items = listRuns(PAGE_SIZE, offset);
  const total = countRuns();
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const rows = items
    .map(
      (r) => `<tr>
      <td><a href="/runs/${r.id}">#${r.id}</a></td>
      <td>${escapeHtml(r.started_at)}</td>
      <td>${r.total}</td>
      <td>${r.passed}</td>
      <td>${r.failed}</td>
      <td>${r.skipped}</td>
      <td>${r.duration_ms != null ? formatDuration(r.duration_ms) : "-"}</td>
      <td>${statusBadge(r.total, r.passed, r.failed)}</td>
    </tr>`,
    )
    .join("");

  let pagination = `<div class="pagination">`;
  if (page > 1) {
    pagination += `<a class="btn btn-sm btn-outline" hx-get="/runs?page=${page - 1}" hx-target="main" hx-push-url="true">← Prev</a>`;
  }
  pagination += `<span>Page ${page} of ${totalPages}</span>`;
  if (page < totalPages) {
    pagination += `<a class="btn btn-sm btn-outline" hx-get="/runs?page=${page + 1}" hx-target="main" hx-push-url="true">Next →</a>`;
  }
  pagination += `</div>`;

  const content = `
    <h1>Test Runs</h1>
    <table>
      <thead><tr>
        <th>ID</th><th>Date</th><th>Total</th><th>Pass</th><th>Fail</th><th>Skip</th><th>Duration</th><th>Status</th>
      </tr></thead>
      <tbody>${rows || "<tr><td colspan=\"8\">No runs yet</td></tr>"}</tbody>
    </table>
    ${pagination}`;

  const isHtmx = c.req.header("HX-Request") === "true";
  if (isHtmx) return c.html(content);
  return c.html(layout("Runs", content));
});

runs.get("/runs/:id", (c) => {
  const id = parseInt(c.req.param("id"), 10);
  if (isNaN(id)) return c.html(layout("Not Found", "<h1>Invalid run ID</h1>"), 400);

  const run = getRunById(id);
  if (!run) return c.html(layout("Not Found", "<h1>Run not found</h1>"), 404);

  const results = getResultsByRunId(id);

  // Group by suite
  const suites = new Map<string, typeof results>();
  for (const r of results) {
    const list = suites.get(r.suite_name) ?? [];
    list.push(r);
    suites.set(r.suite_name, list);
  }

  const headerHtml = `
    <h1>Run #${run.id}</h1>
    <div class="cards">
      <div class="card">
        <div class="card-label">Date</div>
        <div class="card-value" style="font-size:1rem">${escapeHtml(run.started_at)}</div>
      </div>
      <div class="card">
        <div class="card-label">Environment</div>
        <div class="card-value" style="font-size:1rem">${run.environment ? escapeHtml(run.environment) : "-"}</div>
      </div>
      <div class="card">
        <div class="card-label">Duration</div>
        <div class="card-value">${run.duration_ms != null ? formatDuration(run.duration_ms) : "-"}</div>
      </div>
      <div class="card">
        <div class="card-label">Results</div>
        <div class="card-value" style="font-size:1rem">${run.passed} ✓ ${run.failed} ✗ ${run.skipped} ○</div>
      </div>
    </div>`;

  // Build a map of which variables are captured by which step (for flow visualization)
  const captureSourceMap = new Map<string, string>(); // varName → step test_name

  // First pass: collect all captures
  for (const [, steps] of suites) {
    for (const step of steps) {
      if (step.captures && typeof step.captures === "object") {
        for (const varName of Object.keys(step.captures)) {
          captureSourceMap.set(varName, step.test_name);
        }
      }
    }
  }

  let suitesHtml = "";
  for (const [suiteName, steps] of suites) {
    // Detect if this suite has any captures (is a chain)
    const suiteHasCaptures = steps.some(s =>
      s.captures && typeof s.captures === "object" && Object.keys(s.captures).length > 0,
    );
    const isChainSuite = suiteHasCaptures || suiteName.endsWith("CRUD");

    const stepsHtml = steps
      .map((step, i) => {
        const detailId = `detail-${id}-${i}`;
        const hasFailed = step.status === "fail" || step.status === "error";

        // Capture badges
        let capturesHtml = "";
        if (step.captures && typeof step.captures === "object") {
          const captureEntries = Object.entries(step.captures);
          if (captureEntries.length > 0) {
            capturesHtml = captureEntries.map(([k, v]) =>
              `<span class="capture-badge">${escapeHtml(k)} = ${escapeHtml(String(v))}</span>`,
            ).join(" ");
          }
        }

        let assertionsHtml = "";
        if (step.assertions.length > 0) {
          const items = step.assertions
            .map(
              (a) =>
                `<li class="${a.passed ? "assertion-pass" : "assertion-fail"}">${escapeHtml(a.field)}: ${escapeHtml(a.rule)} (got ${escapeHtml(String(a.actual))})</li>`,
            )
            .join("");
          assertionsHtml = `<ul class="assertion-list">${items}</ul>`;
        }

        let requestHtml = "";
        if (step.request_method) {
          requestHtml = `<div><strong>Request:</strong> ${escapeHtml(step.request_method)} ${escapeHtml(step.request_url ?? "")}</div>`;
        }

        let errorHtml = "";
        if (step.error_message) {
          errorHtml = `<div><strong>Error:</strong> ${escapeHtml(step.error_message)}</div>`;
        }

        // Skip reason enhancement for chained steps
        let skipReasonHtml = "";
        if (step.status === "skip" && step.error_message) {
          const match = step.error_message.match(/Depends on missing capture: (\w+)/);
          if (match) {
            const depVar = match[1]!;
            const sourceStep = captureSourceMap.get(depVar);
            skipReasonHtml = sourceStep
              ? `<div class="skip-reason">Skipped: depends on <code>${escapeHtml(depVar)}</code> (from step "${escapeHtml(sourceStep)}")</div>`
              : `<div class="skip-reason">Skipped: depends on <code>${escapeHtml(depVar)}</code></div>`;
          }
        }

        const detailPanel = (hasFailed || skipReasonHtml)
          ? `<div class="detail-panel" id="${detailId}" style="display:none">
              ${requestHtml}
              ${errorHtml}
              ${skipReasonHtml}
              ${assertionsHtml}
            </div>`
          : "";

        const toggle = (hasFailed || skipReasonHtml)
          ? `onclick="var d=document.getElementById('${detailId}');d.style.display=d.style.display==='none'?'block':'none'"`
          : "";

        const chainedClass = isChainSuite ? " chained" : "";

        return `
          <div class="step-row${chainedClass}" ${toggle}>
            <div>${stepStatusBadge(step.status)}</div>
            <div class="step-name">${escapeHtml(step.test_name)}${capturesHtml ? ` ${capturesHtml}` : ""}</div>
            <div class="step-duration">${formatDuration(step.duration_ms)}</div>
          </div>
          ${detailPanel}`;
      })
      .join("");

    const chainClass = isChainSuite ? " chain-suite" : "";

    suitesHtml += `
      <div class="suite-section${chainClass}">
        <h2>${escapeHtml(suiteName)}</h2>
        ${isChainSuite ? '<div class="chain-connector">' : ""}
        ${stepsHtml}
        ${isChainSuite ? "</div>" : ""}
      </div>`;
  }

  const content = headerHtml + suitesHtml + `<div style="margin-top:1rem"><a href="/runs" class="btn btn-outline btn-sm">← Back to Runs</a></div>`;

  const isHtmx = c.req.header("HX-Request") === "true";
  if (isHtmx) return c.html(content);
  return c.html(layout(`Run #${id}`, content));
});

export default runs;
