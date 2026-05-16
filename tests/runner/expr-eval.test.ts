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

  // TASK-204: edge cases pinning current semantics so refactors don't shift
  // skip_if behavior unintentionally.
  describe("edge cases", () => {
    test("string ordering: lexicographic '>' / '<' on non-numeric strings", () => {
      // Falls back to JS string comparison when both sides aren't numeric.
      expect(evaluateExpr("apple < banana")).toBe(true);
      expect(evaluateExpr("banana > apple")).toBe(true);
      expect(evaluateExpr("apple > banana")).toBe(false);
    });

    test("operator precedence: '!=' is checked before '==' so 'a != b' is not parsed as '== '", () => {
      // OPERATORS lists '!=' before '==' (line 1). If that order flips,
      // '!=' would split on the first '=' and evaluate as '== '. Pin it.
      expect(evaluateExpr("a != b")).toBe(true);
      expect(evaluateExpr("a != a")).toBe(false);
    });

    test("'>=' and '<=' are matched as whole operators, not as '>' / '<'", () => {
      // Same precedence concern: '>=' must come before '>' to avoid
      // splitting "5 >= 5" into "5 " > "= 5".
      expect(evaluateExpr("5 >= 5")).toBe(true);
      expect(evaluateExpr("5 <= 5")).toBe(true);
    });

    test("'0' == '' quirk: numeric-coerced when both sides parse as numbers", () => {
      // Number('0') === 0; Number('') === 0 BUT the empty side is filtered
      // out by `left !== "" && right !== ""`, so this falls back to string
      // equality: '0' !== ''.
      expect(evaluateExpr("0 == ")).toBe(false);
      // Both '0' and '0.0' coerce to 0 → numeric branch → equal.
      expect(evaluateExpr("0 == 0.0")).toBe(true);
    });

    test("NaN inputs fall back to string comparison (no NaN propagation)", () => {
      // 'abc' is not numeric; current impl falls back to string equality.
      expect(evaluateExpr("abc == abc")).toBe(true);
      expect(evaluateExpr("abc != abc")).toBe(false);
    });

    test("whitespace-only input is empty after trim → false", () => {
      expect(evaluateExpr("   ")).toBe(false);
      expect(evaluateExpr("\t\n")).toBe(false);
    });

    test("scientific-notation numbers compare numerically", () => {
      expect(evaluateExpr("1e3 == 1000")).toBe(true);
      expect(evaluateExpr("1.5e2 > 100")).toBe(true);
    });
  });
});
