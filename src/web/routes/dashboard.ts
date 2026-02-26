import { Hono } from "hono";
import { layout, escapeHtml } from "../views/layout.ts";
import {
  getDashboardStats,
  getSlowestTests,
  getFlakyTests,
  listRuns,
} from "../../db/queries.ts";
import { formatDuration } from "../../core/reporter/console.ts";

const dashboard = new Hono();

function statusBadge(total: number, passed: number, failed: number): string {
  if (total === 0) return `<span class="badge badge-skip">empty</span>`;
  if (failed > 0) return `<span class="badge badge-fail">fail</span>`;
  return `<span class="badge badge-pass">pass</span>`;
}

function progressBar(total: number, passed: number, failed: number, skipped: number): string {
  if (total === 0) return `<div class="progress-bar"><div class="progress-skip" style="width:100%"></div></div>`;
  const pP = (passed / total) * 100;
  const pF = (failed / total) * 100;
  const pS = (skipped / total) * 100;
  return `<div class="progress-bar">
    <div class="progress-pass" style="width:${pP}%"></div>
    <div class="progress-fail" style="width:${pF}%"></div>
    <div class="progress-skip" style="width:${pS}%"></div>
  </div>`;
}

function metricsHtml(): string {
  const stats = getDashboardStats();
  const recent = listRuns(5, 0);
  const slowest = getSlowestTests(5);
  const flaky = getFlakyTests(20, 5);

  const cards = `
    <div class="cards">
      <div class="card">
        <div class="card-label">Total Runs</div>
        <div class="card-value">${stats.totalRuns}</div>
      </div>
      <div class="card">
        <div class="card-label">Total Tests</div>
        <div class="card-value">${stats.totalTests}</div>
      </div>
      <div class="card">
        <div class="card-label">Pass Rate</div>
        <div class="card-value">${stats.overallPassRate}%</div>
      </div>
      <div class="card">
        <div class="card-label">Avg Duration</div>
        <div class="card-value">${formatDuration(stats.avgDuration)}</div>
      </div>
    </div>`;

  const recentRows = recent
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

  const recentTable = `
    <div class="section-title">Recent Runs</div>
    <table>
      <thead><tr>
        <th>ID</th><th>Date</th><th>Total</th><th>Pass</th><th>Fail</th><th>Skip</th><th>Duration</th><th>Status</th>
      </tr></thead>
      <tbody>${recentRows || "<tr><td colspan=\"8\">No runs yet</td></tr>"}</tbody>
    </table>
    <a href="/runs" class="btn btn-outline btn-sm" hx-get="/runs" hx-target="main" hx-push-url="true">View all runs</a>`;

  const slowRows = slowest
    .map(
      (t) => `<tr>
      <td>${escapeHtml(t.suite_name)}</td>
      <td>${escapeHtml(t.test_name)}</td>
      <td>${formatDuration(t.avg_duration)}</td>
    </tr>`,
    )
    .join("");

  const slowTable = `
    <div class="section-title">Slowest Tests</div>
    <table>
      <thead><tr><th>Suite</th><th>Test</th><th>Avg Duration</th></tr></thead>
      <tbody>${slowRows || "<tr><td colspan=\"3\">No data</td></tr>"}</tbody>
    </table>`;

  const flakyRows = flaky
    .map(
      (t) => `<tr>
      <td>${escapeHtml(t.suite_name)}</td>
      <td>${escapeHtml(t.test_name)}</td>
      <td>${t.distinct_statuses} statuses</td>
    </tr>`,
    )
    .join("");

  const flakyTable = `
    <div class="section-title">Flaky Tests</div>
    <table>
      <thead><tr><th>Suite</th><th>Test</th><th>Variation</th></tr></thead>
      <tbody>${flakyRows || "<tr><td colspan=\"3\">No flaky tests detected</td></tr>"}</tbody>
    </table>`;

  return cards + recentTable + slowTable + flakyTable;
}

dashboard.get("/", (c) => {
  const isHtmx = c.req.header("HX-Request") === "true";
  const content = `<h1>Dashboard</h1>
    <div id="metrics" hx-get="/metrics" hx-trigger="every 10s" hx-swap="innerHTML">
      ${metricsHtml()}
    </div>`;

  if (isHtmx) return c.html(content);
  return c.html(layout("Dashboard", content));
});

dashboard.get("/metrics", (c) => {
  return c.html(metricsHtml());
});

export default dashboard;
