/**
 * ARV-305: `db diagnose --json` must populate `by_recommended_action[*].
 * examples[].reason` even when the underlying result row has no
 * top-level `error_message` (typical for assertion-only failures —
 * the failing rule lives in `.assertions`, not in a free-form message).
 *
 * Without the assertion fallback, triage agents end up with examples
 * stripped down to {suite, test, method, path, status} — the
 * regenerate_suite and tighten_validation buckets become visually
 * indistinguishable in agent output, even though the assertion text
 * is what tells them apart.
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { getDb, closeDb } from "../../src/db/schema.ts";
import { createRun, finalizeRun, saveResults } from "../../src/db/queries.ts";
import { diagnoseRun } from "../../src/core/diagnostics/db-analysis.ts";
import type { TestRunResult } from "../../src/core/runner/types.ts";
import { tmpDb, unlinkDb as unlink } from "../_helpers/tmp-db";

function assertionFailureStep(
  name: string,
  status = 403,
  expected: number[] = [400, 404, 422],
): TestRunResult["steps"][number] {
  return {
    name,
    status: "fail",
    duration_ms: 10,
    request: { method: "GET", url: "http://api/v1/things/missing", headers: {} },
    response: { status, headers: {}, body: "{}", duration_ms: 10 },
    assertions: [
      { field: "status", rule: `one of [${expected.join(", ")}]`, passed: false, actual: status, expected },
    ],
    captures: {},
    // NB: no `error` field — assertion-only failure, mirrors what audit
    // produces on negative-smoke suites that hit the wrong 4xx code.
  };
}

describe("ARV-305: examples[].reason falls back to the failing assertion", () => {
  let dbPath: string;
  beforeEach(() => { dbPath = tmpDb(); getDb(dbPath); });
  afterEach(() => { closeDb(); unlink(dbPath); });

  test("assertion-only failure → reason carries `<field> <rule>: got <actual>`", () => {
    const result: TestRunResult = {
      suite_name: "negative-smoke",
      started_at: "2024-01-01T00:00:00.000Z",
      finished_at: "2024-01-01T00:00:01.000Z",
      total: 1, passed: 0, failed: 1, skipped: 0,
      steps: [assertionFailureStep("GetThingMissing", 403, [400, 404, 422])],
    };
    const runId = createRun({ started_at: result.started_at });
    finalizeRun(runId, [result]);
    saveResults(runId, [result]);

    const out = diagnoseRun(runId, true, dbPath);
    expect(out.by_recommended_action).toBeDefined();
    const buckets = Object.values(out.by_recommended_action!);
    expect(buckets.length).toBeGreaterThan(0);
    const examples = buckets.flatMap(b => b.examples);
    expect(examples.length).toBeGreaterThan(0);
    const reasons = examples.map(e => e.reason).filter(Boolean);
    expect(reasons.length).toBeGreaterThan(0);
    expect(reasons[0]).toMatch(/status.*one of/);
    expect(reasons[0]).toMatch(/got/);
  });
});
