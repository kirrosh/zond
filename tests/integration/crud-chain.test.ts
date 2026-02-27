import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { readOpenApiSpec, extractEndpoints, extractSecuritySchemes } from "../../src/core/generator/openapi-reader.ts";
import { generateSuites, writeSuites } from "../../src/core/generator/skeleton.ts";
import { detectCrudGroups } from "../../src/core/generator/crud.ts";
import { parseFile } from "../../src/core/parser/yaml-parser.ts";
import { runSuite } from "../../src/core/runner/executor.ts";
import { createApp } from "../../src/web/server.ts";
import { getDb } from "../../src/db/schema.ts";
import { tmpdir } from "os";
import { join } from "path";
import { rm, writeFile, mkdir } from "fs/promises";

const realFetch = globalThis.fetch;

describe("Dogfooding: apitool tests its own API", () => {
  let server: ReturnType<typeof Bun.serve>;
  let TEST_BASE: string;
  const tmpDir = join(tmpdir(), `apitool-dogfood-${Date.now()}`);

  beforeAll(async () => {
    globalThis.fetch = realFetch;
    await mkdir(tmpDir, { recursive: true });
    // Initialize DB for the test
    getDb(join(tmpDir, "test.db"));

    // Start apitool's own server
    const app = createApp({ endpoints: [], specPath: null, servers: [], securitySchemes: [], loginPath: null });
    server = Bun.serve({
      fetch: app.fetch,
      port: 0,
    });
    TEST_BASE = `http://localhost:${server.port}`;
  });

  afterAll(async () => {
    server?.stop();
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  });

  test("GET /api/openapi.json returns valid OpenAPI spec", async () => {
    const res = await fetch(`${TEST_BASE}/api/openapi.json`);
    expect(res.status).toBe(200);

    const spec = await res.json() as any;
    expect(spec.openapi).toBe("3.0.0");
    expect(spec.info.title).toBe("apitool API");
    expect(spec.paths).toBeDefined();
    expect(Object.keys(spec.paths).length).toBeGreaterThan(0);
  });

  test("Environments CRUD chain via JSON API", async () => {
    // POST — create environment
    const createRes = await fetch(`${TEST_BASE}/api/environments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "test-env" }),
    });
    expect(createRes.status).toBe(201);
    const created = await createRes.json() as any;
    expect(created.id).toBeDefined();
    expect(created.name).toBe("test-env");
    expect(created.variables).toEqual({});
    const envId = created.id;

    // GET list — environment should be there
    const listRes = await fetch(`${TEST_BASE}/api/environments`);
    expect(listRes.status).toBe(200);
    const list = await listRes.json() as any[];
    expect(list.some((e: any) => e.id === envId)).toBe(true);

    // GET by ID
    const getRes = await fetch(`${TEST_BASE}/api/environments/${envId}`);
    expect(getRes.status).toBe(200);
    const env = await getRes.json() as any;
    expect(env.id).toBe(envId);
    expect(env.name).toBe("test-env");

    // PUT — update variables
    const putRes = await fetch(`${TEST_BASE}/api/environments/${envId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ variables: { BASE_URL: "http://localhost:3000", TOKEN: "abc123" } }),
    });
    expect(putRes.status).toBe(200);
    const updated = await putRes.json() as any;
    expect(updated.variables.BASE_URL).toBe("http://localhost:3000");
    expect(updated.variables.TOKEN).toBe("abc123");

    // DELETE
    const delRes = await fetch(`${TEST_BASE}/api/environments/${envId}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
    });
    expect(delRes.status).toBe(204);

    // GET 404
    const getDeletedRes = await fetch(`${TEST_BASE}/api/environments/${envId}`);
    expect(getDeletedRes.status).toBe(404);
  });

  test("Collections CRUD chain via JSON API", async () => {
    // POST — create collection
    const createRes = await fetch(`${TEST_BASE}/api/collections`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Test Collection", test_path: "/tmp/tests" }),
    });
    expect(createRes.status).toBe(201);
    const created = await createRes.json() as any;
    expect(created.id).toBeDefined();
    expect(created.name).toBe("Test Collection");
    const colId = created.id;

    // GET list
    const listRes = await fetch(`${TEST_BASE}/api/collections`);
    expect(listRes.status).toBe(200);
    const list = await listRes.json() as any[];
    expect(list.some((c: any) => c.id === colId)).toBe(true);

    // GET by ID
    const getRes = await fetch(`${TEST_BASE}/api/collections/${colId}`);
    expect(getRes.status).toBe(200);
    const col = await getRes.json() as any;
    expect(col.name).toBe("Test Collection");

    // DELETE
    const delRes = await fetch(`${TEST_BASE}/api/collections/${colId}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
    });
    expect(delRes.status).toBe(204);

    // GET 404
    const getDeletedRes = await fetch(`${TEST_BASE}/api/collections/${colId}`);
    expect(getDeletedRes.status).toBe(404);
  });

  test("OpenAPI spec can be fetched and parsed by apitool generator", async () => {
    // Fetch spec
    const res = await fetch(`${TEST_BASE}/api/openapi.json`);
    const specJson = await res.json();
    await writeFile(join(tmpDir, "self-spec.json"), JSON.stringify(specJson));

    // Parse with apitool's openapi reader
    const doc = await readOpenApiSpec(join(tmpDir, "self-spec.json"));
    const endpoints = extractEndpoints(doc);

    expect(endpoints.length).toBeGreaterThan(0);
    // Should find our environment and collection routes
    const envPost = endpoints.find((e) => e.method === "POST" && e.path === "/api/environments");
    expect(envPost).toBeDefined();
    const colGet = endpoints.find((e) => e.method === "GET" && e.path === "/api/collections");
    expect(colGet).toBeDefined();
  });
});
