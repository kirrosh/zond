import { describe, test, expect } from "bun:test";
import {
  count5xx,
  is5xx,
  formatStep,
  formatSuiteResult,
  formatGrandTotal,
} from "../../src/core/reporter/console.ts";
import { makeStep, makeResult } from "../_helpers/reporter-fixtures";

describe("is5xx / count5xx", () => {
  test("is5xx detects 500-599 status on response", () => {
    expect(is5xx(makeStep({ status: "fail", response: { status: 500, headers: {}, body: "", duration_ms: 1 } }))).toBe(true);
    expect(is5xx(makeStep({ status: "fail", response: { status: 503, headers: {}, body: "", duration_ms: 1 } }))).toBe(true);
    expect(is5xx(makeStep({ status: "fail", response: { status: 499, headers: {}, body: "", duration_ms: 1 } }))).toBe(false);
    expect(is5xx(makeStep({ status: "fail", response: { status: 600, headers: {}, body: "", duration_ms: 1 } }))).toBe(false);
    expect(is5xx(makeStep({ status: "error" }))).toBe(false);
  });

  test("count5xx counts only fail/error steps with 5xx response", () => {
    const steps = [
      makeStep({ status: "pass", response: { status: 500, headers: {}, body: "", duration_ms: 1 } }),
      makeStep({ status: "fail", response: { status: 502, headers: {}, body: "", duration_ms: 1 } }),
      makeStep({ status: "fail", response: { status: 400, headers: {}, body: "", duration_ms: 1 } }),
      makeStep({ status: "error" }),
    ];
    expect(count5xx(steps)).toBe(1);
  });
});

describe("formatStep highlights 5xx in fail label", () => {
  test("fail with 5xx adds [5xx <status>] tag", () => {
    const step = makeStep({
      status: "fail",
      response: { status: 503, headers: {}, body: "", duration_ms: 1 },
    });
    const out = formatStep(step, false);
    expect(out).toContain("[5xx 503]");
  });

  test("fail without 5xx has no tag", () => {
    const step = makeStep({
      status: "fail",
      response: { status: 400, headers: {}, body: "", duration_ms: 1 },
    });
    const out = formatStep(step, false);
    expect(out).not.toContain("5xx");
  });
});

describe("suite/grand total surfaces 5xx count", () => {
  test("formatSuiteResult shows '<n> 5xx' when present", () => {
    const result = makeResult([
      makeStep({ status: "fail", response: { status: 500, headers: {}, body: "", duration_ms: 1 } }),
      makeStep({ status: "fail", response: { status: 502, headers: {}, body: "", duration_ms: 1 } }),
      makeStep({ status: "fail", response: { status: 400, headers: {}, body: "", duration_ms: 1 } }),
    ]);
    const out = formatSuiteResult(result, false);
    expect(out).toContain("3 failed");
    expect(out).toContain("2 5xx");
  });

  test("no 5xx → no '5xx' label", () => {
    const result = makeResult([
      makeStep({ status: "fail", response: { status: 400, headers: {}, body: "", duration_ms: 1 } }),
    ]);
    const out = formatSuiteResult(result, false);
    expect(out).not.toContain("5xx");
  });

  test("formatGrandTotal aggregates 5xx across suites", () => {
    const a = makeResult([
      makeStep({ status: "fail", response: { status: 500, headers: {}, body: "", duration_ms: 1 } }),
    ]);
    const b = makeResult([
      makeStep({ status: "fail", response: { status: 504, headers: {}, body: "", duration_ms: 1 } }),
    ]);
    const out = formatGrandTotal([a, b], false);
    expect(out).toContain("2 5xx");
  });
});
