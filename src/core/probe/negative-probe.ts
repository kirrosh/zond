/**
 * Negative-input probe generator (T49).
 *
 * Goal: catch the class of bugs where an API returns 5xx (unhandled exception)
 * instead of 4xx (validation error) when given malformed input. The contract
 * is simple: any client-supplied invalid input MUST produce a 4xx, never a 5xx.
 *
 * For each endpoint we generate a suite of probe steps. Each step expects a
 * "no 5xx" response (status in [400, 401, 403, 404, 405, 409, 415, 422]).
 * If the API returns 500/502/503 — the test fails and the runner logs it as
 * a bug candidate via the regular reporter / `zond db diagnose` flow.
 *
 * The probes are deterministic — same spec → same suites — so the generated
 * YAML can be committed as a regression test.
 */
import type { OpenAPIV3 } from "openapi-types";
import type { EndpointInfo, SecuritySchemeInfo } from "../generator/types.ts";
import type { RawSuite, RawStep } from "../generator/serializer.ts";
import { generateFromSchema } from "../generator/data-factory.ts";

// ──────────────────────────────────────────────
// Constants
// ──────────────────────────────────────────────

/** Statuses we consider an *acceptable* response to invalid input. Anything
 *  outside this set (notably 5xx, but also 200/201 which would mean the API
 *  silently accepted the bad input) is a probe failure. */
const ACCEPTABLE_4XX = [400, 401, 403, 404, 405, 409, 415, 422];

/** Long string for boundary probes — 10_000 chars. */
const LONG_STRING = "a".repeat(10_000);

/** Mixed unicode + emoji + RTL for charset probes. */
const UNICODE_MIX = "Mix🌐مرحبا\u200B";

/** Sentinel non-UUID inputs for path/UUID probes. */
const INVALID_UUID_VALUES = [
  "not-a-uuid",
  "12345",
  "00000000",
  "../../etc/passwd",
];

/** Sentinel invalid emails. */
const INVALID_EMAIL_VALUES = [
  "not-an-email",
  "@no-local.example.com",
  "spaces in@email.com",
];

/** Sentinel invalid URIs. */
const INVALID_URI_VALUES = [
  "not a url",
  "javascript:alert(1)",
  "ftp:/missing-slash",
];

/** Sentinel invalid date-time strings. */
const INVALID_DATETIME_VALUES = [
  "yesterday",
  "2023-13-45T99:99:99Z",
  "2023-10-06:23:47:56.678Z", // colon-instead-of-T (real bug we caught)
];

// ──────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────

export interface ProbeOptions {
  endpoints: EndpointInfo[];
  securitySchemes: SecuritySchemeInfo[];
  /** Cap probes per endpoint (default 50). Hard cutoff for huge schemas. */
  maxProbesPerEndpoint?: number;
}

export interface ProbeResult {
  suites: RawSuite[];
  /** Number of endpoints that received probes. */
  probedEndpoints: number;
  /** Endpoints we skipped (no body & no UUID path params). */
  skippedEndpoints: number;
  /** Total generated probe steps. */
  totalProbes: number;
}

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

function convertPath(path: string): string {
  return path.replace(/\{([^}]+)\}/g, "{{$1}}");
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function endpointStem(ep: EndpointInfo): string {
  const path = ep.path
    .replace(/\{[^}]+\}/g, "by-id")
    .replace(/^\//, "")
    .replace(/\//g, "-");
  return slugify(`${ep.method.toLowerCase()}-${path}`);
}

function getAuthHeaders(
  ep: EndpointInfo,
  schemes: SecuritySchemeInfo[],
): Record<string, string> | undefined {
  if (ep.security.length === 0) return undefined;
  for (const secName of ep.security) {
    const scheme = schemes.find((s) => s.name === secName);
    if (!scheme) continue;
    if (scheme.type === "http") {
      if (scheme.scheme === "bearer" || !scheme.scheme) {
        return { Authorization: "Bearer {{auth_token}}" };
      }
      if (scheme.scheme === "basic") {
        return { Authorization: "Basic {{auth_token}}" };
      }
    }
    if (scheme.type === "apiKey" && scheme.in === "header" && scheme.apiKeyName) {
      if (scheme.apiKeyName === "Authorization") {
        return { Authorization: "Bearer {{auth_token}}" };
      }
      return { [scheme.apiKeyName]: "{{api_key}}" };
    }
  }
  return undefined;
}

/** Path with placeholders replaced by valid-but-nonexistent IDs (for body probes
 *  on PUT/PATCH/DELETE — we don't want path validation to mask body errors). */
function pathWithPlaceholders(ep: EndpointInfo, badId: string): string {
  return ep.path.replace(/\{([^}]+)\}/g, (_, name: string) => {
    const param = ep.parameters.find((p) => p.name === name && p.in === "path");
    const schema = param?.schema as OpenAPIV3.SchemaObject | undefined;
    if (badId === "valid-shape") {
      if (schema?.format === "uuid") return "00000000-0000-0000-0000-000000000000";
      if (schema?.type === "integer" || schema?.type === "number") return "999999999";
      return "nonexistent-zzzzz";
    }
    return badId;
  });
}

function findUuidPathParams(ep: EndpointInfo): OpenAPIV3.ParameterObject[] {
  return ep.parameters.filter((p) => {
    if (p.in !== "path") return false;
    const schema = p.schema as OpenAPIV3.SchemaObject | undefined;
    if (!schema) return false;
    if (schema.format === "uuid") return true;
    // also probe path params named like *_id / *_uuid
    const lower = p.name.toLowerCase();
    return lower === "id" || lower.endsWith("_id") || lower === "uuid";
  });
}

/** Walk schema and collect required-field paths up to depth 1 with their schema. */
function collectRequiredFields(
  schema: OpenAPIV3.SchemaObject | undefined,
): Array<{ name: string; schema: OpenAPIV3.SchemaObject }> {
  if (!schema || !schema.properties) return [];
  const required = new Set(schema.required ?? []);
  const out: Array<{ name: string; schema: OpenAPIV3.SchemaObject }> = [];
  for (const [name, propSchema] of Object.entries(schema.properties)) {
    if (required.has(name)) {
      out.push({ name, schema: propSchema as OpenAPIV3.SchemaObject });
    }
  }
  return out;
}

/** Walk schema (depth 1) and collect all properties with their schema. */
function collectAllProps(
  schema: OpenAPIV3.SchemaObject | undefined,
): Array<{ name: string; schema: OpenAPIV3.SchemaObject; required: boolean }> {
  if (!schema || !schema.properties) return [];
  const required = new Set(schema.required ?? []);
  return Object.entries(schema.properties).map(([name, s]) => ({
    name,
    schema: s as OpenAPIV3.SchemaObject,
    required: required.has(name),
  }));
}

// ──────────────────────────────────────────────
// Probe generators
// ──────────────────────────────────────────────

/**
 * Build a step that targets `endpoint`, but with an arbitrary body override.
 * Authentication and required path params are populated with valid placeholders
 * so the request reaches the body-validation layer.
 */
function buildStep(
  ep: EndpointInfo,
  schemes: SecuritySchemeInfo[],
  opts: {
    name: string;
    json?: unknown;
    pathOverride?: string;
    expectStatusOk?: number[];
  },
): RawStep {
  const method = ep.method.toUpperCase();
  const path = opts.pathOverride ?? pathWithPlaceholders(ep, "valid-shape");
  const headers = getAuthHeaders(ep, schemes);

  const step: RawStep = {
    name: opts.name,
    [method]: convertPath(path),
    expect: {
      status: opts.expectStatusOk ?? ACCEPTABLE_4XX,
    },
  };
  if (headers) step.headers = headers;
  if (opts.json !== undefined) (step as any).json = opts.json;
  return step;
}

function probeEmptyBody(ep: EndpointInfo, schemes: SecuritySchemeInfo[]): RawStep | null {
  if (!hasJsonBody(ep)) return null;
  const required = collectRequiredFields(ep.requestBodySchema);
  // Only meaningful when there *is* required data — otherwise {} is valid.
  if (required.length === 0) return null;
  return buildStep(ep, schemes, {
    name: "empty body — must reject (no 5xx)",
    json: {},
  });
}

function probeMissingRequired(
  ep: EndpointInfo,
  schemes: SecuritySchemeInfo[],
  budget: number,
): RawStep[] {
  if (!hasJsonBody(ep) || !ep.requestBodySchema) return [];
  const required = collectRequiredFields(ep.requestBodySchema);
  if (required.length === 0) return [];

  // Build a baseline valid object, then drop one required field at a time.
  const baseline = generateFromSchema(ep.requestBodySchema) as Record<string, unknown>;
  if (typeof baseline !== "object" || baseline === null) return [];

  const out: RawStep[] = [];
  for (const field of required) {
    if (out.length >= budget) break;
    const variant = { ...baseline };
    delete variant[field.name];
    out.push(
      buildStep(ep, schemes, {
        name: `missing required field "${field.name}" — must reject (no 5xx)`,
        json: variant,
      }),
    );
  }
  return out;
}

function probeBoundaryString(
  ep: EndpointInfo,
  schemes: SecuritySchemeInfo[],
  budget: number,
): RawStep[] {
  if (!hasJsonBody(ep) || !ep.requestBodySchema) return [];
  const props = collectAllProps(ep.requestBodySchema).filter(
    (p) => p.schema.type === "string",
  );
  if (props.length === 0) return [];

  const baseline = generateFromSchema(ep.requestBodySchema) as Record<string, unknown>;
  if (typeof baseline !== "object" || baseline === null) return [];

  const out: RawStep[] = [];
  // Only probe the first N string fields to stay within budget
  for (const field of props.slice(0, Math.max(1, Math.floor(budget / 3)))) {
    if (out.length + 3 > budget) break;
    out.push(
      buildStep(ep, schemes, {
        name: `${field.name}: empty string — must reject (no 5xx)`,
        json: { ...baseline, [field.name]: "" },
      }),
      buildStep(ep, schemes, {
        name: `${field.name}: 10000-char string — must reject or accept (no 5xx)`,
        json: { ...baseline, [field.name]: LONG_STRING },
      }),
      buildStep(ep, schemes, {
        name: `${field.name}: unicode/emoji/RTL — must not 5xx`,
        json: { ...baseline, [field.name]: UNICODE_MIX },
      }),
    );
  }
  return out;
}

function probeTypeConfusion(
  ep: EndpointInfo,
  schemes: SecuritySchemeInfo[],
  budget: number,
): RawStep[] {
  if (!hasJsonBody(ep) || !ep.requestBodySchema) return [];
  const props = collectAllProps(ep.requestBodySchema);
  if (props.length === 0) return [];

  const baseline = generateFromSchema(ep.requestBodySchema) as Record<string, unknown>;
  if (typeof baseline !== "object" || baseline === null) return [];

  const out: RawStep[] = [];
  for (const field of props) {
    if (out.length >= budget) break;
    const wrongValue = pickWrongType(field.schema);
    if (wrongValue === undefined) continue;
    out.push(
      buildStep(ep, schemes, {
        name: `${field.name}: wrong type (${describeType(field.schema)} → ${typeof wrongValue}) — must reject (no 5xx)`,
        json: { ...baseline, [field.name]: wrongValue },
      }),
    );
  }
  return out;
}

function probeInvalidFormat(
  ep: EndpointInfo,
  schemes: SecuritySchemeInfo[],
  budget: number,
): RawStep[] {
  if (!hasJsonBody(ep) || !ep.requestBodySchema) return [];
  const props = collectAllProps(ep.requestBodySchema);
  const baseline = generateFromSchema(ep.requestBodySchema) as Record<string, unknown>;
  if (typeof baseline !== "object" || baseline === null) return [];

  const out: RawStep[] = [];
  for (const field of props) {
    if (out.length >= budget) break;
    const fmt = field.schema.format;
    let badValue: string | undefined;
    if (fmt === "email") badValue = INVALID_EMAIL_VALUES[0];
    else if (fmt === "uri" || fmt === "url") badValue = INVALID_URI_VALUES[0];
    else if (fmt === "date-time") badValue = INVALID_DATETIME_VALUES[0];
    else if (fmt === "uuid") badValue = INVALID_UUID_VALUES[0];
    if (badValue === undefined) continue;
    out.push(
      buildStep(ep, schemes, {
        name: `${field.name}: invalid ${fmt} (${JSON.stringify(badValue)}) — must reject (no 5xx)`,
        json: { ...baseline, [field.name]: badValue },
      }),
    );
  }
  return out;
}

function probeInvalidEnum(
  ep: EndpointInfo,
  schemes: SecuritySchemeInfo[],
  budget: number,
): RawStep[] {
  if (!hasJsonBody(ep) || !ep.requestBodySchema) return [];
  const baseline = generateFromSchema(ep.requestBodySchema) as Record<string, unknown>;
  if (typeof baseline !== "object" || baseline === null) return [];

  const out: RawStep[] = [];
  // Walk depth 1 for plain enum strings
  for (const field of collectAllProps(ep.requestBodySchema)) {
    if (out.length >= budget) break;
    if (Array.isArray(field.schema.enum) && field.schema.enum.length > 0) {
      out.push(
        buildStep(ep, schemes, {
          name: `${field.name}: unknown enum value "zond_invalid_value" — must reject (no 5xx)`,
          json: { ...baseline, [field.name]: "zond_invalid_value" },
        }),
      );
    }
    // enum-of-strings inside an array (e.g. webhooks.events: [enum])
    if (field.schema.type === "array" && field.schema.items) {
      const items = field.schema.items as OpenAPIV3.SchemaObject;
      const enumLike = Array.isArray(items.enum) && items.enum.length > 0;
      const isStringArray = items.type === "string";
      if (enumLike || isStringArray) {
        // even when no enum is declared, names like "events"/"types"/"channels"
        // strongly imply a backing whitelist — bug #05B
        out.push(
          buildStep(ep, schemes, {
            name: `${field.name}: array with unknown value ["zond.nonexistent.event"] — must reject (no 5xx)`,
            json: { ...baseline, [field.name]: ["zond.nonexistent.event"] },
          }),
        );
      }
    }
  }
  return out;
}

function probeInvalidPathId(
  ep: EndpointInfo,
  schemes: SecuritySchemeInfo[],
  budget: number,
): RawStep[] {
  const params = findUuidPathParams(ep);
  if (params.length === 0) return [];
  // Skip POST /resource (no path id) — covered by body probes
  const out: RawStep[] = [];
  for (const param of params) {
    for (const bad of INVALID_UUID_VALUES) {
      if (out.length >= budget) break;
      const path = ep.path.replace(/\{([^}]+)\}/g, (_, name: string) => {
        if (name === param.name) return bad;
        const other = ep.parameters.find((p) => p.name === name && p.in === "path");
        const schema = other?.schema as OpenAPIV3.SchemaObject | undefined;
        if (schema?.format === "uuid") return "00000000-0000-0000-0000-000000000000";
        if (schema?.type === "integer" || schema?.type === "number") return "999999999";
        return "nonexistent-zzzzz";
      });
      out.push(
        buildStep(ep, schemes, {
          name: `path param ${param.name}=${JSON.stringify(bad)} — must reject (no 5xx)`,
          pathOverride: path,
        }),
      );
    }
  }
  return out;
}

// ──────────────────────────────────────────────
// Type-confusion helpers
// ──────────────────────────────────────────────

function pickWrongType(schema: OpenAPIV3.SchemaObject): unknown | undefined {
  switch (schema.type) {
    case "string":
      return 12345; // number where string expected
    case "integer":
    case "number":
      return "five"; // string where number expected
    case "boolean":
      return "true"; // string where boolean expected
    case "array":
      return { not: "an-array" }; // object where array expected
    case "object":
      return ["not", "an", "object"]; // array where object expected
    default:
      return undefined;
  }
}

function describeType(schema: OpenAPIV3.SchemaObject): string {
  if (schema.format) return `${schema.type ?? "any"}/${schema.format}`;
  return schema.type ?? "any";
}

function hasJsonBody(ep: EndpointInfo): boolean {
  return (
    ep.method !== "GET" &&
    ep.method !== "DELETE" &&
    ep.requestBodyContentType === "application/json" &&
    ep.requestBodySchema !== undefined
  );
}

function headersEqual(a: Record<string, string>, b: Record<string, string>): boolean {
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  for (const k of ka) if (a[k] !== b[k]) return false;
  return true;
}

// ──────────────────────────────────────────────
// Public API
// ──────────────────────────────────────────────

export function generateNegativeProbes(opts: ProbeOptions): ProbeResult {
  const { endpoints, securitySchemes } = opts;
  const cap = opts.maxProbesPerEndpoint ?? 50;

  const suites: RawSuite[] = [];
  let probedEndpoints = 0;
  let skippedEndpoints = 0;
  let totalProbes = 0;

  for (const ep of endpoints) {
    if (ep.deprecated) continue;

    const steps: RawStep[] = [];
    const remaining = () => Math.max(0, cap - steps.length);

    // 1. Path-id probes (cheap, deterministic)
    steps.push(...probeInvalidPathId(ep, securitySchemes, remaining()));

    // 2. Body probes (only for body-bearing methods)
    const empty = probeEmptyBody(ep, securitySchemes);
    if (empty && steps.length < cap) steps.push(empty);

    steps.push(...probeMissingRequired(ep, securitySchemes, remaining()));
    steps.push(...probeTypeConfusion(ep, securitySchemes, remaining()));
    steps.push(...probeInvalidFormat(ep, securitySchemes, remaining()));
    steps.push(...probeBoundaryString(ep, securitySchemes, remaining()));
    steps.push(...probeInvalidEnum(ep, securitySchemes, remaining()));

    if (steps.length === 0) {
      skippedEndpoints++;
      continue;
    }

    probedEndpoints++;
    totalProbes += steps.length;

    // Hoist auth headers to suite level — every probe in this suite hits the
    // same endpoint, so per-step headers are pure duplication. Dropping them
    // here keeps generated YAML small and makes suite-level overrides
    // (e.g. switching auth tokens) work as expected.
    const suiteHeaders = getAuthHeaders(ep, securitySchemes);
    if (suiteHeaders) {
      for (const step of steps) {
        if (step.headers && headersEqual(step.headers as Record<string, string>, suiteHeaders)) {
          delete (step as { headers?: unknown }).headers;
        }
      }
    }

    const stem = endpointStem(ep);
    const suite: RawSuite = {
      name: `probe ${ep.method} ${ep.path}`,
      tags: ["probe-validation", "negative-input", "no-5xx"],
      fileStem: `probe-${stem}`,
      base_url: "{{base_url}}",
      ...(suiteHeaders ? { headers: suiteHeaders } : {}),
      tests: steps,
    };
    suites.push(suite);
  }

  return { suites, probedEndpoints, skippedEndpoints, totalProbes };
}
