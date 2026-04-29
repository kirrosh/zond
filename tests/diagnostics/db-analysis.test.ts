import { describe, test, expect } from "bun:test";
import { groupFailures } from "../../src/core/diagnostics/db-analysis.ts";
import type { RecommendedAction } from "../../src/core/diagnostics/failure-hints.ts";

function makeFailure(overrides: Partial<{
  suite_name: string;
  test_name: string;
  failure_type: string;
  recommended_action: RecommendedAction;
  hint: string;
  response_status: number | null;
}> = {}) {
  return {
    suite_name: overrides.suite_name ?? "suite",
    test_name: overrides.test_name ?? "test",
    failure_type: overrides.failure_type ?? "assertion_failed",
    recommended_action: overrides.recommended_action ?? ("fix_test_logic" as RecommendedAction),
    hint: overrides.hint,
    response_status: overrides.response_status ?? null,
  };
}

describe("groupFailures", () => {
  test("returns failures as-is when <= 5", () => {
    const failures = Array.from({ length: 5 }, (_, i) =>
      makeFailure({ test_name: `test_${i}`, response_status: 401 })
    );
    const result = groupFailures(failures);
    expect(result.compactFailures).toHaveLength(5);
    expect(result.grouped_failures).toBeUndefined();
  });

  test("groups 10 identical 401 failures into one group", () => {
    const failures = Array.from({ length: 10 }, (_, i) =>
      makeFailure({
        suite_name: `suite_${i}`,
        test_name: `test_${i}`,
        response_status: 401,
        failure_type: "assertion_failed",
        hint: "Auth failure",
      })
    );
    const result = groupFailures(failures);

    expect(result.grouped_failures).toBeDefined();
    expect(result.grouped_failures).toHaveLength(1);
    expect(result.grouped_failures![0]!.count).toBe(10);
    expect(result.grouped_failures![0]!.pattern).toBe("401 assertion_failed");
    expect(result.grouped_failures![0]!.examples).toHaveLength(2);

    // Compact failures should have only 1 representative
    expect(result.compactFailures).toHaveLength(1);
  });

  test("groups multiple failure types separately", () => {
    const failures = [
      // 5x 401
      ...Array.from({ length: 5 }, (_, i) =>
        makeFailure({ suite_name: `auth_${i}`, test_name: `t_${i}`, response_status: 401, failure_type: "assertion_failed" })
      ),
      // 4x 500
      ...Array.from({ length: 4 }, (_, i) =>
        makeFailure({ suite_name: `server_${i}`, test_name: `t_${i}`, response_status: 500, failure_type: "api_error" })
      ),
    ];
    const result = groupFailures(failures);

    expect(result.grouped_failures).toBeDefined();
    expect(result.grouped_failures).toHaveLength(2);

    const g401 = result.grouped_failures!.find(g => g.response_status === 401);
    const g500 = result.grouped_failures!.find(g => g.response_status === 500);
    expect(g401!.count).toBe(5);
    expect(g500!.count).toBe(4);

    // Compact: 1 representative for the 401 group + all 4 api_error 500s
    // (TASK-69: 5xx must never be silently truncated).
    expect(result.compactFailures).toHaveLength(5);
  });

  test("does not group when no group has > 2 items", () => {
    const failures = Array.from({ length: 6 }, (_, i) =>
      makeFailure({
        test_name: `test_${i}`,
        response_status: 400 + i, // all different statuses
        failure_type: "assertion_failed",
      })
    );
    const result = groupFailures(failures);
    expect(result.grouped_failures).toBeUndefined();
    expect(result.compactFailures).toHaveLength(6);
  });

  test("includes hint from first failure in group", () => {
    const failures = Array.from({ length: 6 }, (_, i) =>
      makeFailure({
        test_name: `test_${i}`,
        response_status: 429,
        failure_type: "assertion_failed",
        hint: "Rate limited — too many requests",
      })
    );
    const result = groupFailures(failures);
    expect(result.grouped_failures![0]!.hint).toBe("Rate limited — too many requests");
  });

  test("grouped api_error failures carry report_backend_bug action", () => {
    const failures = Array.from({ length: 6 }, (_, i) =>
      makeFailure({
        suite_name: `s_${i}`,
        test_name: `t_${i}`,
        response_status: 500,
        failure_type: "api_error",
        recommended_action: "report_backend_bug",
      })
    );
    const result = groupFailures(failures);
    expect(result.grouped_failures).toBeDefined();
    expect(result.grouped_failures![0]!.recommended_action).toBe("report_backend_bug");
  });

  // TASK-69: silent data loss — diagnose previously kept only 1 of N 5xx
  // failures in compactFailures, hiding real backend bugs.
  test("api_error (5xx) failures are never collapsed — all surface in compactFailures + examples", () => {
    const failures = Array.from({ length: 11 }, (_, i) =>
      makeFailure({
        suite_name: `s_${i}`,
        test_name: `t_${i}`,
        response_status: 500,
        failure_type: "api_error",
        recommended_action: "report_backend_bug",
      })
    );
    const result = groupFailures(failures);

    expect(result.grouped_failures).toBeDefined();
    expect(result.grouped_failures).toHaveLength(1);
    expect(result.grouped_failures![0]!.count).toBe(11);
    // All 11 examples must be listed, not a 2-item sample.
    expect(result.grouped_failures![0]!.examples).toHaveLength(11);
    // And every 5xx must remain in compactFailures so `data.failures` is complete.
    expect(result.compactFailures).toHaveLength(11);
  });

  test("mixed 5xx + assertion: 5xx kept fully, assertion still collapses", () => {
    const failures = [
      ...Array.from({ length: 8 }, (_, i) =>
        makeFailure({
          suite_name: `srv_${i}`, test_name: `t_${i}`,
          response_status: 503, failure_type: "api_error",
        })
      ),
      ...Array.from({ length: 6 }, (_, i) =>
        makeFailure({
          suite_name: `auth_${i}`, test_name: `t_${i}`,
          response_status: 401, failure_type: "assertion_failed",
        })
      ),
    ];
    const result = groupFailures(failures);

    const g503 = result.grouped_failures!.find(g => g.response_status === 503)!;
    const g401 = result.grouped_failures!.find(g => g.response_status === 401)!;
    expect(g503.count).toBe(8);
    expect(g503.examples).toHaveLength(8); // 5xx full
    expect(g401.count).toBe(6);
    expect(g401.examples).toHaveLength(2); // assertion still sampled

    // compactFailures: 8 (all 5xx) + 1 (representative of 401 group) = 9
    expect(result.compactFailures).toHaveLength(9);
  });
});
