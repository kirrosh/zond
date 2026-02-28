import { describe, test, expect, mock, beforeEach } from "bun:test";

const mockGetRunById = mock((): unknown => ({
  id: 1, started_at: "2024-01-01", finished_at: "2024-01-01",
  total: 3, passed: 1, failed: 2, skipped: 0,
  trigger: "cli", environment: "staging", duration_ms: 500,
  commit_sha: null, branch: null, collection_id: null,
}));
const mockGetResultsByRunId = mock(() => [
  { suite_name: "API", test_name: "GET /pets", status: "pass", duration_ms: 100 },
  {
    suite_name: "API", test_name: "POST /pets", status: "fail", duration_ms: 200,
    error_message: "Expected 201 got 404",
    request_method: "POST", request_url: "https://api.com/pets",
    response_status: 404,
    assertions: [{ field: "status", expected: 201, actual: 404, pass: false }],
  },
  {
    suite_name: "API", test_name: "DELETE /pets/1", status: "error", duration_ms: 50,
    error_message: "Connection refused",
    request_method: "DELETE", request_url: "https://api.com/pets/1",
    response_status: null,
    assertions: [],
  },
]);

mock.module("../../../src/db/queries.ts", () => ({
  getRunById: mockGetRunById,
  getResultsByRunId: mockGetResultsByRunId,
}));

mock.module("../../../src/db/schema.ts", () => ({
  getDb: mock(() => ({})),
}));

import { diagnoseFailureTool } from "../../../src/core/agent/tools/diagnose-failure.ts";

const toolOpts = { toolCallId: "test", messages: [] as any[] };

describe("diagnoseFailureTool", () => {
  beforeEach(() => {
    mockGetRunById.mockClear();
    mockGetResultsByRunId.mockClear();
  });

  test("is an AI SDK v6 tool with inputSchema", () => {
    expect(diagnoseFailureTool).toHaveProperty("inputSchema");
    expect(diagnoseFailureTool).toHaveProperty("execute");
  });

  test("returns diagnosis with failed steps", async () => {
    const result = await diagnoseFailureTool.execute!({ runId: 1 }, toolOpts) as any;
    expect(result).toHaveProperty("run");
    expect(result).toHaveProperty("failures");
    expect(result.failures).toHaveLength(2);
    expect(result.failures[0].test_name).toBe("POST /pets");
    expect(result.failures[0].error_message).toBe("Expected 201 got 404");
    expect(result.failures[1].test_name).toBe("DELETE /pets/1");
    expect(result.summary).toEqual({ total: 3, passed: 1, failed: 2 });
  });

  test("returns error for missing run", async () => {
    mockGetRunById.mockReturnValueOnce(null);
    const result = await diagnoseFailureTool.execute!({ runId: 999 }, toolOpts);
    expect(result).toEqual({ error: "Run 999 not found" });
  });

  test("returns no failures when all passed", async () => {
    mockGetRunById.mockReturnValueOnce({
      id: 2, started_at: "2024-01-01", finished_at: "2024-01-01",
      total: 2, passed: 2, failed: 0, skipped: 0,
      trigger: "cli", environment: null, duration_ms: 200,
      commit_sha: null, branch: null, collection_id: null,
    });
    mockGetResultsByRunId.mockReturnValueOnce([
      { suite_name: "API", test_name: "GET /pets", status: "pass", duration_ms: 100 },
      { suite_name: "API", test_name: "GET /pets/1", status: "pass", duration_ms: 120 },
    ]);
    const result = await diagnoseFailureTool.execute!({ runId: 2 }, toolOpts) as any;
    expect(result.failures).toHaveLength(0);
    expect(result.summary).toEqual({ total: 2, passed: 2, failed: 0 });
  });
});
