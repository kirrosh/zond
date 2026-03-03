import { Hono } from "hono";
import { layout, escapeHtml } from "../views/layout.ts";
import { statusBadge, renderSuiteResults, failedFilterToggle, autoExpandFailedScript, methodBadge } from "../views/results.ts";
import { formatDuration } from "../../core/reporter/console.ts";
import {
  listCollections,
  listRunsByCollection,
  countRunsByCollection,
  getResultsByRunId,
  getRunById,
  getCollectionById,
} from "../../db/queries.ts";
import type { CollectionRecord, CollectionSummary } from "../../db/queries.ts";
import { listEnvFiles } from "../../core/parser/variables.ts";

const dashboard = new Hono();

const HISTORY_PAGE_SIZE = 10;

// ──────────────────────────────────────────────
// GET / — Single-page dashboard
// ──────────────────────────────────────────────

dashboard.get("/", async (c) => {
  const collections = listCollections();

  // Auto-select the only collection, or use query param
  let selectedId: number | null = null;
  const qId = c.req.query("collection");
  if (qId) {
    selectedId = parseInt(qId, 10) || null;
  } else if (collections.length === 1) {
    selectedId = collections[0]!.id;
  }

  const content = await renderPage(collections, selectedId);
  const isHtmx = c.req.header("HX-Request") === "true";
  if (isHtmx) return c.html(content);
  return c.html(layout("apitool", content));
});

// ──────────────────────────────────────────────
// HTMX panel endpoints
// ──────────────────────────────────────────────

dashboard.get("/panels/content", async (c) => {
  const collectionId = parseInt(c.req.query("collection_id") ?? "", 10);
  if (isNaN(collectionId)) return c.html("");

  const collection = getCollectionById(collectionId);
  if (!collection) return c.html("<p>Collection not found</p>");

  return c.html(await renderCollectionContent(collection));
});

dashboard.get("/panels/results", async (c) => {
  const collectionId = parseInt(c.req.query("collection_id") ?? "", 10);
  const runId = parseInt(c.req.query("run_id") ?? "", 10);

  if (!isNaN(runId)) {
    return c.html(await renderRunResults(runId));
  }

  if (!isNaN(collectionId)) {
    // Get latest run for this collection
    const runs = listRunsByCollection(collectionId, 1, 0);
    if (runs.length === 0) return c.html(`<p style="color:var(--text-dim);">No runs yet. Click <strong>Run Tests</strong> to get started.</p>`);
    return c.html(await renderRunResults(runs[0]!.id));
  }

  return c.html("");
});

dashboard.get("/panels/coverage", async (c) => {
  const collectionId = parseInt(c.req.query("collection_id") ?? "", 10);
  if (isNaN(collectionId)) return c.html("");

  const collection = getCollectionById(collectionId);
  if (!collection?.openapi_spec) return c.html("");

  return c.html(await renderCoveragePanel(collection as CollectionRecord & { openapi_spec: string }));
});

dashboard.get("/panels/history", (c) => {
  const collectionId = parseInt(c.req.query("collection_id") ?? "", 10);
  const page = Math.max(1, parseInt(c.req.query("page") ?? "1", 10));
  if (isNaN(collectionId)) return c.html("");

  return c.html(renderHistoryPanel(collectionId, page));
});

// ──────────────────────────────────────────────
// Rendering functions
// ──────────────────────────────────────────────

async function renderPage(collections: CollectionSummary[], selectedId: number | null): Promise<string> {
  if (collections.length === 0) {
    return `
      <div style="text-align:center;padding:3rem 1rem;">
        <h1>apitool</h1>
        <p style="color:var(--text-dim);margin:1rem 0;">No API collections registered yet.</p>
        <p style="color:var(--text-dim);">Use <code>setup_api</code> via CLI or MCP to register your first API.</p>
      </div>`;
  }

  const selected = selectedId ? collections.find(col => col.id === selectedId) ?? null : null;

  // API selector
  const collectionOptions = collections.map(col =>
    `<option value="${col.id}"${col.id === selectedId ? " selected" : ""}>${escapeHtml(col.name)}${col.last_run_total > 0 ? ` (${col.pass_rate}%)` : ""}</option>`,
  ).join("");

  const selectorHtml = collections.length === 1
    ? `<span style="font-weight:600;font-size:1.1rem;">${escapeHtml(collections[0]!.name)}</span>
       <input type="hidden" id="collection-select" value="${collections[0]!.id}">`
    : `<select id="collection-select"
        hx-get="/panels/content"
        hx-target="#collection-content"
        hx-swap="innerHTML"
        name="collection_id"
        style="padding:0.4rem 0.6rem;border:1px solid var(--border);border-radius:6px;background:var(--bg);color:var(--text);font-size:1rem;font-weight:600;">
        <option value="">Select an API...</option>
        ${collectionOptions}
      </select>`;

  return `
    <div style="display:flex;align-items:center;gap:1rem;margin:1.5rem 0 1rem;">
      ${selectorHtml}
    </div>
    <div id="collection-content">
      ${selected ? await renderCollectionContent(selected) : ""}
    </div>`;
}

async function renderCollectionContent(collection: CollectionRecord): Promise<string> {
  const baseDir = collection.base_dir ?? collection.test_path;
  const envNames = await listEnvFiles(baseDir);

  const envSelect = envNames.length > 0
    ? `<select name="env" form="run-form" style="padding:0.35rem 0.5rem;border:1px solid var(--border);border-radius:6px;background:var(--bg);color:var(--text);font-size:0.85rem;">
        ${envNames.map(n => `<option value="${escapeHtml(n)}">${escapeHtml(n || "default")}</option>`).join("")}
      </select>`
    : "";

  const actionBar = `
    <div style="display:flex;align-items:center;gap:0.75rem;margin-bottom:1rem;">
      ${envSelect}
      <form id="run-form"
        hx-post="/run"
        hx-target="#results-panel"
        hx-swap="innerHTML"
        hx-indicator="#run-spinner"
        style="display:inline;">
        <input type="hidden" name="path" value="${escapeHtml(collection.test_path)}">
        <button type="submit" class="btn btn-run" hx-disabled-elt="this">Run Tests</button>
        <span id="run-spinner" class="htmx-indicator" style="color:var(--text-dim);font-size:0.85rem;margin-left:0.25rem;">Running...</span>
      </form>
    </div>`;

  return `
    ${actionBar}
    <div id="coverage-panel"
      hx-get="/panels/coverage?collection_id=${collection.id}"
      hx-trigger="load"
      hx-swap="innerHTML">
    </div>
    <div id="results-panel"
      hx-get="/panels/results?collection_id=${collection.id}"
      hx-trigger="load"
      hx-swap="innerHTML">
      <span class="htmx-indicator" style="color:var(--text-dim);">Loading results...</span>
    </div>
    <div id="history-panel"
      hx-get="/panels/history?collection_id=${collection.id}"
      hx-trigger="load, every 5s"
      hx-swap="innerHTML">
    </div>`;
}

async function loadSuiteMetadata(testPath: string): Promise<Map<string, { description?: string; tags?: string[] }>> {
  const { parseDirectory } = await import("../../core/parser/yaml-parser.ts");
  const suites = await parseDirectory(testPath);
  const map = new Map<string, { description?: string; tags?: string[] }>();
  for (const s of suites) {
    map.set(s.name, { description: s.description, tags: s.tags });
  }
  return map;
}

async function renderRunResults(runId: number): Promise<string> {
  const run = getRunById(runId);
  if (!run) return `<p>Run not found</p>`;

  const results = getResultsByRunId(runId);
  if (results.length === 0) return `<p style="color:var(--text-dim);">No results for run #${runId}.</p>`;

  const passed = run.passed;
  const failed = run.failed;
  const skipped = run.skipped;
  const total = run.total;

  const timeAgo = formatTimeAgo(run.started_at);
  const duration = run.duration_ms != null ? formatDuration(run.duration_ms) : "-";

  // Load suite metadata from YAML files if we can find the collection
  let suiteMetadata: Map<string, { description?: string; tags?: string[] }> | undefined;
  try {
    const collection = run.collection_id != null ? getCollectionById(run.collection_id) : null;
    if (collection?.test_path) {
      suiteMetadata = await loadSuiteMetadata(collection.test_path);
    }
  } catch { /* skip metadata if unavailable */ }

  const header = `
    <div style="display:flex;align-items:center;gap:0.75rem;flex-wrap:wrap;margin-bottom:0.5rem;padding-bottom:0.5rem;border-bottom:1px solid var(--border);">
      <strong>Run #${run.id}</strong>
      <span style="color:var(--text-dim);font-size:0.85rem;">${escapeHtml(timeAgo)}</span>
      <span style="font-size:0.9rem;">${passed}&#10003; ${failed}&#10007; ${skipped}&#9675;</span>
      <span style="color:var(--text-dim);font-size:0.85rem;">${duration}</span>
      ${statusBadge(total, passed, failed)}
      <span style="flex:1;"></span>
      <a href="/api/export/${run.id}/junit" download class="btn btn-sm btn-outline">Export JUnit</a>
      <a href="/api/export/${run.id}/json" download class="btn btn-sm btn-outline">Export JSON</a>
      ${failedFilterToggle()}
    </div>`;

  const suitesHtml = renderSuiteResults(results, runId, { suiteMetadata });

  return header + suitesHtml + autoExpandFailedScript();
}

async function renderCoveragePanel(collection: CollectionRecord & { openapi_spec: string }): Promise<string> {
  try {
    const { readOpenApiSpec, extractEndpoints } = await import("../../core/generator/openapi-reader.ts");
    const { scanCoveredEndpoints, filterUncoveredEndpoints } = await import("../../core/generator/coverage-scanner.ts");

    const doc = await readOpenApiSpec(collection.openapi_spec);
    const allEndpoints = extractEndpoints(doc);
    const covered = await scanCoveredEndpoints(collection.test_path);
    const uncovered = filterUncoveredEndpoints(allEndpoints, covered);

    const totalEndpoints = allEndpoints.length;
    const coveredCount = totalEndpoints - uncovered.length;
    const pct = totalEndpoints > 0 ? Math.round((coveredCount / totalEndpoints) * 100) : 0;

    const badgeClass = pct >= 80 ? "badge-pass" : pct >= 50 ? "badge-skip" : "badge-fail";

    // Build set of uncovered keys for lookup
    const uncoveredSet = new Set(uncovered.map(ep => `${ep.method} ${ep.path}`));

    // Show all endpoints: covered with checkmark, uncovered with X
    const allItems = allEndpoints.map(ep => {
      const isCovered = !uncoveredSet.has(`${ep.method} ${ep.path}`);
      const icon = isCovered
        ? `<span style="color:var(--pass);font-weight:700;">&#10003;</span>`
        : `<span style="color:var(--fail);font-weight:700;">&#10007;</span>`;
      return `<div style="padding:0.2rem 0;font-size:0.85rem;font-family:monospace;display:flex;align-items:center;gap:0.5rem;">
          ${icon} ${methodBadge(ep.method)} ${escapeHtml(ep.path)}
        </div>`;
    }).join("");

    const endpointsHtml = totalEndpoints > 0
      ? `<details style="margin-top:0.5rem;">
          <summary style="cursor:pointer;font-size:0.85rem;color:var(--text-dim);">Show all ${totalEndpoints} endpoints</summary>
          <div style="margin-top:0.25rem;">${allItems}</div>
        </details>`
      : "";

    return `
      <div style="margin-bottom:1rem;">
        <span style="font-size:0.9rem;font-weight:600;">Coverage:</span>
        <span class="badge ${badgeClass}" style="margin-left:0.25rem;">${pct}% (${coveredCount}/${totalEndpoints})</span>
        ${endpointsHtml}
      </div>`;
  } catch {
    return "";
  }
}

function renderHistoryPanel(collectionId: number, page: number): string {
  const offset = (page - 1) * HISTORY_PAGE_SIZE;
  const runs = listRunsByCollection(collectionId, HISTORY_PAGE_SIZE, offset);
  const total = countRunsByCollection(collectionId);
  const hasMore = offset + runs.length < total;

  if (runs.length === 0 && page === 1) return "";

  const rows = runs.map(r => {
    const timeAgo = formatTimeAgo(r.started_at);
    return `
      <div class="history-row"
        style="display:flex;align-items:center;gap:0.75rem;padding:0.4rem 0.5rem;border-bottom:1px solid var(--border);cursor:pointer;font-size:0.85rem;"
        hx-get="/panels/results?run_id=${r.id}"
        hx-target="#results-panel"
        hx-swap="innerHTML">
        <span style="font-weight:600;">#${r.id}</span>
        <span style="color:var(--text-dim);min-width:5rem;">${escapeHtml(timeAgo)}</span>
        <span>${r.passed}/${r.total} pass</span>
        ${statusBadge(r.total, r.passed, r.failed)}
        ${r.duration_ms != null ? `<span style="color:var(--text-dim);">${formatDuration(r.duration_ms)}</span>` : ""}
      </div>`;
  }).join("");

  const loadMore = hasMore
    ? `<div style="text-align:center;padding:0.5rem;">
        <button class="btn btn-sm btn-outline"
          hx-get="/panels/history?collection_id=${collectionId}&page=${page + 1}"
          hx-target="#history-panel"
          hx-swap="innerHTML">Load more...</button>
      </div>`
    : "";

  return `
    <div style="margin-top:1.5rem;">
      <div style="font-weight:600;font-size:0.95rem;margin-bottom:0.5rem;padding-bottom:0.25rem;border-bottom:1px solid var(--border);">Run History</div>
      ${rows}
      ${loadMore}
    </div>`;
}

function formatTimeAgo(isoDate: string): string {
  try {
    const date = new Date(isoDate);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffSec = Math.floor(diffMs / 1000);
    if (diffSec < 60) return "just now";
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24) return `${diffHr}h ago`;
    const diffDay = Math.floor(diffHr / 24);
    if (diffDay < 7) return `${diffDay}d ago`;
    return date.toLocaleDateString();
  } catch {
    return isoDate;
  }
}

export default dashboard;
