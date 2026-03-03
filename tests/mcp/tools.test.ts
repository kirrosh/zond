import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { tmpdir } from "os";
import { join, resolve } from "path";
import { unlinkSync } from "fs";
import { getDb, closeDb } from "../../src/db/schema.ts";
import {
  createRun,
  finalizeRun,
  saveResults,
} from "../../src/db/queries.ts";
import type { TestRunResult } from "../../src/core/runner/types.ts";

// We test the tool handler logic directly by importing the registration functions
// and calling the MCP server's tool handlers through a minimal test harness
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

function tmpDb(): string {
  return join(tmpdir(), `apitool-mcp-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
}

function tryUnlink(path: string): void {
  for (const suffix of ["", "-wal", "-shm"]) {
    try { unlinkSync(path + suffix); } catch { /* ignore */ }
  }
}

function makeSuiteResult(overrides?: Partial<TestRunResult>): TestRunResult {
  return {
    suite_name: "Users API",
    started_at: "2024-01-01T00:00:00.000Z",
    finished_at: "2024-01-01T00:00:01.000Z",
    total: 2,
    passed: 1,
    failed: 1,
    skipped: 0,
    steps: [
      {
        name: "Get user",
        status: "pass",
        duration_ms: 100,
        request: { method: "GET", url: "http://localhost/users/1", headers: {} },
        response: { status: 200, headers: {}, body: '{"id":1}', duration_ms: 100 },
        assertions: [{ field: "status", rule: "equals", passed: true, actual: 200, expected: 200 }],
        captures: {},
      },
      {
        name: "Create user",
        status: "fail",
        duration_ms: 200,
        request: { method: "POST", url: "http://localhost/users", headers: {} },
        response: { status: 500, headers: {}, body: "error", duration_ms: 200 },
        assertions: [{ field: "status", rule: "equals", passed: false, actual: 500, expected: 201 }],
        captures: {},
        error: "Expected 201 but got 500",
      },
    ],
    ...overrides,
  };
}

// ──────────────────────────────────────────────
// validate_tests
// ──────────────────────────────────────────────

describe("validate_tests", () => {
  test("validates a valid test file", async () => {
    const { registerValidateTestsTool } = await import("../../src/mcp/tools/validate-tests.ts");

    const server = new McpServer({ name: "test", version: "0.0.1" });
    registerValidateTestsTool(server);

    // Access the registered tool handler via the internal registry
    const tool = (server as any)._registeredTools["validate_tests"];
    expect(tool).toBeDefined();

    const fixturePath = resolve("tests/fixtures/valid/a.yaml");
    const result = await tool.handler({ testPath: fixturePath });

    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe("text");

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.valid).toBe(true);
    expect(parsed.suites).toBe(1);
    expect(parsed.tests).toBe(1);
  });

  test("returns error for invalid path", async () => {
    const { registerValidateTestsTool } = await import("../../src/mcp/tools/validate-tests.ts");

    const server = new McpServer({ name: "test", version: "0.0.1" });
    registerValidateTestsTool(server);

    const tool = (server as any)._registeredTools["validate_tests"];
    const result = await tool.handler({ testPath: "/nonexistent/path.yaml" });

    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.valid).toBe(false);
    expect(parsed.error).toBeDefined();
  });
});

// ──────────────────────────────────────────────
// query_db
// ──────────────────────────────────────────────

describe("query_db", () => {
  let dbFile: string;

  beforeEach(() => {
    dbFile = tmpDb();
    getDb(dbFile);
  });

  afterEach(() => {
    closeDb();
    tryUnlink(dbFile);
  });

  test("list_collections returns empty array on fresh DB", async () => {
    const { registerQueryDbTool } = await import("../../src/mcp/tools/query-db.ts");

    const server = new McpServer({ name: "test", version: "0.0.1" });
    registerQueryDbTool(server, dbFile);

    const tool = (server as any)._registeredTools["query_db"];
    const result = await tool.handler({ action: "list_collections" });

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed).toEqual([]);
  });

  test("list_runs returns empty array on fresh DB", async () => {
    const { registerQueryDbTool } = await import("../../src/mcp/tools/query-db.ts");

    const server = new McpServer({ name: "test", version: "0.0.1" });
    registerQueryDbTool(server, dbFile);

    const tool = (server as any)._registeredTools["query_db"];
    const result = await tool.handler({ action: "list_runs" });

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed).toEqual([]);
  });

  test("list_runs returns runs after inserting data", async () => {
    const suiteResult = makeSuiteResult();
    const runId = createRun({ started_at: suiteResult.started_at, trigger: "mcp" });
    finalizeRun(runId, [suiteResult]);
    saveResults(runId, [suiteResult]);

    const { registerQueryDbTool } = await import("../../src/mcp/tools/query-db.ts");

    const server = new McpServer({ name: "test", version: "0.0.1" });
    registerQueryDbTool(server, dbFile);

    const tool = (server as any)._registeredTools["query_db"];
    const result = await tool.handler({ action: "list_runs", limit: 10 });

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].total).toBe(2);
    expect(parsed[0].passed).toBe(1);
    expect(parsed[0].failed).toBe(1);
  });

  test("get_run_results returns error for non-existent run", async () => {
    const { registerQueryDbTool } = await import("../../src/mcp/tools/query-db.ts");

    const server = new McpServer({ name: "test", version: "0.0.1" });
    registerQueryDbTool(server, dbFile);

    const tool = (server as any)._registeredTools["query_db"];
    const result = await tool.handler({ action: "get_run_results", runId: 999 });

    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.error).toContain("999");
  });

  test("get_run_results returns detailed results for existing run", async () => {
    const suiteResult = makeSuiteResult();
    const runId = createRun({ started_at: suiteResult.started_at, trigger: "mcp" });
    finalizeRun(runId, [suiteResult]);
    saveResults(runId, [suiteResult]);

    const { registerQueryDbTool } = await import("../../src/mcp/tools/query-db.ts");

    const server = new McpServer({ name: "test", version: "0.0.1" });
    registerQueryDbTool(server, dbFile);

    const tool = (server as any)._registeredTools["query_db"];
    const result = await tool.handler({ action: "get_run_results", runId });

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.run.id).toBe(runId);
    expect(parsed.run.total).toBe(2);
    expect(parsed.results).toHaveLength(2);
    expect(parsed.results[0].test_name).toBe("Get user");
    expect(parsed.results[1].test_name).toBe("Create user");
  });

  test("get_run_results requires runId", async () => {
    const { registerQueryDbTool } = await import("../../src/mcp/tools/query-db.ts");

    const server = new McpServer({ name: "test", version: "0.0.1" });
    registerQueryDbTool(server, dbFile);

    const tool = (server as any)._registeredTools["query_db"];
    const result = await tool.handler({ action: "get_run_results" });

    expect(result.isError).toBe(true);
  });

  test("diagnose_failure returns only failures", async () => {
    const suiteResult = makeSuiteResult();
    const runId = createRun({ started_at: suiteResult.started_at, trigger: "mcp" });
    finalizeRun(runId, [suiteResult]);
    saveResults(runId, [suiteResult]);

    const { registerQueryDbTool } = await import("../../src/mcp/tools/query-db.ts");

    const server = new McpServer({ name: "test", version: "0.0.1" });
    registerQueryDbTool(server, dbFile);

    const tool = (server as any)._registeredTools["query_db"];
    const result = await tool.handler({ action: "diagnose_failure", runId });

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.run.id).toBe(runId);
    expect(parsed.summary.failed).toBe(1);
    expect(parsed.failures.length).toBeGreaterThan(0);
    expect(parsed.failures.every((f: any) => f.status === "fail" || f.status === "error")).toBe(true);
  });

  test("diagnose_failure returns error for missing run", async () => {
    const { registerQueryDbTool } = await import("../../src/mcp/tools/query-db.ts");

    const server = new McpServer({ name: "test", version: "0.0.1" });
    registerQueryDbTool(server, dbFile);

    const tool = (server as any)._registeredTools["query_db"];
    const result = await tool.handler({ action: "diagnose_failure", runId: 9999 });

    expect(result.isError).toBe(true);
  });

  test("diagnose_failure includes hint for 5xx failures", async () => {
    const suiteResult = makeSuiteResult();
    const runId = createRun({ started_at: suiteResult.started_at, trigger: "mcp" });
    finalizeRun(runId, [suiteResult]);
    saveResults(runId, [suiteResult]);

    const { registerQueryDbTool } = await import("../../src/mcp/tools/query-db.ts");

    const server = new McpServer({ name: "test", version: "0.0.1" });
    registerQueryDbTool(server, dbFile);

    const tool = (server as any)._registeredTools["query_db"];
    const result = await tool.handler({ action: "diagnose_failure", runId });

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.failures.length).toBeGreaterThan(0);
    // The failing step has response status 500
    const failWith500 = parsed.failures.find((f: any) => f.response_status === 500);
    expect(failWith500).toBeDefined();
    expect(failWith500.hint).toContain("Server-side error");
  });

  test("diagnose_failure includes hint for 401 failures", async () => {
    const suiteResult = makeSuiteResult({
      steps: [{
        name: "Unauthorized call",
        status: "fail",
        duration_ms: 50,
        request: { method: "GET", url: "http://localhost/secure", headers: {} },
        response: { status: 401, headers: {}, body: "Unauthorized", duration_ms: 50 },
        assertions: [{ field: "status", rule: "equals", passed: false, actual: 401, expected: 200 }],
        captures: {},
        error: "Expected 200 but got 401",
      }],
      total: 1,
      passed: 0,
      failed: 1,
    });
    const runId = createRun({ started_at: suiteResult.started_at, trigger: "mcp" });
    finalizeRun(runId, [suiteResult]);
    saveResults(runId, [suiteResult]);

    const { registerQueryDbTool } = await import("../../src/mcp/tools/query-db.ts");

    const server = new McpServer({ name: "test", version: "0.0.1" });
    registerQueryDbTool(server, dbFile);

    const tool = (server as any)._registeredTools["query_db"];
    const result = await tool.handler({ action: "diagnose_failure", runId });

    const parsed = JSON.parse(result.content[0].text);
    const failWith401 = parsed.failures.find((f: any) => f.response_status === 401);
    expect(failWith401).toBeDefined();
    expect(failWith401.hint).toContain("Auth failure");
  });
});

// ──────────────────────────────────────────────
// describe_endpoint — testSnippet
// ──────────────────────────────────────────────

describe("describe_endpoint testSnippet", () => {
  test("returns testSnippet with {{base_url}} and correct method", async () => {
    const { registerDescribeEndpointTool } = await import("../../src/mcp/tools/describe-endpoint.ts");

    const server = new McpServer({ name: "test", version: "0.0.1" });
    registerDescribeEndpointTool(server);

    const tool = (server as any)._registeredTools["describe_endpoint"];
    const specPath = resolve("tests/fixtures/petstore-simple.json");
    const result = await tool.handler({ specPath, method: "GET", path: "/pets" });

    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.testSnippet).toBeDefined();
    expect(typeof parsed.testSnippet).toBe("string");
    expect(parsed.testSnippet).toContain("{{base_url}}");
    expect(parsed.testSnippet).toContain("GET:");
    expect(parsed.testSnippet).toContain("status:");
  });

  test("testSnippet includes Authorization header when security is defined", async () => {
    const { registerDescribeEndpointTool } = await import("../../src/mcp/tools/describe-endpoint.ts");

    const server = new McpServer({ name: "test", version: "0.0.1" });
    registerDescribeEndpointTool(server);

    const tool = (server as any)._registeredTools["describe_endpoint"];
    const specPath = resolve("tests/fixtures/petstore-auth.json");
    const result = await tool.handler({ specPath, method: "GET", path: "/pets" });

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.testSnippet).toContain("Authorization");
    expect(parsed.testSnippet).toContain("auth_token");
  });
});
