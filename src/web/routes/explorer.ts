import { Hono } from "hono";
import { layout, escapeHtml } from "../views/layout.ts";
import type { EndpointInfo, SecuritySchemeInfo } from "../../core/generator/types.ts";

export interface ServerInfo {
  url: string;
  description?: string;
}

export interface ExplorerDeps {
  endpoints: EndpointInfo[];
  specPath: string | null;
  servers: ServerInfo[];
  securitySchemes: SecuritySchemeInfo[];
  loginPath: string | null;
}

function methodBadge(method: string): string {
  const m = method.toLowerCase();
  return `<span class="badge-method method-${m}">${method}</span>`;
}

function parameterRows(endpoint: EndpointInfo): string {
  if (endpoint.parameters.length === 0) return "";
  const rows = endpoint.parameters
    .map(
      (p) =>
        `<tr><td><code>${escapeHtml(p.name)}</code></td><td>${escapeHtml(p.in)}</td><td>${p.required ? "Yes" : "No"}</td><td>${escapeHtml((p.schema as any)?.type ?? "-")}</td></tr>`,
    )
    .join("");
  return `
    <div style="margin-top:0.5rem"><strong>Parameters</strong></div>
    <table>
      <thead><tr><th>Name</th><th>In</th><th>Required</th><th>Type</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function requestBodySection(endpoint: EndpointInfo): string {
  if (!endpoint.requestBodySchema) return "";
  return `
    <div style="margin-top:0.5rem"><strong>Request Body</strong> (${escapeHtml(endpoint.requestBodyContentType ?? "application/json")})</div>
    <pre>${escapeHtml(JSON.stringify(endpoint.requestBodySchema, null, 2))}</pre>`;
}

function responsesSection(endpoint: EndpointInfo): string {
  if (endpoint.responses.length === 0) return "";
  const rows = endpoint.responses
    .map(
      (r) =>
        `<tr><td>${r.statusCode}</td><td>${escapeHtml(r.description)}</td></tr>`,
    )
    .join("");
  return `
    <div style="margin-top:0.5rem"><strong>Responses</strong></div>
    <table>
      <thead><tr><th>Status</th><th>Description</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function tryItForm(endpoint: EndpointInfo, index: number, servers: ServerInfo[]): string {
  const pathParams = endpoint.parameters.filter((p) => p.in === "path");
  const queryParams = endpoint.parameters.filter((p) => p.in === "query");
  const headerParams = endpoint.parameters.filter((p) => p.in === "header");

  let fields = "";
  for (const p of pathParams) {
    fields += `<label>${escapeHtml(p.name)} (path)</label><input name="path_${p.name}" placeholder="${escapeHtml(p.name)}">`;
  }
  for (const q of queryParams) {
    fields += `<label>${escapeHtml(q.name)} (query)</label><input name="query_${q.name}" placeholder="${escapeHtml(q.name)}">`;
  }
  for (const h of headerParams) {
    fields += `<label>${escapeHtml(h.name)} (header)</label><input name="header_${h.name}" placeholder="${escapeHtml(h.name)}">`;
  }
  if (endpoint.requestBodySchema) {
    fields += `<label>Body (JSON)</label><textarea name="body">${escapeHtml(JSON.stringify(endpoint.requestBodySchema.example ?? {}, null, 2))}</textarea>`;
  }

  // Base URL: dropdown if multiple servers, input with default if one, empty if none
  let baseUrlField: string;
  if (servers.length > 1) {
    const opts = servers
      .map((s) => `<option value="${escapeHtml(s.url)}">${escapeHtml(s.url)}${s.description ? ` — ${escapeHtml(s.description)}` : ""}</option>`)
      .join("");
    baseUrlField = `<label>Server</label><select name="base_url">${opts}</select>`;
  } else {
    const defaultUrl = servers[0]?.url ?? "";
    baseUrlField = `<label>Base URL</label><input name="base_url" value="${escapeHtml(defaultUrl)}" placeholder="https://api.example.com" required>`;
  }

  return `
    <div class="try-form">
      <form hx-post="/api/try" hx-target="#response-${index}" hx-swap="innerHTML">
        <input type="hidden" name="method" value="${endpoint.method}">
        <input type="hidden" name="path" value="${escapeHtml(endpoint.path)}">
        ${baseUrlField}
        ${fields}
        <button type="submit" class="btn" style="margin-top:0.75rem">Try it</button>
      </form>
      <div class="response-panel" id="response-${index}"></div>
    </div>`;
}

function authorizePanel(deps: ExplorerDeps): string {
  const hasBearerScheme = deps.securitySchemes.some(
    (s) => s.type === "http" && s.scheme === "bearer",
  );
  if (!hasBearerScheme) return "";

  const loginPathAttr = deps.loginPath ? escapeHtml(deps.loginPath) : "";

  return `
    <details class="authorize-panel" open>
      <summary>Authorize <span id="auth-status" class="auth-status auth-none">Not authorized</span></summary>
      <div style="margin-top:0.75rem">
        <label style="display:block;font-weight:600;font-size:0.85rem;margin-bottom:0.25rem">Username</label>
        <input id="auth-user" type="text" placeholder="username" style="width:100%;padding:0.4rem 0.6rem;border:1px solid var(--border);border-radius:4px;background:var(--bg);color:var(--text);font-family:monospace;font-size:0.85rem;margin-bottom:0.5rem">
        <label style="display:block;font-weight:600;font-size:0.85rem;margin-bottom:0.25rem">Password</label>
        <input id="auth-pass" type="password" placeholder="password" style="width:100%;padding:0.4rem 0.6rem;border:1px solid var(--border);border-radius:4px;background:var(--bg);color:var(--text);font-family:monospace;font-size:0.85rem;margin-bottom:0.75rem">
        <button class="btn" type="button" onclick="doAuthorize()">Authorize</button>
      </div>
    </details>
    <script>
    window.__authToken = null;
    function applyAuthToken(token) {
      window.__authToken = token;
      document.querySelectorAll('.try-form form').forEach(function(form) {
        var inp = form.querySelector('input[name="header_Authorization"]');
        if (!inp) {
          inp = document.createElement('input');
          inp.type = 'hidden'; inp.name = 'header_Authorization';
          form.appendChild(inp);
        }
        inp.value = 'Bearer ' + token;
      });
      document.getElementById('auth-status').textContent = 'Authorized';
      document.getElementById('auth-status').className = 'auth-status auth-ok';
    }
    // HTMX hook: inject token into every /api/try request
    document.addEventListener('htmx:configRequest', function(evt) {
      if (window.__authToken && evt.detail.path === '/api/try') {
        evt.detail.parameters['header_Authorization'] = 'Bearer ' + window.__authToken;
      }
    });
    async function doAuthorize() {
      var base = document.querySelector('[name="base_url"]');
      base = base ? (base.value || '') : '';
      var resp = await fetch('/api/authorize', {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({
          base_url: base,
          path: '${loginPathAttr}',
          username: document.getElementById('auth-user').value,
          password: document.getElementById('auth-pass').value
        })
      });
      var data = await resp.json();
      if (data.token) applyAuthToken(data.token);
      else {
        var st = document.getElementById('auth-status');
        st.textContent = 'Error: ' + (data.error || 'Login failed');
        st.className = 'auth-status auth-none';
      }
    }
    </script>`;
}

export function createExplorerRoute(deps: ExplorerDeps) {
  const explorer = new Hono();

  explorer.get("/explorer", (c) => {
    const isHtmx = c.req.header("HX-Request") === "true";

    if (!deps.specPath || deps.endpoints.length === 0) {
      const content = `
        <h1>API Explorer</h1>
        <div class="upload-form">
          <p>No OpenAPI spec loaded. Start the server with <code>--openapi &lt;spec&gt;</code> to browse endpoints.</p>
        </div>`;
      if (isHtmx) return c.html(content);
      return c.html(layout("Explorer", content));
    }

    // Group by tags
    const groups = new Map<string, { endpoint: EndpointInfo; idx: number }[]>();
    deps.endpoints.forEach((ep, idx) => {
      const tag = ep.tags[0] ?? "default";
      const list = groups.get(tag) ?? [];
      list.push({ endpoint: ep, idx });
      groups.set(tag, list);
    });

    let groupsHtml = "";
    for (const [tag, items] of groups) {
      const endpointsHtml = items
        .map(({ endpoint, idx }) => {
          const detailId = `endpoint-detail-${idx}`;
          return `
            <div class="endpoint-item" onclick="var d=document.getElementById('${detailId}');d.style.display=d.style.display==='none'?'block':'none'">
              ${methodBadge(endpoint.method)}
              <span class="endpoint-path">${escapeHtml(endpoint.path)}</span>
              <span class="endpoint-summary">${endpoint.summary ? escapeHtml(endpoint.summary) : ""}</span>
            </div>
            <div class="detail-panel" id="${detailId}" style="display:none">
              ${parameterRows(endpoint)}
              ${requestBodySection(endpoint)}
              ${responsesSection(endpoint)}
              ${tryItForm(endpoint, idx, deps.servers)}
            </div>`;
        })
        .join("");

      groupsHtml += `
        <div class="endpoint-group">
          <h2>${escapeHtml(tag)}</h2>
          ${endpointsHtml}
        </div>`;
    }

    const content = `
      <h1>API Explorer</h1>
      <p>Spec: <code>${escapeHtml(deps.specPath)}</code> — ${deps.endpoints.length} endpoints</p>
      ${authorizePanel(deps)}
      ${groupsHtml}`;

    if (isHtmx) return c.html(content);
    return c.html(layout("Explorer", content));
  });

  return explorer;
}

export default createExplorerRoute;
