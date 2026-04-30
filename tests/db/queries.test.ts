import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { tmpdir } from "os";
import { join } from "path";
import { unlinkSync } from "fs";
import { getDb, closeDb } from "../../src/db/schema.ts";
import {
  createRun,
  finalizeRun,
  saveResults,
  getRunById,
  getResultsByRunId,
  listRuns,
  deleteRun,
  getDashboardStats,
  getPassRateTrend,
  getSlowestTests,
  getFlakyTests,
  countRuns,
} from "../../src/db/queries.ts";
import type { TestRunResult } from "../../src/core/runner/types.ts";

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

function tmpDb(): string {
  return join(tmpdir(), `zond-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
}

function tryUnlink(path: string): void {
  for (const suffix of ["", "-wal", "-shm"]) {
    try { unlinkSync(path + suffix); } catch { /* ignore on Windows */ }
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
        assertions: [{ field: "status", rule: "equals 200", passed: true, actual: 200, expected: 200 }],
        captures: {},
      },
      {
        name: "Delete user",
        status: "fail",
        duration_ms: 80,
        request: { method: "DELETE", url: "http://localhost/users/1", headers: {} },
        response: { status: 500, headers: {}, body: '{"error":"oops"}', duration_ms: 80 },
        assertions: [{ field: "status", rule: "equals 204", passed: false, actual: 500, expected: 204 }],
        captures: {},
      },
    ],
    ...overrides,
  };
}

let dbPath: string;

beforeEach(() => {
  dbPath = tmpDb();
  getDb(dbPath);
});

afterEach(() => {
  closeDb();
  tryUnlink(dbPath);
});

// ──────────────────────────────────────────────
// createRun
// ──────────────────────────────────────────────

describe("createRun", () => {
  test("returns a positive integer id", () => {
    const id = createRun({ started_at: "2024-01-01T00:00:00.000Z" });
    expect(typeof id).toBe("number");
    expect(id).toBeGreaterThan(0);
  });

  test("ids auto-increment", () => {
    const id1 = createRun({ started_at: "2024-01-01T00:00:00.000Z" });
    const id2 = createRun({ started_at: "2024-01-01T00:00:01.000Z" });
    expect(id2).toBe(id1 + 1);
  });

  test("stores started_at and environment", () => {
    const id = createRun({ started_at: "2024-06-15T10:00:00.000Z", environment: "staging" });
    const row = getRunById(id);
    expect(row?.started_at).toBe("2024-06-15T10:00:00.000Z");
    expect(row?.environment).toBe("staging");
  });

  test("defaults trigger to 'manual'", () => {
    const id = createRun({ started_at: "2024-01-01T00:00:00.000Z" });
    const row = getRunById(id);
    expect(row?.trigger).toBe("manual");
  });
});

// ──────────────────────────────────────────────
// finalizeRun
// ──────────────────────────────────────────────

describe("finalizeRun", () => {
  test("updates total/passed/failed/skipped/finished_at/duration_ms", () => {
    const id = createRun({ started_at: "2024-01-01T00:00:00.000Z" });
    finalizeRun(id, [makeSuiteResult()]);

    const row = getRunById(id);
    expect(row?.total).toBe(2);
    expect(row?.passed).toBe(1);
    expect(row?.failed).toBe(1);
    expect(row?.skipped).toBe(0);
    expect(row?.finished_at).toBe("2024-01-01T00:00:01.000Z");
    expect(typeof row?.duration_ms).toBe("number");
  });

  test("aggregates totals across multiple suites", () => {
    const id = createRun({ started_at: "2024-01-01T00:00:00.000Z" });
    finalizeRun(id, [
      makeSuiteResult({ total: 3, passed: 2, failed: 1 }),
      makeSuiteResult({ suite_name: "B", total: 2, passed: 2, failed: 0 }),
    ]);

    const row = getRunById(id);
    expect(row?.total).toBe(5);
    expect(row?.passed).toBe(4);
    expect(row?.failed).toBe(1);
  });
});

// ──────────────────────────────────────────────
// saveResults / getResultsByRunId
// ──────────────────────────────────────────────

describe("saveResults", () => {
  test("inserts one row per step", () => {
    const id = createRun({ started_at: "2024-01-01T00:00:00.000Z" });
    saveResults(id, [makeSuiteResult()]);

    const row = getDb(dbPath).query("SELECT COUNT(*) as n FROM results WHERE run_id = ?").get(id) as { n: number };
    expect(row.n).toBe(2);
  });

  test("stores suite_name and test_name correctly", () => {
    const id = createRun({ started_at: "2024-01-01T00:00:00.000Z" });
    saveResults(id, [makeSuiteResult()]);

    const results = getResultsByRunId(id);
    expect(results[0]?.suite_name).toBe("Users API");
    expect(results[0]?.test_name).toBe("Get user");
  });

  test("response_body is stored for passing steps", () => {
    const id = createRun({ started_at: "2024-01-01T00:00:00.000Z" });
    saveResults(id, [makeSuiteResult()]);

    const row = getDb(dbPath)
      .query("SELECT response_body FROM results WHERE test_name = 'Get user'")
      .get() as { response_body: string | null };
    expect(row?.response_body).toBe('{"id":1}');
  });

  test("response_body is stored for failing steps", () => {
    const id = createRun({ started_at: "2024-01-01T00:00:00.000Z" });
    saveResults(id, [makeSuiteResult()]);

    const row = getDb(dbPath)
      .query("SELECT response_body FROM results WHERE test_name = 'Delete user'")
      .get() as { response_body: string | null };
    expect(row?.response_body).toBe('{"error":"oops"}');
  });

  test("failure_class round-trip — saved + reason + null for pass", () => {
    const id = createRun({ started_at: "2024-01-01T00:00:00.000Z" });
    const suite = makeSuiteResult();
    suite.steps[1]!.failure_class = "definitely_bug";
    suite.steps[1]!.failure_class_reason = "API returned 500";
    saveResults(id, [suite]);

    const results = getResultsByRunId(id);
    const failed = results.find((r) => r.test_name === "Delete user")!;
    expect(failed.failure_class).toBe("definitely_bug");
    expect(failed.failure_class_reason).toBe("API returned 500");
    const passed = results.find((r) => r.test_name === "Get user")!;
    expect(passed.failure_class).toBeNull();
    expect(passed.failure_class_reason).toBeNull();
  });

  test("spec_pointer + spec_excerpt round-trip", () => {
    const id = createRun({ started_at: "2024-01-01T00:00:00.000Z" });
    const suite = makeSuiteResult();
    suite.steps[1]!.spec_pointer = "#/paths/~1users~1{id}/delete/responses/204";
    suite.steps[1]!.spec_excerpt = "{ \"description\": \"No Content\" }";
    saveResults(id, [suite]);

    const results = getResultsByRunId(id);
    const failed = results.find((r) => r.test_name === "Delete user")!;
    expect(failed.spec_pointer).toBe("#/paths/~1users~1{id}/delete/responses/204");
    expect(failed.spec_excerpt).toContain("No Content");
    const passed = results.find((r) => r.test_name === "Get user")!;
    expect(passed.spec_pointer).toBeNull();
    expect(passed.spec_excerpt).toBeNull();
  });

  test("provenance round-trip — saved as JSON, parsed back", () => {
    const id = createRun({ started_at: "2024-01-01T00:00:00.000Z" });
    const suiteWithProv = makeSuiteResult();
    suiteWithProv.steps[0]!.provenance = {
      generator: "negative-probe",
      endpoint: "GET /users/{id}",
      response_branch: "404",
    };
    saveResults(id, [suiteWithProv]);

    const results = getResultsByRunId(id);
    const first = results.find((r) => r.test_name === "Get user")!;
    expect(first.provenance).toEqual({
      generator: "negative-probe",
      endpoint: "GET /users/{id}",
      response_branch: "404",
    });
    const second = results.find((r) => r.test_name === "Delete user")!;
    expect(second.provenance).toBeNull();
  });

  test("assertions are deserialized back from JSON", () => {
    const id = createRun({ started_at: "2024-01-01T00:00:00.000Z" });
    saveResults(id, [makeSuiteResult()]);

    const results = getResultsByRunId(id);
    const passStep = results.find((r) => r.test_name === "Get user")!;
    expect(Array.isArray(passStep.assertions)).toBe(true);
    expect(passStep.assertions[0]?.rule).toBe("equals 200");
  });

  test("handles multiple suites in one call", () => {
    const id = createRun({ started_at: "2024-01-01T00:00:00.000Z" });
    saveResults(id, [makeSuiteResult(), makeSuiteResult({ suite_name: "Posts API" })]);

    const count = getDb(dbPath)
      .query("SELECT COUNT(*) as n FROM results WHERE run_id = ?")
      .get(id) as { n: number };
    expect(count.n).toBe(4);
  });

  test("skipped steps have null response_body", () => {
    const id = createRun({ started_at: "2024-01-01T00:00:00.000Z" });
    const suite = makeSuiteResult({
      total: 1,
      passed: 0,
      failed: 0,
      skipped: 1,
      steps: [{
        name: "Skipped step",
        status: "skip",
        duration_ms: 0,
        request: { method: "GET", url: "http://localhost/skip", headers: {} },
        assertions: [],
        captures: {},
        error: "dependency failed",
      }],
    });
    saveResults(id, [suite]);

    const row = getDb(dbPath)
      .query("SELECT response_body FROM results WHERE test_name = 'Skipped step'")
      .get() as { response_body: string | null };
    expect(row?.response_body).toBeNull();
  });
});

// ──────────────────────────────────────────────
// listRuns / deleteRun
// ──────────────────────────────────────────────

describe("listRuns", () => {
  test("returns runs ordered by started_at DESC", () => {
    createRun({ started_at: "2024-01-01T00:00:00.000Z" });
    createRun({ started_at: "2024-01-03T00:00:00.000Z" });
    createRun({ started_at: "2024-01-02T00:00:00.000Z" });

    const runs = listRuns();
    expect(runs[0]?.started_at).toBe("2024-01-03T00:00:00.000Z");
    expect(runs[2]?.started_at).toBe("2024-01-01T00:00:00.000Z");
  });

  test("respects limit and offset", () => {
    for (let i = 1; i <= 5; i++) {
      createRun({ started_at: `2024-01-0${i}T00:00:00.000Z` });
    }
    const page = listRuns(2, 1);
    expect(page).toHaveLength(2);
  });

  test("returns empty array when no runs", () => {
    expect(listRuns()).toEqual([]);
  });
});

describe("deleteRun", () => {
  test("returns true when run exists and deletes it", () => {
    const id = createRun({ started_at: "2024-01-01T00:00:00.000Z" });
    expect(deleteRun(id)).toBe(true);
    expect(getRunById(id)).toBeNull();
  });

  test("returns false when run does not exist", () => {
    expect(deleteRun(9999)).toBe(false);
  });

  test("also deletes associated results", () => {
    const id = createRun({ started_at: "2024-01-01T00:00:00.000Z" });
    saveResults(id, [makeSuiteResult()]);
    deleteRun(id);

    const count = getDb(dbPath)
      .query("SELECT COUNT(*) as n FROM results WHERE run_id = ?")
      .get(id) as { n: number };
    expect(count.n).toBe(0);
  });
});

// ──────────────────────────────────────────────
// Dashboard metrics
// ──────────────────────────────────────────────

describe("getDashboardStats", () => {
  test("returns zeros when no runs", () => {
    const stats = getDashboardStats();
    expect(stats.totalRuns).toBe(0);
    expect(stats.totalTests).toBe(0);
    expect(stats.overallPassRate).toBe(0);
    expect(stats.avgDuration).toBe(0);
  });

  test("returns correct aggregates", () => {
    const id1 = createRun({ started_at: "2024-01-01T00:00:00.000Z" });
    finalizeRun(id1, [makeSuiteResult({ total: 4, passed: 3, failed: 1 })]);
    const id2 = createRun({ started_at: "2024-01-02T00:00:00.000Z" });
    finalizeRun(id2, [makeSuiteResult({ total: 6, passed: 6, failed: 0 })]);

    const stats = getDashboardStats();
    expect(stats.totalRuns).toBe(2);
    expect(stats.totalTests).toBe(10);
    expect(stats.overallPassRate).toBe(90);
  });
});

describe("getPassRateTrend", () => {
  test("returns empty array when no runs", () => {
    expect(getPassRateTrend()).toEqual([]);
  });

  test("returns pass rate per run", () => {
    const id = createRun({ started_at: "2024-01-01T00:00:00.000Z" });
    finalizeRun(id, [makeSuiteResult({ total: 10, passed: 8, failed: 2 })]);

    const trend = getPassRateTrend(10);
    expect(trend).toHaveLength(1);
    expect(trend[0]!.pass_rate).toBe(80);
  });
});

describe("getSlowestTests", () => {
  test("returns empty array when no results", () => {
    expect(getSlowestTests()).toEqual([]);
  });

  test("returns tests sorted by avg duration desc", () => {
    const id = createRun({ started_at: "2024-01-01T00:00:00.000Z" });
    saveResults(id, [makeSuiteResult()]);

    const slow = getSlowestTests(5);
    expect(slow.length).toBeGreaterThan(0);
    expect(slow[0]!.suite_name).toBe("Users API");
  });
});

describe("getFlakyTests", () => {
  test("returns empty array when no flaky tests", () => {
    expect(getFlakyTests()).toEqual([]);
  });

  test("detects flaky tests with multiple statuses", () => {
    // Run 1: step passes
    const id1 = createRun({ started_at: "2024-01-01T00:00:00.000Z" });
    saveResults(id1, [makeSuiteResult({
      steps: [{ name: "Flaky step", status: "pass", duration_ms: 100, request: { method: "GET", url: "http://x", headers: {} }, assertions: [], captures: {} }],
    })]);

    // Run 2: same step fails
    const id2 = createRun({ started_at: "2024-01-02T00:00:00.000Z" });
    saveResults(id2, [makeSuiteResult({
      steps: [{ name: "Flaky step", status: "fail", duration_ms: 100, request: { method: "GET", url: "http://x", headers: {} }, assertions: [], captures: {} }],
    })]);

    const flaky = getFlakyTests(10, 5);
    expect(flaky.length).toBe(1);
    expect(flaky[0]!.test_name).toBe("Flaky step");
    expect(flaky[0]!.distinct_statuses).toBe(2);
  });
});

describe("countRuns", () => {
  test("returns 0 when no runs", () => {
    expect(countRuns()).toBe(0);
  });

  test("returns correct count", () => {
    createRun({ started_at: "2024-01-01T00:00:00.000Z" });
    createRun({ started_at: "2024-01-02T00:00:00.000Z" });
    expect(countRuns()).toBe(2);
  });
});
