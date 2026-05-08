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
      { endpoint: "GET /a", method: "GET", path: "/a", lastStatus: 200 },
    ]);
    expect(buckets.coveredButNon2xx).toEqual([
      { endpoint: "PUT /b", method: "PUT", path: "/b", lastStatus: 502 },
    ]);
    expect(buckets.unhit).toEqual([
      { endpoint: "GET /c", method: "GET", path: "/c", lastStatus: null },
    ]);
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

  test("network-error-only result (responseStatus=null) is still 'hit' but lastStatus=null", () => {
    const matrix: CoverageMatrix = {
      rows: [
        row("GET", "/net", { "2xx": emptyCell(), "4xx": emptyCell(), "5xx": cell([ref("error", null)]) }),
      ],
      totals: { endpoints: 1, cells: 3, covered: 0, partial: 1, uncovered: 0, byReason: {} as never },
    };
    const buckets = bucketRows(matrix);
    expect(buckets.coveredButNon2xx).toEqual([
      { endpoint: "GET /net", method: "GET", path: "/net", lastStatus: null },
    ]);
    expect(buckets.unhit).toEqual([]);
  });
});
