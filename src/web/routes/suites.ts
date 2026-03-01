import { Hono } from "hono";
import { resolve } from "path";
import { layout, escapeHtml } from "../views/layout.ts";
import { getCollectionById, listEnvironments } from "../../db/queries.ts";
import { parseDirectorySafe, parseFile } from "../../core/parser/yaml-parser.ts";
import type { TestSuite } from "../../core/parser/types.ts";

function methodBadge(method: string): string {
  const m = method.toLowerCase();
  return `<span class="badge-method method-${m}">${method}</span>`;
}

function renderSuiteList(
  collection: { id: number; name: string; test_path: string },
  suites: TestSuite[],
  errors: { file: string; error: string }[],
  envOptions: string,
): string {
  const rows = suites.map((s) => {
    const source = (s as any)._source as string;
    // relative path from test_path
    const rel = source.startsWith(collection.test_path)
      ? source.slice(collection.test_path.length).replace(/^[/\\]+/, "")
      : source.replace(/^.*[/\\]/, "");

    return `<tr>
      <td><code>${escapeHtml(rel)}</code></td>
      <td>${escapeHtml(s.name)}</td>
      <td>${s.tests.length}</td>
      <td>${s.base_url ? `<code>${escapeHtml(s.base_url)}</code>` : "<span style=\"color:var(--text-dim)\">—</span>"}</td>
      <td style="display:flex;gap:0.25rem;">
        <a class="btn btn-sm btn-outline" href="/collections/${collection.id}/suites/detail?file=${encodeURIComponent(rel)}">View</a>
        <form style="display:contents;" hx-post="/run" hx-indicator="#run-spinner-suite">
          <input type="hidden" name="path" value="${escapeHtml(source)}">
          <input type="hidden" name="env" value="" class="suite-env-input">
          <button type="submit" class="btn btn-sm btn-run" hx-disabled-elt="this">Run</button>
        </form>
      </td>
    </tr>`;
  }).join("");

  const errorRows = errors.map((e) => {
    const absPath = `${collection.test_path}/${e.file}`;
    const deleteVals = JSON.stringify({ file_path: absPath, collection_id: collection.id });
    return `<tr style="background:var(--fail-bg, rgba(239,68,68,0.1));">
    <td><code>${escapeHtml(e.file)}</code></td>
    <td colspan="3" style="color:var(--fail);">${escapeHtml(e.error)}</td>
    <td>
      <button class="btn btn-sm btn-danger"
        hx-post="/api/ai-generate/delete-file"
        hx-vals='${escapeHtml(deleteVals)}'
        hx-confirm="Delete ${escapeHtml(e.file)}?"
        hx-target="closest tr"
        hx-swap="outerHTML">Delete</button>
    </td>
  </tr>`;
  }).join("");

  return `
    <a href="/collections/${collection.id}" style="color:var(--text-dim);text-decoration:none;font-size:0.9rem;">&larr; Back to ${escapeHtml(collection.name)}</a>
    <h1>${escapeHtml(collection.name)} — Suites</h1>
    <div style="display:flex;gap:0.5rem;margin-bottom:1rem;align-items:center;">
      <form style="display:contents;" hx-post="/run" hx-indicator="#run-spinner-suite">
        <input type="hidden" name="path" value="${escapeHtml(collection.test_path)}">
        <select name="env" id="suite-env-select" style="padding:0.3rem;border:1px solid var(--border);border-radius:4px;background:var(--bg);color:var(--text);font-size:0.85rem;"
          onchange="document.querySelectorAll('.suite-env-input').forEach(function(el){el.value=this.value}.bind(this))">
          <option value="">No environment</option>
          ${envOptions}
        </select>
        <button type="submit" class="btn btn-sm btn-run" hx-disabled-elt="this">Run All</button>
      </form>
      <span id="run-spinner-suite" class="htmx-indicator" style="color:var(--text-dim);">Running...</span>
    </div>
    <p style="color:var(--text-dim);font-size:0.85rem;">${suites.length} suite${suites.length !== 1 ? "s" : ""} in <code>${escapeHtml(collection.test_path)}</code>${errors.length > 0 ? `, ${errors.length} error${errors.length !== 1 ? "s" : ""}` : ""}</p>
    <table>
      <thead><tr>
        <th>File</th><th>Suite Name</th><th>Tests</th><th>Base URL</th><th>Actions</th>
      </tr></thead>
      <tbody>${rows}${errorRows || ""}</tbody>
    </table>
  `;
}

function renderSuiteDetail(
  collection: { id: number; name: string },
  suite: TestSuite,
  relPath: string,
  envOptions: string,
): string {
  const stepRows = suite.tests.map((step, i) => `<tr>
    <td>${i + 1}</td>
    <td>${escapeHtml(step.name)}</td>
    <td>${methodBadge(step.method)}</td>
    <td><code>${escapeHtml(step.path)}</code></td>
    <td>${step.expect.status ?? "—"}</td>
  </tr>`).join("");

  const headersHtml = suite.headers
    ? Object.entries(suite.headers).map(([k, v]) => `<code>${escapeHtml(k)}: ${escapeHtml(v)}</code>`).join("<br>")
    : "<span style=\"color:var(--text-dim)\">None</span>";

  const source = (suite as any)._source as string;

  return `
    <a href="/collections/${collection.id}/suites" style="color:var(--text-dim);text-decoration:none;font-size:0.9rem;">&larr; Back to suites</a>
    <h1>${escapeHtml(suite.name)}</h1>
    <p style="color:var(--text-dim);font-size:0.85rem;">File: <code>${escapeHtml(relPath)}</code></p>

    <div class="cards">
      <div class="card">
        <div class="card-label">Base URL</div>
        <div class="card-value" style="font-size:0.85rem;">${suite.base_url ? escapeHtml(suite.base_url) : "—"}</div>
      </div>
      <div class="card">
        <div class="card-label">Tests</div>
        <div class="card-value">${suite.tests.length}</div>
      </div>
      <div class="card">
        <div class="card-label">Timeout</div>
        <div class="card-value">${suite.config.timeout}ms</div>
      </div>
      <div class="card">
        <div class="card-label">Headers</div>
        <div class="card-value" style="font-size:0.75rem;">${headersHtml}</div>
      </div>
    </div>

    <div style="display:flex;gap:0.5rem;margin:1rem 0;align-items:center;">
      <form style="display:contents;" hx-post="/run" hx-indicator="#run-spinner-detail">
        <input type="hidden" name="path" value="${escapeHtml(source)}">
        <select name="env" style="padding:0.3rem;border:1px solid var(--border);border-radius:4px;background:var(--bg);color:var(--text);font-size:0.85rem;">
          <option value="">No environment</option>
          ${envOptions}
        </select>
        <button type="submit" class="btn btn-sm btn-run" hx-disabled-elt="this">Run Suite</button>
      </form>
      <span id="run-spinner-detail" class="htmx-indicator" style="color:var(--text-dim);">Running...</span>
    </div>

    <div class="section-title">Test Steps</div>
    <table>
      <thead><tr>
        <th>#</th><th>Name</th><th>Method</th><th>Path</th><th>Expected Status</th>
      </tr></thead>
      <tbody>${stepRows}</tbody>
    </table>
  `;
}

export function createCollectionSuitesRoute() {
  const route = new Hono();

  route.get("/collections/:id/suites", async (c) => {
    const id = parseInt(c.req.param("id"), 10);
    const isHtmx = c.req.header("HX-Request") === "true";

    const collection = getCollectionById(id);
    if (!collection) {
      const content = `<h1>Collection not found</h1><a href="/">Back to dashboard</a>`;
      if (isHtmx) return c.html(content);
      return c.html(layout("Not Found", content), 404);
    }

    const envs = listEnvironments();
    const envOptions = envs.map(e => `<option value="${escapeHtml(e)}">${escapeHtml(e)}</option>`).join("");

    try {
      const { suites, errors } = await parseDirectorySafe(collection.test_path);
      const content = renderSuiteList(collection, suites, errors, envOptions);
      if (isHtmx) return c.html(content);
      return c.html(layout(`${collection.name} — Suites`, content));
    } catch (err) {
      const content = `
        <a href="/collections/${id}" style="color:var(--text-dim);text-decoration:none;font-size:0.9rem;">&larr; Back to collection</a>
        <h1>${escapeHtml(collection.name)} — Suites</h1>
        <p style="color:var(--fail);">Failed to read test directory: ${escapeHtml((err as Error).message)}</p>`;
      if (isHtmx) return c.html(content);
      return c.html(layout("Suites", content));
    }
  });

  route.get("/collections/:id/suites/detail", async (c) => {
    const id = parseInt(c.req.param("id"), 10);
    const fileParam = c.req.query("file") ?? "";
    const isHtmx = c.req.header("HX-Request") === "true";

    const collection = getCollectionById(id);
    if (!collection) {
      const content = `<h1>Collection not found</h1><a href="/">Back to dashboard</a>`;
      if (isHtmx) return c.html(content);
      return c.html(layout("Not Found", content), 404);
    }

    // Path traversal protection
    const absPath = resolve(collection.test_path, fileParam);
    if (!absPath.startsWith(resolve(collection.test_path))) {
      const content = `<h1>Invalid path</h1><a href="/collections/${id}/suites">Back to suites</a>`;
      if (isHtmx) return c.html(content);
      return c.html(layout("Error", content), 400);
    }

    const envs = listEnvironments();
    const envOptions = envs.map(e => `<option value="${escapeHtml(e)}">${escapeHtml(e)}</option>`).join("");

    try {
      const suite = await parseFile(absPath);
      const content = renderSuiteDetail(collection, suite, fileParam, envOptions);
      if (isHtmx) return c.html(content);
      return c.html(layout(`${suite.name} — Suite Detail`, content));
    } catch (err) {
      const content = `
        <a href="/collections/${id}/suites" style="color:var(--text-dim);text-decoration:none;font-size:0.9rem;">&larr; Back to suites</a>
        <h1>Parse Error</h1>
        <p style="color:var(--fail);">${escapeHtml((err as Error).message)}</p>`;
      if (isHtmx) return c.html(content);
      return c.html(layout("Suite Error", content));
    }
  });

  return route;
}
