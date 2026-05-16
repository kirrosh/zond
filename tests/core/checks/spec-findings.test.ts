/**
 * ARV-60: spec-level rollup of systemic gaps. Verifies that
 * `computeSpecFindings` collapses 1-issue × N-ops noise into a single
 * actionable row when the 80% threshold is crossed, and stays silent
 * below it.
 */
import { describe, expect, test } from "bun:test";

import { computeSpecFindings, type PerCheckObservations } from "../../../src/core/checks/spec-findings.ts";
import type { CheckFinding } from "../../../src/core/checks/types.ts";

function mkFinding(check: string, status: number, path: string, method: string = "GET"): CheckFinding {
  return {
    check,
    severity: "low",
    operation: { path, method },
    request_signature: `${method} ${path}`,
    response_summary: { status },
    message: `Status ${status} not declared`,
  };
}

function perCheck(applicable: number, cases: number, skipped: Record<string, number> = {}): PerCheckObservations {
  return { applicable, cases, skipped };
}

describe("computeSpecFindings (ARV-60)", () => {
  test("AC #1 — 83/83 status-401 cluster on status_code_conformance → 1 spec_finding", () => {
    const findings: CheckFinding[] = [];
    const paths = Array.from({ length: 83 }, (_, i) => `/p${i}`);
    for (const p of paths) findings.push(mkFinding("status_code_conformance", 401, p));
    const observations = new Map<string, PerCheckObservations>([
      ["status_code_conformance", perCheck(83, 83)],
    ]);

    const spec = computeSpecFindings(findings, observations);
    const drift = spec.filter((s) => s.kind === "status_drift");
    expect(drift).toHaveLength(1);
    expect(drift[0]!.check).toBe("status_code_conformance");
    expect(drift[0]!.count).toBe(83);
    expect(drift[0]!.applicable).toBe(83);
    // AC #2 — actionable next-step text
    expect(drift[0]!.fix_hint).toMatch(/--tolerate-undeclared 401|response declarations/);
    expect(drift[0]!.reason).toMatch(/401/);
  });

  test("below threshold — 3/10 cluster does NOT roll up", () => {
    const findings: CheckFinding[] = [];
    for (let i = 0; i < 3; i++) findings.push(mkFinding("status_code_conformance", 401, `/p${i}`));
    const observations = new Map<string, PerCheckObservations>([
      ["status_code_conformance", perCheck(10, 10)],
    ]);

    const spec = computeSpecFindings(findings, observations);
    expect(spec.filter((s) => s.kind === "status_drift")).toHaveLength(0);
  });

  test("AC #5 — response_schema_conformance skip-cluster → missing_declaration", () => {
    const observations = new Map<string, PerCheckObservations>([
      ["response_schema_conformance", perCheck(
        83,
        83,
        { "response_schema_conformance: no JSON Schema on this response branch": 83 },
      )],
    ]);

    const spec = computeSpecFindings([], observations);
    const md = spec.filter((s) => s.kind === "missing_declaration");
    expect(md).toHaveLength(1);
    expect(md[0]!.severity).toBe("info");
    expect(md[0]!.fix_hint).toMatch(/Add response schemas|zond api annotate/);
  });

  test("AC #5 — use_after_free with 0 cases on N≥5 ops → no_detector", () => {
    const observations = new Map<string, PerCheckObservations>([
      ["use_after_free", perCheck(20, 0)],
    ]);

    const spec = computeSpecFindings([], observations);
    const nd = spec.filter((s) => s.kind === "no_detector");
    expect(nd).toHaveLength(1);
    expect(nd[0]!.severity).toBe("info");
    expect(nd[0]!.fix_hint).toMatch(/annotate/i);
  });

  test("no_detector floor — fewer than 5 applicable ops stays quiet", () => {
    const observations = new Map<string, PerCheckObservations>([
      ["use_after_free", perCheck(3, 0)],
    ]);
    const spec = computeSpecFindings([], observations);
    expect(spec.filter((s) => s.kind === "no_detector")).toHaveLength(0);
  });

  test("max_requests skip cluster is NOT a spec finding (ARV-227 budget cap, not spec gap)", () => {
    const observations = new Map<string, PerCheckObservations>([
      ["not_a_server_error", perCheck(50, 50, { "not_a_server_error: max_requests-cap-reached": 50 })],
    ]);
    const spec = computeSpecFindings([], observations);
    expect(spec).toHaveLength(0);
  });

  test("AC #3 — every spec_finding carries affected_operations, count, applicable", () => {
    const findings: CheckFinding[] = [];
    for (let i = 0; i < 10; i++) findings.push(mkFinding("status_code_conformance", 401, `/p${i}`));
    const observations = new Map<string, PerCheckObservations>([
      ["status_code_conformance", perCheck(10, 10)],
    ]);
    const spec = computeSpecFindings(findings, observations);
    expect(spec[0]!.count).toBe(10);
    expect(spec[0]!.applicable).toBe(10);
    expect(spec[0]!.affected_operations.length).toBe(10);
    expect(spec[0]!.affected_operations[0]).toMatchObject({ path: "/p0", method: "GET" });
  });

  test("status_drift carries category from check id (status_code_conformance → contract)", () => {
    const findings: CheckFinding[] = [];
    for (let i = 0; i < 10; i++) findings.push(mkFinding("status_code_conformance", 401, `/p${i}`));
    const observations = new Map<string, PerCheckObservations>([
      ["status_code_conformance", perCheck(10, 10)],
    ]);
    const spec = computeSpecFindings(findings, observations);
    expect(spec[0]!.category).toBe("contract");
  });
});
