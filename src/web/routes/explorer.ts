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

function renderBearerScheme(scheme: SecuritySchemeInfo, deps: ExplorerDeps): string {
  const name = escapeHtml(scheme.name);
  const loginPathAttr = deps.loginPath ? escapeHtml(deps.loginPath) : "";

  let loginSection = "";
  if (deps.loginPath) {
    loginSection = `
      <div class="auth-input-group">
        <label>Username</label>
        <input id="auth-user-${name}" type="text" placeholder="username">
      </div>
      <div class="auth-input-group">
        <label>Password</label>
        <input id="auth-pass-${name}" type="password" placeholder="password">
      </div>
      <button class="btn btn-sm" type="button" onclick="doLoginProxy('${name}', '${loginPathAttr}')">Login</button>`;
  }

  return `
    <div class="auth-scheme-section" data-scheme="${name}">
      <div class="auth-scheme-header">
        ${name} <span class="auth-scheme-badge">bearer</span>
        <span class="auth-scheme-status" id="scheme-status-${name}"></span>
      </div>
      <div class="auth-input-group">
        <label>Token</label>
        <input id="auth-token-${name}" type="text" placeholder="Bearer token">
      </div>
      <button class="btn btn-sm" type="button" onclick="applyBearerDirect('${name}')" style="margin-bottom:0.5rem">Apply token</button>
      ${loginSection}
    </div>`;
}

function renderBasicScheme(scheme: SecuritySchemeInfo): string {
  const name = escapeHtml(scheme.name);
  return `
    <div class="auth-scheme-section" data-scheme="${name}">
      <div class="auth-scheme-header">
        ${name} <span class="auth-scheme-badge">basic</span>
        <span class="auth-scheme-status" id="scheme-status-${name}"></span>
      </div>
      <div class="auth-input-group">
        <label>Username</label>
        <input id="auth-basic-user-${name}" type="text" placeholder="username">
      </div>
      <div class="auth-input-group">
        <label>Password</label>
        <input id="auth-basic-pass-${name}" type="password" placeholder="password">
      </div>
      <button class="btn btn-sm" type="button" onclick="applyBasic('${name}')">Authorize</button>
    </div>`;
}

function renderApiKeyScheme(scheme: SecuritySchemeInfo): string {
  const name = escapeHtml(scheme.name);
  const keyName = escapeHtml(scheme.apiKeyName ?? "");
  const location = escapeHtml(scheme.in ?? "header");
  return `
    <div class="auth-scheme-section" data-scheme="${name}">
      <div class="auth-scheme-header">
        ${name} <span class="auth-scheme-badge">apiKey</span>
        <span class="auth-location-badge">in ${location} as ${keyName}</span>
        <span class="auth-scheme-status" id="scheme-status-${name}"></span>
      </div>
      <div class="auth-input-group">
        <label>${keyName}</label>
        <input id="auth-apikey-${name}" type="text" placeholder="API key value">
      </div>
      <button class="btn btn-sm" type="button" onclick="applyApiKey('${name}', '${location}', '${keyName}')">Apply</button>
    </div>`;
}

function renderUnsupportedScheme(scheme: SecuritySchemeInfo): string {
  const name = escapeHtml(scheme.name);
  const typeLabel = escapeHtml(scheme.type);
  return `
    <div class="auth-scheme-section" data-scheme="${name}">
      <div class="auth-scheme-header">
        ${name} <span class="auth-scheme-badge">${typeLabel}</span>
      </div>
      <div class="auth-unsupported">Not yet supported</div>
    </div>`;
}

function authScript(deps: ExplorerDeps): string {
  return `
    <script>
    window.__authCredentials = {};

    function setSchemeStatus(name, ok) {
      var el = document.getElementById('scheme-status-' + name);
      if (el) {
        el.textContent = ok ? 'Active' : '';
        el.className = 'auth-scheme-status' + (ok ? ' auth-scheme-badge active' : '');
      }
    }

    function updateGlobalStatus() {
      var count = Object.keys(window.__authCredentials).length;
      var el = document.getElementById('auth-status');
      if (!el) return;
      if (count > 0) {
        el.textContent = count + ' scheme' + (count > 1 ? 's' : '') + ' active';
        el.className = 'auth-status auth-ok';
      } else {
        el.textContent = 'Not authorized';
        el.className = 'auth-status auth-none';
      }
    }

    function applyBearerDirect(name) {
      var token = document.getElementById('auth-token-' + name).value;
      if (!token) return;
      window.__authCredentials[name] = { type: 'bearer', headers: { 'Authorization': 'Bearer ' + token }, queryParams: {} };
      setSchemeStatus(name, true);
      updateGlobalStatus();
    }

    function doLoginProxy(name, loginPath) {
      var base = document.querySelector('[name="base_url"]');
      base = base ? (base.value || '') : '';
      fetch('/api/authorize', {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({
          base_url: base,
          path: loginPath,
          username: document.getElementById('auth-user-' + name).value,
          password: document.getElementById('auth-pass-' + name).value
        })
      }).then(function(resp) { return resp.json(); }).then(function(data) {
        if (data.token) {
          window.__authCredentials[name] = { type: 'bearer', headers: { 'Authorization': 'Bearer ' + data.token }, queryParams: {} };
          setSchemeStatus(name, true);
          updateGlobalStatus();
        } else {
          var el = document.getElementById('auth-status');
          if (el) { el.textContent = 'Error: ' + (data.error || 'Login failed'); el.className = 'auth-status auth-none'; }
        }
      });
    }

    function applyApiKey(name, location, keyName) {
      var val = document.getElementById('auth-apikey-' + name).value;
      if (!val) return;
      var cred = { type: 'apiKey', headers: {}, queryParams: {} };
      if (location === 'header') { cred.headers[keyName] = val; }
      else if (location === 'query') { cred.queryParams[keyName] = val; }
      window.__authCredentials[name] = cred;
      setSchemeStatus(name, true);
      updateGlobalStatus();
    }

    function applyBasic(name) {
      var user = document.getElementById('auth-basic-user-' + name).value;
      var pass = document.getElementById('auth-basic-pass-' + name).value;
      if (!user) return;
      var encoded = btoa(user + ':' + pass);
      window.__authCredentials[name] = { type: 'basic', headers: { 'Authorization': 'Basic ' + encoded }, queryParams: {} };
      setSchemeStatus(name, true);
      updateGlobalStatus();
    }

    // HTMX hook: inject all active credentials into /api/try requests
    document.addEventListener('htmx:configRequest', function(evt) {
      if (evt.detail.path !== '/api/try') return;
      var creds = window.__authCredentials;
      for (var schemeName in creds) {
        var cred = creds[schemeName];
        for (var h in cred.headers) {
          evt.detail.parameters['header_' + h] = cred.headers[h];
        }
        for (var q in cred.queryParams) {
          evt.detail.parameters['query_' + q] = cred.queryParams[q];
        }
      }
    });
    </script>`;
}

function authorizePanel(deps: ExplorerDeps): string {
  if (deps.securitySchemes.length === 0) return "";

  const sections = deps.securitySchemes.map((scheme) => {
    if (scheme.type === "http" && scheme.scheme === "bearer") return renderBearerScheme(scheme, deps);
    if (scheme.type === "http" && scheme.scheme === "basic") return renderBasicScheme(scheme);
    if (scheme.type === "apiKey") return renderApiKeyScheme(scheme);
    return renderUnsupportedScheme(scheme);
  }).join("");

  return `
    <details class="authorize-panel" open>
      <summary>Authorize <span id="auth-status" class="auth-status auth-none">Not authorized</span></summary>
      <div class="auth-schemes">${sections}</div>
    </details>
    ${authScript(deps)}`;
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
