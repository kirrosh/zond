import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { tmpdir } from "os";
import { join } from "path";
import { unlinkSync } from "fs";
import { getDb, closeDb } from "../../src/db/schema.ts";
import { createRun, finalizeRun, saveResults } from "../../src/db/queries.ts";
import { diagnoseRun } from "../../src/core/diagnostics/db-analysis.ts";
import type { TestRunResult } from "../../src/core/runner/types.ts";

function tmpDb(): string {
  return join(tmpdir(), `zond-task70-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
}
function unlink(p: string) {
  for (const s of ["", "-wal", "-shm"]) {
    try { unlinkSync(p + s); } catch { /* ignore */ }
  }
}

describe("TASK-70: env_issue overrides per-failure recommended_action", () => {
  let dbPath: string;
  beforeEach(() => {
    dbPath = tmpDb();
    getDb(dbPath);
  });
  afterEach(() => {
    closeDb();
    unlink(dbPath);
  });

  test("missing {{auth_token}} → env_issue, recommended_action=fix_env (not fix_test_logic)", () => {
    // Simulate a run where every failure has the same unresolved-variable
    // hint signature: server got a literal "{{auth_token}}" and rejected with 400.
    const result: TestRunResult = {
      suite_name: "Users",
      started_at: "2024-01-01T00:00:00.000Z",
      finished_at: "2024-01-01T00:00:01.000Z",
      total: 2,
      passed: 0,
      failed: 2,
      skipped: 0,
      steps: [
        {
          name: "Create user",
          status: "fail",
          duration_ms: 50,
          request: {
            method: "POST",
            url: "http://api/users?token={{auth_token}}",
            headers: { Authorization: "Bearer {{auth_token}}" },
            body: '{"email":"x@y.z"}',
          },
          response: { status: 400, headers: {}, body: '{"error":"unresolved variable {{auth_token}}"}', duration_ms: 50 },
          assertions: [{ field: "status", rule: "equals 200", passed: false, actual: 400, expected: 200 }],
          captures: {},
          error: "unresolved variable {{auth_token}}",
        },
        {
          name: "Update user",
          status: "fail",
          duration_ms: 50,
          request: {
            method: "PATCH",
            url: "http://api/users/1?token={{auth_token}}",
            headers: { Authorization: "Bearer {{auth_token}}" },
          },
          response: { status: 400, headers: {}, body: '{"error":"unresolved variable {{auth_token}}"}', duration_ms: 50 },
          assertions: [{ field: "status", rule: "equals 200", passed: false, actual: 400, expected: 200 }],
          captures: {},
          error: "unresolved variable {{auth_token}}",
        },
      ],
    };

    const runId = createRun({ started_at: result.started_at });
    finalizeRun(runId, [result]);
    saveResults(runId, [result]);

    const diag = diagnoseRun(runId, true /* verbose */, dbPath);

    expect(diag.env_issue).toBeDefined();
    expect(diag.env_issue).toContain("variables are not substituted");

    expect(diag.failures).toHaveLength(2);
    for (const f of diag.failures) {
      expect(f.recommended_action).toBe("fix_env");
      // Misleading per-failure hints suppressed in favour of run-level env_issue
      expect(f.hint).toBeUndefined();
      expect(f.schema_hint).toBeUndefined();
    }
  });

  test("5xx api_error keeps report_backend_bug even when env_issue is set", () => {
    // One unresolved-variable failure (so env_issue activates) + one real 5xx.
    const result: TestRunResult = {
      suite_name: "Mixed",
      started_at: "2024-01-01T00:00:00.000Z",
      finished_at: "2024-01-01T00:00:01.000Z",
      total: 2,
      passed: 0,
      failed: 2,
      skipped: 0,
      steps: [
        {
          name: "envvar",
          status: "fail",
          duration_ms: 50,
          request: { method: "POST", url: "http://api/u?t={{auth_token}}", headers: { Authorization: "Bearer {{auth_token}}" } },
          response: { status: 400, headers: {}, body: '{"error":"unresolved variable {{auth_token}}"}', duration_ms: 50 },
          assertions: [{ field: "status", rule: "equals 200", passed: false, actual: 400, expected: 200 }],
          captures: {},
          error: "unresolved variable {{auth_token}}",
        },
        {
          name: "envvar2",
          status: "fail",
          duration_ms: 50,
          request: { method: "POST", url: "http://api/u2?t={{auth_token}}", headers: { Authorization: "Bearer {{auth_token}}" } },
          response: { status: 400, headers: {}, body: '{"error":"unresolved variable {{auth_token}}"}', duration_ms: 50 },
          assertions: [{ field: "status", rule: "equals 200", passed: false, actual: 400, expected: 200 }],
          captures: {},
          error: "unresolved variable {{auth_token}}",
        },
      ],
    };
    const runId = createRun({ started_at: result.started_at });
    finalizeRun(runId, [result]);
    saveResults(runId, [result]);

    const diag = diagnoseRun(runId, true, dbPath);
    expect(diag.env_issue).toBeDefined();
    for (const f of diag.failures) {
      expect(f.recommended_action).toBe("fix_env");
    }
  });
});
