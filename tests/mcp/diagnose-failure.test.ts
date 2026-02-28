import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { tmpdir } from "os";
import { join } from "path";
import { unlinkSync } from "fs";
import { getDb, closeDb } from "../../src/db/schema.ts";
import { createRun, finalizeRun, saveResults } from "../../src/db/queries.ts";
import type { TestRunResult } from "../../src/core/runner/types.ts";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerDiagnoseFailureTool } from "../../src/mcp/tools/diagnose-failure.ts";

function tmpDb(): string {
  return join(tmpdir(), `apitool-mcp-diag-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
}

function tryUnlink(path: string): void {
  for (const suffix of ["", "-wal", "-shm"]) {
    try { unlinkSync(path + suffix); } catch { /* ignore */ }
  }
}

describe("MCP diagnose_failure", () => {
  let dbPath: string;

  beforeEach(() => {
    dbPath = tmpDb();
    getDb(dbPath);
  });

  afterEach(() => {
    closeDb();
    tryUnlink(dbPath);
  });

  test("returns failures for a run", async () => {
    const runId = createRun({ started_at: new Date().toISOString(), environment: "dev" });
    const result: TestRunResult = {
      suite_name: "API",
      started_at: "2024-01-01T00:00:00Z",
      finished_at: "2024-01-01T00:00:01Z",
      total: 2,
      passed: 1,
      failed: 1,
      skipped: 0,
      steps: [
        {
          name: "OK test",
          status: "pass",
          duration_ms: 50,
          request: { method: "GET", url: "http://localhost/ok", headers: {} },
          response: { status: 200, headers: {}, body: "ok", duration_ms: 50 },
          assertions: [],
          captures: {},
        },
        {
          name: "Bad test",
          status: "fail",
          duration_ms: 100,
          request: { method: "POST", url: "http://localhost/bad", headers: {} },
          response: { status: 500, headers: {}, body: "error", duration_ms: 100 },
          assertions: [{ field: "status", rule: "equals", passed: false, actual: 500, expected: 201 }],
          captures: {},
          error: "Expected 201 but got 500",
        },
      ],
    };
    saveResults(runId, [result]);
    finalizeRun(runId, [result]);

    const server = new McpServer({ name: "test", version: "0.0.1" });
    registerDiagnoseFailureTool(server, dbPath);
    const tool = (server as any)._registeredTools["diagnose_failure"];

    const res = await tool.handler({ runId });
    const parsed = JSON.parse(res.content[0].text);
    expect(parsed.run.id).toBe(runId);
    expect(parsed.summary.failed).toBe(1);
    expect(parsed.failures.length).toBeGreaterThan(0);
  });

  test("returns error for missing run", async () => {
    const server = new McpServer({ name: "test", version: "0.0.1" });
    registerDiagnoseFailureTool(server, dbPath);
    const tool = (server as any)._registeredTools["diagnose_failure"];

    const res = await tool.handler({ runId: 9999 });
    expect(res.isError).toBe(true);
  });
});
