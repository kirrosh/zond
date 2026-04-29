import { z } from "zod";
import type { TestSuite, TestStep, AssertionRule, TestStepExpect, SuiteConfig, RetryUntil, ForEach, MultipartField } from "./types.ts";

const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;

function extractMethodAndPath(raw: unknown): unknown {
  if (typeof raw !== "object" || raw === null) return raw;
  const obj = raw as Record<string, unknown>;

  let foundMethod: string | undefined;
  for (const method of HTTP_METHODS) {
    if (method in obj) {
      if (foundMethod) {
        throw new Error(`Ambiguous step: found both ${foundMethod} and ${method} keys`);
      }
      foundMethod = method;
    }
  }

  if (foundMethod) {
    const path = obj[foundMethod];
    if (typeof path !== "string") {
      throw new Error(`${foundMethod} value must be a string path, got ${typeof path}`);
    }
    const { [foundMethod]: _, ...rest } = obj;
    return { ...rest, method: foundMethod, path };
  }

  // set-only step: no HTTP method required
  if (obj.set && !obj.method) {
    return { ...obj, method: "GET", path: "" };
  }

  return raw;
}

const ASSERTION_KEYS = new Set([
  "capture", "type", "equals", "not_equals", "contains", "not_contains",
  "matches", "gt", "lt", "gte", "lte", "exists",
  "length", "length_gt", "length_gte", "length_lt", "length_lte",
  "each", "contains_item", "set_equals",
]);

/**
 * Recursively flattens nested body assertion objects into dot-notation keys.
 * e.g. { category: { name: { equals: "Dogs" } } } → { "category.name": { equals: "Dogs" } }
 * Leaves assertion-level objects untouched (objects where all keys are ASSERTION_KEYS).
 * Also skips the special `_body` key prefix.
 */
export function flattenBodyAssertions(body: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  function walk(obj: Record<string, unknown>, prefix: string) {
    for (const [key, value] of Object.entries(obj)) {
      const fullKey = prefix ? `${prefix}.${key}` : key;

      if (
        typeof value === "object" && value !== null && !Array.isArray(value) &&
        !fullKey.startsWith("_body")
      ) {
        const objKeys = Object.keys(value as Record<string, unknown>);
        const isAssertionRule = objKeys.length > 0 && objKeys.every(k => ASSERTION_KEYS.has(k));

        if (isAssertionRule) {
          result[fullKey] = value;
        } else {
          walk(value as Record<string, unknown>, fullKey);
        }
      } else {
        result[fullKey] = value;
      }
    }
  }

  walk(body, "");
  return result;
}

const AssertionRuleSchemaInner: z.ZodType<AssertionRule> = z.preprocess(
  (val) => {
    if (typeof val === "string") return { type: val };
    if (val === null || val === undefined) return { exists: true };
    if (typeof val === "object" && val !== null) {
      const obj = val as Record<string, unknown>;
      // Coerce exists: "true"/"false" → boolean
      if (typeof obj.exists === "string") {
        obj.exists = obj.exists === "true";
      }
      return obj;
    }
    return val;
  },
  z.object({
    capture: z.string().optional(),
    type: z.enum(["string", "integer", "number", "boolean", "array", "object", "null"]).optional(),
    equals: z.unknown().optional(),
    not_equals: z.unknown().optional(),
    contains: z.string().optional(),
    not_contains: z.string().optional(),
    matches: z.string().optional(),
    gt: z.number().optional(),
    lt: z.number().optional(),
    gte: z.number().optional(),
    lte: z.number().optional(),
    exists: z.boolean().optional(),
    length: z.number().int().optional(),
    length_gt: z.number().int().optional(),
    length_gte: z.number().int().optional(),
    length_lt: z.number().int().optional(),
    length_lte: z.number().int().optional(),
    each: z.record(z.string(), z.lazy(() => AssertionRuleSchemaInner)).optional(),
    contains_item: z.record(z.string(), z.lazy(() => AssertionRuleSchemaInner)).optional(),
    set_equals: z.unknown().optional(),
  }),
) as z.ZodType<AssertionRule>;

const AssertionRuleSchema = AssertionRuleSchemaInner;

const TestStepExpectSchema: z.ZodType<TestStepExpect> = z.preprocess(
  (val) => {
    if (typeof val !== "object" || val === null) return val;
    const obj = val as Record<string, unknown>;
    // body: null → remove it
    if (obj.body === null) {
      const { body: _, ...rest } = obj;
      return rest;
    }
    // Flatten nested body assertions into dot-notation
    if (obj.body && typeof obj.body === "object" && !Array.isArray(obj.body)) {
      obj.body = flattenBodyAssertions(obj.body as Record<string, unknown>);
    }
    return obj;
  },
  z.object({
    status: z.union([z.number().int(), z.array(z.number().int())]).optional(),
    body: z.record(z.string(), AssertionRuleSchema).optional(),
    headers: z.record(z.string(), z.union([z.string(), AssertionRuleSchema])).optional(),
    duration: z.number().optional(),
  }),
) as z.ZodType<TestStepExpect>;

const RetryUntilSchema: z.ZodType<RetryUntil> = z.object({
  condition: z.string(),
  max_attempts: z.number().int().positive(),
  delay_ms: z.number().int().nonnegative(),
});

const ForEachSchema: z.ZodType<ForEach> = z.object({
  var: z.string(),
  in: z.unknown(),
});

const MultipartFileFieldSchema = z.object({
  file: z.string(),
  filename: z.string().optional(),
  content_type: z.string().optional(),
});

const MultipartFieldSchema: z.ZodType<MultipartField> = z.union([z.string(), MultipartFileFieldSchema]);

const TestStepSchema: z.ZodType<TestStep> = z.preprocess(
  (raw) => {
    const obj = extractMethodAndPath(raw);
    // Make expect optional for set-only steps
    if (typeof obj === "object" && obj !== null) {
      const o = obj as Record<string, unknown>;
      if (o.set && !o.expect) {
        o.expect = {};
      }
    }
    return obj;
  },
  z.object({
    name: z.string(),
    method: z.enum(HTTP_METHODS),
    path: z.string(),
    headers: z.record(z.string(), z.string()).optional(),
    json: z.unknown().optional(),
    form: z.record(z.string(), z.string()).optional(),
    multipart: z.record(z.string(), MultipartFieldSchema).optional(),
    query: z.record(z.string(), z.string()).optional(),
    expect: TestStepExpectSchema,
    skip_if: z.string().optional(),
    retry_until: RetryUntilSchema.optional(),
    for_each: ForEachSchema.optional(),
    set: z.record(z.string(), z.unknown()).optional(),
    always: z.boolean().optional(),
  }),
) as z.ZodType<TestStep>;

export const DEFAULT_CONFIG: SuiteConfig = {
  timeout: 30000,
  retries: 0,
  retry_delay: 1000,
  follow_redirects: true,
  verify_ssl: true,
};

const SuiteConfigSchema = z.preprocess(
  (val) => ({ ...DEFAULT_CONFIG, ...(typeof val === "object" && val !== null ? val : {}) }),
  z.object({
    timeout: z.number(),
    retries: z.number(),
    retry_delay: z.number(),
    follow_redirects: z.boolean(),
    verify_ssl: z.boolean(),
  }),
) as z.ZodType<SuiteConfig>;

const TestSuiteSchema = z.preprocess(
  (val) => {
    if (typeof val === "object" && val !== null && !("config" in val)) {
      return { ...val, config: DEFAULT_CONFIG };
    }
    return val;
  },
  z.object({
    name: z.string(),
    description: z.string().optional(),
    setup: z.boolean().optional(),
    tags: z.array(z.string()).optional(),
    base_url: z.string().optional(),
    headers: z.record(z.string(), z.string()).optional(),
    parameterize: z.record(z.string(), z.array(z.unknown()).min(1)).optional(),
    config: SuiteConfigSchema,
    tests: z.array(TestStepSchema).min(1),
  }),
);

export function validateSuite(raw: unknown): TestSuite {
  return TestSuiteSchema.parse(raw) as TestSuite;
}

export { TestSuiteSchema, TestStepSchema, AssertionRuleSchema, ASSERTION_KEYS };
