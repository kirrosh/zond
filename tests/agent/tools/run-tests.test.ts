import { describe, test, expect, mock, beforeEach, afterAll } from "bun:test";

// Mock executeRun before importing the tool
mock.module("../../../src/core/runner/execute-run.ts", () => ({
  executeRun: mock(() => Promise.resolve({
    runId: 1,
    results: [{
      suite_name: "Pet API",
      started_at: "2024-01-01T00:00:00Z",
      finished_at: "2024-01-01T00:00:01Z",
      total: 3,
      passed: 2,
      failed: 1,
      skipped: 0,
      steps: [],
    }],
  })),
}));

afterAll(() => { mock.restore(); });

import { runTestsTool } from "../../../src/core/agent/tools/run-tests.ts";
import { executeRun } from "../../../src/core/runner/execute-run.ts";

const toolOpts = { toolCallId: "test", messages: [] as any[] };

describe("runTestsTool", () => {
  beforeEach(() => {
    (executeRun as ReturnType<typeof mock>).mockClear();
  });

  test("is an AI SDK v6 tool with inputSchema", () => {
    expect(runTestsTool).toHaveProperty("inputSchema");
    expect(runTestsTool).toHaveProperty("execute");
    expect(runTestsTool).toHaveProperty("description");
  });

  test("returns structured result on success", async () => {
    const result = await runTestsTool.execute!({ testPath: "tests/api.yaml" }, toolOpts);
    expect(result).toEqual({
      runId: 1,
      total: 3,
      passed: 2,
      failed: 1,
      skipped: 0,
      status: "has_failures",
    });
    expect(executeRun).toHaveBeenCalledWith({
      testPath: "tests/api.yaml",
      envName: undefined,
      safe: undefined,
      trigger: "agent",
    });
  });

  test("passes envName and safe mode", async () => {
    await runTestsTool.execute!({ testPath: "tests/", envName: "staging", safe: true }, toolOpts);
    expect(executeRun).toHaveBeenCalledWith({
      testPath: "tests/",
      envName: "staging",
      safe: true,
      trigger: "agent",
    });
  });

  test("returns all_passed when no failures", async () => {
    (executeRun as ReturnType<typeof mock>).mockResolvedValueOnce({
      runId: 2,
      results: [{
        suite_name: "OK",
        started_at: "2024-01-01T00:00:00Z",
        finished_at: "2024-01-01T00:00:01Z",
        total: 5,
        passed: 5,
        failed: 0,
        skipped: 0,
        steps: [],
      }],
    });
    const result = await runTestsTool.execute!({ testPath: "tests/" }, toolOpts);
    expect((result as any).status).toBe("all_passed");
  });

  test("returns structured error on failure", async () => {
    (executeRun as ReturnType<typeof mock>).mockRejectedValueOnce(new Error("No test files found"));
    const result = await runTestsTool.execute!({ testPath: "bad/path" }, toolOpts);
    expect(result).toEqual({ error: "No test files found" });
  });
});
