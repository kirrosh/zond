import { Hono } from "hono";
import { layout, escapeHtml } from "../views/layout.ts";
import type { EndpointInfo, SecuritySchemeInfo } from "../../core/generator/types.ts";
import type { CoveredEndpoint } from "../../core/generator/coverage-scanner.ts";

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

// Cache for per-collection explorer deps
const depsCache = new Map<string, ExplorerDeps>();

export function clearExplorerCache(): void {
  depsCache.clear();
}

export async function loadExplorerDepsForSpec(specPath: string): Promise<ExplorerDeps> {
  const cached = depsCache.get(specPath);
  if (cached) return cached;

  const { readOpenApiSpec, extractEndpoints, extractSecuritySchemes } = await import("../../core/generator/openapi-reader.ts");
  const doc = await readOpenApiSpec(specPath);
  const endpoints = extractEndpoints(doc);
  const securitySchemes = extractSecuritySchemes(doc);

  let servers: ServerInfo[] = [];
  if (doc.servers && Array.isArray(doc.servers)) {
    servers = doc.servers.map((s: any) => ({
      url: (s.url ?? "").replace(/\/+$/, ""),
      description: s.description,
    }));
  }

  // Resolve relative server URLs using environment base_url
  const allRelative = servers.length > 0 && servers.every(s => !s.url.startsWith("http"));
  if (allRelative) {
    try {
      const { getEnvironment } = await import("../../db/queries.ts");
      const { sanitizeEnvName } = await import("../../core/generator/serializer.ts");
      const specTitle = (doc as any).info?.title;
      const envName = specTitle ? sanitizeEnvName(specTitle) : null;
      const env = envName ? getEnvironment(envName) : null;
      if (env?.base_url) {
        const envBase = env.base_url.replace(/\/+$/, "");
        if (envBase.startsWith("http")) {
          servers = servers.map(s => ({
            url: envBase,
            description: s.description ?? "From environment",
          }));
        }
      }
    } catch { /* DB not critical */ }
  }

  // Auto-detect login endpoint
  let loginPath: string | null = null;
  const loginEndpoint = endpoints.find((ep) => {
    if (ep.method !== "POST") return false;
    if (ep.security.length > 0) return false;
    return /\/(auth|login|token)/i.test(ep.path);
  });
  if (loginEndpoint) loginPath = loginEndpoint.path;

  const deps: ExplorerDeps = { endpoints, specPath, servers, securitySchemes, loginPath };
  depsCache.set(specPath, deps);
  return deps;
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
  const isRelative = (url: string) => !url.startsWith("http://") && !url.startsWith("https://");

  if (servers.length > 1) {
    // Filter out relative URLs or warn
    const opts = servers
      .map((s) => {
        const warn = isRelative(s.url) ? " ⚠ relative" : "";
        return `<option value="${escapeHtml(s.url)}">${escapeHtml(s.url)}${warn}${s.description ? ` — ${escapeHtml(s.description)}` : ""}</option>`;
      })
      .join("");
    baseUrlField = `<label>Server</label><select name="base_url">${opts}</select>`;
  } else {
    const rawUrl = servers[0]?.url ?? "";
    const defaultUrl = isRelative(rawUrl) ? "" : rawUrl;
    const placeholder = isRelative(rawUrl)
      ? `https://your-host${rawUrl}`
      : "https://api.example.com";
    baseUrlField = `<label>Base URL</label><input name="base_url" value="${escapeHtml(defaultUrl)}" placeholder="${escapeHtml(placeholder)}" required>`;
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

interface ExplorerRenderOptions {
  breadcrumb?: string;
  coveredMap?: Map<string, CoveredEndpoint[]>;
  collectionId?: number;
  specPath?: string;
  aiSettingsLabel?: string;
}

function normalizeEndpointKey(method: string, path: string): string {
  return `${method} ${path.replace(/\{[^}]+\}/g, "{*}").replace(/\{\{[^}]+\}\}/g, "{*}").replace(/\/+$/, "")}`;
}

function renderAISettingsPanel(aiSettingsLabel: string): string {
  return `
    <details class="authorize-panel" style="margin-top:0.75rem;">
      <summary>AI Provider <span class="ai-settings-saved">${aiSettingsLabel ? escapeHtml(aiSettingsLabel) : "Not configured"}</span></summary>
      <form hx-post="/api/settings/ai" hx-target="#ai-settings-status" hx-swap="innerHTML"
        style="display:grid;grid-template-columns:1fr 1fr;gap:0.5rem;margin-top:0.5rem;">
        <div>
          <label style="font-size:0.8rem;font-weight:600;color:var(--text-dim);display:block;">Provider</label>
          <select name="provider" style="width:100%;padding:0.35rem;border:1px solid var(--border);border-radius:4px;background:var(--bg);color:var(--text);">
            <option value="ollama">Ollama (local)</option>
            <option value="openai">OpenAI</option>
            <option value="anthropic">Anthropic (Claude)</option>
            <option value="custom">Custom (OpenAI-compatible)</option>
          </select>
        </div>
        <div>
          <label style="font-size:0.8rem;font-weight:600;color:var(--text-dim);display:block;">Model</label>
          <input type="text" name="model" placeholder="qwen3:4b"
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
        <div style="grid-column:1/-1;display:flex;align-items:center;gap:0.5rem;">
          <button type="submit" class="btn btn-sm">Save</button>
          <span id="ai-settings-status"></span>
        </div>
      </form>
    </details>`;
}

function renderEndpointSuites(files: CoveredEndpoint[]): string {
  if (files.length === 0) return "";
  const seen = new Set<string>();
  const links: string[] = [];
  for (const f of files) {
    if (seen.has(f.file)) continue;
    seen.add(f.file);
    const shortPath = f.file.replace(/^.*[/\\]/, "");
    links.push(`<span class="endpoint-suite-file"><code>${escapeHtml(shortPath)}</code></span>`);
  }
  return `<div class="endpoint-suites">${links.join(" ")}</div>`;
}

function renderGenerateButton(endpoint: EndpointInfo, idx: number, collectionId?: number, specPath?: string): string {
  if (!collectionId || !specPath) return "";
  const vals = JSON.stringify({
    method: endpoint.method,
    path: endpoint.path,
    collection_id: String(collectionId),
    spec_path: specPath,
  });
  return `
    <div class="endpoint-ai-generate" style="margin-top:0.75rem;">
      <div style="display:flex;align-items:center;gap:0.5rem;">
        <button class="btn btn-sm"
          hx-post="/api/ai-generate-endpoint"
          hx-vals='${escapeHtml(vals)}'
          hx-target="#endpoint-ai-result-${idx}"
          hx-indicator="#endpoint-ai-spinner-${idx}"
          hx-disabled-elt="this">
          Generate Test
        </button>
        <span class="htmx-indicator" id="endpoint-ai-spinner-${idx}" style="color:var(--text-dim);">Generating...</span>
      </div>
      <div id="endpoint-ai-result-${idx}" style="margin-top:0.5rem;"></div>
    </div>`;
}

function renderExplorerContent(deps: ExplorerDeps, options?: ExplorerRenderOptions): string {
  if (!deps.specPath || deps.endpoints.length === 0) {
    return `
      ${options?.breadcrumb ?? ""}
      <h1>API Explorer</h1>
      <div class="upload-form">
        <p>No OpenAPI spec loaded. Start the server with <code>--openapi &lt;spec&gt;</code> to browse endpoints.</p>
      </div>`;
  }

  const coveredMap = options?.coveredMap;

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
        const key = normalizeEndpointKey(endpoint.method, endpoint.path);

        // Coverage badge & related suites
        let coverageBadge = "";
        let suitesHtml = "";
        if (coveredMap) {
          const files = coveredMap.get(key) ?? [];
          coverageBadge = files.length > 0
            ? `<span class="badge-coverage badge-covered">tested</span>`
            : `<span class="badge-coverage badge-uncovered">no tests</span>`;
          suitesHtml = renderEndpointSuites(files);
        }

        return `
          <div class="endpoint-item" onclick="var d=document.getElementById('${detailId}');d.style.display=d.style.display==='none'?'block':'none'">
            ${methodBadge(endpoint.method)}
            <span class="endpoint-path">${escapeHtml(endpoint.path)}</span>
            ${coverageBadge}
            <span class="endpoint-summary">${endpoint.summary ? escapeHtml(endpoint.summary) : ""}</span>
          </div>
          ${suitesHtml}
          <div class="detail-panel" id="${detailId}" style="display:none">
            ${parameterRows(endpoint)}
            ${requestBodySection(endpoint)}
            ${responsesSection(endpoint)}
            ${tryItForm(endpoint, idx, deps.servers)}
            ${renderGenerateButton(endpoint, idx, options?.collectionId, options?.specPath)}
          </div>`;
      })
      .join("");

    groupsHtml += `
      <div class="endpoint-group">
        <h2>${escapeHtml(tag)}</h2>
        ${endpointsHtml}
      </div>`;
  }

  // AI settings panel (only for collection explorer)
  const aiPanel = options?.collectionId ? renderAISettingsPanel(options?.aiSettingsLabel ?? "") : "";

  return `
    ${options?.breadcrumb ?? ""}
    <h1>API Explorer</h1>
    <p>Spec: <code>${escapeHtml(deps.specPath)}</code> — ${deps.endpoints.length} endpoints</p>
    ${authorizePanel(deps)}
    ${aiPanel}
    ${groupsHtml}`;
}

export function createExplorerRoute(deps: ExplorerDeps) {
  const explorer = new Hono();

  explorer.get("/explorer", (c) => {
    const isHtmx = c.req.header("HX-Request") === "true";
    const content = renderExplorerContent(deps);
    if (isHtmx) return c.html(content);
    return c.html(layout("Explorer", content));
  });

  return explorer;
}

export function createCollectionExplorerRoute() {
  const route = new Hono();

  route.get("/collections/:id/explorer", async (c) => {
    const id = parseInt(c.req.param("id"), 10);
    const isHtmx = c.req.header("HX-Request") === "true";

    const { getCollectionById } = await import("../../db/queries.ts");
    const collection = getCollectionById(id);
    if (!collection) {
      const content = `<h1>Collection not found</h1><a href="/">Back to dashboard</a>`;
      if (isHtmx) return c.html(content);
      return c.html(layout("Not Found", content), 404);
    }

    if (!collection.openapi_spec) {
      const content = `
        <a href="/collections/${id}" style="color:var(--text-dim);text-decoration:none;font-size:0.9rem;">&larr; Back to collection</a>
        <h1>${escapeHtml(collection.name)} — Explorer</h1>
        <p>No OpenAPI spec linked to this collection.</p>`;
      if (isHtmx) return c.html(content);
      return c.html(layout("Explorer", content));
    }

    try {
      const deps = await loadExplorerDepsForSpec(collection.openapi_spec);
      const breadcrumb = `<a href="/collections/${id}" style="color:var(--text-dim);text-decoration:none;font-size:0.9rem;">&larr; Back to ${escapeHtml(collection.name)}</a>`;

      // Build coverage map from test files (method+path → files[])
      let coveredMap: Map<string, CoveredEndpoint[]> | undefined;
      if (collection.test_path) {
        try {
          const { scanCoveredEndpoints } = await import("../../core/generator/coverage-scanner.ts");
          const covered = await scanCoveredEndpoints(collection.test_path);
          coveredMap = new Map();
          for (const ep of covered) {
            const key = normalizeEndpointKey(ep.method, ep.path);
            const list = coveredMap.get(key) ?? [];
            if (!list.some(e => e.file === ep.file)) {
              list.push(ep);
            }
            coveredMap.set(key, list);
          }
        } catch { /* coverage scan not critical */ }
      }

      // Load AI settings label
      let aiSettingsLabel = "";
      try {
        const { getAISettings } = await import("../../db/queries.ts");
        const ai = getAISettings();
        if (ai.provider && ai.model) aiSettingsLabel = `${ai.provider} / ${ai.model}`;
        else if (ai.provider) aiSettingsLabel = ai.provider;
      } catch { /* not critical */ }

      const content = renderExplorerContent(deps, {
        breadcrumb,
        coveredMap,
        collectionId: id,
        specPath: collection.openapi_spec,
        aiSettingsLabel,
      });
      if (isHtmx) return c.html(content);
      return c.html(layout(`${collection.name} — Explorer`, content));
    } catch (err) {
      const content = `
        <a href="/collections/${id}" style="color:var(--text-dim);text-decoration:none;font-size:0.9rem;">&larr; Back to collection</a>
        <h1>${escapeHtml(collection.name)} — Explorer</h1>
        <p style="color:var(--fail);">Failed to load OpenAPI spec: ${escapeHtml((err as Error).message)}</p>`;
      if (isHtmx) return c.html(content);
      return c.html(layout("Explorer", content));
    }
  });

  return route;
}

export default createExplorerRoute;
