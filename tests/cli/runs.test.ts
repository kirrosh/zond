import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { tmpdir } from "os";
import { join } from "path";
import { unlinkSync } from "fs";
import { getDb, closeDb } from "../../src/db/schema.ts";
import { createRun, finalizeRun, saveResults } from "../../src/db/queries.ts";
import { runsCommand } from "../../src/cli/commands/runs.ts";
import type { TestRunResult } from "../../src/core/runner/types.ts";

function tmpDb(): string {
  return join(tmpdir(), `apitool-runs-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
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

describe("runsCommand", () => {
  let dbPath: string;

  beforeEach(() => {
    dbPath = tmpDb();
    getDb(dbPath);
  });

  afterEach(() => {
    closeDb();
    tryUnlink(dbPath);
  });

  test("list shows empty message when no runs", () => {
    const code = runsCommand({ dbPath });
    expect(code).toBe(0);
  });

  test("list shows runs table", () => {
    const runId = createRun({ started_at: new Date().toISOString(), environment: "dev" });
    const result = makeSuiteResult();
    saveResults(runId, [result]);
    finalizeRun(runId, [result]);
    const code = runsCommand({ dbPath });
    expect(code).toBe(0);
  });

  test("detail shows run info", () => {
    const runId = createRun({ started_at: new Date().toISOString() });
    const result = makeSuiteResult();
    saveResults(runId, [result]);
    finalizeRun(runId, [result]);
    const code = runsCommand({ runId, dbPath });
    expect(code).toBe(0);
  });

  test("detail returns 1 for missing run", () => {
    const code = runsCommand({ runId: 9999, dbPath });
    expect(code).toBe(1);
  });
});
