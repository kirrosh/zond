import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { tmpdir } from "os";
import { join } from "path";
import { mkdir, rm, writeFile } from "fs/promises";

import { diagnoseRun } from "../../src/core/diagnostics/db-analysis.ts";
import { closeDb } from "../../src/db/schema.ts";

const CLI_PATH = join(import.meta.dir, "..", "..", "src", "cli", "index.ts");

describe("MCP tools — registry + zond_run + zond_diagnose", () => {
  const tmpDir = join(tmpdir(), `zond-mcp-tools-${Date.now()}`);
  const dbPath = join(tmpDir, "zond.db");
  const testsDir = join(tmpDir, "tests");
  const suiteFile = join(testsDir, "ping.yaml");
  const specFile = join(tmpDir, "spec.json");

  let server: ReturnType<typeof Bun.serve>;
  let baseUrl: string;
  let client: Client;
  let transport: StdioClientTransport;

  beforeAll(async () => {
    await mkdir(testsDir, { recursive: true });

    server = Bun.serve({
      port: 0,
      fetch: (req) => {
        const url = new URL(req.url);
        if (url.pathname === "/ping") return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
        return new Response("not found", { status: 404 });
      },
    });
    baseUrl = `http://localhost:${server.port}`;

    await writeFile(suiteFile, [
      `name: ping suite`,
      `base_url: "${baseUrl}"`,
      `tests:`,
      `  - name: ping returns 200`,
      `    method: GET`,
      `    path: /ping`,
      `    expect:`,
      `      status: 200`,
    ].join("\n"));

    await writeFile(specFile, JSON.stringify({
      openapi: "3.0.0",
      info: { title: "Test API", version: "1.0.0" },
      servers: [{ url: baseUrl }],
      paths: {
        "/ping": {
          get: { summary: "Ping", responses: { "200": { description: "OK" } } },
        },
        "/users/{id}": {
          get: {
            parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
            responses: { "200": { description: "OK" } },
          },
        },
      },
    }));

    transport = new StdioClientTransport({
      command: "bun",
      args: [CLI_PATH, "mcp", "start", "--db", dbPath],
    });
    client = new Client(
      { name: "zond-test-client", version: "0.0.0" },
      { capabilities: {} },
    );
    await client.connect(transport);
  });

  afterAll(async () => {
    await client.close();
    server?.stop();
    closeDb();
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  });

  test("AC#1: tools/list returns all 11 zond_* tools, each with object-typed JSON Schema", async () => {
    const res = await client.listTools();
    const names = new Set(res.tools.map((t) => t.name));
    for (const expected of [
      "zond_run", "zond_diagnose", "zond_db_runs", "zond_db_run",
      "zond_describe", "zond_catalog", "zond_coverage",
      "zond_validate", "zond_sync", "zond_init", "zond_request",
    ]) {
      expect(names.has(expected)).toBe(true);
    }
    for (const tool of res.tools) {
      const schema = tool.inputSchema as { type?: string; properties?: unknown };
      expect(schema.type).toBe("object");
      expect(typeof tool.description).toBe("string");
      expect(tool.description!.length).toBeGreaterThan(0);
    }
  });

  test("AC#2: tools/call zond_run executes tests and returns runId", async () => {
    const res = await client.callTool({
      name: "zond_run",
      arguments: { testPath: suiteFile },
    });
    expect(res.isError).not.toBe(true);
    const data = res.structuredContent as { runId: number; results: unknown[] };
    expect(typeof data.runId).toBe("number");
    expect(data.runId).toBeGreaterThan(0);
    expect(Array.isArray(data.results)).toBe(true);
    expect(data.results.length).toBeGreaterThan(0);

    // Persist for AC#3 below
    (globalThis as any).__zondRunId = data.runId;
  });

  test("AC#3: tools/call zond_diagnose returns same structure as diagnoseRun()", async () => {
    const runId = (globalThis as any).__zondRunId as number;
    expect(runId).toBeGreaterThan(0);

    const res = await client.callTool({
      name: "zond_diagnose",
      arguments: { runId },
    });
    expect(res.isError).not.toBe(true);
    const toolData = res.structuredContent as Record<string, unknown>;

    closeDb();
    const direct = diagnoseRun(runId, undefined, dbPath);
    closeDb();

    expect(JSON.stringify(toolData)).toBe(JSON.stringify(direct));
    expect(toolData).toHaveProperty("run");
    expect(toolData).toHaveProperty("summary");
    expect(toolData).toHaveProperty("failures");
  });

  test("T7: resources/read zond://run/{id}/diagnosis returns markdown digest", async () => {
    const runId = (globalThis as any).__zondRunId as number;
    expect(runId).toBeGreaterThan(0);

    const res = await client.readResource({ uri: `zond://run/${runId}/diagnosis` });
    expect(res.contents).toHaveLength(1);
    const content = res.contents[0] as { uri: string; mimeType?: string; text?: string };
    expect(content.uri).toBe(`zond://run/${runId}/diagnosis`);
    expect(content.mimeType).toBe("text/markdown");
    expect(content.text).toMatch(new RegExp(`^# Run ${runId} `));
    expect(content.text).toContain("## Summary");
  });

  test("T7: resources/read zond://run/{id}/diagnosis errors on bad id", async () => {
    await expect(
      client.readResource({ uri: "zond://run/999999/diagnosis" }),
    ).rejects.toThrow(/Run 999999 not found/);
  });

  test("Unknown tool returns isError without throwing", async () => {
    const res = await client.callTool({
      name: "zond_nonexistent",
      arguments: {},
    });
    expect(res.isError).toBe(true);
  });

  test("Invalid input shape returns isError with Zod issues", async () => {
    const res = await client.callTool({
      name: "zond_run",
      arguments: { testPath: 42 as unknown as string },
    });
    expect(res.isError).toBe(true);
    const text = (res.content as Array<{ text?: string }>)[0]?.text ?? "";
    expect(text.toLowerCase()).toContain("invalid input");
  });

  test("zond_db_runs returns recent runs with the run from AC#2", async () => {
    const res = await client.callTool({
      name: "zond_db_runs",
      arguments: {},
    });
    expect(res.isError).not.toBe(true);
    const data = res.structuredContent as { runs: Array<{ id: number }> };
    expect(Array.isArray(data.runs)).toBe(true);
    expect(data.runs.length).toBeGreaterThan(0);
    const runId = (globalThis as any).__zondRunId as number;
    expect(data.runs.map((r) => r.id)).toContain(runId);
  });

  test("zond_db_run returns detail with run + results", async () => {
    const runId = (globalThis as any).__zondRunId as number;
    const res = await client.callTool({
      name: "zond_db_run",
      arguments: { runId },
    });
    expect(res.isError).not.toBe(true);
    const data = res.structuredContent as { run: { id: number }; results: unknown[] };
    expect(data.run.id).toBe(runId);
    expect(Array.isArray(data.results)).toBe(true);
  });

  test("zond_describe (compact) lists endpoints from spec", async () => {
    const res = await client.callTool({
      name: "zond_describe",
      arguments: { mode: "compact", specPath: specFile },
    });
    expect(res.isError).not.toBe(true);
    const data = res.structuredContent as { endpoints: Array<{ method: string; path: string }> };
    expect(data.endpoints.length).toBe(2);
    expect(data.endpoints.map((e) => e.path)).toContain("/ping");
  });

  test("zond_describe (endpoint) returns single endpoint detail", async () => {
    const res = await client.callTool({
      name: "zond_describe",
      arguments: { mode: "endpoint", specPath: specFile, method: "GET", path: "/ping" },
    });
    expect(res.isError).not.toBe(true);
    const data = res.structuredContent as { method: string; path: string };
    expect(data.method.toUpperCase()).toBe("GET");
    expect(data.path).toBe("/ping");
  });

  test("zond_catalog builds catalog from spec", async () => {
    const res = await client.callTool({
      name: "zond_catalog",
      arguments: { specPath: specFile },
    });
    expect(res.isError).not.toBe(true);
    const data = res.structuredContent as { endpointCount: number; endpoints: unknown[] };
    expect(data.endpointCount).toBe(2);
    expect(Array.isArray(data.endpoints)).toBe(true);
  });

  test("zond_coverage returns covered/uncovered counts", async () => {
    const res = await client.callTool({
      name: "zond_coverage",
      arguments: { specPath: specFile, testsDir },
    });
    expect(res.isError).not.toBe(true);
    const data = res.structuredContent as { total: number; covered: number; uncovered: number; percentage: number };
    expect(data.total).toBe(2);
    expect(data.covered + data.uncovered).toBe(2);
  });

  test("zond_validate counts suites and tests in YAML dir", async () => {
    const res = await client.callTool({
      name: "zond_validate",
      arguments: { path: testsDir },
    });
    expect(res.isError).not.toBe(true);
    const data = res.structuredContent as { suites: number; tests: number; valid: boolean };
    expect(data.valid).toBe(true);
    expect(data.suites).toBeGreaterThan(0);
    expect(data.tests).toBeGreaterThan(0);
  });

  test("zond_sync errors with isError when .zond-meta.json missing", async () => {
    const res = await client.callTool({
      name: "zond_sync",
      arguments: { specPath: specFile, testsDir },
    });
    expect(res.isError).toBe(true);
    const text = (res.content as Array<{ text?: string }>)[0]?.text ?? "";
    expect(text).toContain(".zond-meta.json");
  });

  test("zond_request hits the inline server and returns status/headers/body", async () => {
    const res = await client.callTool({
      name: "zond_request",
      arguments: { method: "GET", url: `${baseUrl}/ping` },
    });
    expect(res.isError).not.toBe(true);
    const data = res.structuredContent as { status: number; body: unknown; duration_ms: number };
    expect(data.status).toBe(200);
    expect((data.body as { ok?: boolean }).ok).toBe(true);
    expect(typeof data.duration_ms).toBe("number");
  });

  test("zond_init creates a collection and scaffold dir from spec", async () => {
    const initDir = join(tmpDir, "init-target");
    const res = await client.callTool({
      name: "zond_init",
      arguments: {
        name: `test-init-${Date.now()}`,
        spec: specFile,
        dir: initDir,
      },
    });
    expect(res.isError).not.toBe(true);
    const data = res.structuredContent as {
      created: boolean;
      collectionId: number;
      baseDir: string;
      testPath: string;
    };
    expect(data.created).toBe(true);
    expect(data.collectionId).toBeGreaterThan(0);
    expect(data.testPath.length).toBeGreaterThan(0);
  });
});
