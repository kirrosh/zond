import { Hono } from "hono";
import { escapeHtml } from "../views/layout.ts";

const api = new Hono();

// POST /api/run — run tests from WebUI
api.post("/api/run", async (c) => {
  try {
    const body = await c.req.json();
    const testPath: string = body.path;
    const envName: string | undefined = body.env;

    if (!testPath) {
      return c.json({ error: "Missing 'path' field" }, 400);
    }

    // Dynamic imports to avoid circular deps at module load time
    const { parse } = await import("../../core/parser/yaml-parser.ts");
    const { loadEnvironment } = await import("../../core/parser/variables.ts");
    const { runSuite } = await import("../../core/runner/executor.ts");
    const { getDb } = await import("../../db/schema.ts");
    const { createRun, finalizeRun, saveResults } = await import("../../db/queries.ts");
    const { dirname } = await import("node:path");

    const suites = await parse(testPath);
    if (suites.length === 0) {
      return c.json({ error: "No test files found" }, 404);
    }

    const env = await loadEnvironment(envName, dirname(testPath));
    const results = await Promise.all(suites.map((s) => runSuite(s, env)));

    getDb();
    const runId = createRun({
      started_at: results[0]?.started_at ?? new Date().toISOString(),
      environment: envName,
      trigger: "webui",
    });
    finalizeRun(runId, results);
    saveResults(runId, results);

    // Return redirect header for HTMX
    c.header("HX-Redirect", `/runs/${runId}`);
    return c.json({ runId });
  } catch (err) {
    return c.json({ error: (err as Error).message }, 500);
  }
});

// POST /api/try — single request from Explorer
api.post("/api/try", async (c) => {
  try {
    let method: string;
    let url: string;
    let headers: Record<string, string> = {};
    let body: string | undefined;

    const contentType = c.req.header("content-type") ?? "";

    if (contentType.includes("application/x-www-form-urlencoded") || contentType.includes("multipart/form-data")) {
      // From HTMX form
      const formData = await c.req.parseBody();
      method = (formData["method"] as string)?.toUpperCase() ?? "GET";
      const basePath = formData["path"] as string ?? "/";
      const baseUrl = (formData["base_url"] as string ?? "").replace(/\/+$/, "");

      // Build URL with path params
      let resolvedPath = basePath;
      const queryParts: string[] = [];

      for (const [key, value] of Object.entries(formData)) {
        if (key.startsWith("path_") && typeof value === "string" && value) {
          const paramName = key.slice(5);
          resolvedPath = resolvedPath.replace(`{${paramName}}`, encodeURIComponent(value));
        } else if (key.startsWith("query_") && typeof value === "string" && value) {
          const paramName = key.slice(6);
          queryParts.push(`${encodeURIComponent(paramName)}=${encodeURIComponent(value)}`);
        } else if (key.startsWith("header_") && typeof value === "string" && value) {
          const headerName = key.slice(7);
          headers[headerName] = value;
        }
      }

      url = baseUrl + resolvedPath;
      if (queryParts.length > 0) url += "?" + queryParts.join("&");

      const rawBody = formData["body"] as string | undefined;
      if (rawBody && rawBody.trim()) {
        body = rawBody;
        if (!headers["Content-Type"]) headers["Content-Type"] = "application/json";
      }
    } else {
      // JSON body
      const json = await c.req.json();
      method = (json.method ?? "GET").toUpperCase();
      url = json.url ?? "";
      headers = json.headers ?? {};
      body = json.body ? (typeof json.body === "string" ? json.body : JSON.stringify(json.body)) : undefined;
    }

    if (!url) {
      return c.html(`<div class="response-status status-4xx">Error: missing URL</div>`, 400);
    }

    const start = performance.now();
    const response = await fetch(url, {
      method,
      headers,
      body: body ?? undefined,
    });
    const duration = Math.round(performance.now() - start);

    const responseBody = await response.text();
    const statusClass = response.status < 400 ? "status-2xx" : response.status < 500 ? "status-4xx" : "status-5xx";

    let prettyBody = escapeHtml(responseBody);
    try {
      const parsed = JSON.parse(responseBody);
      prettyBody = escapeHtml(JSON.stringify(parsed, null, 2));
    } catch {
      // Not JSON, use raw
    }

    const respHeaders = Array.from(response.headers.entries())
      .map(([k, v]) => `${escapeHtml(k)}: ${escapeHtml(v)}`)
      .join("\n");

    return c.html(`
      <div class="response-status ${statusClass}">${response.status} ${escapeHtml(response.statusText)} (${duration}ms)</div>
      <details><summary>Headers</summary><pre>${respHeaders}</pre></details>
      <pre>${prettyBody}</pre>
    `);
  } catch (err) {
    return c.html(`<div class="response-status status-5xx">Error: ${escapeHtml((err as Error).message)}</div>`, 500);
  }
});

export default api;
