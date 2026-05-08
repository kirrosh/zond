import { describe, test, expect } from "bun:test";
import { parseUnion, parseDuration } from "../../src/cli/commands/coverage.ts";

describe("parseUnion (TASK-255)", () => {
  test("'session' (any case) returns session sentinel", () => {
    expect(parseUnion("session")).toEqual({ kind: "session" });
    expect(parseUnion("SESSION")).toEqual({ kind: "session" });
    expect(parseUnion("  session  ")).toEqual({ kind: "session" });
  });

  test("comma-separated ids parsed in order", () => {
    expect(parseUnion("58,59,60")).toEqual({ kind: "runIds", ids: [58, 59, 60] });
  });

  test("whitespace around ids tolerated", () => {
    expect(parseUnion(" 1 , 2 , 3 ")).toEqual({ kind: "runIds", ids: [1, 2, 3] });
  });

  test("single id is allowed (still a list)", () => {
    expect(parseUnion("42")).toEqual({ kind: "runIds", ids: [42] });
  });

  test("non-integer rejected with actionable message", () => {
    expect(() => parseUnion("58,abc")).toThrow(/runs:/);
  });

  test("zero or negative rejected", () => {
    expect(() => parseUnion("0")).toThrow();
    expect(() => parseUnion("-3")).toThrow();
  });

  test("empty string rejected", () => {
    expect(() => parseUnion("")).toThrow(/'session'/);
  });

  test("only commas rejected", () => {
    expect(() => parseUnion(",,,")).toThrow(/'session'/);
  });
});

describe("parseUnion (TASK-274)", () => {
  test("runs:<id1,id2,...> prefix is supported alongside the bare list", () => {
    expect(parseUnion("runs:58,59")).toEqual({ kind: "runIds", ids: [58, 59] });
    expect(parseUnion("RUNS:7,8,9")).toEqual({ kind: "runIds", ids: [7, 8, 9] });
  });

  test("since:<dur> returns a since spec with millis", () => {
    expect(parseUnion("since:1h")).toEqual({ kind: "since", durationMs: 3_600_000, raw: "1h" });
    expect(parseUnion("since:24h")).toEqual({ kind: "since", durationMs: 86_400_000, raw: "24h" });
    expect(parseUnion("since:7d")).toEqual({ kind: "since", durationMs: 7 * 86_400_000, raw: "7d" });
    expect(parseUnion("since:30m")).toEqual({ kind: "since", durationMs: 30 * 60_000, raw: "30m" });
  });

  test("since: bad duration rejected with actionable message", () => {
    expect(() => parseUnion("since:")).toThrow(/needs a duration/);
    expect(() => parseUnion("since:abc")).toThrow(/Invalid duration/);
    expect(() => parseUnion("since:0h")).toThrow(/positive integer/);
  });

  test("tag:<name> returns a tag spec", () => {
    expect(parseUnion("tag:smoke")).toEqual({ kind: "tag", name: "smoke" });
    expect(parseUnion("TAG:Negative")).toEqual({ kind: "tag", name: "Negative" });
  });

  test("tag: empty rejected", () => {
    expect(() => parseUnion("tag:")).toThrow(/needs a tag/);
  });

  test("parseDuration handles each unit", () => {
    expect(parseDuration("1s")).toBe(1_000);
    expect(parseDuration("2m")).toBe(120_000);
    expect(parseDuration("3h")).toBe(3 * 3_600_000);
    expect(parseDuration("4d")).toBe(4 * 86_400_000);
  });

  test("parseDuration rejects malformed input", () => {
    expect(() => parseDuration("1y")).toThrow();
    expect(() => parseDuration("h")).toThrow();
    expect(() => parseDuration("")).toThrow();
  });
});
