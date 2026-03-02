import { OpenAPIHono, createRoute } from "@hono/zod-openapi";
import { getRunById, getResultsByRunId } from "../../db/queries.ts";
import { generateJunitXml } from "../../core/reporter/junit.ts";
import { executeRun } from "../../core/runner/execute-run.ts";
import { statusBadge, renderSuiteResults, failedFilterToggle, autoExpandFailedScript } from "../views/results.ts";
import { formatDuration } from "../../core/reporter/console.ts";
import type { TestRunResult, StepResult } from "../../core/runner/types.ts";
import {
  ErrorSchema,
  RunRequestSchema,
  RunResponseSchema,
  RunDetailSchema,
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

    // If targeted at the results panel (dashboard), return inline HTML
    const hxTarget = c.req.header("HX-Target");
    if (hxTarget === "results-panel") {
      const run = getRunById(runId);
      if (!run) {
        c.header("HX-Redirect", `/runs/${runId}`);
        return c.json({ runId });
      }
      const results = getResultsByRunId(runId);
      const passed = run.passed;
      const failed = run.failed;
      const skipped = run.skipped;
      const total = run.total;
      const duration = run.duration_ms != null ? formatDuration(run.duration_ms) : "-";

      const header = `
        <div style="display:flex;align-items:center;gap:0.75rem;flex-wrap:wrap;margin-bottom:0.5rem;padding-bottom:0.5rem;border-bottom:1px solid var(--border);">
          <strong>Run #${run.id}</strong>
          <span style="color:var(--text-dim);font-size:0.85rem;">just now</span>
          <span style="font-size:0.9rem;">${passed}&#10003; ${failed}&#10007; ${skipped}&#9675;</span>
          <span style="color:var(--text-dim);font-size:0.85rem;">${duration}</span>
          ${statusBadge(total, passed, failed)}
          <span style="flex:1;"></span>
          <a href="/api/export/${run.id}/junit" download class="btn btn-sm btn-outline">Export JUnit</a>
          <a href="/api/export/${run.id}/json" download class="btn btn-sm btn-outline">Export JSON</a>
          ${failedFilterToggle()}
        </div>`;

      const suitesHtml = renderSuiteResults(results, runId);
      return c.html(header + suitesHtml + autoExpandFailedScript());
    }

    // Default: redirect to run detail page
    c.header("HX-Redirect", `/runs/${runId}`);
    return c.json({ runId });
  } catch (err) {
    const hxTarget = c.req.header("HX-Target");
    if (hxTarget === "results-panel") {
      return c.html(`<div style="color:var(--fail);padding:1rem;border:1px solid var(--fail);border-radius:6px;">Error: ${(err as Error).message}</div>`, 500);
    }
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
