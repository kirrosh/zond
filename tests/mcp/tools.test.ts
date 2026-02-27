import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { tmpdir } from "os";
import { join, resolve } from "path";
import { unlinkSync } from "fs";
import { getDb, closeDb } from "../../src/db/schema.ts";
import {
  createRun,
  finalizeRun,
  saveResults,
  listRuns,
  listCollections,
  listEnvironmentRecords,
  upsertEnvironment,
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
// list_runs
// ──────────────────────────────────────────────

describe("list_runs", () => {
  let dbFile: string;

  beforeEach(() => {
    dbFile = tmpDb();
    getDb(dbFile);
  });

  afterEach(() => {
    closeDb();
    tryUnlink(dbFile);
  });

  test("returns empty array on fresh DB", async () => {
    const { registerListRunsTool } = await import("../../src/mcp/tools/list-runs.ts");

    const server = new McpServer({ name: "test", version: "0.0.1" });
    registerListRunsTool(server, dbFile);

    const tool = (server as any)._registeredTools["list_runs"];
    const result = await tool.handler({ limit: undefined });

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed).toEqual([]);
  });

  test("returns runs after inserting data", async () => {
    const suiteResult = makeSuiteResult();
    const runId = createRun({ started_at: suiteResult.started_at, trigger: "mcp" });
    finalizeRun(runId, [suiteResult]);
    saveResults(runId, [suiteResult]);

    const { registerListRunsTool } = await import("../../src/mcp/tools/list-runs.ts");

    const server = new McpServer({ name: "test", version: "0.0.1" });
    registerListRunsTool(server, dbFile);

    const tool = (server as any)._registeredTools["list_runs"];
    const result = await tool.handler({ limit: undefined });

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].total).toBe(2);
    expect(parsed[0].passed).toBe(1);
    expect(parsed[0].failed).toBe(1);
  });
});

// ──────────────────────────────────────────────
// get_run_results
// ──────────────────────────────────────────────

describe("get_run_results", () => {
  let dbFile: string;

  beforeEach(() => {
    dbFile = tmpDb();
    getDb(dbFile);
  });

  afterEach(() => {
    closeDb();
    tryUnlink(dbFile);
  });

  test("returns error for non-existent run", async () => {
    const { registerGetRunResultsTool } = await import("../../src/mcp/tools/get-run-results.ts");

    const server = new McpServer({ name: "test", version: "0.0.1" });
    registerGetRunResultsTool(server, dbFile);

    const tool = (server as any)._registeredTools["get_run_results"];
    const result = await tool.handler({ runId: 999 });

    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.error).toContain("999");
  });

  test("returns detailed results for existing run", async () => {
    const suiteResult = makeSuiteResult();
    const runId = createRun({ started_at: suiteResult.started_at, trigger: "mcp" });
    finalizeRun(runId, [suiteResult]);
    saveResults(runId, [suiteResult]);

    const { registerGetRunResultsTool } = await import("../../src/mcp/tools/get-run-results.ts");

    const server = new McpServer({ name: "test", version: "0.0.1" });
    registerGetRunResultsTool(server, dbFile);

    const tool = (server as any)._registeredTools["get_run_results"];
    const result = await tool.handler({ runId });

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.run.id).toBe(runId);
    expect(parsed.run.total).toBe(2);
    expect(parsed.results).toHaveLength(2);
    expect(parsed.results[0].test_name).toBe("Get user");
    expect(parsed.results[1].test_name).toBe("Create user");
  });
});

// ──────────────────────────────────────────────
// list_collections
// ──────────────────────────────────────────────

describe("list_collections", () => {
  let dbFile: string;

  beforeEach(() => {
    dbFile = tmpDb();
    getDb(dbFile);
  });

  afterEach(() => {
    closeDb();
    tryUnlink(dbFile);
  });

  test("returns empty array on fresh DB", async () => {
    const { registerListCollectionsTool } = await import("../../src/mcp/tools/list-collections.ts");

    const server = new McpServer({ name: "test", version: "0.0.1" });
    registerListCollectionsTool(server, dbFile);

    const tool = (server as any)._registeredTools["list_collections"];
    const result = await tool.handler({});

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed).toEqual([]);
  });
});

// ──────────────────────────────────────────────
// list_environments
// ──────────────────────────────────────────────

describe("list_environments", () => {
  let dbFile: string;

  beforeEach(() => {
    dbFile = tmpDb();
    getDb(dbFile);
  });

  afterEach(() => {
    closeDb();
    tryUnlink(dbFile);
  });

  test("returns empty array on fresh DB", async () => {
    const { registerListEnvironmentsTool } = await import("../../src/mcp/tools/list-environments.ts");

    const server = new McpServer({ name: "test", version: "0.0.1" });
    registerListEnvironmentsTool(server, dbFile);

    const tool = (server as any)._registeredTools["list_environments"];
    const result = await tool.handler({});

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed).toEqual([]);
  });

  test("returns environments with variable keys only", async () => {
    upsertEnvironment("staging", { base_url: "https://staging.example.com", api_key: "secret123" });

    const { registerListEnvironmentsTool } = await import("../../src/mcp/tools/list-environments.ts");

    const server = new McpServer({ name: "test", version: "0.0.1" });
    registerListEnvironmentsTool(server, dbFile);

    const tool = (server as any)._registeredTools["list_environments"];
    const result = await tool.handler({});

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].name).toBe("staging");
    expect(parsed[0].variables).toContain("base_url");
    expect(parsed[0].variables).toContain("api_key");
    // Values should NOT be included
    expect(result.content[0].text).not.toContain("secret123");
  });
});
