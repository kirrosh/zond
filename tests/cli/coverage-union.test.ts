import { describe, test, expect } from "bun:test";
import { parseUnion } from "../../src/cli/commands/coverage.ts";

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
    expect(() => parseUnion("58,abc")).toThrow(/comma-separated list of run IDs/);
  });

  test("zero or negative rejected", () => {
    expect(() => parseUnion("0")).toThrow();
    expect(() => parseUnion("-3")).toThrow();
  });

  test("empty string rejected", () => {
    expect(() => parseUnion("")).toThrow(/expects 'session' or a comma/);
  });

  test("only commas rejected", () => {
    expect(() => parseUnion(",,,")).toThrow(/expects 'session' or a comma/);
  });
});
