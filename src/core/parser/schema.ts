import { z } from "zod";
import type { TestSuite, TestStep, AssertionRule, TestStepExpect, SuiteConfig } from "./types.ts";

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

  return raw;
}

const AssertionRuleSchema: z.ZodType<AssertionRule> = z.object({
  capture: z.string().optional(),
  type: z.enum(["string", "integer", "number", "boolean", "array", "object"]).optional(),
  equals: z.unknown().optional(),
  contains: z.string().optional(),
  matches: z.string().optional(),
  gt: z.number().optional(),
  lt: z.number().optional(),
  exists: z.boolean().optional(),
});

const TestStepExpectSchema: z.ZodType<TestStepExpect> = z.object({
  status: z.number().int().optional(),
  body: z.record(z.string(), AssertionRuleSchema).optional(),
  headers: z.record(z.string(), z.string()).optional(),
  duration: z.number().optional(),
});

const TestStepSchema: z.ZodType<TestStep> = z.preprocess(
  extractMethodAndPath,
  z.object({
    name: z.string(),
    method: z.enum(HTTP_METHODS),
    path: z.string(),
    headers: z.record(z.string(), z.string()).optional(),
    json: z.unknown().optional(),
    form: z.record(z.string(), z.string()).optional(),
    query: z.record(z.string(), z.string()).optional(),
    expect: TestStepExpectSchema,
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
    base_url: z.string().optional(),
    headers: z.record(z.string(), z.string()).optional(),
    config: SuiteConfigSchema,
    tests: z.array(TestStepSchema).min(1),
  }),
);

export function validateSuite(raw: unknown): TestSuite {
  return TestSuiteSchema.parse(raw) as TestSuite;
}

export { TestSuiteSchema, TestStepSchema, AssertionRuleSchema };
