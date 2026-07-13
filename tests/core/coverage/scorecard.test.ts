/**
 * ARV-437 / ARV-440: the pure evidence-panel aggregate. Feeds a synthetic
 * coverage matrix + run records + check_findings into computeScorecard (no DB)
 * and asserts the panel numbers: 5xx, findings by severity, suite failures,
 * exercised/full honest-2xx, span, and the delta vs previous scan.
 */
import { describe, test, expect } from "bun:test";
import { computeScorecard, formatDuration, formatScorecardLine } from "../../../src/core/coverage/scorecard.ts";
import type { CoverageMatrix, MatrixRow, CellResultRef } from "../../../src/core/coverage/reasons.ts";
import type { RunRecord } from "../../../src/db/queries/types.ts";
import type { CheckFindingRow } from "../../../src/db/check-findings.ts";

function ref(over: Partial<CellResultRef>): CellResultRef {
  return {
    resultId: 0, runId: 1, status: "pass", responseStatus: 200,
    failureClass: null, testName: "t", suiteFile: null, ...over,
  };
}

function row(endpoint: string, cells: Partial<MatrixRow["cells"]>): MatrixRow {
  const empty = () => ({ status: "uncovered" as const, reasons: [], results: [] });
  return {
    endpoint, method: endpoint.split(" ")[0]!, path: endpoint.split(" ")[1]!,
    tags: [], deprecated: false, security: [], declaredStatuses: [],
    cells: { "2xx": empty(), "4xx": empty(), "5xx": empty(), ...cells },
  };
}

function run(started: string, finished: string | null, durationMs: number | null = null): RunRecord {
  return {
    id: 1, started_at: started, finished_at: finished, total: 0, passed: 0,
    failed: 0, skipped: 0, trigger: "test", commit_sha: null, branch: null,
    environment: null, duration_ms: durationMs, collection_id: null, session_id: null,
    tags: null, run_kind: "regular",
  };
}

function cf(over: Partial<CheckFindingRow>): CheckFindingRow {
  return {
    id: 0, run_id: 1, check_name: "status_code_conformance", severity: "low",
    category: "contract", method: "GET", path: "/x", status: 404, message: null,
    recommended_action: null, suppressed: 0, ...over,
  };
}

describe("computeScorecard evidence panel (ARV-440)", () => {
  test("5xx, findings-by-severity, suite-fail, exercised/full honest-2xx", () => {
    const matrix: CoverageMatrix = {
      rows: [
        row("GET /a", { "2xx": { status: "covered", reasons: [], results: [ref({ resultId: 1 })] } }),      // honest-2xx
        row("POST /b", { "5xx": { status: "covered", reasons: [], results: [ref({ resultId: 2, status: "fail", responseStatus: 500, failureClass: "server_error" })] } }), // 5xx + suite-fail
        row("GET /c", { "4xx": { status: "covered", reasons: [], results: [ref({ resultId: 3, status: "fail", responseStatus: 404 })] } }), // reached, no failure_class
        row("DELETE /d", {}),                                                                                 // unhit
      ],
      totals: { endpoints: 4, cells: 12, covered: 0, partial: 0, uncovered: 0, byReason: {} as never },
    };
    const findings: CheckFindingRow[] = [
      cf({ severity: "high", check_name: "response_schema_conformance" }),
      cf({ severity: "high", check_name: "not_a_server_error" }),
      cf({ severity: "medium" }),
      cf({ severity: "low" }),
      cf({ severity: "low", suppressed: 1 }), // excluded
    ];
    const stats = computeScorecard(matrix, [run("2026-07-13T10:00:00Z", "2026-07-13T10:03:30Z")], findings, 2);

    expect(stats.serverErrors).toBe(1);          // one 5xx response
    expect(stats.findings).toBe(4);              // 5 minus 1 suppressed
    expect(stats.suppressed).toBe(1);
    expect(stats.bySeverity).toMatchObject({ high: 2, medium: 1, low: 1, critical: 0, info: 0 });
    expect(stats.suiteFailures).toBe(1);         // the failure_class result
    expect(stats.honest2xx).toBe(1);
    expect(stats.reached).toBe(3);
    expect(stats.total).toBe(4);
    expect(stats.honest2xxPctExercised).toBe(33); // 1/3
    expect(stats.honest2xxPctFull).toBe(25);      // 1/4
    expect(stats.durationMs).toBe(210_000);
    expect(stats.findingsDelta).toBe(2);          // 4 − 2
  });

  test("no previous scan → delta null; empty matrix → no divide-by-zero", () => {
    const stats = computeScorecard({ rows: [], totals: {} as never }, [], [], null);
    expect(stats).toMatchObject({
      serverErrors: 0, findings: 0, suiteFailures: 0, honest2xx: 0, reached: 0,
      total: 0, honest2xxPctExercised: 0, honest2xxPctFull: 0, findingsDelta: null,
    });
  });

  test("sums per-run duration_ms; falls back to span only when unmeasured", () => {
    const matrix: CoverageMatrix = { rows: [], totals: {} as never };
    const runs = [
      run("2026-07-13T10:00:00Z", "2026-07-13T10:00:40Z", 40_000),
      run("2026-07-13T10:01:00Z", "2026-07-13T10:01:05Z"),
      run("2026-07-13T10:02:00Z", "2026-07-13T10:02:00Z", 0),
    ];
    expect(computeScorecard(matrix, runs).durationMs).toBe(45_000);
  });

  test("formatDuration is compact across scales", () => {
    expect(formatDuration(820)).toBe("820ms");
    expect(formatDuration(12_000)).toBe("12s");
    expect(formatDuration(210_000)).toBe("3m 30s");
    expect(formatDuration(180_000)).toBe("3m");
    expect(formatDuration(3_840_000)).toBe("1h 4m");
  });

  test("line: zero-value detail segments drop; delta sign renders", () => {
    const base = computeScorecard(
      { rows: [row("GET /a", { "2xx": { status: "covered", reasons: [], results: [ref({ resultId: 1 })] } })], totals: {} as never },
      [run("2026-07-13T10:00:00Z", "2026-07-13T10:00:12Z", 12_000)],
      [cf({ severity: "high" })],
      0,
    );
    // 0 5xx · 1 finding · 1 high · 100%/100% honest-2xx · 1/1 ops · 12s · +1 vs prev
    const line = formatScorecardLine(base);
    expect(line).toContain("0 5xx");
    expect(line).toContain("1 finding · 1 high");
    expect(line).toContain("100%/100% honest-2xx");
    expect(line).toContain("1/1 ops");
    expect(line).toContain("12s");
    expect(line).toContain("+1 vs prev");
    expect(line).not.toContain("suite-fail");   // zero → dropped
    expect(line).not.toContain("med");          // zero → dropped
  });

  test("line: negative and zero delta signs", () => {
    const mk = (delta: number) => formatScorecardLine({
      serverErrors: 0, findings: 0, suppressed: 0, suiteFailures: 0,
      bySeverity: { critical: 0, high: 0, medium: 0, low: 0, info: 0 }, byCategory: {},
      honest2xx: 0, reached: 0, total: 0, honest2xxPctExercised: 0, honest2xxPctFull: 0,
      durationMs: 0, runs: 0, findingsDelta: delta,
    });
    expect(mk(-3)).toContain("-3 vs prev");
    expect(mk(0)).toContain("±0 vs prev");
  });
});
