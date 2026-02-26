import { Hono } from "hono";
import { escapeHtml } from "../views/layout.ts";
import { getRunById, getResultsByRunId } from "../../db/queries.ts";
import { generateJunitXml } from "../../core/reporter/junit.ts";
import type { TestRunResult, StepResult } from "../../core/runner/types.ts";

const api = new Hono();

// POST /api/run — run tests from WebUI
api.post("/api/run", async (c) => {
  try {
    const contentType = c.req.header("content-type") ?? "";
    let testPath: string;
    let envName: string | undefined;

    if (contentType.includes("application/json")) {
      const body = await c.req.json();
      testPath = body.path;
      envName = body.env;
    } else {
      const form = await c.req.parseBody();
      testPath = form["path"] as string;
      envName = (form["env"] as string) || undefined;
    }

    if (!testPath) {
      return c.json({ error: "Missing 'path' field" }, 400);
    }

    // Dynamic imports to avoid circular deps at module load time
    const { parse } = await import("../../core/parser/yaml-parser.ts");
    const { loadEnvironment } = await import("../../core/parser/variables.ts");
    const { runSuite } = await import("../../core/runner/executor.ts");
    const { getDb } = await import("../../db/schema.ts");
    const { createRun, finalizeRun, saveResults, findCollectionByTestPath } = await import("../../db/queries.ts");
    const { dirname, resolve } = await import("node:path");

    const suites = await parse(testPath);
    if (suites.length === 0) {
      return c.json({ error: "No test files found" }, 404);
    }

    const env = await loadEnvironment(envName, dirname(testPath));
    const results = await Promise.all(suites.map((s) => runSuite(s, env)));

    getDb();
    const collection = findCollectionByTestPath(resolve(testPath));
    const runId = createRun({
      started_at: results[0]?.started_at ?? new Date().toISOString(),
      environment: envName,
      trigger: "webui",
      collection_id: collection?.id,
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

// POST /api/authorize — proxy login request, extract token
api.post("/api/authorize", async (c) => {
  try {
    const { base_url, path, username, password } = await c.req.json();
    if (!base_url || !path) {
      return c.json({ error: "Missing base_url or path" }, 400);
    }

    const url = base_url.replace(/\/+$/, "") + path;
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });

    if (!response.ok) {
      const text = await response.text();
      return c.json({ error: `Login failed (${response.status}): ${text}` }, 401);
    }

    const data = await response.json();
    const token = data.token ?? data.access_token;
    if (!token) {
      return c.json({ error: "No token in response" }, 401);
    }

    return c.json({ token });
  } catch (err) {
    return c.json({ error: (err as Error).message }, 500);
  }
});

// ──────────────────────────────────────────────
// Export helpers
// ──────────────────────────────────────────────

function reconstructResults(runId: number): TestRunResult[] | null {
  const run = getRunById(runId);
  if (!run) return null;

  const rows = getResultsByRunId(runId);
  const suiteMap = new Map<string, StepResult[]>();

  for (const row of rows) {
    const steps = suiteMap.get(row.suite_name) ?? [];
    steps.push({
      name: row.test_name,
      status: row.status as StepResult["status"],
      duration_ms: row.duration_ms,
      request: {
        method: row.request_method ?? "GET",
        url: row.request_url ?? "",
        headers: {},
      },
      response: row.response_status != null
        ? { status: row.response_status, headers: {}, body: "", duration_ms: row.duration_ms }
        : undefined,
      assertions: row.assertions,
      captures: row.captures as Record<string, unknown>,
      error: row.error_message ?? undefined,
    });
    suiteMap.set(row.suite_name, steps);
  }

  const results: TestRunResult[] = [];
  for (const [suiteName, steps] of suiteMap) {
    const total = steps.length;
    const passed = steps.filter((s) => s.status === "pass").length;
    const failed = steps.filter((s) => s.status === "fail").length;
    const skipped = steps.filter((s) => s.status === "skip").length;
    results.push({
      suite_name: suiteName,
      started_at: run.started_at,
      finished_at: run.finished_at ?? run.started_at,
      total,
      passed,
      failed,
      skipped,
      steps,
    });
  }
  return results;
}

// GET /api/export/:runId/junit
api.get("/api/export/:runId/junit", (c) => {
  const runId = parseInt(c.req.param("runId"), 10);
  if (isNaN(runId)) return c.text("Invalid run ID", 400);

  const results = reconstructResults(runId);
  if (!results) return c.text("Run not found", 404);

  const xml = generateJunitXml(results);
  c.header("Content-Disposition", `attachment; filename="run-${runId}-junit.xml"`);
  c.header("Content-Type", "application/xml");
  return c.body(xml);
});

// GET /api/export/:runId/json
api.get("/api/export/:runId/json", (c) => {
  const runId = parseInt(c.req.param("runId"), 10);
  if (isNaN(runId)) return c.text("Invalid run ID", 400);

  const results = reconstructResults(runId);
  if (!results) return c.text("Run not found", 404);

  const json = JSON.stringify(results, null, 2);
  c.header("Content-Disposition", `attachment; filename="run-${runId}-results.json"`);
  c.header("Content-Type", "application/json");
  return c.body(json);
});

export default api;
