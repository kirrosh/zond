/**
 * ARV-307: run-level broken-baseline guard for the conformance family.
 * On a degenerate baseline (>90% of positive probes non-2xx, e.g. a fully
 * auth-rejected scan) status_code_conformance / content_type_conformance
 * findings are baseline artifacts — roll them up into one broken_baseline
 * spec_finding and drop the per-op rows.
 */
import { describe, test, expect } from "bun:test";
import { applyBrokenBaselineGuard } from "../../../src/core/checks/spec-findings.ts";
import type { CheckFinding } from "../../../src/core/checks/types.ts";

function finding(check: string, path: string, status: number, suppressed = false): CheckFinding {
  return {
    check,
    severity: "low",
    category: "contract",
    operation: { path, method: "GET" },
    request_signature: `GET ${path}`,
    response_summary: { status },
    message: `undeclared ${status}`,
    recommended_action: "fix_test_logic",
    ...(suppressed ? { suppressed_by: { source: "test", rule_index: 0, reason: "x" } } : {}),
  } as CheckFinding;
}

describe("applyBrokenBaselineGuard (ARV-307)", () => {
  test("degenerate baseline → conformance findings rolled into one spec_finding", () => {
    const findings = [
      finding("status_code_conformance", "/a", 401),
      finding("content_type_conformance", "/b", 404),
      finding("not_a_server_error", "/c", 503), // not gated — must survive
    ];
    const r = applyBrokenBaselineGuard({ findings, positiveTotal: 50, positiveTwoxx: 1 });
    expect(r.specFinding?.kind).toBe("broken_baseline");
    expect(r.specFinding?.severity).toBe("info");
    expect(r.removed).toHaveLength(2);
    expect(r.kept.map((f) => f.check)).toEqual(["not_a_server_error"]);
    expect(r.specFinding?.count).toBe(2);
  });

  test("healthy baseline (positive probes mostly 2xx) → no-op", () => {
    const findings = [finding("status_code_conformance", "/a", 418)];
    const r = applyBrokenBaselineGuard({ findings, positiveTotal: 50, positiveTwoxx: 48 });
    expect(r.specFinding).toBeNull();
    expect(r.removed).toHaveLength(0);
    expect(r.kept).toBe(findings);
  });

  test("too few positive probes to judge → no-op (guard cannot assess baseline)", () => {
    const findings = [finding("status_code_conformance", "/a", 401)];
    const r = applyBrokenBaselineGuard({ findings, positiveTotal: 5, positiveTwoxx: 0 });
    expect(r.specFinding).toBeNull();
  });

  test("suppressed conformance findings are left in the audit trail", () => {
    const findings = [
      finding("status_code_conformance", "/a", 401, true), // suppressed → keep
      finding("status_code_conformance", "/b", 401),        // active → remove
    ];
    const r = applyBrokenBaselineGuard({ findings, positiveTotal: 40, positiveTwoxx: 0 });
    expect(r.removed).toHaveLength(1);
    expect(r.kept.some((f) => f.suppressed_by)).toBe(true);
  });

  test("degenerate baseline but no conformance findings → no-op (nothing to roll up)", () => {
    const findings = [finding("not_a_server_error", "/c", 503)];
    const r = applyBrokenBaselineGuard({ findings, positiveTotal: 40, positiveTwoxx: 0 });
    expect(r.specFinding).toBeNull();
    expect(r.kept).toBe(findings);
  });
});
