import { describe, test, expect } from "bun:test";
import { groupFailures } from "../../src/core/diagnostics/db-analysis.ts";
import type { RecommendedAction } from "../../src/core/diagnostics/failure-hints.ts";

function makeFailure(overrides: Partial<{
  suite_name: string;
  test_name: string;
  failure_type: string;
  recommended_action: RecommendedAction;
  response_status: number | null;
}> = {}) {
  return {
    suite_name: overrides.suite_name ?? "suite",
    test_name: overrides.test_name ?? "test",
    failure_type: overrides.failure_type ?? "assertion_failed",
    recommended_action: overrides.recommended_action ?? ("fix_test_logic" as RecommendedAction),
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

// ARV-339: field-level body/schema diff for `zond db compare`.
import { diffBodyShapes } from "../../src/core/diagnostics/db-analysis.ts";

describe("diffBodyShapes", () => {
  test("detects added, removed and type-changed fields", () => {
    const before = JSON.stringify({ id: 1, name: "a", legacy: true, tags: ["x"] });
    const after = JSON.stringify({ id: "1", name: "a", email: "a@b.c", tags: ["x"] });
    const changes = diffBodyShapes(before, after);
    expect(changes).toEqual([
      { field: "email", change: "added", after: "string", scope: "container" },
      { field: "id", change: "type_changed", before: "number", after: "string", scope: "container" },
      { field: "legacy", change: "removed", before: "boolean", scope: "container" },
    ]);
  });

  test("collapses array elements — item count/order is not a shape change", () => {
    const before = JSON.stringify({ items: [{ id: 1 }, { id: 2 }] });
    const after = JSON.stringify({ items: [{ id: 3 }] });
    expect(diffBodyShapes(before, after)).toEqual([]);
  });

  test("reports nested field paths through arrays", () => {
    const before = JSON.stringify({ items: [{ id: 1 }] });
    const after = JSON.stringify({ items: [{ id: 1, price: 9.5 }] });
    expect(diffBodyShapes(before, after)).toEqual([
      { field: "items[].price", change: "added", after: "number", scope: "element" },
    ]);
  });

  // ARV-352: on list/log endpoints, field variance across re-sampled objects
  // must be scoped `element` (schema-of-union noise), while envelope/pagination
  // changes stay `container` (real drift) — deterministic from the `[]` path.
  test("scopes collection-item changes as element, envelope changes as container", () => {
    const before = JSON.stringify({ object: "list", data: [{ request: { id: "req_1" } }] });
    const after = JSON.stringify({ object: "list", total_count: 5, data: [{ request: { id: null }, extra: 1 }] });
    const changes = diffBodyShapes(before, after);
    expect(changes).toEqual([
      { field: "data[].extra", change: "added", after: "number", scope: "element" },
      { field: "data[].request.id", change: "type_changed", before: "string", after: "null", scope: "element" },
      { field: "total_count", change: "added", after: "number", scope: "container" },
    ]);
  });

  test("returns [] for missing, identical or non-JSON bodies", () => {
    expect(diffBodyShapes(null, '{"a":1}')).toEqual([]);
    expect(diffBodyShapes('{"a":1}', '{"a":1}')).toEqual([]);
    expect(diffBodyShapes("<html>", '{"a":1}')).toEqual([]);
    expect(diffBodyShapes('"plain string"', '{"a":1}')).toEqual([]);
  });
});
