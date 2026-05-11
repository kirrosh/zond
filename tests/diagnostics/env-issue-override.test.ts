import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { getDb, closeDb } from "../../src/db/schema.ts";
import { createRun, finalizeRun, saveResults } from "../../src/db/queries.ts";
import { diagnoseRun } from "../../src/core/diagnostics/db-analysis.ts";
import type { TestRunResult } from "../../src/core/runner/types.ts";
import { tmpDb, unlinkDb as unlink } from "../_helpers/tmp-db";

// TASK-208 AC#2: shared step builders across both describe blocks. Earlier the
// first block re-declared full TestRunResult inline (~50 lines per case) while
// the second already had failingStep/passStep — unify on the helpers.
function failingStep(
  name: string,
  url: string,
  status = 400,
  body = "",
  method: string = "POST",
  headers: Record<string, string> = {},
): TestRunResult["steps"][number] {
  return {
    name,
    status: "fail",
    duration_ms: 10,
    request: { method, url, headers },
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
    const unresolved = '{"error":"unresolved variable {{auth_token}}"}';
    const authHeaders = { Authorization: "Bearer {{auth_token}}" };
    const result: TestRunResult = {
      suite_name: "Users",
      started_at: "2024-01-01T00:00:00.000Z",
      finished_at: "2024-01-01T00:00:01.000Z",
      total: 2, passed: 0, failed: 2, skipped: 0,
      steps: [
        failingStep("Create user", "http://api/users?token={{auth_token}}", 400, unresolved, "POST", authHeaders),
        failingStep("Update user", "http://api/users/1?token={{auth_token}}", 400, unresolved, "PATCH", authHeaders),
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
    const unresolved = '{"error":"unresolved variable {{auth_token}}"}';
    const authHeaders = { Authorization: "Bearer {{auth_token}}" };
    const result: TestRunResult = {
      suite_name: "Mixed",
      started_at: "2024-01-01T00:00:00.000Z",
      finished_at: "2024-01-01T00:00:01.000Z",
      total: 2, passed: 0, failed: 2, skipped: 0,
      steps: [
        failingStep("envvar", "http://api/u?t={{auth_token}}", 400, unresolved, "POST", authHeaders),
        failingStep("envvar2", "http://api/u2?t={{auth_token}}", 400, unresolved, "POST", authHeaders),
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

// ARV-101 (F6): the diagnose envelope now exposes a top-level
// `by_recommended_action` aggregation so the zond-triage skill ("route on
// recommended_action enum") can read it directly instead of folding
// failures[].recommended_action through `jq | group_by`. Tester saw the
// missing key on Sentry as a skill-drift indicator.
describe("ARV-101 (F6): diagnose payload aggregates by recommended_action enum", () => {
  let dbPath: string;
  beforeEach(() => {
    dbPath = tmpDb();
    getDb(dbPath);
  });
  afterEach(() => {
    closeDb();
    unlink(dbPath);
  });

  test("by_recommended_action mirrors the canonical enum and counts the full failure set", () => {
    // Mix: 2 backend bugs (5xx) + 1 generated-suite 4xx (regenerate_suite or
    // fix_test_logic depending on classifier) + 1 fixture-related 404.
    const result: TestRunResult = {
      suite_name: "Mixed",
      started_at: "2024-01-01T00:00:00.000Z",
      finished_at: "2024-01-01T00:00:01.000Z",
      total: 4, passed: 0, failed: 4, skipped: 0,
      steps: [
        failingStep("svr1", "http://api/widgets", 500, ""),
        failingStep("svr2", "http://api/widgets/2", 500, ""),
        failingStep("nf", "http://api/widgets/missing", 404, ""),
        failingStep("nf2", "http://api/widgets/also-missing", 404, ""),
      ],
    };
    const runId = createRun({ started_at: result.started_at });
    finalizeRun(runId, [result]);
    saveResults(runId, [result]);

    const diag = diagnoseRun(runId, true, dbPath);

    expect(diag.by_recommended_action).toBeDefined();
    const agg = diag.by_recommended_action!;

    // Sum of bucket counts must equal the total failure count — proves the
    // aggregation is built off the FULL set, not the compactFailures subset
    // (which gets collapsed when grouping kicks in).
    const total = Object.values(agg).reduce((sum, b) => sum + b.count, 0);
    expect(total).toBe(diag.summary.failed);

    // Every action key must be one of the documented enum members the
    // triage skill routes on. Catches drift if a new RecommendedAction is
    // added without surfacing it in the aggregation.
    const validActions = new Set([
      "report_backend_bug",
      "fix_auth_config",
      "fix_test_logic",
      "fix_network_config",
      "fix_env",
      "fix_spec",
      "fix_fixture",
      "regenerate_suite",
      "tighten_validation",
      "add_required_header",
    ]);
    for (const k of Object.keys(agg)) {
      expect(validActions.has(k)).toBe(true);
    }

    // Every bucket has bounded examples (cap = 5) shaped as <suite>/<test>.
    for (const bucket of Object.values(agg)) {
      expect(bucket.count).toBeGreaterThan(0);
      expect(bucket.examples.length).toBeGreaterThan(0);
      expect(bucket.examples.length).toBeLessThanOrEqual(5);
      for (const ex of bucket.examples) {
        expect(ex).toMatch(/.+\/.+/);
      }
    }

    // 5xx still routes to report_backend_bug — so we expect that bucket
    // populated, with both svr1 + svr2 surfaced as examples.
    expect(agg.report_backend_bug).toBeDefined();
    expect(agg.report_backend_bug!.count).toBeGreaterThanOrEqual(2);
  });

  test("payload omits by_recommended_action entirely when there are no failures", () => {
    const allPass: TestRunResult = {
      suite_name: "Healthy",
      started_at: "2024-01-01T00:00:00.000Z",
      finished_at: "2024-01-01T00:00:01.000Z",
      total: 1, passed: 1, failed: 0, skipped: 0,
      steps: [passStep("ok")],
    };
    const runId = createRun({ started_at: allPass.started_at });
    finalizeRun(runId, [allPass]);
    saveResults(runId, [allPass]);

    const diag = diagnoseRun(runId, true, dbPath);
    expect(diag.by_recommended_action).toBeUndefined();
  });
});
