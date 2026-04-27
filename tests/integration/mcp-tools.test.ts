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

  test("tools/list exposes zond_run and zond_diagnose with JSON Schema inputs", async () => {
    const res = await client.listTools();
    const names = res.tools.map((t) => t.name);
    expect(names).toContain("zond_run");
    expect(names).toContain("zond_diagnose");

    const runTool = res.tools.find((t) => t.name === "zond_run")!;
    expect(runTool.inputSchema).toBeDefined();
    expect((runTool.inputSchema as { type?: string }).type).toBe("object");
    expect((runTool.inputSchema as { properties?: Record<string, unknown> }).properties).toHaveProperty("testPath");

    const diagTool = res.tools.find((t) => t.name === "zond_diagnose")!;
    expect((diagTool.inputSchema as { properties?: Record<string, unknown> }).properties).toHaveProperty("runId");
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
});
