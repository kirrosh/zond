import type { TestStepExpect, AssertionRule } from "../parser/types.ts";
import type { HttpResponse, AssertionResult } from "./types.ts";
import { getByPath } from "../utils.ts";

function checkType(value: unknown, expectedType: string): boolean {
  switch (expectedType) {
    case "string": return typeof value === "string";
    case "integer": return typeof value === "number" && Number.isInteger(value);
    case "number": return typeof value === "number";
    case "boolean": return typeof value === "boolean";
    case "array": return Array.isArray(value);
    case "object": return typeof value === "object" && value !== null && !Array.isArray(value);
    default: return false;
  }
}

function describeType(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (Array.isArray(value)) return "array";
  if (typeof value === "number" && Number.isInteger(value)) return "integer";
  return typeof value;
}

function deepEquals(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  // Loose numeric comparison: "123" == 123
  if (typeof a === "number" && typeof b === "string") return a === Number(b);
  if (typeof a === "string" && typeof b === "number") return Number(a) === b;
  if (typeof a !== typeof b) return false;
  if (typeof a !== "object" || a === null || b === null) return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

function checkRule(path: string, rule: AssertionRule, actual: unknown): AssertionResult[] {
  const results: AssertionResult[] = [];
  const field = `body.${path}`;

  if (rule.exists !== undefined) {
    const doesExist = actual !== undefined && actual !== null;
    results.push({
      field, rule: `exists ${rule.exists}`,
      passed: doesExist === rule.exists, actual: doesExist, expected: rule.exists,
    });
  }

  if (rule.type !== undefined) {
    results.push({
      field, rule: `type ${rule.type}`,
      passed: checkType(actual, rule.type), actual: describeType(actual), expected: rule.type,
    });
  }

  if (rule.equals !== undefined) {
    results.push({
      field, rule: `equals ${JSON.stringify(rule.equals)}`,
      passed: deepEquals(actual, rule.equals), actual, expected: rule.equals,
    });
  }

  if (rule.contains !== undefined) {
    const passed = typeof actual === "string" && actual.includes(rule.contains);
    results.push({
      field, rule: `contains "${rule.contains}"`,
      passed, actual, expected: rule.contains,
    });
  }

  if (rule.matches !== undefined) {
    const passed = typeof actual === "string" && new RegExp(rule.matches).test(actual);
    results.push({
      field, rule: `matches ${rule.matches}`,
      passed, actual, expected: rule.matches,
    });
  }

  if (rule.gt !== undefined) {
    const passed = typeof actual === "number" && actual > rule.gt;
    results.push({
      field, rule: `gt ${rule.gt}`,
      passed, actual, expected: rule.gt,
    });
  }

  if (rule.lt !== undefined) {
    const passed = typeof actual === "number" && actual < rule.lt;
    results.push({
      field, rule: `lt ${rule.lt}`,
      passed, actual, expected: rule.lt,
    });
  }

  return results;
}

export function checkAssertions(expect: TestStepExpect, response: HttpResponse): AssertionResult[] {
  const results: AssertionResult[] = [];

  if (expect.status !== undefined) {
    results.push({
      field: "status",
      rule: `equals ${expect.status}`,
      passed: response.status === expect.status,
      actual: response.status,
      expected: expect.status,
    });
  }

  if (expect.duration !== undefined) {
    results.push({
      field: "duration",
      rule: `lte ${expect.duration}ms`,
      passed: response.duration_ms <= expect.duration,
      actual: response.duration_ms,
      expected: expect.duration,
    });
  }

  if (expect.headers) {
    for (const [key, expectedValue] of Object.entries(expect.headers)) {
      const actual = response.headers[key.toLowerCase()];
      results.push({
        field: `headers.${key}`,
        rule: `equals "${expectedValue}"`,
        passed: actual === expectedValue,
        actual,
        expected: expectedValue,
      });
    }
  }

  if (expect.body && response.body_parsed !== undefined) {
    for (const [path, rule] of Object.entries(expect.body)) {
      const actual = getByPath(response.body_parsed, path);
      results.push(...checkRule(path, rule, actual));
    }
  }

  return results;
}

export function extractCaptures(
  bodyRules: Record<string, AssertionRule> | undefined,
  responseBody: unknown,
): Record<string, unknown> {
  const captures: Record<string, unknown> = {};
  if (!bodyRules || responseBody === undefined) return captures;

  for (const [path, rule] of Object.entries(bodyRules)) {
    if (rule.capture) {
      const value = getByPath(responseBody, path);
      if (value !== undefined) {
        captures[rule.capture] = value;
      }
    }
  }
  return captures;
}
