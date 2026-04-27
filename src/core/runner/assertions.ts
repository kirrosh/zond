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
    case "null": return value === null;
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
    // Key-presence semantics: null counts as "exists" (key present in response).
    // Use `not_equals: null` or `type: "null"` to assert non-null specifically.
    const doesExist = actual !== undefined;
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

  if (rule.not_equals !== undefined) {
    results.push({
      field, rule: `not_equals ${JSON.stringify(rule.not_equals)}`,
      passed: !deepEquals(actual, rule.not_equals), actual, expected: rule.not_equals,
    });
  }

  if (rule.not_contains !== undefined) {
    const passed = typeof actual === "string" && !actual.includes(rule.not_contains);
    results.push({
      field, rule: `not_contains "${rule.not_contains}"`,
      passed, actual, expected: rule.not_contains,
    });
  }

  if (rule.gte !== undefined) {
    const passed = typeof actual === "number" && actual >= rule.gte;
    results.push({
      field, rule: `gte ${rule.gte}`,
      passed, actual, expected: rule.gte,
    });
  }

  if (rule.lte !== undefined) {
    const passed = typeof actual === "number" && actual <= rule.lte;
    results.push({
      field, rule: `lte ${rule.lte}`,
      passed, actual, expected: rule.lte,
    });
  }

  if (rule.length !== undefined) {
    const hasLength = (Array.isArray(actual) || typeof actual === "string");
    const passed = hasLength && (actual as string | unknown[]).length === rule.length;
    results.push({
      field, rule: `length ${rule.length}`,
      passed, actual: hasLength ? (actual as string | unknown[]).length : describeType(actual), expected: rule.length,
    });
  }

  if (rule.length_gt !== undefined) {
    const hasLength = (Array.isArray(actual) || typeof actual === "string");
    const passed = hasLength && (actual as string | unknown[]).length > rule.length_gt;
    results.push({
      field, rule: `length_gt ${rule.length_gt}`,
      passed, actual: hasLength ? (actual as string | unknown[]).length : describeType(actual), expected: rule.length_gt,
    });
  }

  if (rule.length_gte !== undefined) {
    const hasLength = (Array.isArray(actual) || typeof actual === "string");
    const passed = hasLength && (actual as string | unknown[]).length >= rule.length_gte;
    results.push({
      field, rule: `length_gte ${rule.length_gte}`,
      passed, actual: hasLength ? (actual as string | unknown[]).length : describeType(actual), expected: rule.length_gte,
    });
  }

  if (rule.length_lt !== undefined) {
    const hasLength = (Array.isArray(actual) || typeof actual === "string");
    const passed = hasLength && (actual as string | unknown[]).length < rule.length_lt;
    results.push({
      field, rule: `length_lt ${rule.length_lt}`,
      passed, actual: hasLength ? (actual as string | unknown[]).length : describeType(actual), expected: rule.length_lt,
    });
  }

  if (rule.length_lte !== undefined) {
    const hasLength = (Array.isArray(actual) || typeof actual === "string");
    const passed = hasLength && (actual as string | unknown[]).length <= rule.length_lte;
    results.push({
      field, rule: `length_lte ${rule.length_lte}`,
      passed, actual: hasLength ? (actual as string | unknown[]).length : describeType(actual), expected: rule.length_lte,
    });
  }

  if (rule.each !== undefined) {
    if (!Array.isArray(actual)) {
      results.push({ field, rule: "each", passed: false, actual: describeType(actual), expected: "array" });
    } else {
      for (let i = 0; i < actual.length; i++) {
        for (const [subPath, subRule] of Object.entries(rule.each)) {
          const subActual = getByPath(actual[i], subPath);
          const subResults = checkRule(`${path}[${i}].${subPath}`, subRule, subActual);
          results.push(...subResults);
        }
      }
    }
  }

  if (rule.contains_item !== undefined) {
    if (!Array.isArray(actual)) {
      results.push({ field, rule: "contains_item", passed: false, actual: describeType(actual), expected: "array" });
    } else {
      const found = actual.some((item) => {
        for (const [subPath, subRule] of Object.entries(rule.contains_item!)) {
          const subActual = getByPath(item, subPath);
          const subResults = checkRule("", subRule, subActual);
          if (subResults.some(r => !r.passed)) return false;
        }
        return true;
      });
      results.push({
        field, rule: "contains_item",
        passed: found, actual: `array(${actual.length})`, expected: "at least one matching item",
      });
    }
  }

  if (rule.set_equals !== undefined) {
    if (!Array.isArray(actual) || !Array.isArray(rule.set_equals)) {
      results.push({
        field, rule: "set_equals",
        passed: false, actual: describeType(actual), expected: "both must be arrays",
      });
    } else {
      const actualSet = new Set(actual.map(v => JSON.stringify(v)));
      const expectedSet = new Set((rule.set_equals as unknown[]).map(v => JSON.stringify(v)));
      const passed = actualSet.size === expectedSet.size && [...actualSet].every(v => expectedSet.has(v));
      results.push({
        field, rule: "set_equals",
        passed, actual, expected: rule.set_equals,
      });
    }
  }

  return results;
}

export function checkAssertions(expect: TestStepExpect, response: HttpResponse): AssertionResult[] {
  const results: AssertionResult[] = [];

  if (expect.status !== undefined) {
    const allowed = Array.isArray(expect.status) ? expect.status : [expect.status];
    results.push({
      field: "status",
      rule: allowed.length === 1 ? `equals ${allowed[0]}` : `one of [${allowed.join(", ")}]`,
      passed: allowed.includes(response.status),
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
    for (const [key, rule] of Object.entries(expect.headers)) {
      const actual = response.headers[key.toLowerCase()];
      if (typeof rule === "string") {
        results.push({
          field: `headers.${key}`,
          rule: `equals "${rule}"`,
          passed: actual === rule,
          actual,
          expected: rule,
        });
      } else {
        // AssertionRule in header — supports capture and other checks
        const ruleResults = checkRule(key, rule, actual).map(r => ({
          ...r,
          field: r.field.replace(/^body\./, "headers."),
        }));
        results.push(...ruleResults);
      }
    }
  }

  if (expect.body && response.body_parsed !== undefined) {
    for (const [path, rule] of Object.entries(expect.body)) {
      let actual: unknown;
      if (path === "_body") {
        actual = response.body_parsed;
      } else if (path.startsWith("_body.")) {
        actual = getByPath(response.body_parsed, path.slice(6));
      } else {
        actual = getByPath(response.body_parsed, path);
      }
      results.push(...checkRule(path, rule, actual));
    }
  }

  return results;
}

export function extractCaptures(
  bodyRules: Record<string, AssertionRule> | undefined,
  responseBody: unknown,
  headerRules?: Record<string, string | AssertionRule>,
  responseHeaders?: Record<string, string>,
): Record<string, unknown> {
  const captures: Record<string, unknown> = {};

  if (bodyRules && responseBody !== undefined) {
    for (const [path, rule] of Object.entries(bodyRules)) {
      if (rule.capture) {
        let value: unknown;
        if (path === "_body") {
          value = responseBody;
        } else if (path.startsWith("_body.")) {
          value = getByPath(responseBody, path.slice(6));
        } else {
          value = getByPath(responseBody, path);
        }
        if (value !== undefined) {
          captures[rule.capture] = value;
        }
      }
    }
  }

  if (headerRules && responseHeaders) {
    for (const [key, rule] of Object.entries(headerRules)) {
      if (typeof rule !== "string" && rule.capture) {
        const value = responseHeaders[key.toLowerCase()];
        if (value !== undefined) {
          captures[rule.capture] = value;
        }
      }
    }
  }

  return captures;
}
