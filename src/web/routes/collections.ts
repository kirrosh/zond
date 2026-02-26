import { Hono } from "hono";
import { layout, escapeHtml } from "../views/layout.ts";
import {
  getCollectionById,
  getCollectionStats,
  getCollectionPassRateTrend,
  listRunsByCollection,
  countRunsByCollection,
  createCollection,
  deleteCollection,
  normalizePath,
  listAIGenerations,
} from "../../db/queries.ts";
import { formatDuration } from "../../core/reporter/console.ts";
import { renderTrendChart } from "../views/trend-chart.ts";
import { parse } from "../../core/parser/yaml-parser.ts";
import type { TestSuite } from "../../core/parser/types.ts";

const collections = new Hono();

function statusBadge(total: number, passed: number, failed: number): string {
  if (total === 0) return `<span class="badge badge-skip">empty</span>`;
  if (failed > 0) return `<span class="badge badge-fail">fail</span>`;
  return `<span class="badge badge-pass">pass</span>`;
}

async function loadSuitesHtml(testPath: string): Promise<string> {
  try {
    const suites = await parse(testPath);
    return renderSuites(suites);
  } catch {
    return `<p style="color:var(--text-dim)">Could not load test files from path.</p>`;
  }
}

function methodBadge(method: string): string {
  const m = method.toLowerCase();
  return `<span class="badge-method method-${m}">${method}</span>`;
}

function renderSuites(suites: TestSuite[]): string {
  if (suites.length === 0) return `<p style="color:var(--text-dim)">No test files found.</p>`;

  return suites.map(suite => {
    // Detect captures in this suite
    const captureVars = new Map<string, string>(); // varName → step name
    for (const step of suite.tests) {
      if (step.expect.body) {
        for (const [field, rule] of Object.entries(step.expect.body)) {
          if (rule.capture) captureVars.set(rule.capture, step.name);
        }
      }
    }
    const isChain = captureVars.size > 0;

    const stepsHtml = suite.tests.map(step => {
      // Find captures this step produces
      const produces: string[] = [];
      if (step.expect.body) {
        for (const [, rule] of Object.entries(step.expect.body)) {
          if (rule.capture) produces.push(rule.capture);
        }
      }

      // Find captured vars this step consumes ({{var}} in path)
      const consumes: string[] = [];
      const varRefs = step.path.match(/\{\{(\w+)\}\}/g) ?? [];
      for (const ref of varRefs) {
        const varName = ref.slice(2, -2);
        if (captureVars.has(varName)) consumes.push(varName);
      }

      const captureHtml = produces.map(v =>
        `<span class="capture-badge">capture: ${escapeHtml(v)}</span>`
      ).join(" ");

      const consumeHtml = consumes.map(v =>
        `<span class="capture-badge" style="opacity:0.7">uses: ${escapeHtml(v)}</span>`
      ).join(" ");

      const chainedClass = isChain ? " chained" : "";

      return `<div class="step-row${chainedClass}">
        <div>${methodBadge(step.method)}</div>
        <div class="step-name">
          ${escapeHtml(step.name)}
          <span class="endpoint-path" style="margin-left:0.5rem">${escapeHtml(step.path)}</span>
          ${captureHtml}${consumeHtml}
        </div>
        ${step.expect.status ? `<div class="step-duration" style="font-family:monospace">expect ${step.expect.status}</div>` : ""}
      </div>`;
    }).join("");

    const chainClass = isChain ? " chain-suite" : "";

    const sourcePath: string = (suite as any)._source ?? "";
    const isAIGenerated = sourcePath.includes("ai-generated-") || suite.name.toLowerCase().startsWith("ai-generated");
    const aiBadge = isAIGenerated ? ' <span class="badge-ai">AI</span>' : "";

    return `<div class="suite-section${chainClass}">
      <h3>${escapeHtml(suite.name)}${aiBadge}${isChain ? ' <span class="capture-badge" style="font-weight:400">chain</span>' : ""}</h3>
      ${isChain ? '<div class="chain-connector">' : ""}
      ${stepsHtml}
      ${isChain ? "</div>" : ""}
    </div>`;
  }).join("");
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
    ? `<a class="btn btn-outline btn-sm" href="/explorer">Explorer</a>`
    : "";

  const content = `
    <h1>${escapeHtml(collection.name)}</h1>
    <div style="display:flex;gap:0.5rem;margin-bottom:1rem;">
      <a class="btn btn-sm" href="/" >Back</a>
      <button class="btn btn-sm btn-run"
        hx-post="/api/run"
        hx-vals='${JSON.stringify({ path: collection.test_path })}'
        hx-indicator="#run-spinner-${id}"
        hx-disabled-elt="this">Run Tests</button>
      ${explorerLink}
      <button class="btn btn-danger btn-sm"
        hx-delete="/api/collections/${id}"
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

    <div class="section-title">Test Suites</div>
    <div id="suites-section">${await loadSuitesHtml(collection.test_path)}</div>

    ${collection.openapi_spec ? renderAIGenerateSection(id, collection.openapi_spec) : ""}

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

// POST /api/collections — create collection from form
collections.post("/api/collections", async (c) => {
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

// DELETE /api/collections/:id — delete collection
collections.delete("/api/collections/:id", (c) => {
  const id = parseInt(c.req.param("id"), 10);
  deleteCollection(id, false);
  c.header("HX-Redirect", "/");
  return c.body(null, 200);
});

function renderAIGenerateSection(collectionId: number, specPath: string): string {
  const generations = listAIGenerations(collectionId, 10);

  const historyRows = generations.map((g) => `
    <tr id="ai-gen-row-${g.id}">
      <td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${escapeHtml(g.prompt)}">${escapeHtml(g.prompt)}</td>
      <td>${escapeHtml(g.model)}</td>
      <td><span class="badge ${g.status === "success" ? "badge-pass" : "badge-fail"}">${g.status}</span></td>
      <td>${g.duration_ms != null ? (g.duration_ms / 1000).toFixed(1) + "s" : "-"}</td>
      <td style="font-size:0.8rem;color:var(--text-dim);">${escapeHtml(g.created_at)}</td>
      <td class="ai-gen-actions">
        ${g.status === "success" ? `<button class="btn btn-sm btn-outline"
          hx-get="/api/ai-generation/${g.id}"
          hx-target="#ai-gen-row-${g.id}"
          hx-swap="afterend"
          hx-on::after-request="this.closest('tr').classList.toggle('expanded')">View</button>` : ""}
        <button class="btn btn-sm btn-outline" onclick="document.getElementById('ai-prompt').value = ${escapeHtml(JSON.stringify(g.prompt))}; document.getElementById('ai-prompt').scrollIntoView({behavior:'smooth'});">Reuse</button>
      </td>
    </tr>
  `).join("");

  return `
    <div class="section-title">AI Test Generator</div>
    <div class="ai-generate-section">
      <form hx-post="/api/ai-generate" hx-target="#ai-result" hx-indicator="#ai-spinner">
        <input type="hidden" name="collection_id" value="${collectionId}">
        <input type="hidden" name="spec_path" value="${escapeHtml(specPath)}">

        <label for="ai-prompt" style="font-weight:600;font-size:0.85rem;display:block;margin-bottom:0.25rem;">
          Describe your test scenario:
        </label>
        <textarea id="ai-prompt" name="prompt" rows="4" placeholder="e.g. Test name uniqueness: create entity, create duplicate, expect 409 conflict"
          style="width:100%;padding:0.5rem;border:1px solid var(--border);border-radius:4px;background:var(--bg);color:var(--text);font-family:inherit;font-size:0.9rem;resize:vertical;"></textarea>

        <details style="margin:0.75rem 0;">
          <summary style="cursor:pointer;font-weight:600;font-size:0.85rem;color:var(--text-dim);">Provider Settings</summary>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.5rem;margin-top:0.5rem;">
            <div>
              <label style="font-size:0.8rem;font-weight:600;color:var(--text-dim);display:block;">Provider</label>
              <select name="provider" style="width:100%;padding:0.35rem;border:1px solid var(--border);border-radius:4px;background:var(--bg);color:var(--text);">
                <option value="ollama" selected>Ollama (local)</option>
                <option value="openai">OpenAI</option>
                <option value="anthropic">Anthropic (Claude)</option>
                <option value="custom">Custom (OpenAI-compatible)</option>
              </select>
            </div>
            <div>
              <label style="font-size:0.8rem;font-weight:600;color:var(--text-dim);display:block;">Model</label>
              <input type="text" name="model" placeholder="llama3.2:3b"
                style="width:100%;padding:0.35rem;border:1px solid var(--border);border-radius:4px;background:var(--bg);color:var(--text);font-family:monospace;">
            </div>
            <div>
              <label style="font-size:0.8rem;font-weight:600;color:var(--text-dim);display:block;">URL</label>
              <input type="text" name="base_url" placeholder="http://localhost:11434/v1"
                style="width:100%;padding:0.35rem;border:1px solid var(--border);border-radius:4px;background:var(--bg);color:var(--text);font-family:monospace;">
            </div>
            <div>
              <label style="font-size:0.8rem;font-weight:600;color:var(--text-dim);display:block;">API Key</label>
              <input type="password" name="api_key" placeholder="sk-..."
                style="width:100%;padding:0.35rem;border:1px solid var(--border);border-radius:4px;background:var(--bg);color:var(--text);font-family:monospace;">
            </div>
          </div>
        </details>

        <div style="display:flex;align-items:center;gap:0.5rem;">
          <button type="submit" class="btn btn-sm">Generate Test Suite</button>
          <span id="ai-spinner" class="htmx-indicator" style="color:var(--text-dim);">Generating...</span>
        </div>
      </form>

      <div id="ai-result" style="margin-top:1rem;"></div>

      ${generations.length > 0 ? `
        <div style="margin-top:1.25rem;">
          <div style="font-weight:600;font-size:0.9rem;margin-bottom:0.5rem;">Generation History</div>
          <table class="ai-gen-history">
            <thead><tr><th>Prompt</th><th>Model</th><th>Status</th><th>Duration</th><th>Date</th><th>Actions</th></tr></thead>
            <tbody>${historyRows}</tbody>
          </table>
        </div>
      ` : ""}
    </div>
  `;
}

export default collections;
