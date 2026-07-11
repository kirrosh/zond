import { z } from "zod";
import type { TestSuite, TestStep, AssertionRule, TestStepExpect, SuiteConfig, RetryUntil, ForEach, MultipartField, SourceMetadata } from "./types.ts";

// ARV-223 (R16/F28): include OPTIONS / HEAD / TRACE so probe-method generated
// suites (which emit one step per missing-method per path) parse and run.
// Without this, `zond probe static --emit-tests → zond run` breaks end-to-end
// on every API where these methods aren't already declared (= almost always).
const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD", "TRACE"] as const;

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
    // Reject `expect.capture: {...}` — non-canonical syntax some users
    // reach for. zond captures live INSIDE body-rules
    // (`body: { "path.to.field": { capture: var_name } }`); a top-level
    // `capture:` block inside `expect:` is silently dropped, leaving the
    // test green with no captured values. Throw with a clear pointer.
    // (TASK-247)
    if ("capture" in obj && typeof obj.capture === "object" && obj.capture !== null && !Array.isArray(obj.capture)) {
      throw new Error(
        `'expect.capture: {...}' is not a valid step shape. Captures are defined per-field: ` +
        `\`expect.body: { "<path>": { capture: <var_name> } }\`. ` +
        `Top-level 'capture' inside 'expect' is silently ignored — the test would pass with no captured values.`,
      );
    }
    // expect.status: spot-message for common wrong shapes.
    // Schema accepts `number | number[]`. Users reaching from other tools often
    // write `oneOf: [...]`, `any: [...]`, a string `"200"`, or an array
    // containing strings. The raw zod-issue path (`tests.N.expect.status.0`)
    // is hard to read — surface a single-line hint here. (TASK-249, feedback-13#F1)
    if ("status" in obj && obj.status !== undefined && obj.status !== null) {
      const s = obj.status;
      const STATUS_HINT =
        "expect.status: use a number (200), an array of numbers ([200, 404]), or omit. " +
        "oneOf/any/anyOf are not supported.";
      if (typeof s === "object" && !Array.isArray(s)) {
        const keys = Object.keys(s as Record<string, unknown>);
        const wrong = keys.find((k) => ["oneOf", "anyOf", "any", "in", "one_of"].includes(k));
        if (wrong) {
          throw new Error(`'expect.status' got '${wrong}: [...]' — ${STATUS_HINT}`);
        }
        throw new Error(`'expect.status' got an object — ${STATUS_HINT}`);
      }
      if (typeof s === "string") {
        throw new Error(`'expect.status' got string "${s}" — ${STATUS_HINT}`);
      }
      if (Array.isArray(s) && s.some((v) => typeof v !== "number")) {
        throw new Error(`'expect.status' array must contain only numbers — ${STATUS_HINT}`);
      }
    }
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

// form:/query: scalar — string on the wire, but accept number/boolean and coerce.
const FormScalarSchema = z.union([z.string(), z.number(), z.boolean()]).transform((v) => String(v));

// Provenance metadata: passthrough — все поля optional, неизвестные пропускаем без warning
const SourceMetadataSchema: z.ZodType<SourceMetadata> = z.object({
  type: z.enum(["openapi-generated", "manual", "probe-suite"]).optional(),
  spec: z.string().optional(),
  generator: z.string().optional(),
  generated_at: z.string().optional(),
  endpoint: z.string().optional(),
  response_branch: z.string().optional(),
  schema_pointer: z.string().optional(),
}).passthrough() as z.ZodType<SourceMetadata>;

const KNOWN_STEP_KEYS = new Set([
  "name", "source", "method", "path", "headers",
  "json", "form", "multipart", "query", "expect",
  "skip_if", "retry_until", "for_each", "set", "always",
  // raw HTTP method keys are folded into method/path by extractMethodAndPath
  ...HTTP_METHODS,
]);

// Common typo / wrong-name body keys we detect explicitly to emit an
// actionable error instead of silently dropping. Real APIs reject the empty
// POST that follows, but the user spends 10+ minutes debugging — this hint
// turns it into a one-line fix. (TASK-244)
const BODY_KEY_HINTS: Record<string, string> = {
  body: "json (for application/json), form (urlencoded), or multipart (file upload)",
  data: "json (for application/json) or form (urlencoded)",
  payload: "json",
  // TASK-257: previous hint pointed only at `form:` which is x-www-form-urlencoded
  // and useless for file uploads. Surface `multipart:` explicitly so users with
  // file-upload endpoints (file-upload endpoints, etc.) find it.
  raw: "json for raw JSON, multipart: { field: { file: <path> } } for file upload, or form for urlencoded — raw bodies are not parsed",
};

const TestStepSchema: z.ZodType<TestStep> = z.preprocess(
  (raw) => {
    const obj = extractMethodAndPath(raw);
    if (typeof obj === "object" && obj !== null) {
      const o = obj as Record<string, unknown>;

      // Reject silently-dropped body-shaped keys with a clear suggestion.
      for (const [bad, hint] of Object.entries(BODY_KEY_HINTS)) {
        if (bad in o) {
          const stepName = typeof o.name === "string" ? ` in step "${o.name}"` : "";
          throw new Error(
            `Unknown step key '${bad}'${stepName}. Did you mean '${hint}'? ` +
            `(zond does not recognize '${bad}:' and would silently drop the body)`,
          );
        }
      }

      // Make expect optional for set-only steps
      if (o.set && !o.expect) {
        o.expect = {};
      }
    }
    return obj;
  },
  z.object({
    name: z.string(),
    source: SourceMetadataSchema.optional(),
    method: z.enum(HTTP_METHODS),
    path: z.string(),
    headers: z.record(z.string(), z.string()).optional(),
    json: z.unknown().optional(),
    // form/query values are strings on the wire; accept numbers/booleans and
    // coerce so `amount: 1500` doesn't parse-error (encodeFormBody already
    // String()s them at runtime). Keeps the output type Record<string,string>.
    form: z.record(z.string(), FormScalarSchema).optional(),
    multipart: z.record(z.string(), MultipartFieldSchema).optional(),
    query: z.record(z.string(), FormScalarSchema).optional(),
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
    source: SourceMetadataSchema.optional(),
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

/** Render a zod path array (`["tests", 0, "expect", "status"]`) as
 * `tests[0].expect.status`. Numeric segments become bracket-indices, string
 * segments dot-join. */
function pathToHuman(path: ReadonlyArray<string | number>): string {
  let out = "";
  for (const seg of path) {
    if (typeof seg === "number") out += `[${seg}]`;
    else out += out ? `.${seg}` : seg;
  }
  return out || "(root)";
}

/**
 * Format a {@link z.ZodError} as a compact, multi-line, human-readable list:
 *
 *   N validation issue(s):
 *     <path>: <message>
 *     ...
 *
 * The default `ZodError.message` is a JSON dump of the full issue list with
 * internal field names (`_def`, deeply numeric paths, "Invalid input" prefix).
 * The wrapper that callers used to surface ("Validation error in <file>:
 * [{...}]") was unreadable for tester users — they had to mentally parse the
 * stack to find the real path. (TASK-249)
 */
export function formatZodError(err: z.ZodError): string {
  const lines = err.issues.map((i) => {
    const path = pathToHuman(i.path as ReadonlyArray<string | number>);
    // zod v4 messages are already readable; strip the redundant "Invalid input: "
    // prefix that adds noise without info.
    const msg = i.message.replace(/^Invalid input:\s*/, "");
    return `  ${path}: ${msg}`;
  });
  const header = `${err.issues.length} validation issue${err.issues.length === 1 ? "" : "s"}:`;
  return `${header}\n${lines.join("\n")}`;
}

