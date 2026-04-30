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
    expect(diag.env_issue!.message).toMatch(/missing_var|variables are not substituted|env-broken/);

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

// ── TASK-98: per-suite env clustering ─────────────────────────────────────
describe("TASK-98: env_issue scope and per-suite clustering", () => {
  let dbPath: string;
  beforeEach(() => {
    dbPath = tmpDb();
    getDb(dbPath);
  });
  afterEach(() => {
    closeDb();
    unlink(dbPath);
  });

  function failingStep(name: string, url: string, status = 400, body = ""): TestRunResult["steps"][number] {
    return {
      name,
      status: "fail",
      duration_ms: 10,
      request: { method: "POST", url, headers: {} },
      response: { status, headers: {}, body, duration_ms: 10 },
      assertions: [{ field: "status", rule: "equals 200", passed: false, actual: status, expected: 200 }],
      captures: {},
      error: body || `${status}`,
    };
  }

  function passStep(name: string): TestRunResult["steps"][number] {
    return {
      name,
      status: "pass",
      duration_ms: 5,
      request: { method: "GET", url: "http://api/ok", headers: {} },
      response: { status: 200, headers: {}, body: "{}", duration_ms: 5 },
      assertions: [],
      captures: {},
    };
  }

  test("AC#1: per-suite missing variable → suite-scoped env_issue, fix_env only there", () => {
    // payments suite needs {{stripe_key}} (unresolved) — both tests fail.
    // users suite has a real assertion failure (200 OK but unexpected body).
    const payments: TestRunResult = {
      suite_name: "payments",
      started_at: "2024-01-01T00:00:00.000Z",
      finished_at: "2024-01-01T00:00:01.000Z",
      total: 2, passed: 0, failed: 2, skipped: 0,
      steps: [
        failingStep("charge", "http://api/charge?key={{stripe_key}}", 400, '{"error":"unresolved variable {{stripe_key}}"}'),
        failingStep("refund", "http://api/refund?key={{stripe_key}}", 400, '{"error":"unresolved variable {{stripe_key}}"}'),
      ],
    };
    const users: TestRunResult = {
      suite_name: "users",
      started_at: "2024-01-01T00:00:00.000Z",
      finished_at: "2024-01-01T00:00:01.000Z",
      total: 2, passed: 1, failed: 1, skipped: 0,
      steps: [
        passStep("list users"),
        {
          name: "create user",
          status: "fail",
          duration_ms: 10,
          request: { method: "POST", url: "http://api/users", headers: {} },
          response: { status: 422, headers: {}, body: '{"error":"validation"}', duration_ms: 10 },
          assertions: [{ field: "status", rule: "equals 201", passed: false, actual: 422, expected: 201 }],
          captures: {},
          error: "validation",
        },
      ],
    };

    const runId = createRun({ started_at: payments.started_at });
    finalizeRun(runId, [payments, users]);
    saveResults(runId, [payments, users]);

    const diag = diagnoseRun(runId, true, dbPath);

    expect(diag.env_issue).toBeDefined();
    expect(diag.env_issue!.scope).toBe("suite:payments");
    expect(diag.env_issue!.affected_suites).toEqual(["payments"]);
    expect(diag.env_issue!.symptoms.missing_var).toBe(2);

    // payments failures → fix_env, users failure stays fix_test_logic
    for (const f of diag.failures) {
      if (f.suite_name === "payments") expect(f.recommended_action).toBe("fix_env");
      else expect(f.recommended_action).toBe("fix_test_logic");
    }
  });

  test("AC#2: mixed run with two env-broken suites → run scope, both listed", () => {
    const payments: TestRunResult = {
      suite_name: "payments",
      started_at: "2024-01-01T00:00:00.000Z", finished_at: "2024-01-01T00:00:01.000Z",
      total: 2, passed: 0, failed: 2, skipped: 0,
      steps: [
        failingStep("a", "http://api/a?k={{stripe_key}}", 400, '{"error":"unresolved variable {{stripe_key}}"}'),
        failingStep("b", "http://api/b?k={{stripe_key}}", 400, '{"error":"unresolved variable {{stripe_key}}"}'),
      ],
    };
    const auth: TestRunResult = {
      suite_name: "auth",
      started_at: "2024-01-01T00:00:00.000Z", finished_at: "2024-01-01T00:00:01.000Z",
      total: 2, passed: 0, failed: 2, skipped: 0,
      steps: [
        failingStep("me", "http://api/me", 401, '{"error":"unauthorized"}'),
        failingStep("orgs", "http://api/orgs", 401, '{"error":"unauthorized"}'),
      ],
    };
    const runId = createRun({ started_at: payments.started_at });
    finalizeRun(runId, [payments, auth]);
    saveResults(runId, [payments, auth]);

    const diag = diagnoseRun(runId, true, dbPath);
    expect(diag.env_issue).toBeDefined();
    expect(diag.env_issue!.scope).toBe("run");
    expect(diag.env_issue!.affected_suites.sort()).toEqual(["auth", "payments"]);
    expect(diag.env_issue!.symptoms.auth_expired).toBe(2);
    expect(diag.env_issue!.symptoms.missing_var).toBe(2);
  });

  test("AC#3: 5xx never gets fix_env override even if suite is env-broken", () => {
    // 1 unresolved-variable + 1 5xx in the same suite. The 80% threshold of
    // env-symptoms is computed only over non-5xx failures, so the suite is
    // still flagged — but the 5xx must keep report_backend_bug.
    const mixed: TestRunResult = {
      suite_name: "mixed",
      started_at: "2024-01-01T00:00:00.000Z", finished_at: "2024-01-01T00:00:01.000Z",
      total: 2, passed: 0, failed: 2, skipped: 0,
      steps: [
        failingStep("envvar", "http://api/x?t={{auth_token}}", 400, '{"error":"unresolved variable {{auth_token}}"}'),
        failingStep("backend", "http://api/y", 500, '{"error":"internal"}'),
      ],
    };
    const runId = createRun({ started_at: mixed.started_at });
    finalizeRun(runId, [mixed]);
    saveResults(runId, [mixed]);

    const diag = diagnoseRun(runId, true, dbPath);
    const byName = Object.fromEntries(diag.failures.map(f => [f.test_name, f]));
    expect(byName.envvar!.recommended_action).toBe("fix_env");
    expect(byName.backend!.recommended_action).toBe("report_backend_bug");
  });
});
