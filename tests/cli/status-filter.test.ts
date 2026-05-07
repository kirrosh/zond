import { describe, expect, test } from "bun:test";
import {
  parseStatusFilter,
  statusMatches,
  compileStatusFilterToSql,
} from "../../src/cli/status-filter.ts";

describe("parseStatusFilter", () => {
  test("exact code", () => {
    const m = parseStatusFilter("502");
    expect(m).toEqual({ exacts: [502], ranges: [] });
  });

  test("class wildcard 5xx", () => {
    const m = parseStatusFilter("5xx");
    expect(m).toEqual({ exacts: [], ranges: [[500, 599]] });
  });

  test("range 500-599", () => {
    const m = parseStatusFilter("500-599");
    expect(m).toEqual({ exacts: [], ranges: [[500, 599]] });
  });

  test("comparison >=500", () => {
    const m = parseStatusFilter(">=500");
    expect(m).toEqual({ exacts: [], ranges: [[500, 599]] });
  });

  test("comparison <400", () => {
    const m = parseStatusFilter("<400");
    expect(m).toEqual({ exacts: [], ranges: [[100, 399]] });
  });

  test("comparison >500 (strict)", () => {
    const m = parseStatusFilter(">500");
    expect(m).toEqual({ exacts: [], ranges: [[501, 599]] });
  });

  test("comma list of exacts", () => {
    const m = parseStatusFilter("500,502,504");
    expect(m).toEqual({ exacts: [500, 502, 504], ranges: [] });
  });

  test("mix of class + exact", () => {
    const m = parseStatusFilter("5xx,429");
    expect(m).toEqual({ exacts: [429], ranges: [[500, 599]] });
  });

  test("rejects invalid syntax", () => {
    expect(() => parseStatusFilter("foo")).toThrow(/invalid --status/);
    expect(() => parseStatusFilter("99")).toThrow(/invalid --status/);
    expect(() => parseStatusFilter("")).toThrow(/empty/);
    expect(() => parseStatusFilter("700")).toThrow();
    expect(() => parseStatusFilter("5xx,bogus")).toThrow();
    expect(() => parseStatusFilter("599-500")).toThrow(/range start > end/);
  });
});

describe("statusMatches", () => {
  test("exact + range", () => {
    const m = parseStatusFilter("5xx,429");
    expect(statusMatches(m, 500)).toBe(true);
    expect(statusMatches(m, 599)).toBe(true);
    expect(statusMatches(m, 429)).toBe(true);
    expect(statusMatches(m, 200)).toBe(false);
    expect(statusMatches(m, 400)).toBe(false);
    expect(statusMatches(m, null)).toBe(false);
    expect(statusMatches(m, undefined)).toBe(false);
  });

  test(">=500 boundary", () => {
    const m = parseStatusFilter(">=500");
    expect(statusMatches(m, 499)).toBe(false);
    expect(statusMatches(m, 500)).toBe(true);
    expect(statusMatches(m, 599)).toBe(true);
  });
});

describe("compileStatusFilterToSql", () => {
  test("compiles exacts to IN clause", () => {
    const m = parseStatusFilter("500,502");
    const out = compileStatusFilterToSql(m, "response_status");
    expect(out?.sql).toBe("(response_status IN (?,?))");
    expect(out?.params).toEqual([500, 502]);
  });

  test("compiles range to BETWEEN", () => {
    const m = parseStatusFilter("5xx");
    const out = compileStatusFilterToSql(m, "response_status");
    expect(out?.sql).toBe("(response_status BETWEEN ? AND ?)");
    expect(out?.params).toEqual([500, 599]);
  });

  test("combines exacts and ranges with OR", () => {
    const m = parseStatusFilter("5xx,429");
    const out = compileStatusFilterToSql(m, "response_status");
    expect(out?.sql).toBe("(response_status IN (?) OR response_status BETWEEN ? AND ?)");
    expect(out?.params).toEqual([429, 500, 599]);
  });
});
