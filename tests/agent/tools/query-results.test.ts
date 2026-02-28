import { describe, test, expect, mock, beforeEach, afterAll } from "bun:test";

const mockListRuns = mock(() => [
  { id: 1, started_at: "2024-01-01", total: 5, passed: 4, failed: 1, skipped: 0 },
  { id: 2, started_at: "2024-01-02", total: 3, passed: 3, failed: 0, skipped: 0 },
]);
const mockGetRunById = mock((): unknown => ({
  id: 1, started_at: "2024-01-01", finished_at: "2024-01-01", total: 5, passed: 4, failed: 1, skipped: 0,
  trigger: "cli", environment: "staging", duration_ms: 1234,
}));
const mockGetResultsByRunId = mock(() => [
  { suite_name: "API", test_name: "GET /pets", status: "pass", duration_ms: 100 },
  { suite_name: "API", test_name: "POST /pets", status: "fail", duration_ms: 200, error_message: "404" },
]);
const mockListCollections = mock(() => [
  { id: 1, name: "Petstore", test_path: "./tests/", total_runs: 5 },
]);

mock.module("../../../src/db/queries.ts", () => ({
  listRuns: mockListRuns,
  getRunById: mockGetRunById,
  getResultsByRunId: mockGetResultsByRunId,
  listCollections: mockListCollections,
}));

mock.module("../../../src/db/schema.ts", () => ({
  getDb: mock(() => ({})),
}));

afterAll(() => { mock.restore(); });

import { queryResultsTool } from "../../../src/core/agent/tools/query-results.ts";

const toolOpts = { toolCallId: "test", messages: [] as any[] };

describe("queryResultsTool", () => {
  beforeEach(() => {
    mockListRuns.mockClear();
    mockGetRunById.mockClear();
    mockGetResultsByRunId.mockClear();
    mockListCollections.mockClear();
  });

  test("is an AI SDK v6 tool with inputSchema", () => {
    expect(queryResultsTool).toHaveProperty("inputSchema");
    expect(queryResultsTool).toHaveProperty("execute");
  });

  test("list_runs action returns runs", async () => {
    const result = await queryResultsTool.execute!({ action: "list_runs" }, toolOpts) as any;
    expect(result).toEqual({ runs: mockListRuns() });
  });

  test("get_run action returns run details with results", async () => {
    const result = await queryResultsTool.execute!({ action: "get_run", runId: 1 }, toolOpts);
    expect(result).toHaveProperty("run");
    expect(result).toHaveProperty("results");
    expect(mockGetRunById).toHaveBeenCalledWith(1);
    expect(mockGetResultsByRunId).toHaveBeenCalledWith(1);
  });

  test("get_run with missing run returns error", async () => {
    mockGetRunById.mockReturnValueOnce(null);
    const result = await queryResultsTool.execute!({ action: "get_run", runId: 999 }, toolOpts);
    expect(result).toEqual({ error: "Run 999 not found" });
  });

  test("list_collections action returns collections", async () => {
    const result = await queryResultsTool.execute!({ action: "list_collections" }, toolOpts) as any;
    expect(result).toEqual({ collections: mockListCollections() });
  });

  test("unknown action returns error", async () => {
    const result = await queryResultsTool.execute!({ action: "unknown" as any }, toolOpts);
    expect(result).toEqual({ error: "Unknown action: unknown" });
  });
});
