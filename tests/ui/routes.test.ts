import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { createApp, startServer } from "../../src/ui/server/server.ts";
import { getDb, closeDb } from "../../src/db/schema.ts";
import { createCollection, createRun, finalizeRun, saveResults } from "../../src/db/queries.ts";
import type { TestRunResult } from "../../src/core/runner/types.ts";
import { mkdirSync, rmSync, unlinkSync, writeFileSync } from "fs";
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
      total: 4,
      passed: 1,
      failed: 3,
      skipped: 0,
      steps: [
        {
          name: "List pets",
          status: "fail",
          duration_ms: 100,
          request: { method: "GET", url: "http://localhost/pets", headers: {} },
          response: { status: 500, headers: {}, body: "[]", duration_ms: 100 },
          assertions: [{ field: "status", rule: "equals 200", passed: false, actual: 500, expected: 200 }],
          captures: {},
          provenance: {
            type: "openapi-generated",
            generator: "zond-generate",
            endpoint: "GET /pets",
            response_branch: "200",
            spec: "/tmp/petstore.json",
          },
          spec_pointer: "#/paths/~1pets/get/responses/200/content/application~1json/schema",
          spec_excerpt: '{"type":"array","items":{"type":"object"}}',
          failure_class: "definitely_bug",
          failure_class_reason: "Server returned 500 on a documented 200 response",
        },
        {
          name: "Probe limit float",
          status: "fail",
          duration_ms: 5,
          request: { method: "GET", url: "http://localhost/pets?limit=1.5", headers: {} },
          response: { status: 200, headers: {}, body: "[]", duration_ms: 5 },
          assertions: [{ field: "status", rule: "one of [400]", passed: false, actual: 200, expected: [400] }],
          captures: {},
          provenance: {
            type: "probe-suite",
            generator: "negative-probe",
            endpoint: "GET /pets",
            response_branch: "400|422",
          },
          failure_class: "likely_bug",
          failure_class_reason: "Negative probe expected 4xx, got 200 — API accepts invalid input",
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
        {
          name: "Manual smoke",
          status: "pass",
          duration_ms: 12,
          request: { method: "GET", url: "http://localhost/health", headers: {} },
          response: { status: 200, headers: {}, body: "ok", duration_ms: 12 },
          assertions: [{ field: "status", rule: "equals 200", passed: true, actual: 200, expected: 200 }],
          captures: {},
          provenance: { type: "manual" },
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

  it("GET /api/runs/:id → exposes provenance + spec_pointer + spec_excerpt", async () => {
    const res = await app.request(`/api/runs/${runId}`);
    const body = await res.json() as {
      results: Array<{
        test_name: string;
        provenance: { type?: string; generator?: string; endpoint?: string; response_branch?: string } | null;
        spec_pointer: string | null;
        spec_excerpt: string | null;
      }>;
    };

    const openapiStep = body.results.find((r) => r.test_name === "List pets");
    expect(openapiStep).toBeDefined();
    expect(openapiStep?.provenance?.type).toBe("openapi-generated");
    expect(openapiStep?.provenance?.endpoint).toBe("GET /pets");
    expect(openapiStep?.provenance?.response_branch).toBe("200");
    expect(openapiStep?.spec_pointer).toContain("#/paths");
    expect(openapiStep?.spec_excerpt).toContain('"type":"array"');

    const probeStep = body.results.find((r) => r.test_name === "Probe limit float");
    expect(probeStep?.provenance?.type).toBe("probe-suite");
    expect(probeStep?.provenance?.generator).toBe("negative-probe");
    expect(probeStep?.spec_pointer).toBeNull();
    expect(probeStep?.spec_excerpt).toBeNull();

    const manualStep = body.results.find((r) => r.test_name === "Manual smoke");
    expect(manualStep?.provenance?.type).toBe("manual");

    const legacyStep = body.results.find((r) => r.test_name === "Delete pet");
    expect(legacyStep?.provenance).toBeNull();
    expect(legacyStep?.spec_pointer).toBeNull();
    expect(legacyStep?.spec_excerpt).toBeNull();
  });

  it("GET /api/runs/:id → exposes failure_class + reason", async () => {
    const res = await app.request(`/api/runs/${runId}`);
    const body = await res.json() as {
      results: Array<{
        test_name: string;
        failure_class: string | null;
        failure_class_reason: string | null;
      }>;
    };

    const def = body.results.find((r) => r.test_name === "List pets");
    expect(def?.failure_class).toBe("definitely_bug");
    expect(def?.failure_class_reason).toContain("500");

    const likely = body.results.find((r) => r.test_name === "Probe limit float");
    expect(likely?.failure_class).toBe("likely_bug");

    const legacy = body.results.find((r) => r.test_name === "Delete pet");
    expect(legacy?.failure_class).toBeNull();
    expect(legacy?.failure_class_reason).toBeNull();
  });

  it("POST /api/replay → dryRun resolves vars from collection env without sending", async () => {
    const res = await app.request("/api/replay", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        method: "GET",
        url: "http://localhost/pets",
        headers: { "X-Trace": "abc" },
        dryRun: true,
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { resolved: { method: string; url: string; headers: Record<string, string> } };
    expect(body.resolved.method).toBe("GET");
    expect(body.resolved.url).toBe("http://localhost/pets");
    expect(body.resolved.headers["X-Trace"]).toBe("abc");
  });

  it("POST /api/replay → 400 on missing method/url", async () => {
    const res = await app.request("/api/replay", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "http://localhost" }),
    });
    expect(res.status).toBe(400);
  });

  it("POST /api/replay → sends and returns response", async () => {
    const origFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ ok: true }), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      })) as unknown as typeof fetch;
    try {
      const res = await app.request("/api/replay", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ method: "POST", url: "http://localhost/pets", body: '{"name":"x"}' }),
      });
      expect(res.status).toBe(200);
      const body = await res.json() as {
        resolved: { headers: Record<string, string> };
        response: { status: number; body: unknown };
      };
      expect(body.response.status).toBe(201);
      expect(body.resolved.headers["Content-Type"]).toBe("application/json");
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it("GET /api/runs/999999 → 404", async () => {
    const res = await app.request("/api/runs/999999");
    expect(res.status).toBe(404);
  });

  it("GET /api/runs/abc → 400 invalid id", async () => {
    const res = await app.request("/api/runs/abc");
    expect(res.status).toBe(400);
  });

  it("GET /api/sessions → groups runs that share a session_id", async () => {
    const sid = "test-session-abc";
    const r1 = createRun({ started_at: new Date().toISOString(), session_id: sid });
    finalizeRun(r1, [{
      suite_name: "s1", started_at: new Date().toISOString(), finished_at: new Date().toISOString(),
      total: 1, passed: 1, failed: 0, skipped: 0, steps: [],
    }]);
    const r2 = createRun({ started_at: new Date().toISOString(), session_id: sid });
    finalizeRun(r2, [{
      suite_name: "s2", started_at: new Date().toISOString(), finished_at: new Date().toISOString(),
      total: 2, passed: 1, failed: 1, skipped: 0, steps: [],
    }]);

    const res = await app.request("/api/sessions");
    expect(res.status).toBe(200);
    const body = await res.json() as { sessions: Array<{ session_id: string; run_count: number; total: number; failed: number }>; total: number };
    const found = body.sessions.find((s) => s.session_id === sid);
    expect(found).toBeDefined();
    expect(found!.run_count).toBe(2);
    expect(found!.total).toBe(3);
    expect(found!.failed).toBe(1);

    const runsRes = await app.request(`/api/sessions/${sid}/runs`);
    expect(runsRes.status).toBe(200);
    const runsBody = await runsRes.json() as { runs: Array<{ id: number; session_id: string }> };
    expect(runsBody.runs.length).toBe(2);
    expect(runsBody.runs[0]!.session_id).toBe(sid);
  });
});

describe("UI /api/suites", () => {
  const SUITES_DIR = join(tmpdir(), `zond-ui-suites-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const TEST_DB = join(tmpdir(), `zond-ui-suites-${Date.now()}.db`);
  let app: ReturnType<typeof createApp>;

  beforeAll(() => {
    try { unlinkSync(TEST_DB); } catch {}
    getDb(TEST_DB);
    seedData();
    app = createApp();

    mkdirSync(SUITES_DIR, { recursive: true });
    writeFileSync(join(SUITES_DIR, "manual.yaml"), [
      "name: Manual smoke",
      "description: hand-written health probe",
      "base_url: http://localhost",
      "tests:",
      "  - name: alive",
      "    GET: /health",
      "    expect:",
      "      status: 200",
    ].join("\n"));
    writeFileSync(join(SUITES_DIR, "generated.yaml"), [
      "name: listPets",
      "source:",
      "  type: openapi-generated",
      "  generator: zond-generate",
      "  endpoint: GET /pets",
      "  response_branch: '200'",
      "  spec: /tmp/petstore.json",
      "base_url: http://localhost",
      "tests:",
      "  - name: list pets",
      "    source:",
      "      type: openapi-generated",
      "      endpoint: GET /pets",
      "      response_branch: '200'",
      "    GET: /pets",
      "    expect:",
      "      status: 200",
      "  - name: list pets paged",
      "    source:",
      "      type: openapi-generated",
      "      endpoint: GET /pets",
      "      response_branch: '200'",
      "    GET: /pets?page=2",
      "    expect:",
      "      status: 200",
    ].join("\n"));
    writeFileSync(join(SUITES_DIR, "probe.yaml"), [
      "name: probe GET /pets",
      "source:",
      "  type: probe-suite",
      "  generator: negative-probe",
      "  endpoint: GET /pets",
      "base_url: http://localhost",
      "tests:",
      "  - name: probe limit float",
      "    GET: /pets?limit=1.5",
      "    expect:",
      "      status: [400, 422]",
    ].join("\n"));
  });

  afterAll(() => {
    closeDb();
    try { unlinkSync(TEST_DB); } catch {}
    try { rmSync(SUITES_DIR, { recursive: true, force: true }); } catch {}
  });

  it("GET /api/suites?path=… returns parsed suites with source blocks", async () => {
    const res = await app.request(`/api/suites?path=${encodeURIComponent(SUITES_DIR)}`);
    expect(res.status).toBe(200);
    const body = await res.json() as {
      root: string;
      errors: unknown[];
      suites: Array<{
        name: string;
        file: string | null;
        source: { type?: string; endpoint?: string } | null;
        step_count: number;
        tests: Array<{ name: string; method: string; path: string }>;
        last_run: { run_id: number } | null;
      }>;
    };
    expect(body.root).toBe(SUITES_DIR);
    expect(body.errors).toEqual([]);
    expect(body.suites.length).toBe(3);

    const generated = body.suites.find((s) => s.name === "listPets");
    expect(generated?.source?.type).toBe("openapi-generated");
    expect(generated?.source?.endpoint).toBe("GET /pets");
    expect(generated?.step_count).toBe(2);
    expect(generated?.tests[0]?.method).toBe("GET");
    expect(generated?.tests[0]?.path).toBe("/pets");

    const probe = body.suites.find((s) => s.name === "probe GET /pets");
    expect(probe?.source?.type).toBe("probe-suite");

    const manual = body.suites.find((s) => s.name === "Manual smoke");
    expect(manual?.source).toBeNull();
    expect(manual?.step_count).toBe(1);
  });

  it("GET /api/suites: last_run wires through suite_file → step_results", async () => {
    // Seed a run whose results carry suite_file = generated.yaml
    const filePath = join(SUITES_DIR, "generated.yaml");
    const runId = createRun({ started_at: "2026-01-01T00:00:00.000Z", environment: "test", collection_id: null });
    const results: TestRunResult[] = [{
      suite_name: "listPets",
      suite_file: filePath,
      started_at: "2026-01-01T00:00:00.000Z",
      finished_at: "2026-01-01T00:00:01.000Z",
      total: 2,
      passed: 1,
      failed: 1,
      skipped: 0,
      steps: [
        {
          name: "list pets",
          status: "pass",
          duration_ms: 5,
          request: { method: "GET", url: "http://localhost/pets", headers: {} },
          response: { status: 200, headers: {}, body: "[]", duration_ms: 5 },
          assertions: [{ field: "status", rule: "equals 200", passed: true, actual: 200, expected: 200 }],
          captures: {},
        },
        {
          name: "list pets paged",
          status: "fail",
          duration_ms: 5,
          request: { method: "GET", url: "http://localhost/pets?page=2", headers: {} },
          response: { status: 500, headers: {}, body: "boom", duration_ms: 5 },
          assertions: [{ field: "status", rule: "equals 200", passed: false, actual: 500, expected: 200 }],
          captures: {},
        },
      ],
    }];
    finalizeRun(runId, results);
    saveResults(runId, results);

    const res = await app.request(`/api/suites?path=${encodeURIComponent(SUITES_DIR)}`);
    const body = await res.json() as {
      suites: Array<{ name: string; last_run: { run_id: number; total: number; passed: number; failed: number } | null }>;
    };
    const generated = body.suites.find((s) => s.name === "listPets");
    expect(generated?.last_run?.run_id).toBe(runId);
    expect(generated?.last_run?.total).toBe(2);
    expect(generated?.last_run?.passed).toBe(1);
    expect(generated?.last_run?.failed).toBe(1);

    const manual = body.suites.find((s) => s.name === "Manual smoke");
    expect(manual?.last_run).toBeNull();
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
