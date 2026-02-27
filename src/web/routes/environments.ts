import { Hono } from "hono";
import { layout, escapeHtml } from "../views/layout.ts";
import {
  listEnvironmentRecords,
  getEnvironmentById,
  upsertEnvironment,
  deleteEnvironment,
} from "../../db/queries.ts";
import type { EnvironmentRecord } from "../../db/queries.ts";

const environments = new Hono();

function envListPage(envs: EnvironmentRecord[]): string {
  const rows = envs.map((e) => {
    const varCount = Object.keys(e.variables).length;
    return `<tr>
      <td><a href="/environments/${e.id}">${escapeHtml(e.name)}</a></td>
      <td>${varCount} variable${varCount === 1 ? "" : "s"}</td>
      <td>
        <a class="btn btn-sm btn-outline" href="/environments/${e.id}">Edit</a>
        <button class="btn btn-sm btn-danger"
          hx-delete="/api/environments/${e.id}"
          hx-confirm="Delete environment '${escapeHtml(e.name)}'?"
          hx-target="closest tr"
          hx-swap="outerHTML">Delete</button>
      </td>
    </tr>`;
  }).join("");

  return `
    <h1>Environments</h1>
    <table>
      <thead><tr><th>Name</th><th>Variables</th><th>Actions</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="3">No environments yet</td></tr>'}</tbody>
    </table>

    <div class="section-title" style="margin-top:2rem;">Create Environment</div>
    <form hx-post="/api/environments" hx-target="body" style="max-width:400px;">
      <div style="margin-bottom:0.75rem;">
        <label style="font-weight:600;font-size:0.85rem;display:block;margin-bottom:0.25rem;">Name</label>
        <input type="text" name="name" required placeholder="e.g. dev, staging, prod"
          style="width:100%;padding:0.4rem;border:1px solid var(--border);border-radius:4px;background:var(--bg);color:var(--text);">
      </div>
      <button type="submit" class="btn btn-sm">Create</button>
    </form>
  `;
}

function envDetailPage(env: EnvironmentRecord): string {
  const entries = Object.entries(env.variables);
  const varRows = entries.map(([key, value], i) => `
    <div class="env-var-row" style="display:flex;gap:0.5rem;margin-bottom:0.5rem;align-items:center;">
      <input type="text" name="key" value="${escapeHtml(key)}" placeholder="KEY"
        style="flex:1;padding:0.4rem;border:1px solid var(--border);border-radius:4px;background:var(--bg);color:var(--text);font-family:monospace;">
      <input type="text" name="value" value="${escapeHtml(value)}" placeholder="value"
        style="flex:2;padding:0.4rem;border:1px solid var(--border);border-radius:4px;background:var(--bg);color:var(--text);font-family:monospace;">
      <button type="button" class="btn btn-sm btn-danger" onclick="this.parentElement.remove()">x</button>
    </div>
  `).join("");

  return `
    <h1>${escapeHtml(env.name)}</h1>
    <div style="display:flex;gap:0.5rem;margin-bottom:1rem;">
      <a class="btn btn-sm" href="/environments">Back</a>
      <button class="btn btn-sm btn-danger"
        hx-delete="/api/environments/${env.id}"
        hx-confirm="Delete environment '${escapeHtml(env.name)}'?">Delete</button>
    </div>

    <form id="env-form" hx-put="/api/environments/${env.id}" hx-target="body">
      <div class="section-title">Variables</div>
      <div id="env-vars">
        ${varRows}
      </div>
      <div style="display:flex;gap:0.5rem;margin-top:0.75rem;">
        <button type="button" class="btn btn-sm btn-outline" onclick="addEnvVar()">Add Variable</button>
        <button type="submit" class="btn btn-sm">Save</button>
      </div>
    </form>

    <script>
    function addEnvVar() {
      var container = document.getElementById('env-vars');
      var row = document.createElement('div');
      row.className = 'env-var-row';
      row.style.cssText = 'display:flex;gap:0.5rem;margin-bottom:0.5rem;align-items:center;';
      row.innerHTML = '<input type="text" name="key" placeholder="KEY" style="flex:1;padding:0.4rem;border:1px solid var(--border);border-radius:4px;background:var(--bg);color:var(--text);font-family:monospace;">'
        + '<input type="text" name="value" placeholder="value" style="flex:2;padding:0.4rem;border:1px solid var(--border);border-radius:4px;background:var(--bg);color:var(--text);font-family:monospace;">'
        + '<button type="button" class="btn btn-sm btn-danger" onclick="this.parentElement.remove()">x</button>';
      container.appendChild(row);
    }
    </script>
  `;
}

// GET /environments — list all environments
environments.get("/environments", (c) => {
  const envs = listEnvironmentRecords();
  const content = envListPage(envs);
  const isHtmx = c.req.header("HX-Request") === "true";
  if (isHtmx) return c.html(content);
  return c.html(layout("Environments", content));
});

// GET /environments/:id — environment detail / edit page
environments.get("/environments/:id", (c) => {
  const id = parseInt(c.req.param("id"), 10);
  if (isNaN(id)) return c.html(layout("Error", "<h1>Invalid ID</h1>"), 400);

  const env = getEnvironmentById(id);
  if (!env) return c.html(layout("Not Found", "<h1>Environment not found</h1>"), 404);

  const content = envDetailPage(env);
  const isHtmx = c.req.header("HX-Request") === "true";
  if (isHtmx) return c.html(content);
  return c.html(layout(env.name, content));
});

// POST /api/environments — create environment
environments.post("/api/environments", async (c) => {
  const body = await c.req.parseBody();
  const name = (body["name"] as string ?? "").trim();

  if (!name) {
    return c.html(layout("Error", "<h1>Error</h1><p>Name is required.</p><a href=\"/environments\">Back</a>"), 400);
  }

  upsertEnvironment(name, {});

  c.header("HX-Redirect", "/environments");
  return c.redirect("/environments");
});

// PUT /api/environments/:id — update environment variables
environments.put("/api/environments/:id", async (c) => {
  const id = parseInt(c.req.param("id"), 10);
  if (isNaN(id)) return c.html(layout("Error", "<h1>Invalid ID</h1>"), 400);

  const env = getEnvironmentById(id);
  if (!env) return c.html(layout("Not Found", "<h1>Environment not found</h1>"), 404);

  const body = await c.req.parseBody({ all: true });
  const keys = (Array.isArray(body["key"]) ? body["key"] : [body["key"]]) as string[];
  const values = (Array.isArray(body["value"]) ? body["value"] : [body["value"]]) as string[];

  const variables: Record<string, string> = {};
  for (let i = 0; i < keys.length; i++) {
    const k = (keys[i] ?? "").trim();
    if (k) {
      variables[k] = values[i] ?? "";
    }
  }

  upsertEnvironment(env.name, variables);

  c.header("HX-Redirect", `/environments/${id}`);
  return c.redirect(`/environments/${id}`);
});

// DELETE /api/environments/:id — delete environment
environments.delete("/api/environments/:id", (c) => {
  const id = parseInt(c.req.param("id"), 10);
  deleteEnvironment(id);
  c.header("HX-Redirect", "/environments");
  return c.body(null, 200);
});

export default environments;
