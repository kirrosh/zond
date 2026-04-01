/**
 * Explorer tab: Swagger-like interactive API explorer.
 * Renders endpoint forms, executes requests via server proxy, displays responses.
 */

import type { OpenAPIV3 } from "openapi-types";
import type { CollectionRecord } from "../../db/queries.ts";
import type { EndpointInfo } from "../../core/generator/types.ts";
import { escapeHtml } from "./layout.ts";
import { methodBadge } from "./results.ts";

// ── Public API ──

export async function renderExplorerTab(collection: CollectionRecord): Promise<string> {
  if (!collection.openapi_spec) {
    return `<div class="tab-empty">No OpenAPI spec configured. Register a spec with <code>setup_api</code> to see the explorer.</div>`;
  }

  let doc: OpenAPIV3.Document;
  let endpoints: EndpointInfo[];
  try {
    const { readOpenApiSpec, extractEndpoints } = await import("../../core/generator/openapi-reader.ts");
    doc = await readOpenApiSpec(collection.openapi_spec);
    endpoints = extractEndpoints(doc);
  } catch (err) {
    return `<div class="tab-empty">Failed to load OpenAPI spec: ${escapeHtml((err as Error).message)}</div>`;
  }

  if (endpoints.length === 0) {
    return `<div class="tab-empty">No endpoints found in the OpenAPI spec.</div>`;
  }

  // Resolve base URLs from spec servers + env
  const baseUrls: string[] = [];
  if (doc.servers && doc.servers.length > 0) {
    for (const s of doc.servers) {
      if (s.url) baseUrls.push(s.url);
    }
  }

  let envBaseUrl: string | undefined;
  try {
    const { loadEnvironment } = await import("../../core/parser/variables.ts");
    const env = await loadEnvironment(undefined, collection.base_dir ?? collection.test_path);
    if (env.base_url) {
      envBaseUrl = env.base_url;
      if (!baseUrls.includes(envBaseUrl)) baseUrls.unshift(envBaseUrl);
    }
  } catch { /* no env file */ }

  // Base URL bar
  const baseUrlBar = renderBaseUrlBar(baseUrls, envBaseUrl);

  // Group endpoints by first tag
  const groups = new Map<string, EndpointInfo[]>();
  for (const ep of endpoints) {
    const tag = ep.tags.length > 0 ? ep.tags[0]! : "Other";
    const list = groups.get(tag) ?? [];
    list.push(ep);
    groups.set(tag, list);
  }

  let idx = 0;
  const groupsHtml = [...groups.entries()].map(([tag, eps]) => {
    const rows = eps.map(ep => {
      const html = renderEndpointEntry(ep, idx, collection.id);
      idx++;
      return html;
    }).join("");
    return `<details class="explorer-group" open>
      <summary class="explorer-group-title">${escapeHtml(tag)} <span class="tab-count">${eps.length}</span></summary>
      ${rows}
    </details>`;
  }).join("");

  const script = `<script>
    function explorerToggle(id) {
      var el = document.getElementById(id);
      if (!el) return;
      el.style.display = el.style.display === 'none' ? 'block' : 'none';
    }
    function explorerAddHeader(btn) {
      var container = btn.previousElementSibling;
      var count = container.querySelectorAll('.explorer-header-pair').length;
      var row = document.createElement('div');
      row.className = 'explorer-header-pair';
      row.innerHTML = '<input type="text" name="custom_header_key_' + count + '" placeholder="Header name" class="explorer-input explorer-input-sm">' +
        '<input type="text" name="custom_header_value_' + count + '" placeholder="Value" class="explorer-input explorer-input-sm">' +
        '<button type="button" class="explorer-remove-btn" onclick="this.parentElement.remove()">x</button>';
      container.appendChild(row);
    }
    function explorerGetBaseUrl() {
      var sel = document.getElementById('explorer-base-url-select');
      var custom = document.getElementById('explorer-base-url-custom');
      if (sel && sel.value === '__custom__') return custom ? custom.value : '';
      return sel ? sel.value : (custom ? custom.value : '');
    }
    function explorerBeforeRequest(formId) {
      var form = document.getElementById(formId);
      if (!form) return true;
      var input = form.querySelector('input[name="base_url"]');
      if (input) input.value = explorerGetBaseUrl();
      return true;
    }
    document.addEventListener('change', function(e) {
      if (e.target && e.target.id === 'explorer-base-url-select') {
        var custom = document.getElementById('explorer-base-url-custom');
        if (custom) custom.style.display = e.target.value === '__custom__' ? 'block' : 'none';
      }
    });
  </script>`;

  return `${baseUrlBar}<div class="explorer-list">${groupsHtml}</div>${script}`;
}

export function renderProxyResponse(status: number, headers: Record<string, string>, body: string, elapsedMs: number): string {
  const statusClass = status < 300 ? "status-2xx" : status < 400 ? "status-3xx" : status < 500 ? "status-4xx" : "status-5xx";
  const statusText = httpStatusText(status);
  const size = body.length < 1024 ? `${body.length} B` : `${(body.length / 1024).toFixed(1)} KB`;

  // Try to format JSON
  let formattedBody: string;
  const contentType = headers["content-type"] ?? "";
  if (contentType.includes("json") || body.trimStart().startsWith("{") || body.trimStart().startsWith("[")) {
    try {
      const pretty = JSON.stringify(JSON.parse(body), null, 2);
      formattedBody = highlightJson(pretty);
    } catch {
      formattedBody = escapeHtml(body);
    }
  } else {
    formattedBody = escapeHtml(body);
  }

  const headerEntries = Object.entries(headers);
  const headersHtml = headerEntries.length > 0
    ? `<details class="response-headers">
        <summary>Headers (${headerEntries.length})</summary>
        <pre class="response-headers-pre">${headerEntries.map(([k, v]) => `<span class="json-key">${escapeHtml(k)}</span>: ${escapeHtml(v)}`).join("\n")}</pre>
      </details>`
    : "";

  return `<div class="explorer-response">
    <div class="response-meta">
      <span class="response-status ${statusClass}">${status} ${escapeHtml(statusText)}</span>
      <span class="response-time">${elapsedMs}ms</span>
      <span class="response-size">${size}</span>
    </div>
    ${headersHtml}
    <div class="response-body"><pre><code>${formattedBody}</code></pre></div>
  </div>`;
}

export function renderProxyError(message: string, elapsedMs: number): string {
  return `<div class="explorer-response explorer-response-error">
    <div class="response-meta">
      <span class="response-status status-5xx">Error</span>
      <span class="response-time">${elapsedMs}ms</span>
    </div>
    <div class="response-error-msg">${escapeHtml(message)}</div>
  </div>`;
}

// ── Private helpers ──

function renderBaseUrlBar(baseUrls: string[], envBaseUrl?: string): string {
  if (baseUrls.length === 0) {
    return `<div class="explorer-base-url">
      <label class="explorer-label">Base URL</label>
      <input type="text" id="explorer-base-url-custom" class="explorer-input" placeholder="https://api.example.com" value="">
    </div>`;
  }

  const options = baseUrls.map(url => {
    const label = url === envBaseUrl ? `${url} (env)` : url;
    return `<option value="${escapeHtml(url)}">${escapeHtml(label)}</option>`;
  }).join("");

  return `<div class="explorer-base-url">
    <label class="explorer-label">Base URL</label>
    <select id="explorer-base-url-select" class="explorer-input">
      ${options}
      <option value="__custom__">Custom...</option>
    </select>
    <input type="text" id="explorer-base-url-custom" class="explorer-input" placeholder="https://api.example.com" style="display:none;">
  </div>`;
}

function renderEndpointEntry(ep: EndpointInfo, index: number, collectionId: number): string {
  const formId = `explorer-form-${index}`;
  const detailId = `explorer-detail-${index}`;
  const responseId = `explorer-response-${index}`;
  const spinnerId = `explorer-spinner-${index}`;
  const deprecated = ep.deprecated ? ' <span class="warning-badge warning-deprecated">DEPRECATED</span>' : "";
  const securityHint = ep.security.length > 0
    ? ` <span class="explorer-auth-hint" title="Requires: ${escapeHtml(ep.security.join(", "))}">Auth</span>`
    : "";

  // Separate parameters by location
  const pathParams = ep.parameters.filter(p => p.in === "path");
  const queryParams = ep.parameters.filter(p => p.in === "query");
  const headerParams = ep.parameters.filter(p => p.in === "header");

  // Request body
  const hasBody = ["POST", "PUT", "PATCH"].includes(ep.method);
  const exampleBody = hasBody && ep.requestBodySchema
    ? JSON.stringify(generateExample(ep.requestBodySchema), null, 2)
    : "";
  const bodyContentType = ep.requestBodyContentType ?? "application/json";

  const paramsHtml = renderParamsSection(pathParams, queryParams, headerParams);
  const bodyHtml = hasBody ? renderBodySection(exampleBody, bodyContentType) : "";
  const headersHtml = renderCustomHeadersSection();

  return `
    <div class="explorer-endpoint" onclick="explorerToggle('${detailId}')">
      ${methodBadge(ep.method)}
      <span class="explorer-endpoint-path">${escapeHtml(ep.path)}</span>
      ${deprecated}${securityHint}
      ${ep.summary ? `<span class="explorer-endpoint-summary">${escapeHtml(ep.summary)}</span>` : ""}
    </div>
    <div class="explorer-detail" id="${detailId}" style="display:none" onclick="event.stopPropagation()">
      <form id="${formId}" hx-post="/api/proxy" hx-target="#${responseId}" hx-swap="innerHTML"
            hx-indicator="#${spinnerId}"
            hx-vals='js:{"base_url": explorerGetBaseUrl()}'
            hx-disabled-elt="find .explorer-send-btn">
        <input type="hidden" name="method" value="${ep.method}">
        <input type="hidden" name="path" value="${escapeHtml(ep.path)}">
        <input type="hidden" name="collection_id" value="${collectionId}">
        ${paramsHtml}
        ${bodyHtml}
        ${headersHtml}
        <div class="explorer-actions">
          <button type="submit" class="btn explorer-send-btn">Send</button>
          <span id="${spinnerId}" class="htmx-indicator explorer-spinner">Sending...</span>
        </div>
      </form>
      <div id="${responseId}" class="explorer-response-container"></div>
    </div>`;
}

function renderParamsSection(
  pathParams: OpenAPIV3.ParameterObject[],
  queryParams: OpenAPIV3.ParameterObject[],
  headerParams: OpenAPIV3.ParameterObject[],
): string {
  const all = [
    ...pathParams.map(p => ({ ...p, prefix: "param_path_" })),
    ...queryParams.map(p => ({ ...p, prefix: "param_query_" })),
    ...headerParams.map(p => ({ ...p, prefix: "param_header_" })),
  ];

  if (all.length === 0) return "";

  const rows = all.map(p => {
    const schema = p.schema as OpenAPIV3.SchemaObject | undefined;
    const type = schema?.type ?? "string";
    const required = p.required ? '<span class="explorer-required">*</span>' : "";
    const locationLabel = p.in === "path" ? "path" : p.in === "query" ? "query" : "header";
    const placeholder = schema?.example != null ? String(schema.example) : (schema?.enum ? schema.enum[0] : "");
    const defaultVal = schema?.default != null ? String(schema.default) : "";
    const description = p.description ? ` title="${escapeHtml(p.description)}"` : "";

    return `<div class="explorer-param-row"${description}>
      <span class="explorer-param-name">${escapeHtml(p.name)}${required}</span>
      <span class="explorer-param-location">${locationLabel}</span>
      <span class="explorer-param-type">${escapeHtml(type)}${schema?.format ? ` (${escapeHtml(schema.format)})` : ""}</span>
      <input type="text" name="${p.prefix}${escapeHtml(p.name)}" class="explorer-input"
        placeholder="${escapeHtml(placeholder)}" value="${escapeHtml(defaultVal)}"
        ${p.required ? "required" : ""}>
    </div>`;
  }).join("");

  return `<div class="explorer-section">
    <div class="explorer-section-title">Parameters</div>
    ${rows}
  </div>`;
}

function renderBodySection(exampleBody: string, contentType: string): string {
  return `<div class="explorer-section">
    <div class="explorer-section-title">Request Body
      <select name="content_type" class="explorer-input explorer-input-sm explorer-content-type">
        <option value="application/json"${contentType === "application/json" ? " selected" : ""}>application/json</option>
        <option value="application/x-www-form-urlencoded"${contentType === "application/x-www-form-urlencoded" ? " selected" : ""}>form-urlencoded</option>
      </select>
    </div>
    <textarea name="body" class="explorer-body-editor" rows="8" spellcheck="false">${escapeHtml(exampleBody)}</textarea>
  </div>`;
}

function renderCustomHeadersSection(): string {
  return `<div class="explorer-section">
    <div class="explorer-section-title">Headers</div>
    <div class="explorer-headers-list">
      <div class="explorer-header-pair">
        <input type="text" name="custom_header_key_0" placeholder="Header name" class="explorer-input explorer-input-sm">
        <input type="text" name="custom_header_value_0" placeholder="Value" class="explorer-input explorer-input-sm">
        <button type="button" class="explorer-remove-btn" onclick="this.parentElement.remove()">x</button>
      </div>
    </div>
    <button type="button" class="explorer-add-header-btn" onclick="explorerAddHeader(this)">+ Add header</button>
  </div>`;
}

function generateExample(schema: OpenAPIV3.SchemaObject, depth = 0): unknown {
  if (depth > 5) return {};

  if (schema.example !== undefined) return schema.example;

  if (schema.enum && schema.enum.length > 0) return schema.enum[0];

  if (schema.allOf) {
    const merged: Record<string, unknown> = {};
    for (const sub of schema.allOf) {
      const s = sub as OpenAPIV3.SchemaObject;
      const val = generateExample(s, depth + 1);
      if (typeof val === "object" && val !== null && !Array.isArray(val)) {
        Object.assign(merged, val);
      }
    }
    return merged;
  }

  if (schema.oneOf && schema.oneOf.length > 0) {
    return generateExample(schema.oneOf[0] as OpenAPIV3.SchemaObject, depth + 1);
  }

  if (schema.anyOf && schema.anyOf.length > 0) {
    return generateExample(schema.anyOf[0] as OpenAPIV3.SchemaObject, depth + 1);
  }

  switch (schema.type) {
    case "string":
      if (schema.format === "email") return "user@example.com";
      if (schema.format === "date") return "2026-01-01";
      if (schema.format === "date-time") return "2026-01-01T00:00:00Z";
      if (schema.format === "uri" || schema.format === "url") return "https://example.com";
      if (schema.format === "uuid") return "550e8400-e29b-41d4-a716-446655440000";
      return "string";
    case "integer":
      return schema.minimum != null ? schema.minimum : 0;
    case "number":
      return schema.minimum != null ? schema.minimum : 0.0;
    case "boolean":
      return true;
    case "array": {
      const items = schema.items as OpenAPIV3.SchemaObject | undefined;
      if (items) return [generateExample(items, depth + 1)];
      return [];
    }
    case "object":
    default:
      if (schema.properties) {
        const result: Record<string, unknown> = {};
        for (const [key, propObj] of Object.entries(schema.properties)) {
          result[key] = generateExample(propObj as OpenAPIV3.SchemaObject, depth + 1);
        }
        return result;
      }
      return {};
  }
}

function highlightJson(json: string): string {
  // Split into tokens and non-token text, escape everything properly
  const tokenRe = /("(?:\\.|[^"\\])*")\s*:|("(?:\\.|[^"\\])*")|([-]?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|\b(true|false)\b|\b(null)\b/g;
  let result = "";
  let lastIndex = 0;
  let m: RegExpExecArray | null;

  while ((m = tokenRe.exec(json)) !== null) {
    // Escape text between tokens (brackets, commas, whitespace, colons)
    if (m.index > lastIndex) {
      result += escapeHtml(json.slice(lastIndex, m.index));
    }
    const [, key, str, num, bool, nil] = m;
    if (key) result += `<span class="json-key">${escapeHtml(key)}</span>:`;
    else if (str) result += `<span class="json-string">${escapeHtml(str)}</span>`;
    else if (num) result += `<span class="json-number">${num}</span>`;
    else if (bool) result += `<span class="json-boolean">${bool}</span>`;
    else if (nil) result += `<span class="json-null">null</span>`;
    lastIndex = tokenRe.lastIndex;
  }
  // Remaining text after last token
  if (lastIndex < json.length) {
    result += escapeHtml(json.slice(lastIndex));
  }
  return result;
}

function httpStatusText(code: number): string {
  const map: Record<number, string> = {
    200: "OK", 201: "Created", 204: "No Content",
    301: "Moved Permanently", 302: "Found", 304: "Not Modified",
    400: "Bad Request", 401: "Unauthorized", 403: "Forbidden", 404: "Not Found",
    405: "Method Not Allowed", 409: "Conflict", 422: "Unprocessable Entity",
    429: "Too Many Requests",
    500: "Internal Server Error", 502: "Bad Gateway", 503: "Service Unavailable",
  };
  return map[code] ?? "";
}
