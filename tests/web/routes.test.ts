import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { createApp } from "../../src/web/server.ts";
import { getDb, closeDb } from "../../src/db/schema.ts";
import { createRun, finalizeRun, saveResults } from "../../src/db/queries.ts";
import type { TestRunResult } from "../../src/core/runner/types.ts";
import { unlinkSync } from "node:fs";

const TEST_DB = "test-web-routes.db";

function seedData() {
  const results: TestRunResult[] = [
    {
      suite_name: "petstore",
      started_at: "2025-01-01T00:00:00.000Z",
      finished_at: "2025-01-01T00:00:01.500Z",
      total: 3,
      passed: 2,
      failed: 1,
      skipped: 0,
      steps: [
        {
          name: "List pets",
          status: "pass",
          duration_ms: 120,
          request: { method: "GET", url: "http://localhost/pets", headers: {} },
          response: { status: 200, headers: {}, body: "[]", duration_ms: 120 },
          assertions: [{ field: "status", rule: "equals 200", passed: true, actual: 200, expected: 200 }],
          captures: {},
        },
        {
          name: "Create pet",
          status: "pass",
          duration_ms: 200,
          request: { method: "POST", url: "http://localhost/pets", headers: {}, body: '{"name":"Buddy"}' },
          response: { status: 201, headers: {}, body: '{"id":1}', duration_ms: 200 },
          assertions: [{ field: "status", rule: "equals 201", passed: true, actual: 201, expected: 201 }],
          captures: { petId: 1 },
        },
        {
          name: "Delete pet",
          status: "fail",
          duration_ms: 50,
          request: { method: "DELETE", url: "http://localhost/pets/1", headers: {} },
          response: { status: 500, headers: {}, body: "error", duration_ms: 50 },
          assertions: [{ field: "status", rule: "equals 204", passed: false, actual: 500, expected: 204 }],
          captures: {},
        },
      ],
    },
  ];

  const runId = createRun({ started_at: "2025-01-01T00:00:00.000Z", environment: "test" });
  finalizeRun(runId, results);
  saveResults(runId, results);
  return runId;
}

describe("Web routes", () => {
  let app: ReturnType<typeof createApp>;
  let runId: number;

  beforeAll(() => {
    try { unlinkSync(TEST_DB); } catch {}
    getDb(TEST_DB);
    runId = seedData();
    app = createApp({ endpoints: [], specPath: null, servers: [] });
  });

  afterAll(() => {
    closeDb();
    try { unlinkSync(TEST_DB); } catch {}
  });

  it("GET / returns 200 with Dashboard", async () => {
    const res = await app.request("/");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Dashboard");
    expect(html).toContain("Total Runs");
    expect(html).toContain("Pass Rate");
  });

  it("GET /metrics returns HTML fragment", async () => {
    const res = await app.request("/metrics");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Total Runs");
  });

  it("GET /runs returns 200 with table", async () => {
    const res = await app.request("/runs");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Test Runs");
    expect(html).toContain(`#${runId}`);
  });

  it("GET /runs/:id returns 200 for existing run", async () => {
    const res = await app.request(`/runs/${runId}`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain(`Run #${runId}`);
    expect(html).toContain("petstore");
    expect(html).toContain("List pets");
    expect(html).toContain("Delete pet");
  });

  it("GET /runs/:id returns 404 for non-existent run", async () => {
    const res = await app.request("/runs/99999");
    expect(res.status).toBe(404);
    const html = await res.text();
    expect(html).toContain("Run not found");
  });

  it("GET /runs/:id returns 400 for invalid id", async () => {
    const res = await app.request("/runs/abc");
    expect(res.status).toBe(400);
  });

  it("GET /explorer returns 200 with no-spec message", async () => {
    const res = await app.request("/explorer");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Explorer");
    expect(html).toContain("--openapi");
  });

  it("GET /static/style.css returns 200 with CSS", async () => {
    const res = await app.request("/static/style.css");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/css");
    const css = await res.text();
    expect(css).toContain(":root");
  });

  it("GET /static/nonexistent returns 404", async () => {
    const res = await app.request("/static/nope.js");
    expect(res.status).toBe(404);
  });

  it("HTMX requests return fragment without layout", async () => {
    const res = await app.request("/", { headers: { "HX-Request": "true" } });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Dashboard");
    // Should not have full HTML boilerplate
    expect(html).not.toContain("<!DOCTYPE html>");
  });

  it("GET /runs with pagination", async () => {
    const res = await app.request("/runs?page=1");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Page 1");
  });
});
