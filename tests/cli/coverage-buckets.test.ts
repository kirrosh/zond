import { describe, test, expect } from "bun:test";
import { bucketRows } from "../../src/cli/commands/coverage.ts";
import type { CoverageMatrix, MatrixRow, MatrixCell, CellResultRef } from "../../src/core/coverage/reasons.ts";

// TASK-280: bucketRows is the single source of truth for the
// covered2xx / coveredButNon2xx / unhit split used by both the text reporter
// and the JSON envelope. Test it on a hand-rolled matrix with three rows:
//   - GET /a   — passing 2xx (200) → covered2xx
//   - PUT /b   — 5xx, no pass     → coveredButNon2xx
//   - GET /c   — no results       → unhit

function ref(status: string, responseStatus: number | null): CellResultRef {
  return {
    resultId: 0, runId: 0,
    status,
    responseStatus,
    failureClass: null,
    testName: "x",
    suiteFile: null,
  };
}

function cell(refs: CellResultRef[]): MatrixCell {
  return { status: refs.length > 0 ? "covered" : "uncovered", reasons: [], results: refs };
}

function row(method: string, path: string, cells: MatrixRow["cells"]): MatrixRow {
  return {
    endpoint: `${method} ${path}`,
    method,
    path,
    tags: [], deprecated: false, security: [], declaredStatuses: [],
    cells,
  };
}

function emptyCell(): MatrixCell { return { status: "uncovered", reasons: [], results: [] }; }

describe("bucketRows (TASK-280)", () => {
  test("splits rows into covered2xx / coveredButNon2xx / unhit", () => {
    const matrix: CoverageMatrix = {
      rows: [
        row("GET", "/a", { "2xx": cell([ref("pass", 200)]), "4xx": emptyCell(), "5xx": emptyCell() }),
        row("PUT", "/b", { "2xx": emptyCell(), "4xx": emptyCell(), "5xx": cell([ref("fail", 502)]) }),
        row("GET", "/c", { "2xx": emptyCell(), "4xx": emptyCell(), "5xx": emptyCell() }),
      ],
      totals: { endpoints: 3, cells: 9, covered: 1, partial: 1, uncovered: 1, byReason: {} as never },
    };

    const buckets = bucketRows(matrix);
    expect(buckets.covered2xx).toEqual([
      { endpoint: "GET /a", method: "GET", path: "/a", lastStatus: 200, passStatus: 200, deprecated: false },
    ]);
    expect(buckets.coveredButNon2xx).toEqual([
      { endpoint: "PUT /b", method: "PUT", path: "/b", lastStatus: 502, passStatus: null, deprecated: false },
    ]);
    expect(buckets.unhit).toEqual([
      { endpoint: "GET /c", method: "GET", path: "/c", lastStatus: null, passStatus: null, deprecated: false },
    ]);
  });

  test("ARV-426: covered2xx row with a later negative case keeps passStatus=2xx while lastStatus reflects the 4xx", () => {
    // One endpoint, one positive (200 pass) then one negative (404 fail) case —
    // the exact shape that made lastStatus contradict bucket membership.
    const matrix: CoverageMatrix = {
      rows: [
        row("GET", "/d", { "2xx": cell([ref("pass", 200)]), "4xx": cell([ref("fail", 404)]), "5xx": emptyCell() }),
      ],
      totals: { endpoints: 1, cells: 3, covered: 1, partial: 0, uncovered: 0, byReason: {} as never },
    };
    const buckets = bucketRows(matrix);
    expect(buckets.covered2xx).toHaveLength(1);
    expect(buckets.covered2xx[0]?.passStatus).toBe(200); // honest health signal
    expect(buckets.covered2xx[0]?.lastStatus).toBe(404); // chronological-last, no longer read as health
  });

  test("hit-but-failed (assertion failure with 4xx) lands in coveredButNon2xx", () => {
    const matrix: CoverageMatrix = {
      rows: [
        row("POST", "/x", { "2xx": emptyCell(), "4xx": cell([ref("fail", 422)]), "5xx": emptyCell() }),
      ],
      totals: { endpoints: 1, cells: 3, covered: 0, partial: 1, uncovered: 0, byReason: {} as never },
    };
    const buckets = bucketRows(matrix);
    expect(buckets.covered2xx).toEqual([]);
    expect(buckets.coveredButNon2xx).toHaveLength(1);
    expect(buckets.coveredButNon2xx[0]?.lastStatus).toBe(422);
    expect(buckets.unhit).toEqual([]);
  });

  test("TASK-270: rows that hit but never pass land in coveredButNon2xx (= hit_coverage but not pass_coverage)", () => {
    // Two rows: A is a clean 2xx pass, B is a 5xx-only hit. pass-coverage
    // should count A only; hit-coverage should count both.
    const matrix: CoverageMatrix = {
      rows: [
        row("GET", "/a", { "2xx": cell([ref("pass", 200)]), "4xx": emptyCell(), "5xx": emptyCell() }),
        row("PUT", "/b", { "2xx": emptyCell(), "4xx": emptyCell(), "5xx": cell([ref("fail", 502)]) }),
      ],
      totals: { endpoints: 2, cells: 6, covered: 1, partial: 1, uncovered: 0, byReason: {} as never },
    };
    const buckets = bucketRows(matrix);
    // pass-coverage proxy
    expect(buckets.covered2xx).toHaveLength(1);
    // hit-coverage proxy = covered2xx + coveredButNon2xx
    expect(buckets.covered2xx.length + buckets.coveredButNon2xx.length).toBe(2);
  });

  test("ARV-379: per-entry deprecated flag flows from the matrix row", () => {
    const dep: MatrixRow = { ...row("GET", "/old", { "2xx": emptyCell(), "4xx": emptyCell(), "5xx": emptyCell() }), deprecated: true };
    const matrix: CoverageMatrix = {
      rows: [dep, row("GET", "/new", { "2xx": cell([ref("pass", 200)]), "4xx": emptyCell(), "5xx": emptyCell() })],
      totals: { endpoints: 2, cells: 6, covered: 1, partial: 0, uncovered: 1, byReason: {} as never },
    };
    const buckets = bucketRows(matrix);
    expect(buckets.unhit[0]?.deprecated).toBe(true);
    expect(buckets.covered2xx[0]?.deprecated).toBe(false);
  });

  test("network-error-only result (responseStatus=null) is still 'hit' but lastStatus=null", () => {
    const matrix: CoverageMatrix = {
      rows: [
        row("GET", "/net", { "2xx": emptyCell(), "4xx": emptyCell(), "5xx": cell([ref("error", null)]) }),
      ],
      totals: { endpoints: 1, cells: 3, covered: 0, partial: 1, uncovered: 0, byReason: {} as never },
    };
    const buckets = bucketRows(matrix);
    expect(buckets.coveredButNon2xx).toEqual([
      { endpoint: "GET /net", method: "GET", path: "/net", lastStatus: null, passStatus: null, deprecated: false },
    ]);
    expect(buckets.unhit).toEqual([]);
  });
});
