/**
 * ARV-437: the pure scorecard aggregate. Feeds a synthetic coverage matrix
 * + run records straight into computeScorecard (no DB) and asserts the four
 * headline numbers: findings (distinct failure_class results), honest-2xx
 * ops, reached/total ops, and the wall-clock span.
 */
import { describe, test, expect } from "bun:test";
import { computeScorecard, formatDuration, formatScorecardLine } from "../../../src/core/coverage/scorecard.ts";
import type { CoverageMatrix, MatrixRow, CellResultRef } from "../../../src/core/coverage/reasons.ts";
import type { RunRecord } from "../../../src/db/queries/types.ts";

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

describe("computeScorecard (ARV-437)", () => {
  test("counts honest-2xx, reached, findings, span", () => {
    const matrix: CoverageMatrix = {
      rows: [
        // honest-2xx: has a passing 2xx
        row("GET /a", { "2xx": { status: "covered", reasons: [], results: [ref({ resultId: 1 })] } }),
        // reached but not honest (4xx only) + a finding
        row("POST /b", { "4xx": { status: "covered", reasons: [], results: [ref({ resultId: 2, status: "fail", responseStatus: 400, failureClass: "schema_violation" })] } }),
        // reached, non-2xx, no failure_class → not a finding
        row("GET /c", { "4xx": { status: "covered", reasons: [], results: [ref({ resultId: 3, status: "fail", responseStatus: 404 })] } }),
        // unhit
        row("DELETE /d", {}),
      ],
      totals: { endpoints: 4, cells: 12, covered: 0, partial: 0, uncovered: 0, byReason: {} as never },
    };
    const stats = computeScorecard(matrix, [run("2026-07-13T10:00:00Z", "2026-07-13T10:03:30Z")]);

    expect(stats.total).toBe(4);
    expect(stats.reached).toBe(3);      // a, b, c hit; d unhit
    expect(stats.honest2xx).toBe(1);    // only /a
    expect(stats.honest2xxPct).toBe(25); // 1/4
    expect(stats.findings).toBe(1);     // only the failure_class result
    expect(stats.durationMs).toBe(210_000); // no duration_ms → started→finished span
    expect(stats.runs).toBe(1);
  });

  test("sums per-run duration_ms; falls back to span only when unmeasured", () => {
    const matrix: CoverageMatrix = { rows: [], totals: {} as never };
    const runs = [
      run("2026-07-13T10:00:00Z", "2026-07-13T10:00:40Z", 40_000), // measured 40s
      run("2026-07-13T10:01:00Z", "2026-07-13T10:01:05Z"),          // unmeasured → 5s span
      run("2026-07-13T10:02:00Z", "2026-07-13T10:02:00Z", 0),       // stamped now, span 0 → contributes 0
    ];
    expect(computeScorecard(matrix, runs).durationMs).toBe(45_000);
  });

  test("dedups a finding seen in multiple cells; empty span → 0", () => {
    const dup = ref({ resultId: 7, status: "fail", responseStatus: 500, failureClass: "server_error" });
    const matrix: CoverageMatrix = {
      rows: [row("GET /x", {
        "4xx": { status: "covered", reasons: [], results: [dup] },
        "5xx": { status: "covered", reasons: [], results: [dup] },
      })],
      totals: { endpoints: 1, cells: 3, covered: 0, partial: 0, uncovered: 0, byReason: {} as never },
    };
    const stats = computeScorecard(matrix, [run("2026-07-13T10:00:00Z", null)]);
    expect(stats.findings).toBe(1); // same resultId across two cells → one finding
    expect(stats.durationMs).toBe(0); // finished_at null, single point
  });

  test("empty matrix is all zeros, no divide-by-zero", () => {
    const stats = computeScorecard({ rows: [], totals: {} as never }, []);
    expect(stats).toMatchObject({ findings: 0, honest2xx: 0, reached: 0, total: 0, honest2xxPct: 0, durationMs: 0, runs: 0 });
  });

  test("formatDuration is compact across scales", () => {
    expect(formatDuration(820)).toBe("820ms");
    expect(formatDuration(12_000)).toBe("12s");
    expect(formatDuration(210_000)).toBe("3m 30s");
    expect(formatDuration(180_000)).toBe("3m");
    expect(formatDuration(3_840_000)).toBe("1h 4m");
  });

  test("line renders all four segments with singular/plural findings", () => {
    const line = formatScorecardLine({ findings: 1, honest2xx: 5, reached: 8, total: 10, honest2xxPct: 50, durationMs: 12_000, runs: 1 });
    expect(line).toBe("1 finding · 50% honest-2xx · 8/10 ops · 12s");
  });
});
