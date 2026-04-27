import { describe, test, expect } from "bun:test";
import { evaluateExpr } from "../../src/core/runner/expr-eval.ts";

describe("evaluateExpr", () => {
  describe("comparison operators", () => {
    test("== with numbers", () => {
      expect(evaluateExpr("200 == 200")).toBe(true);
      expect(evaluateExpr("200 == 404")).toBe(false);
    });

    test("== with strings", () => {
      expect(evaluateExpr("completed == completed")).toBe(true);
      expect(evaluateExpr("pending == completed")).toBe(false);
    });

    test("!= with numbers", () => {
      expect(evaluateExpr("200 != 404")).toBe(true);
      expect(evaluateExpr("200 != 200")).toBe(false);
    });

    test("> with numbers", () => {
      expect(evaluateExpr("10 > 5")).toBe(true);
      expect(evaluateExpr("5 > 10")).toBe(false);
    });

    test("< with numbers", () => {
      expect(evaluateExpr("5 < 10")).toBe(true);
      expect(evaluateExpr("10 < 5")).toBe(false);
    });

    test(">= with numbers", () => {
      expect(evaluateExpr("5 >= 5")).toBe(true);
      expect(evaluateExpr("6 >= 5")).toBe(true);
      expect(evaluateExpr("4 >= 5")).toBe(false);
    });

    test("<= with numbers", () => {
      expect(evaluateExpr("5 <= 5")).toBe(true);
      expect(evaluateExpr("4 <= 5")).toBe(true);
      expect(evaluateExpr("6 <= 5")).toBe(false);
    });
  });

  describe("truthiness", () => {
    test("empty string is false", () => {
      expect(evaluateExpr("")).toBe(false);
    });

    test("'0' is false", () => {
      expect(evaluateExpr("0")).toBe(false);
    });

    test("'false' is false", () => {
      expect(evaluateExpr("false")).toBe(false);
    });

    test("'null' is false", () => {
      expect(evaluateExpr("null")).toBe(false);
    });

    test("'undefined' is false", () => {
      expect(evaluateExpr("undefined")).toBe(false);
    });

    test("non-empty string is true", () => {
      expect(evaluateExpr("something")).toBe(true);
    });

    test("'true' is true", () => {
      expect(evaluateExpr("true")).toBe(true);
    });

    test("'1' is true", () => {
      expect(evaluateExpr("1")).toBe(true);
    });
  });

  test("handles whitespace", () => {
    expect(evaluateExpr("  200 == 200  ")).toBe(true);
  });

  // T27 — placeholder detection for needs-id smoke tests
  describe("empty-string equality (T27 skip_if)", () => {
    test("empty == empty (env value unset/empty) → true → step skips", () => {
      expect(evaluateExpr(" ==")).toBe(true);
      expect(evaluateExpr("==")).toBe(true);
    });

    test("non-empty == empty (env value supplied) → false → step runs", () => {
      expect(evaluateExpr("real-id ==")).toBe(false);
      expect(evaluateExpr("550e8400-e29b-41d4-a716-446655440000 ==")).toBe(false);
    });
  });
});
