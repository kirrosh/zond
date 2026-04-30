import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { createApp, startServer } from "../../src/ui/server/server.ts";
import { getDb, closeDb } from "../../src/db/schema.ts";
import { createCollection, createRun, finalizeRun, saveResults } from "../../src/db/queries.ts";
import type { TestRunResult } from "../../src/core/runner/types.ts";
import { unlinkSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const TEST_DB_API = join(tmpdir(), `zond-ui-routes-api-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
const TEST_DB_SPA = join(tmpdir(), `zond-ui-routes-spa-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);

function seedData(): { runId: number } {
  const colId = createCollection({ name: "Test API", test_path: "./tests/pet" });
  const results: TestRunResult[] = [
    {
      suite_name: "petstore",
      started_at: "2025-01-01T00:00:00.000Z",
      finished_at: "2025-01-01T00:00:01.000Z",
      total: 2,
      passed: 1,
      failed: 1,
      skipped: 0,
      steps: [
        {
          name: "List pets",
          status: "pass",
          duration_ms: 100,
          request: { method: "GET", url: "http://localhost/pets", headers: {} },
          response: { status: 200, headers: {}, body: "[]", duration_ms: 100 },
          assertions: [{ field: "status", rule: "equals 200", passed: true, actual: 200, expected: 200 }],
          captures: {},
        },
        {
          name: "Delete pet",
          status: "fail",
          duration_ms: 50,
          request: { method: "DELETE", url: "http://localhost/pets/1", headers: {} },
          response: { status: 500, headers: {}, body: "boom", duration_ms: 50 },
          assertions: [{ field: "status", rule: "equals 204", passed: false, actual: 500, expected: 204 }],
          captures: {},
        },
      ],
    },
  ];
  const runId = createRun({ started_at: "2025-01-01T00:00:00.000Z", environment: "test", collection_id: colId });
  finalizeRun(runId, results);
  saveResults(runId, results);
  return { runId };
}

describe("UI API routes", () => {
  let app: ReturnType<typeof createApp>;
  let runId: number;

  beforeAll(() => {
    try { unlinkSync(TEST_DB_API); } catch {}
    getDb(TEST_DB_API);
    ({ runId } = seedData());
    app = createApp();
  });

  afterAll(() => {
    closeDb();
    try { unlinkSync(TEST_DB_API); } catch {}
  });

  it("GET /api/hello → 200 JSON", async () => {
    const res = await app.request("/api/hello");
    expect(res.status).toBe(200);
    const body = await res.json() as { message: string; ts: string };
    expect(body.message).toContain("zond");
    expect(typeof body.ts).toBe("string");
  });

  it("GET /api/runs → seeded run is listed", async () => {
    const res = await app.request("/api/runs");
    expect(res.status).toBe(200);
    const body = await res.json() as { runs: Array<{ id: number }>; total: number };
    expect(body.total).toBeGreaterThanOrEqual(1);
    expect(Array.isArray(body.runs)).toBe(true);
    expect(body.runs.find((r) => r.id === runId)).toBeDefined();
  });

  it("GET /api/runs/:id → run detail with results", async () => {
    const res = await app.request(`/api/runs/${runId}`);
    expect(res.status).toBe(200);
    const body = await res.json() as { run: { id: number }; results: unknown[] };
    expect(body.run.id).toBe(runId);
    expect(Array.isArray(body.results)).toBe(true);
    expect(body.results.length).toBeGreaterThan(0);
  });

  it("GET /api/runs/999999 → 404", async () => {
    const res = await app.request("/api/runs/999999");
    expect(res.status).toBe(404);
  });

  it("GET /api/runs/abc → 400 invalid id", async () => {
    const res = await app.request("/api/runs/abc");
    expect(res.status).toBe(400);
  });
});

describe("UI SPA smoke (dev bundle)", () => {
  let server: ReturnType<typeof Bun.serve>;
  let baseUrl: string;

  beforeAll(async () => {
    try { unlinkSync(TEST_DB_SPA); } catch {}
    getDb(TEST_DB_SPA);
    seedData();
    // dev:true uses HTML-import path, no dist/ui build required
    server = await startServer({ port: 0, host: "127.0.0.1", dev: true, dbPath: TEST_DB_SPA });
    baseUrl = `http://127.0.0.1:${server.port}`;
  });

  afterAll(() => {
    try { server?.stop(true); } catch {}
    closeDb();
    try { unlinkSync(TEST_DB_SPA); } catch {}
  });

  for (const path of ["/", "/runs", `/runs/1`]) {
    it(`GET ${path} → 200 HTML`, async () => {
      const res = await fetch(`${baseUrl}${path}`);
      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text.toLowerCase()).toContain("<!doctype html");
    });
  }
});
