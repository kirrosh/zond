import { OpenAPIHono, createRoute } from "@hono/zod-openapi";
import { escapeHtml } from "../views/layout.ts";
import { getRunById, getResultsByRunId } from "../../db/queries.ts";
import { generateJunitXml } from "../../core/reporter/junit.ts";
import { executeRun } from "../../core/runner/execute-run.ts";
import type { TestRunResult, StepResult } from "../../core/runner/types.ts";
import {
  ErrorSchema,
  RunRequestSchema,
  RunResponseSchema,
  RunDetailSchema,
  AuthorizeRequest,
  AuthorizeResponse,
  RunIdParam,
} from "../schemas.ts";

const api = new OpenAPIHono();

// ──────────────────────────────────────────────
// POST /run — form-data handler for HTMX
// ──────────────────────────────────────────────

api.post("/run", async (c) => {
  try {
    const form = await c.req.parseBody();
    const testPath = form["path"] as string;
    const envName = (form["env"] as string) || undefined;

    if (!testPath) {
      return c.json({ error: "Missing 'path' field" }, 400);
    }

    const { runId } = await executeRun({ testPath, envName, trigger: "webui" });

    c.header("HX-Redirect", `/runs/${runId}`);
    return c.json({ runId });
  } catch (err) {
    return c.json({ error: (err as Error).message }, 500);
  }
});

const runRoute = createRoute({
  method: "post",
  path: "/api/run",
  tags: ["Runs"],
  summary: "Run tests",
  request: {
    body: {
      content: { "application/json": { schema: RunRequestSchema } },
      required: true,
    },
  },
  responses: {
    200: {
      content: { "application/json": { schema: RunResponseSchema } },
      description: "Run created",
    },
    400: {
      content: { "application/json": { schema: ErrorSchema } },
      description: "Validation error",
    },
    500: {
      content: { "application/json": { schema: ErrorSchema } },
      description: "Server error",
    },
  },
});

api.openapi(runRoute, async (c) => {
  try {
    const { path: testPath, env: envName } = c.req.valid("json");
    const { runId } = await executeRun({ testPath, envName, trigger: "webui" });

    c.header("HX-Redirect", `/runs/${runId}`);
    return c.json({ runId }, 200);
  } catch (err) {
    return c.json({ error: (err as Error).message }, 500);
  }
});

// POST /api/try — HTMX-only, returns HTML fragment (not in OpenAPI spec)
api.post("/api/try", async (c) => {
  try {
    let method: string;
    let url: string;
    let headers: Record<string, string> = {};
    let body: string | undefined;

    const contentType = c.req.header("content-type") ?? "";

    if (contentType.includes("application/x-www-form-urlencoded") || contentType.includes("multipart/form-data")) {
      const formData = await c.req.parseBody();
      method = (formData["method"] as string)?.toUpperCase() ?? "GET";
      const basePath = formData["path"] as string ?? "/";
      const baseUrl = (formData["base_url"] as string ?? "").replace(/\/+$/, "");

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

// ──────────────────────────────────────────────
// POST /api/authorize
// ──────────────────────────────────────────────

const authorizeRoute = createRoute({
  method: "post",
  path: "/api/authorize",
  tags: ["Auth"],
  summary: "Proxy login request and extract token",
  request: {
    body: {
      content: { "application/json": { schema: AuthorizeRequest } },
      required: true,
    },
  },
  responses: {
    200: {
      content: { "application/json": { schema: AuthorizeResponse } },
      description: "Token extracted",
    },
    400: {
      content: { "application/json": { schema: ErrorSchema } },
      description: "Missing fields",
    },
    401: {
      content: { "application/json": { schema: ErrorSchema } },
      description: "Login failed",
    },
    500: {
      content: { "application/json": { schema: ErrorSchema } },
      description: "Server error",
    },
  },
});

api.openapi(authorizeRoute, async (c) => {
  try {
    const { base_url, path, username, password } = c.req.valid("json");
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

    const data = await response.json() as any;
    const token = data.token ?? data.access_token;
    if (!token) {
      return c.json({ error: "No token in response" }, 401);
    }

    return c.json({ token }, 200);
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

// ──────────────────────────────────────────────
// Export routes (OpenAPI-documented)
// ──────────────────────────────────────────────

const exportJsonRoute = createRoute({
  method: "get",
  path: "/api/export/{runId}/json",
  tags: ["Export"],
  summary: "Export run results as JSON",
  request: { params: RunIdParam },
  responses: {
    200: {
      content: { "application/json": { schema: RunDetailSchema } },
      description: "Run results",
    },
    400: {
      content: { "application/json": { schema: ErrorSchema } },
      description: "Invalid run ID",
    },
    404: {
      content: { "application/json": { schema: ErrorSchema } },
      description: "Run not found",
    },
  },
});

api.openapi(exportJsonRoute, (c) => {
  const { runId } = c.req.valid("param");
  const results = reconstructResults(runId);
  if (!results) return c.json({ error: "Run not found" }, 404);

  c.header("Content-Disposition", `attachment; filename="run-${runId}-results.json"`);
  return c.json(results as any, 200);
});

const exportJunitRoute = createRoute({
  method: "get",
  path: "/api/export/{runId}/junit",
  tags: ["Export"],
  summary: "Export run results as JUnit XML",
  request: { params: RunIdParam },
  responses: {
    200: { description: "JUnit XML file" },
    400: {
      content: { "application/json": { schema: ErrorSchema } },
      description: "Invalid run ID",
    },
    404: {
      content: { "application/json": { schema: ErrorSchema } },
      description: "Run not found",
    },
  },
});

api.openapi(exportJunitRoute, (c) => {
  const { runId } = c.req.valid("param");
  const results = reconstructResults(runId);
  if (!results) return c.json({ error: "Run not found" }, 404);

  const xml = generateJunitXml(results);
  c.header("Content-Disposition", `attachment; filename="run-${runId}-junit.xml"`);
  c.header("Content-Type", "application/xml");
  return c.body(xml);
});

export default api;
