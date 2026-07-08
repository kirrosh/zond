/**
 * ARV-266: retention primitives — runKindStats() surfaces per-kind counts,
 * deleteRunsOlderThan() prunes by cutoff + kind and cascades to results.
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { getDb, closeDb } from "../../src/db/schema.ts";
import { tmpDb, unlinkDb } from "../_helpers/tmp-db";
import {
  createRun,
  finalizeRun,
  saveResults,
  runKindStats,
  deleteRunsOlderThan,
  countRuns,
} from "../../src/db/queries.ts";
import type { TestRunResult } from "../../src/core/runner/types.ts";
import { parseRetentionDays } from "../../src/cli/commands/db.ts";

let dbPath: string;

function oneResult(started: string): TestRunResult {
  return {
    suite_name: "s", started_at: started, finished_at: started,
    total: 1, passed: 1, failed: 0, skipped: 0,
    steps: [{
      name: "t", status: "pass", duration_ms: 1,
      request: { method: "GET", url: "http://x/1", headers: {} },
      response: { status: 200, headers: {}, body: "{}", duration_ms: 1 },
      assertions: [], captures: {},
    }],
  } as TestRunResult;
}

beforeEach(() => {
  dbPath = tmpDb("zond-arv266");
  getDb(dbPath);
});
afterEach(() => {
  closeDb();
  unlinkDb(dbPath);
});

describe("ARV-266 retention", () => {
  test("parseRetentionDays handles d / h / bare", () => {
    expect(parseRetentionDays("30d")).toBe(30);
    expect(parseRetentionDays("30")).toBe(30);
    expect(parseRetentionDays("12h")).toBe(0.5);
    expect(parseRetentionDays("nope")).toBeNull();
  });

  test("runKindStats groups counts by kind", () => {
    const r1 = createRun({ started_at: "2020-01-01T00:00:00.000Z", run_kind: "check" });
    saveResults(r1, [oneResult("2020-01-01T00:00:00.000Z")]); finalizeRun(r1, [oneResult("2020-01-01T00:00:00.000Z")]);
    const r2 = createRun({ started_at: "2020-01-02T00:00:00.000Z", run_kind: "regular" });
    saveResults(r2, [oneResult("2020-01-02T00:00:00.000Z")]); finalizeRun(r2, [oneResult("2020-01-02T00:00:00.000Z")]);

    const stats = runKindStats();
    const byKind = Object.fromEntries(stats.map((s) => [s.run_kind, s]));
    expect(byKind.check?.runs).toBe(1);
    expect(byKind.regular?.runs).toBe(1);
    expect(byKind.check?.results).toBeGreaterThanOrEqual(1);
  });

  test("deleteRunsOlderThan removes only pre-cutoff runs of the given kind", () => {
    const old = createRun({ started_at: "2020-01-01T00:00:00.000Z", run_kind: "check" });
    saveResults(old, [oneResult("2020-01-01T00:00:00.000Z")]); finalizeRun(old, [oneResult("2020-01-01T00:00:00.000Z")]);
    const recent = createRun({ started_at: "2999-01-01T00:00:00.000Z", run_kind: "check" });
    saveResults(recent, [oneResult("2999-01-01T00:00:00.000Z")]); finalizeRun(recent, [oneResult("2999-01-01T00:00:00.000Z")]);
    const regularOld = createRun({ started_at: "2020-01-01T00:00:00.000Z", run_kind: "regular" });
    saveResults(regularOld, [oneResult("2020-01-01T00:00:00.000Z")]); finalizeRun(regularOld, [oneResult("2020-01-01T00:00:00.000Z")]);

    const cutoff = "2025-01-01T00:00:00.000Z";
    const del = deleteRunsOlderThan(cutoff, "check");
    expect(del.runs).toBe(1);          // only the old check run
    expect(del.results).toBeGreaterThanOrEqual(1);

    // recent check + old regular survive.
    expect(countRuns()).toBe(2);
  });

  test("deleteRunsOlderThan with no kind prunes across kinds", () => {
    { const id = createRun({ started_at: "2020-01-01T00:00:00.000Z", run_kind: "check" }); saveResults(id, [oneResult("2020-01-01T00:00:00.000Z")]); finalizeRun(id, [oneResult("2020-01-01T00:00:00.000Z")]); }
    { const id = createRun({ started_at: "2020-01-01T00:00:00.000Z", run_kind: "regular" }); saveResults(id, [oneResult("2020-01-01T00:00:00.000Z")]); finalizeRun(id, [oneResult("2020-01-01T00:00:00.000Z")]); }
    const del = deleteRunsOlderThan("2025-01-01T00:00:00.000Z");
    expect(del.runs).toBe(2);
    expect(countRuns()).toBe(0);
  });
});
