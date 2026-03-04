import { Hono } from "hono";
import { layout, escapeHtml } from "../views/layout.ts";
import { methodBadge } from "../views/results.ts";
import { renderHealthStrip } from "../views/health-strip.ts";
import { renderEndpointsTab } from "../views/endpoints-tab.ts";
import { renderSuitesTab } from "../views/suites-tab.ts";
import { renderRunsTab, renderRunDetail } from "../views/runs-tab.ts";
import { buildCollectionState, invalidateCollectionCache } from "../data/collection-state.ts";
import {
  listCollections,
  getCollectionById,
  countRunsByCollection,
} from "../../db/queries.ts";
import type { CollectionRecord, CollectionSummary } from "../../db/queries.ts";
import { listEnvFiles } from "../../core/parser/variables.ts";

const dashboard = new Hono();

// ──────────────────────────────────────────────
// GET / — Main dashboard
// ──────────────────────────────────────────────

dashboard.get("/", async (c) => {
  const collections = listCollections();

  let selectedId: number | null = null;
  const qId = c.req.query("collection");
  if (qId) {
    selectedId = parseInt(qId, 10) || null;
  } else if (collections.length === 1) {
    selectedId = collections[0]!.id;
  }

  const selected = selectedId ? collections.find(col => col.id === selectedId) ?? null : null;
  const selectedRecord = selected ? getCollectionById(selected.id) : null;

  const { content, navExtra } = await renderPage(collections, selectedId, selectedRecord);
  const isHtmx = c.req.header("HX-Request") === "true";
  if (isHtmx) return c.html(content);
  return c.html(layout("zond", content, navExtra));
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

dashboard.get("/panels/health-strip", async (c) => {
  const collectionId = parseInt(c.req.query("collection_id") ?? "", 10);
  if (isNaN(collectionId)) return c.html("");

  const collection = getCollectionById(collectionId);
  if (!collection) return c.html("");

  invalidateCollectionCache(collectionId);
  const state = await buildCollectionState(collection);
  return c.html(renderHealthStrip(state));
});

dashboard.get("/panels/endpoints", async (c) => {
  const collectionId = parseInt(c.req.query("collection_id") ?? "", 10);
  if (isNaN(collectionId)) return c.html("");

  const collection = getCollectionById(collectionId);
  if (!collection) return c.html("");

  const state = await buildCollectionState(collection);
  const filters = {
    status: c.req.query("status") || undefined,
    method: c.req.query("method") || undefined,
  };
  return c.html(renderEndpointsTab(state, filters));
});

dashboard.get("/panels/suites", async (c) => {
  const collectionId = parseInt(c.req.query("collection_id") ?? "", 10);
  if (isNaN(collectionId)) return c.html("");

  const collection = getCollectionById(collectionId);
  if (!collection) return c.html("");

  const state = await buildCollectionState(collection);
  return c.html(renderSuitesTab(state));
});

dashboard.get("/panels/runs-tab", (c) => {
  const collectionId = parseInt(c.req.query("collection_id") ?? "", 10);
  const page = Math.max(1, parseInt(c.req.query("page") ?? "1", 10));
  if (isNaN(collectionId)) return c.html("");

  return c.html(renderRunsTab(collectionId, page));
});

dashboard.get("/panels/run-detail", (c) => {
  const runId = parseInt(c.req.query("run_id") ?? "", 10);
  const collectionId = parseInt(c.req.query("collection_id") ?? "", 10);
  if (isNaN(runId)) return c.html("");

  return c.html(renderRunDetail(runId, collectionId));
});

// Legacy endpoints for backwards compat (runs.ts detail page uses /panels/results)
dashboard.get("/panels/results", async (c) => {
  const collectionId = parseInt(c.req.query("collection_id") ?? "", 10);
  const runId = parseInt(c.req.query("run_id") ?? "", 10);

  if (!isNaN(runId)) {
    return c.html(renderRunDetail(runId, collectionId || 0));
  }

  if (!isNaN(collectionId)) {
    const { listRunsByCollection } = await import("../../db/queries.ts");
    const runs = listRunsByCollection(collectionId, 1, 0);
    if (runs.length === 0) return c.html(`<p style="color:var(--text-dim);">No runs yet.</p>`);
    return c.html(renderRunDetail(runs[0]!.id, collectionId));
  }

  return c.html("");
});

// Legacy coverage panel (kept for /runs/:id page)
dashboard.get("/panels/coverage", async (c) => {
  const collectionId = parseInt(c.req.query("collection_id") ?? "", 10);
  if (isNaN(collectionId)) return c.html("");

  const collection = getCollectionById(collectionId);
  if (!collection?.openapi_spec) return c.html("");

  return c.html(await renderCoveragePanel(collection as CollectionRecord & { openapi_spec: string }));
});

// Legacy history panel (kept for /runs/:id page)
dashboard.get("/panels/history", (c) => {
  const collectionId = parseInt(c.req.query("collection_id") ?? "", 10);
  const page = Math.max(1, parseInt(c.req.query("page") ?? "1", 10));
  if (isNaN(collectionId)) return c.html("");

  return c.html(renderRunsTab(collectionId, page));
});

// ──────────────────────────────────────────────
// Rendering functions
// ──────────────────────────────────────────────

async function renderPage(
  collections: CollectionSummary[],
  selectedId: number | null,
  selectedRecord: CollectionRecord | null,
): Promise<{ content: string; navExtra: string }> {
  if (collections.length === 0) {
    return {
      navExtra: "",
      content: `
        <div style="text-align:center;padding:3rem 1rem;">
          <h1>zond</h1>
          <p style="color:var(--text-dim);margin:1rem 0;">No API collections registered yet.</p>
          <p style="color:var(--text-dim);">Use <code>setup_api</code> via CLI or MCP to register your first API.</p>
        </div>`,
    };
  }

  // Navbar: separator + collection selector + action bar
  const collectionOptions = collections.map(col =>
    `<option value="${col.id}"${col.id === selectedId ? " selected" : ""}>${escapeHtml(col.name)}${col.last_run_total > 0 ? ` (${col.pass_rate}%)` : ""}</option>`,
  ).join("");

  const selectorHtml = collections.length === 1
    ? `<span class="nav-separator"></span>
       <span class="collection-selector" style="border:none;background:none;">${escapeHtml(collections[0]!.name)}</span>
       <input type="hidden" id="collection-select" value="${collections[0]!.id}">`
    : `<span class="nav-separator"></span>
       <select id="collection-select" class="collection-selector"
         hx-get="/panels/content"
         hx-target="#main-content"
         hx-swap="innerHTML"
         name="collection_id">
         <option value="">Select an API...</option>
         ${collectionOptions}
       </select>`;

  // Action bar in navbar
  let actionHtml = "";
  if (selectedRecord) {
    const baseDir = selectedRecord.base_dir ?? selectedRecord.test_path;
    const envNames = await listEnvFiles(baseDir);
    const envSelect = envNames.length > 0
      ? `<select name="env" form="run-form" class="collection-selector" style="font-size:0.75rem;padding:0.25rem 0.5rem;">
          ${envNames.map(n => `<option value="${escapeHtml(n)}">${escapeHtml(n || "default")}</option>`).join("")}
        </select>`
      : "";

    actionHtml = `<div class="nav-actions">
      ${envSelect}
      <form id="run-form" style="display:contents;"
        hx-post="/run"
        hx-indicator="#run-spinner"
        hx-swap="none">
        <input type="hidden" name="path" value="${escapeHtml(selectedRecord.test_path)}">
        <button type="submit" class="btn btn-run" hx-disabled-elt="this">&#9654; Run Tests</button>
        <span id="run-spinner" class="htmx-indicator" style="color:var(--text-dim);font-size:0.85rem;">Running...</span>
      </form>
    </div>`;
  }

  const navExtra = `${selectorHtml}${actionHtml}`;

  const bodyContent = selectedRecord ? await renderCollectionContent(selectedRecord) : "";

  return {
    navExtra,
    content: `<div id="main-content">${bodyContent}</div>`,
  };
}

async function renderCollectionContent(collection: CollectionRecord): Promise<string> {
  const state = await buildCollectionState(collection);

  // Health strip
  const healthStrip = renderHealthStrip(state);

  // Tab bar with counts
  const runCount = countRunsByCollection(collection.id);
  const tabBar = `
    <div class="tab-bar" id="tab-bar">
      <button class="tab-btn tab-active" data-tab="endpoints"
        hx-get="/panels/endpoints?collection_id=${collection.id}"
        hx-target="#tab-content" hx-swap="innerHTML"
        onclick="activateTab(this)">Endpoints <span class="tab-count">${state.totalEndpoints}</span></button>
      <button class="tab-btn" data-tab="suites"
        hx-get="/panels/suites?collection_id=${collection.id}"
        hx-target="#tab-content" hx-swap="innerHTML"
        onclick="activateTab(this)">Suites <span class="tab-count">${state.suites.length}</span></button>
      <button class="tab-btn" data-tab="runs"
        hx-get="/panels/runs-tab?collection_id=${collection.id}"
        hx-target="#tab-content" hx-swap="innerHTML"
        onclick="activateTab(this)">Runs <span class="tab-count">${runCount}</span></button>
    </div>`;

  // Default tab content (endpoints)
  const defaultContent = renderEndpointsTab(state);

  const tabScript = `<script>
    function activateTab(el) {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('tab-active'));
      el.classList.add('tab-active');
    }
  </script>`;

  return `
    <div id="health-strip-panel">${healthStrip}</div>
    ${tabBar}
    <div id="tab-content">${defaultContent}</div>
    ${tabScript}`;
}

// ── Legacy helpers (kept for /runs/:id page) ──

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

    const uncoveredSet = new Set(uncovered.map(ep => `${ep.method} ${ep.path}`));

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

export default dashboard;
