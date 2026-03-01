import { OpenAPIHono, createRoute } from "@hono/zod-openapi";
import { layout, escapeHtml } from "../views/layout.ts";
import {
  getCollectionById,
  getCollectionStats,
  getCollectionPassRateTrend,
  listRunsByCollection,
  countRunsByCollection,
  createCollection,
  deleteCollection,
  listCollections,
  normalizePath,
  listEnvironments,
} from "../../db/queries.ts";
import { formatDuration } from "../../core/reporter/console.ts";
import { renderTrendChart } from "../views/trend-chart.ts";
import {
  ErrorSchema,
  IdParamSchema,
  CollectionSchema,
  CollectionListSchema,
  CreateCollectionRequest,
  CreateCollectionResponse,
} from "../schemas.ts";

const collections = new OpenAPIHono();

function statusBadge(total: number, passed: number, failed: number): string {
  if (total === 0) return `<span class="badge badge-skip">empty</span>`;
  if (failed > 0) return `<span class="badge badge-fail">fail</span>`;
  return `<span class="badge badge-pass">pass</span>`;
}

// GET /collections/:id — collection detail page
collections.get("/collections/:id", async (c) => {
  const id = parseInt(c.req.param("id"), 10);
  const collection = getCollectionById(id);
  if (!collection) {
    return c.html(layout("Not Found", `<h1>Collection not found</h1><a href="/">Back to dashboard</a>`), 404);
  }

  const page = parseInt(c.req.query("page") ?? "1", 10);
  const perPage = 20;
  const offset = (page - 1) * perPage;

  const stats = getCollectionStats(id);
  const runs = listRunsByCollection(id, perPage, offset);
  const totalRuns = countRunsByCollection(id);
  const totalPages = Math.max(1, Math.ceil(totalRuns / perPage));

  const runRows = runs
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

  const pagination =
    totalPages > 1
      ? `<div class="pagination">
        ${page > 1 ? `<a class="btn btn-outline btn-sm" href="/collections/${id}?page=${page - 1}">Prev</a>` : ""}
        <span>Page ${page} of ${totalPages}</span>
        ${page < totalPages ? `<a class="btn btn-outline btn-sm" href="/collections/${id}?page=${page + 1}">Next</a>` : ""}
      </div>`
      : "";

  const explorerLink = collection.openapi_spec
    ? `<a class="btn btn-sm" href="/collections/${id}/explorer">Explorer</a>`
    : "";
  const suitesLink = `<a class="btn btn-sm" href="/collections/${id}/suites">Suites</a>`;

  const envs = listEnvironments();
  const envOptions = envs.map(e => `<option value="${escapeHtml(e)}">${escapeHtml(e)}</option>`).join("");

  const content = `
    <h1>${escapeHtml(collection.name)}</h1>
    <div style="display:flex;gap:0.5rem;margin-bottom:1rem;align-items:center;">
      <a class="btn btn-sm" href="/" >Back</a>
      <form style="display:contents;" hx-post="/run" hx-indicator="#run-spinner-${id}">
        <input type="hidden" name="path" value="${escapeHtml(collection.test_path)}">
        <select name="env" style="padding:0.3rem;border:1px solid var(--border);border-radius:4px;background:var(--bg);color:var(--text);font-size:0.85rem;">
          <option value="">No environment</option>
          ${envOptions}
        </select>
        <button type="submit" class="btn btn-sm btn-run" hx-disabled-elt="this">Run Tests</button>
      </form>
      ${suitesLink}
      ${explorerLink}
      <button class="btn btn-danger btn-sm"
        hx-delete="/collections/${id}"
        hx-confirm="Delete collection '${escapeHtml(collection.name)}'? Runs will be unlinked."
        hx-target="body">Delete</button>
      <span id="run-spinner-${id}" class="htmx-indicator" style="margin-left:0.5rem;color:var(--text-dim);">Running...</span>
    </div>

    <div class="cards">
      <div class="card">
        <div class="card-label">Test Path</div>
        <div class="card-value" style="font-size:0.85rem;word-break:break-all;">${escapeHtml(collection.test_path)}</div>
      </div>
      <div class="card">
        <div class="card-label">Total Runs</div>
        <div class="card-value">${stats.totalRuns}</div>
      </div>
      <div class="card">
        <div class="card-label">Pass Rate</div>
        <div class="card-value">${stats.overallPassRate}%</div>
      </div>
      <div class="card">
        <div class="card-label">Avg Duration</div>
        <div class="card-value">${formatDuration(stats.avgDuration)}</div>
      </div>
    </div>

    ${renderTrendChart(getCollectionPassRateTrend(id))}

    ${collection.openapi_spec ? `<p style="color:var(--text-dim);font-size:0.85rem;">OpenAPI: ${escapeHtml(collection.openapi_spec)}</p>` : ""}

    <div class="section-title">Runs</div>
    <table>
      <thead><tr>
        <th>ID</th><th>Date</th><th>Total</th><th>Pass</th><th>Fail</th><th>Skip</th><th>Duration</th><th>Status</th>
      </tr></thead>
      <tbody>${runRows || `<tr><td colspan="8">No runs yet. Run tests with <code>apitool run ${escapeHtml(collection.test_path)}</code></td></tr>`}</tbody>
    </table>
    ${pagination}
  `;

  const isHtmx = c.req.header("HX-Request") === "true";
  if (isHtmx) return c.html(content);
  return c.html(layout(collection.name, content));
});

// ──────────────────────────────────────────────
// Form-data handlers (HTMX) on HTML paths
// ──────────────────────────────────────────────

// POST /collections — create collection (form-data from HTMX)
collections.post("/collections", async (c) => {
  const body = await c.req.parseBody();
  const name = (body["name"] as string ?? "").trim();
  const testPath = (body["test_path"] as string ?? "").trim();
  const openapiSpec = (body["openapi_spec"] as string ?? "").trim();

  if (!name || !testPath) {
    return c.html(layout("Error", `<h1>Error</h1><p>Name and test path are required.</p><a href="/">Back</a>`), 400);
  }

  const id = createCollection({
    name,
    test_path: normalizePath(testPath),
    openapi_spec: openapiSpec || undefined,
  });

  return c.redirect(`/collections/${id}`);
});

// DELETE /collections/:id — delete collection (HTMX)
collections.delete("/collections/:id", (c) => {
  const id = parseInt(c.req.param("id"), 10);
  deleteCollection(id, false);
  c.header("HX-Redirect", "/");
  return c.body(null, 200);
});

// ──────────────────────────────────────────────
// OpenAPI JSON API routes
// ──────────────────────────────────────────────

const listCollectionsRoute = createRoute({
  method: "get",
  path: "/api/collections",
  tags: ["Collections"],
  summary: "List all collections",
  responses: {
    200: {
      content: { "application/json": { schema: CollectionListSchema } },
      description: "List of collections",
    },
  },
});

collections.openapi(listCollectionsRoute, (c) => {
  const cols = listCollections();
  const result = cols.map((col) => ({
    id: col.id,
    name: col.name,
    test_path: col.test_path,
    openapi_spec: col.openapi_spec,
    created_at: col.created_at,
  }));
  return c.json(result, 200);
});

const getCollectionRoute = createRoute({
  method: "get",
  path: "/api/collections/{id}",
  tags: ["Collections"],
  summary: "Get collection by ID",
  request: { params: IdParamSchema },
  responses: {
    200: {
      content: { "application/json": { schema: CollectionSchema } },
      description: "Collection details",
    },
    404: {
      content: { "application/json": { schema: ErrorSchema } },
      description: "Not found",
    },
  },
});

collections.openapi(getCollectionRoute, (c) => {
  const { id } = c.req.valid("param");
  const col = getCollectionById(id);
  if (!col) return c.json({ error: "Collection not found" }, 404);
  return c.json(col, 200);
});

const createCollectionRoute = createRoute({
  method: "post",
  path: "/api/collections",
  tags: ["Collections"],
  summary: "Create a new collection",
  request: {
    body: {
      content: { "application/json": { schema: CreateCollectionRequest } },
      required: true,
    },
  },
  responses: {
    201: {
      content: { "application/json": { schema: CreateCollectionResponse } },
      description: "Collection created",
    },
    400: {
      content: { "application/json": { schema: ErrorSchema } },
      description: "Validation error",
    },
  },
});

collections.openapi(createCollectionRoute, (c) => {
  const { name, test_path, openapi_spec } = c.req.valid("json");
  const id = createCollection({
    name,
    test_path: normalizePath(test_path),
    openapi_spec: openapi_spec || undefined,
  });
  const col = getCollectionById(id);
  if (!col) return c.json({ error: "Failed to create collection" }, 400);
  return c.json({ id: col.id, name: col.name, test_path: col.test_path, openapi_spec: col.openapi_spec }, 201);
});

const deleteCollectionRoute = createRoute({
  method: "delete",
  path: "/api/collections/{id}",
  tags: ["Collections"],
  summary: "Delete a collection",
  request: { params: IdParamSchema },
  responses: {
    204: { description: "Collection deleted" },
    404: {
      content: { "application/json": { schema: ErrorSchema } },
      description: "Not found",
    },
  },
});

collections.openapi(deleteCollectionRoute, (c) => {
  const { id } = c.req.valid("param");
  const col = getCollectionById(id);
  if (!col) return c.json({ error: "Collection not found" }, 404);
  deleteCollection(id, false);
  return c.body(null, 204);
});

export default collections;
