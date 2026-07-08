import type { OpenAPIV3 } from "openapi-types";
import type { EndpointInfo, SecuritySchemeInfo, CrudGroup } from "./types.ts";
import type { RawSuite, RawStep } from "./serializer.ts";
import type { SourceMetadata } from "../parser/types.ts";
import { generateFromSchema, generateMultipartFromSchema, isFkFixtureField, canonicalVarName, effectiveObjectShape } from "./data-factory.ts";
import { groupEndpointsByTag } from "./chunker.ts";
import { getAuthHeaders as sharedGetAuthHeaders } from "../probe/shared.ts";
import { flattenToFormFields } from "../runner/form-encode.ts";

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

/**
 * Singularize an English plural noun for use in suite names and capture
 * variables. Handles the cases that matter for typical OpenAPI resource
 * names — `properties → property`, `addresses → address`, `boxes → box`,
 * `users → user`. Words that don't match any rule are returned unchanged
 * (so already-singular `series`, `news`, `data`, etc. survive).
 */
export function singularizeResource(word: string): string {
  if (word.length > 3 && /ies$/i.test(word)) return word.slice(0, -3) + "y";
  // ARV-100 (F5): the inner alternative was `s` — but a single trailing `s`
  // catches every regular plural whose stem ends in any vowel + `s` (e.g.
  // `releases`, `phases`, `houses`), and `slice(-2)` then chops "es" instead
  // of just "s". The result was `releas_id` / `phas_id` capture vars that
  // matched nothing on the manifest side. Restrict the rule to the genuine
  // sibilant double — `ss` — so `addresses → address` keeps working without
  // dragging single-s plurals along.
  if (word.length > 3 && /(ch|sh|x|ss|z)es$/i.test(word)) return word.slice(0, -2);
  if (word.length > 1 && /[^s]s$/i.test(word)) return word.slice(0, -1);
  return word;
}

/**
 * Build a `<resource>_id` capture/var name. Strips dashes so the result is
 * a safe template variable identifier — `contact-properties` becomes
 * `contact_property_id` rather than `contact-propertie_id` (TASK-214).
 *
 * ARV-100 (F5): always lowercase. Path-params/headers in fixtures-builder
 * are normalised to lowercase (line 157), so capture vars must match — a
 * `Groups` resource would otherwise produce `Group_id` while path-params on
 * the same endpoint produce `group_id`, splitting the `{{var}}` namespace
 * and triggering "Undefined variables" in `zond run`.
 */
export function resourceVar(resource: string, suffix: string): string {
  const singular = singularizeResource(resource);
  return `${singular.replace(/[^a-zA-Z0-9]+/g, "_")}_${suffix}`.toLowerCase();
}

/** Convert OpenAPI path params {param} to test interpolation {{param}} */
function convertPath(path: string): string {
  return path.replace(/\{([^}]+)\}/g, "{{$1}}");
}

/**
 * Convert path params to seed values for smoke suites (no capture context).
 * Uses the parameter's example/default from the spec, or falls back to
 * {{placeholder}} form so the user fills them in via .env.yaml.
 */
function convertPathWithSeeds(path: string, ep: EndpointInfo): string {
  return path.replace(/\{([^}]+)\}/g, (_, name: string) => {
    const param = ep.parameters.find(p => p.name === name && p.in === "path");
    const schema = param?.schema as OpenAPIV3.SchemaObject | undefined;
    const example = (param as any)?.example ?? schema?.example ?? schema?.default;
    if (example !== undefined) return String(example);
    return `{{${name}}}`;
  });
}

/**
 * For negative-smoke suites: replace path params with guaranteed-non-existent values.
 * Picks a value that's syntactically valid for the param's type/format but very
 * unlikely to match a real resource (zero-UUID, very large int, sentinel string).
 */
function getNonexistentSeed(schema: OpenAPIV3.SchemaObject | undefined): string {
  if (!schema) return "nonexistent_id_zzzzzz";
  if (schema.format === "uuid") return "00000000-0000-0000-0000-000000000000";
  if (schema.type === "integer" || schema.type === "number") return "999999999";
  return "nonexistent_id_zzzzzz";
}

function convertPathWithBadIds(path: string, ep: EndpointInfo): string {
  return path.replace(/\{([^}]+)\}/g, (_, name: string) => {
    const param = ep.parameters.find(p => p.name === name && p.in === "path");
    const schema = param?.schema as OpenAPIV3.SchemaObject | undefined;
    return getNonexistentSeed(schema);
  });
}

function endpointHasPathParams(ep: EndpointInfo): boolean {
  return ep.parameters.some(p => p.in === "path");
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const HEALTHCHECK_PATH_RE = /\/(health|healthz|ping|status|ready|readiness|liveness|alive)\b/i;
const RESET_PATH_RE = /\/(reset|flush|purge|truncate|wipe|clear-data|factory-reset)\b/i;
const LOGOUT_PATH_RE = /\/(logout|signout|invalidate|revoke)\b/i;
const SHORT_PATH_RE = /^\/[a-z0-9-]*$/i; // matches /, /api, /v1, etc.

function selectHealthcheckEndpoint(gets: EndpointInfo[]): EndpointInfo | undefined {
  return (
    gets.find(ep => HEALTHCHECK_PATH_RE.test(ep.path) && !ep.parameters.some(p => p.in === "path")) ??
    gets.find(ep => SHORT_PATH_RE.test(ep.path) && !ep.parameters.some(p => p.in === "path") && ep.security.length === 0) ??
    gets.find(ep => !ep.parameters.some(p => p.in === "path") && ep.security.length === 0)
  );
}

/**
 * Pick the success status the test should assert.
 *
 * Order:
 *   1. First 2xx declared in the spec (most authoritative).
 *   2. Method-aware default when the spec lists only non-2xx responses or none
 *      at all (many OpenAPI specs is silent for several mutating endpoints — the
 *      actual runtime returns 201/204, while the old default of 200 caused
 *      tests to fail at runtime). We never assert a 4xx/5xx as the success
 *      status — that would generate guaranteed-failing tests.
 */
function getExpectedStatus(ep: EndpointInfo): number {
  const success = ep.responses.find(r => r.statusCode >= 200 && r.statusCode < 300);
  if (success) return success.statusCode;
  return defaultStatusByMethod(ep.method);
}

function defaultStatusByMethod(method: string): number {
  switch (method.toUpperCase()) {
    case "POST":
      return 201;
    case "DELETE":
      return 204;
    default:
      return 200;
  }
}

function getSuccessSchema(ep: EndpointInfo): OpenAPIV3.SchemaObject | undefined {
  return ep.responses.find(r => r.statusCode >= 200 && r.statusCode < 300)?.schema;
}

function getBodyAssertions(ep: EndpointInfo): Record<string, Record<string, string>> | undefined {
  const schema = getSuccessSchema(ep);
  if (!schema) return undefined;

  if (schema.type === "array") {
    return { _body: { type: "array" } };
  }

  if (schema.properties) {
    const assertions: Record<string, Record<string, string>> = {};
    const props = Object.keys(schema.properties).slice(0, 5);
    for (const prop of props) {
      assertions[prop] = { exists: "true" };
    }
    return Object.keys(assertions).length > 0 ? assertions : undefined;
  }

  return undefined;
}

/** Derive a variable name for a security scheme's token */
export function schemeVarName(scheme: SecuritySchemeInfo, allSchemes: SecuritySchemeInfo[]): string {
  // Count how many bearer-like schemes exist
  const bearerSchemes = allSchemes.filter(s =>
    (s.type === "http" && (s.scheme === "bearer" || !s.scheme)) ||
    (s.type === "apiKey" && s.in === "header" && s.apiKeyName === "Authorization")
  );
  // If only one bearer scheme → keep generic auth_token for backward compat
  if (bearerSchemes.length <= 1) return "auth_token";
  // Multiple → derive from scheme name (e.g. "platformAuth" → "platform_auth_token")
  const slug = scheme.name.replace(/([a-z])([A-Z])/g, "$1_$2").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/_token$|_auth$/, "");
  return `${slug}_token`;
}

function getAuthHeaders(
  ep: EndpointInfo,
  schemes: SecuritySchemeInfo[],
): Record<string, string> | undefined {
  return sharedGetAuthHeaders(ep, schemes, s => schemeVarName(s, schemes));
}

function getRequiredQueryParams(ep: EndpointInfo): Record<string, string> | undefined {
  const queryParams = ep.parameters.filter(p => p.in === "query" && p.required);
  if (queryParams.length === 0) return undefined;

  const query: Record<string, string> = {};
  for (const p of queryParams) {
    if (p.schema) {
      const val = generateFromSchema(p.schema as OpenAPIV3.SchemaObject, p.name);
      query[p.name] = typeof val === "object" ? JSON.stringify(val) : String(val);
    } else {
      query[p.name] = "{{$randomString}}";
    }
  }
  return query;
}

/** Check if all endpoints share the same auth headers → suite-level */
function getSuiteHeaders(
  endpoints: EndpointInfo[],
  schemes: SecuritySchemeInfo[],
): Record<string, string> | undefined {
  if (endpoints.length === 0) return undefined;

  const headerSets = endpoints.map(ep => getAuthHeaders(ep, schemes));
  const first = headerSets[0];
  if (!first) {
    // ARV-212 (R13/F16): spec has no securitySchemes (GitHub publishes its
    // OpenAPI this way) so per-endpoint auth-header derivation returns
    // undefined for every step. When the API workspace nonetheless wires
    // `auth_token` end-to-end (ARV-201 seeds it in .env.yaml on bare specs,
    // and zond request / runner auto-attach Authorization: Bearer when
    // auth_token is present), generated suites should not silently go
    // unauth — that bricks them on the first rate-limited 60 requests.
    // Fall back to a generic Bearer header at the suite level. The header
    // is harmless when .secrets.yaml.auth_token is empty (zond runner
    // still substitutes `{{auth_token}}` to an empty string, just like
    // before; the server then 401s — same outcome as today).
    if (schemes.length === 0 && _suiteDefaultAuthVar !== null) {
      return { Authorization: `Bearer {{${_suiteDefaultAuthVar}}}` };
    }
    return undefined;
  }

  const firstJson = JSON.stringify(first);
  const allSame = headerSets.every(h => JSON.stringify(h) === firstJson);
  return allSame ? first : undefined;
}

// ARV-212 (R13/F16): generator-level "the caller wired auth_token in
// .env.yaml even though the spec has no securitySchemes" hint. Set at the
// top of generateSuites and consulted by getSuiteHeaders / generateCrudSuite
// / generateSanitySuite. Module-scoped to avoid threading through ~7 call
// sites. Always reset to null at the end of generateSuites so the helper
// stays stateless from the caller's perspective.
let _suiteDefaultAuthVar: string | null = null;

/** Common id-like field names looked up after `id` itself.
 *  TASK-139: many real-world APIs return `slug`, `uuid`, `version`, `key`,
 *  or `name` instead of an `id` field on create responses. Without these,
 *  CRUD chains fall back to capturing `"id"` from a body that doesn't have
 *  one, breaking the `{id}` substitution in follow-up reads. */
const ID_LIKE_NAMES = ["slug", "uuid", "key", "version", "name"];

/** Find the best field to capture from POST response (for CRUD chains).
 *
 *  Priority:
 *    1. Field whose name matches the path-param (e.g. `{rule_id}` → `rule_id`
 *       or `{slug}` → `slug`). The path-param name is the strongest hint —
 *       whatever the response calls "the id of this resource" is what gets
 *       interpolated back into the read/update/delete URLs.
 *    2. `id` (most common case).
 *    3. Conventional id-like names: `slug`, `uuid`, `key`, `version`, `name`
 *       — but only if they are typed as a string (avoids capturing a `name`
 *       object on resources that nest metadata).
 *    4. Any field with `type: integer` or `format: uuid`.
 *    5. Fallback: `"id"` (the YAML capture will simply be empty if absent —
 *       the runner already handles this gracefully).
 */
function getCaptureField(ep: EndpointInfo, idParam?: string): string {
  const schema = getSuccessSchema(ep);
  const props = schema?.properties;
  if (!props) return "id";

  // 1. Path-param name match.
  if (idParam) {
    if (idParam in props) return idParam;
    // Also try the conventional `<resource>_id` ↔ `id` swap.
    if (idParam.endsWith("_id") && "id" in props) return "id";
  }

  // 2. Plain `id`.
  if ("id" in props) return "id";

  // 3. Conventional id-like names (string-typed only).
  for (const candidate of ID_LIKE_NAMES) {
    if (candidate in props) {
      const s = props[candidate] as OpenAPIV3.SchemaObject;
      if (s.type === "string") return candidate;
    }
  }

  // 4. Any integer or uuid-shaped field.
  for (const [name, propSchema] of Object.entries(props)) {
    const s = propSchema as OpenAPIV3.SchemaObject;
    if (s.type === "integer" || s.format === "uuid") return name;
  }

  return "id";
}

const AUTH_PATH_PATTERNS = /\/(auth|login|signin|signup|register|token|oauth)\b/i;

function isAuthEndpoint(ep: EndpointInfo): boolean {
  if (AUTH_PATH_PATTERNS.test(ep.path)) return true;
  if (ep.tags?.some(t => /^auth/i.test(t))) return true;
  return false;
}

// ──────────────────────────────────────────────
// Provenance helpers
// ──────────────────────────────────────────────

function escapeJsonPointerSegment(s: string): string {
  return s.replace(/~/g, "~0").replace(/\//g, "~1");
}

function pickPrimaryStatus(status: number | number[]): number {
  return Array.isArray(status) ? (status[0] ?? 200) : status;
}

/** Build step-level provenance for an endpoint + chosen response status. */
export function buildStepSource(
  ep: EndpointInfo,
  statusOverride?: number | number[],
): SourceMetadata {
  const method = ep.method.toUpperCase();
  const status = statusOverride ?? getExpectedStatus(ep);
  const primary = pickPrimaryStatus(status);
  const responseBranch = Array.isArray(status) ? status.map(String).join("|") : String(status);
  const escapedPath = escapeJsonPointerSegment(ep.path);
  return {
    endpoint: `${method} ${ep.path}`,
    response_branch: responseBranch,
    schema_pointer: `#/paths/${escapedPath}/${method.toLowerCase()}/responses/${primary}`,
  };
}

/** Build suite-level provenance for an openapi-generated suite. */
export function buildOpenApiSuiteSource(specPath?: string): SourceMetadata | undefined {
  if (!specPath) return undefined;
  return {
    type: "openapi-generated",
    spec: specPath,
    generator: "zond-generate",
    generated_at: new Date().toISOString(),
  };
}

// ──────────────────────────────────────────────
// Public API
// ──────────────────────────────────────────────

/**
 * ARV-45: swap FK-shaped required body fields for `{{fixture}}` references so
 * their values come from `.env.yaml` instead of `{{$randomString}}`/`{{$uuid}}`
 * junk that 400s and kills the CRUD chain at step 1. Field names that motivated
 * this — `sequenceTypeCode`, `templateGroupCode` — are closed-vocab codes the
 * generator can't guess. The var name is canonicalised (`sequence_type_code`)
 * to match the manifest entry (fixtures-builder step 5); the HTTP body key
 * keeps the raw spec spelling. Recurses into nested objects for nested FKs.
 *
 * Keep the detection predicate (`isFkFixtureField`) in lockstep with the
 * manifest builder — every var the tests reference must appear in the manifest
 * (decision-7).
 */
export function wireBodyFkRefs(schema: OpenAPIV3.SchemaObject, body: unknown): unknown {
  if (!body || typeof body !== "object" || Array.isArray(body)) return body;
  // `effectiveObjectShape` merges allOf so allOf-wrapped bodies (the .NET/
  // Swagger norm) resolve their properties — a direct schema.properties read
  // misses every FK on those specs.
  const { properties, required } = effectiveObjectShape(schema);
  const out = body as Record<string, unknown>;
  for (const [name, propSchema] of Object.entries(properties)) {
    if (!(name in out)) continue;
    if (required.has(name) && isFkFixtureField(name, propSchema)) {
      out[name] = `{{${canonicalVarName(name)}}}`;
    } else if (out[name] && typeof out[name] === "object" && !Array.isArray(out[name])) {
      out[name] = wireBodyFkRefs(propSchema, out[name]);
    }
  }
  return out;
}

/** Generate a request body from a schema with FK fields wired to fixtures. */
function generateBody(schema: OpenAPIV3.SchemaObject): unknown {
  return wireBodyFkRefs(schema, generateFromSchema(schema));
}

/** Generate a single test step from an EndpointInfo */
export function generateStep(
  ep: EndpointInfo,
  securitySchemes: SecuritySchemeInfo[],
): RawStep {
  const method = ep.method.toUpperCase();
  const name = ep.operationId ?? ep.summary ?? `${method} ${ep.path}`;
  const path = convertPath(ep.path);

  const step: RawStep = {
    name,
    source: buildStepSource(ep),
    [method]: path,
    expect: {
      status: getExpectedStatus(ep),
    },
  };

  const authHeaders = getAuthHeaders(ep, securitySchemes);
  if (authHeaders) {
    step.headers = authHeaders;
  }

  if (["POST", "PUT", "PATCH"].includes(method) && ep.requestBodySchema) {
    if (ep.requestBodyContentType === "multipart/form-data") {
      step.multipart = generateMultipartFromSchema(ep.requestBodySchema);
    } else if (ep.requestBodyContentType === "application/x-www-form-urlencoded") {
      // ARV-149: form-encoded endpoints (Stripe v1 et al.) — emit `form:` so
      // the runner posts URL-encoded bodies with bracket notation. Without
      // this, generate baked `json:` blocks and every POST 400'd with
      // "wrong content type".
      step.form = flattenToFormFields(generateBody(ep.requestBodySchema));
    } else {
      step.json = generateBody(ep.requestBodySchema);
    }
  }

  const query = getRequiredQueryParams(ep);
  if (query) {
    step.query = query;
  }

  const body = getBodyAssertions(ep);
  if (body) {
    step.expect.body = body;
  }

  return step;
}

/** Strip a single trailing slash for comparison purposes. We never rewrite
 *  endpoint paths in the spec — we just normalise the matching regex so
 *  `POST /alerts/` + `GET /alerts/{id}/` lines up the same as the no-slash
 *  variant. */
function stripTrailingSlash(p: string): string {
  return p.length > 1 && p.endsWith("/") ? p.slice(0, -1) : p;
}

/** Per-resource diagnostic record used by `zond generate --explain`.
 *  Captures every POST candidate the detector considered and the verdict
 *  with a human reason — so users can see "I have a CRUD-looking pair, why
 *  didn't generate emit a chain?" without grepping the spec. */
export interface CrudDetectionDiagnostic {
  resource: string;
  basePath: string;
  postPath: string;
  hasGetById: boolean;
  hasUpdate: boolean;
  hasDelete: boolean;
  hasList: boolean;
  verdict: "chain" | "skipped";
  reason: string;
}

export interface DetectCrudResult {
  groups: CrudGroup[];
  diagnostics: CrudDetectionDiagnostic[];
}

/** Detect CRUD groups from a list of endpoints.
 *
 *  Match logic (TASK-139):
 *    - basePath = POST endpoint's path with any trailing slash trimmed.
 *    - item path = `<basePath>/{param}` with optional trailing slash.
 *  This catches common SaaS-style `POST /alert-rules/` + `GET /alert-rules/{id}/`
 *  pairs that previously fell through because the regex required the same
 *  slash form on both. */
export function detectCrudGroups(endpoints: EndpointInfo[]): CrudGroup[] {
  return detectCrudGroupsWithDiagnostics(endpoints).groups;
}

export function detectCrudGroupsWithDiagnostics(
  endpoints: EndpointInfo[],
): DetectCrudResult {
  const groups: CrudGroup[] = [];
  const diagnostics: CrudDetectionDiagnostic[] = [];
  const postEndpoints = endpoints.filter(
    ep => ep.method.toUpperCase() === "POST" && !ep.deprecated,
  );

  for (const createEp of postEndpoints) {
    const basePath = stripTrailingSlash(createEp.path);
    const resource = basePath.split("/").filter(Boolean).pop() ?? "resource";

    // Match `<basePath>/{param}` with optional trailing slash. Tolerates
    // both `POST /alerts/` + `GET /alerts/{id}` and `POST /alerts` +
    // `GET /alerts/{id}/`, which some real-world specs mix.
    const itemPattern = new RegExp(`^${escapeRegex(basePath)}/\\{([^}]+)\\}/?$`);
    const itemEndpoints = endpoints.filter(
      ep => !ep.deprecated && itemPattern.test(ep.path),
    );

    // Fallback for "subdomain"/nested-item routing (common SaaS-style):
    // create lives under one root (`/api/0/organizations/{org}/teams/`)
    // but item-path lives under another (`/api/0/teams/{org}/{team}/`).
    // The strict basePath/{id} regex misses these. Match instead by:
    //   1. shared OpenAPI tag with the create operation,
    //   2. terminal {param} matching the singular form of the resource
    //      (`{team}` / `{team_id}` / `{team_id_or_slug}`).
    let resolvedItemEndpoints = itemEndpoints;
    if (resolvedItemEndpoints.length === 0) {
      const singular = singularizeResource(resource).toLowerCase();
      const itemTerminalRe = /\{([^}]+)\}\/?$/;
      const matchesResourceParam = (p: string) => {
        const m = p.match(itemTerminalRe);
        if (!m) return false;
        const param = m[1]!.toLowerCase();
        return (
          param === singular ||
          param === `${singular}_id` ||
          param === `${singular}_id_or_slug` ||
          param === `${singular}_slug`
        );
      };
      const createTags = new Set(createEp.tags ?? []);
      const sharedTag = (ep: EndpointInfo) =>
        (ep.tags ?? []).some(t => createTags.has(t));

      resolvedItemEndpoints = endpoints.filter(
        ep =>
          !ep.deprecated &&
          ep.path !== createEp.path &&
          matchesResourceParam(ep.path) &&
          sharedTag(ep),
      );
    }

    const read = resolvedItemEndpoints.find(ep => ep.method.toUpperCase() === "GET");
    const update = resolvedItemEndpoints.find(
      ep => ["PUT", "PATCH"].includes(ep.method.toUpperCase()),
    );
    const del = resolvedItemEndpoints.find(ep => ep.method.toUpperCase() === "DELETE");
    // List endpoint matches with the same trailing-slash tolerance.
    const list = endpoints.find(
      ep =>
        ep.method.toUpperCase() === "GET" &&
        stripTrailingSlash(ep.path) === basePath &&
        !ep.deprecated,
    );

    const diag: CrudDetectionDiagnostic = {
      resource,
      basePath,
      postPath: createEp.path,
      hasGetById: !!read,
      hasUpdate: !!update,
      hasDelete: !!del,
      hasList: !!list,
      verdict: "skipped",
      reason: "",
    };

    if (resolvedItemEndpoints.length === 0) {
      diag.reason = `no item endpoint matching ${basePath}/{...}`;
      diagnostics.push(diag);
      continue;
    }
    // TASK-260: accept headless chains — POST + (GET/PUT/PATCH/DELETE on /{id}).
    // Resources with no GET-by-id (e.g. external-teams, some user-binding endpoints)
    // were previously skipped entirely, even though POST captures the ID and PUT/DELETE
    // can drive the chain on their own. The Read/Verify steps in the suite generator
    // are already conditional on `group.read`, so headless chains generate cleanly.
    if (!read && !update && !del) {
      diag.reason = "item endpoint exists but no GET/PUT/PATCH/DELETE on /{id}";
      diagnostics.push(diag);
      continue;
    }

    const itemPath = resolvedItemEndpoints[0]!.path;
    const idMatch = itemPath.match(/\{([^}]+)\}\/?$/);
    if (!idMatch) {
      diag.reason = "item path has no terminal {param}";
      diagnostics.push(diag);
      continue;
    }
    const idParam = idMatch[1]!;

    diag.verdict = "chain";
    if (read) {
      diag.reason = "POST + GET/{id} matched";
    } else {
      // TASK-260: explicit headless reason so `--explain` differentiates the
      // two chain shapes — useful for debugging fixture flow.
      const partner = update ? `${update.method.toUpperCase()}/{id}` : `DELETE/{id}`;
      diag.reason = `POST + ${partner} matched (headless: no GET-by-id)`;
    }
    diagnostics.push(diag);

    groups.push({
      resource,
      basePath,
      itemPath,
      idParam,
      create: createEp,
      list,
      read,
      update,
      delete: del,
    });
  }

  return { groups, diagnostics };
}

/** Generate a CRUD chain suite from a CrudGroup */
/** ARV-368: does the create's success response actually carry the capture
 *  field? If not — a 204 no-body create, or a response schema without the id —
 *  the runtime capture is empty and `{{captureVar}}` falls back to the
 *  read-fixture of the SAME name (ARV-137 deliberately shares it). A PUT/DELETE
 *  then targets a *pre-existing* resource whose id the user harvested for read
 *  coverage — silent data-loss. Gate mutating chain steps on this so the suite
 *  can only ever update/delete what it actually captured, never live data. */
function createCapturesId(
  create: EndpointInfo | undefined,
  captureField: string,
): boolean {
  if (!create) return false;
  const props = getSuccessSchema(create)?.properties;
  return !!props && captureField in props;
}

export function generateCrudSuite(
  group: CrudGroup,
  securitySchemes: SecuritySchemeInfo[],
): RawSuite {
  const captureField = group.create ? getCaptureField(group.create, group.idParam) : "id";
  // ARV-368: only chain PUT/DELETE when the create response yields the id we'd
  // capture. Otherwise the capture is empty at runtime and the mutating step
  // falls back to the shared read-fixture → deletes/overwrites pre-existing data.
  const canChainMutations = createCapturesId(group.create, captureField);
  // ARV-137: use the spec's path-param name as the capture var. Previously
  // we synthesised `<resource>_id` via `resourceVar(...)`, which produced
  // phantom manifest dupes whenever the spec named the path-param anything
  // other than `<resource>_id` (e.g. `monitor_id_or_slug`, `version`, or
  // collection-stem mismatches like resource=`saved`/idParam=`query_id`).
  // Aligning on `group.idParam` keeps tests, manifest, and spec consistent.
  // Fallback to `resourceVar` only when the group has no idParam (defensive
  // — shouldn't happen for any group with a read/update/delete endpoint).
  const captureVar = group.idParam || resourceVar(group.resource, "id");
  const tests: RawStep[] = [];

  const allEps = [group.create, group.list, group.read, group.update, group.delete].filter(Boolean) as EndpointInfo[];
  const suiteHeaders = getSuiteHeaders(allEps, securitySchemes);

  // 0. List all (before create, to verify collection exists)
  if (group.list) {
    const step = generateStep(group.list, securitySchemes);
    if (suiteHeaders) delete (step as any).headers;
    tests.push(step);
  }

  // 1. Create
  if (group.create) {
    const step = generateStep(group.create, securitySchemes);
    if (!step.expect.body) step.expect.body = {};
    step.expect.body[captureField] = { capture: captureVar };
    if (suiteHeaders) delete (step as any).headers;
    tests.push(step);
  }

  // 2. Read created
  if (group.read) {
    const step: RawStep = {
      name: group.read.operationId ?? `Read created ${singularizeResource(group.resource)}`,
      source: buildStepSource(group.read),
      GET: convertPath(group.itemPath).replace(`{{${group.idParam}}}`, `{{${captureVar}}}`),
      expect: {
        status: getExpectedStatus(group.read),
        body: getBodyAssertions(group.read),
      },
    };
    tests.push(step);
  }

  // 3. Update (ARV-368: only if the chain self-captures its id — else the
  //    fixture-fallback would overwrite a pre-existing resource)
  if (group.update && canChainMutations) {
    const method = group.update.method.toUpperCase();
    const itemPath = convertPath(group.itemPath).replace(`{{${group.idParam}}}`, `{{${captureVar}}}`);
    const etagVar = resourceVar(group.resource, "etag");

    // If endpoint requires ETag (optimistic locking), capture it from a GET step first
    if (group.update.requiresEtag && group.read) {
      tests.push({
        name: `Get ETag before update ${singularizeResource(group.resource)}`,
        source: buildStepSource(group.read),
        GET: itemPath,
        expect: {
          status: getExpectedStatus(group.read),
          headers: { ETag: { capture: etagVar } },
        },
      });
    }

    const step: RawStep = {
      name: group.update.operationId ?? `Update ${singularizeResource(group.resource)}`,
      source: buildStepSource(group.update),
      [method]: itemPath,
      expect: {
        status: getExpectedStatus(group.update),
      },
    };
    if (group.update.requiresEtag) {
      step.headers = { "If-Match": `"{{${etagVar}}}"` };
    }
    if (group.update.requestBodySchema) {
      step.json = generateBody(group.update.requestBodySchema);
    }
    tests.push(step);
  }

  // 4. Delete (ARV-368: only if the chain self-captures its id — else the
  //    fixture-fallback would DELETE a pre-existing resource → data-loss)
  if (group.delete && canChainMutations) {
    const itemPath = convertPath(group.itemPath).replace(`{{${group.idParam}}}`, `{{${captureVar}}}`);
    const etagVar = resourceVar(group.resource, "etag");

    // If delete requires ETag and update didn't already capture it, add a GET step
    const updateAlreadyCapturedEtag = group.update?.requiresEtag;
    if (group.delete.requiresEtag && group.read && !updateAlreadyCapturedEtag) {
      tests.push({
        name: `Get ETag before delete ${singularizeResource(group.resource)}`,
        source: buildStepSource(group.read),
        GET: itemPath,
        expect: {
          status: getExpectedStatus(group.read),
          headers: { ETag: { capture: etagVar } },
        },
      });
    }

    // T44: cleanup must run even if earlier assertions failed (tainted captures)
    const step: RawStep = {
      name: group.delete.operationId ?? `Delete ${singularizeResource(group.resource)}`,
      source: buildStepSource(group.delete),
      DELETE: itemPath,
      always: true,
      expect: {
        status: getExpectedStatus(group.delete),
      },
    };
    if (group.delete.requiresEtag) {
      step.headers = { "If-Match": `"{{${etagVar}}}"` };
    }
    tests.push(step);

    // 5. Verify deleted — also always, so we confirm cleanup happened
    if (group.read) {
      tests.push({
        name: `Verify ${singularizeResource(group.resource)} deleted`,
        source: buildStepSource(group.read, 404),
        GET: convertPath(group.itemPath).replace(`{{${group.idParam}}}`, `{{${captureVar}}}`),
        always: true,
        expect: {
          status: 404,
        },
      });
    }
  }

  // T28: classify by cleanup behavior. A suite that owns a DELETE leaves the API
  // in its starting state (ephemeral); without DELETE it leaves residual data.
  const cleanupTag = group.delete ? "ephemeral" : "persistent-write";

  const suite: RawSuite = {
    name: `${group.resource}-crud`,
    tags: ["crud", cleanupTag],
    fileStem: `crud-${slugify(group.resource)}`,
    base_url: "{{base_url}}",
    tests,
  };

  if (suiteHeaders) {
    suite.headers = suiteHeaders;
  }

  return suite;
}

/** Find unresolved template variables in a suite (excluding known globals, captured vars, and env keys) */
export function findUnresolvedVars(suite: RawSuite, envKeys?: Set<string>, extraKnown?: Set<string>): string[] {
  const KNOWN = new Set(["base_url", "auth_token", "api_key"]);
  if (envKeys) for (const k of envKeys) KNOWN.add(k);
  if (extraKnown) for (const k of extraKnown) KNOWN.add(k);
  const captured = new Set<string>();
  for (const step of suite.tests) {
    if (step.expect?.body) {
      for (const val of Object.values(step.expect.body)) {
        if (val && typeof val === "object" && "capture" in val) captured.add((val as any).capture);
      }
    }
  }
  const vars = new Set<string>();
  const scan = (obj: unknown) => {
    if (typeof obj === "string") {
      for (const m of obj.matchAll(/\{\{([^$}][^}]*)\}\}/g)) {
        if (!KNOWN.has(m[1]!) && !captured.has(m[1]!)) vars.add(m[1]!);
      }
    } else if (obj && typeof obj === "object") {
      for (const v of Object.values(obj)) scan(v);
    }
  };
  scan(suite);
  return [...vars];
}

/** Check if a schema has a specific field name (case-insensitive) */
function schemaHasField(schema: OpenAPIV3.SchemaObject | undefined, ...names: string[]): boolean {
  if (!schema?.properties) return false;
  const keys = Object.keys(schema.properties).map(k => k.toLowerCase());
  return names.some(n => keys.includes(n.toLowerCase()));
}

/** Generate auth suite with register+login consistency */
export function generateAuthSuite(
  authEndpoints: EndpointInfo[],
  securitySchemes: SecuritySchemeInfo[],
): RawSuite {
  // Detect register → login pair
  const registerEp = authEndpoints.find(ep =>
    /\/(register|signup)\b/i.test(ep.path) && ep.method.toUpperCase() === "POST"
  );
  const loginEp = authEndpoints.find(ep =>
    ep !== registerEp &&
    /\/(login|signin|auth)\b/i.test(ep.path) &&
    ep.method.toUpperCase() === "POST"
  );

  const hasCredentialPair = registerEp && loginEp &&
    schemaHasField(registerEp.requestBodySchema, "email", "username") &&
    schemaHasField(registerEp.requestBodySchema, "password") &&
    schemaHasField(loginEp.requestBodySchema, "email", "username") &&
    schemaHasField(loginEp.requestBodySchema, "password");

  if (hasCredentialPair) {
    return generateConsistentAuthSuite(registerEp, loginEp, authEndpoints, securitySchemes);
  }

  // Fallback: plain auth suite — exclude logout/revoke endpoints from setup suite
  const nonLogoutEndpoints = authEndpoints.filter(ep => !LOGOUT_PATH_RE.test(ep.path));
  const tests = nonLogoutEndpoints.map(ep => generateStep(ep, securitySchemes));
  const headers = getSuiteHeaders(nonLogoutEndpoints, securitySchemes);

  const suite: RawSuite = {
    name: "auth",
    setup: true,
    tags: ["auth"],
    fileStem: "auth",
    base_url: "{{base_url}}",
    tests,
  };

  if (headers) {
    suite.headers = headers;
    for (const t of tests) {
      if (t.headers && JSON.stringify(t.headers) === JSON.stringify(headers)) {
        delete (t as any).headers;
      }
    }
  }

  return suite;
}

/** Generate auth suite with consistent register → login credentials */
function generateConsistentAuthSuite(
  registerEp: EndpointInfo,
  loginEp: EndpointInfo,
  allAuthEndpoints: EndpointInfo[],
  securitySchemes: SecuritySchemeInfo[],
): RawSuite {
  const tests: RawStep[] = [];

  // Determine credential field: "email" or "username"
  const useEmail = schemaHasField(registerEp.requestBodySchema, "email");
  const credField = useEmail ? "email" : "username";
  const credValue = useEmail ? "test_{{$timestamp}}@test.com" : "testuser_{{$timestamp}}";

  // 0. Set shared credentials
  const setStep: RawStep = {
    name: "Set test credentials",
    set: {
      [`test_${credField}`]: credValue,
      test_password: "TestPass123!",
    },
    expect: {},
  } as RawStep;
  tests.push(setStep);

  // 1. Register step — replace credential fields with shared vars
  const registerStep = generateStep(registerEp, securitySchemes);
  if (registerStep.json && typeof registerStep.json === "object") {
    const json = registerStep.json as Record<string, unknown>;
    if (credField in json) json[credField] = `{{test_${credField}}}`;
    if ("password" in json) json.password = "{{test_password}}";
  }
  tests.push(registerStep);

  // 2. Login step — reuse same credentials + capture token
  const loginStep = generateStep(loginEp, securitySchemes);
  if (loginStep.json && typeof loginStep.json === "object") {
    const json = loginStep.json as Record<string, unknown>;
    if (credField in json) json[credField] = `{{test_${credField}}}`;
    if ("password" in json) json.password = "{{test_password}}";
  }
  // Try to capture auth token from login response
  const loginSchema = getSuccessSchema(loginEp);
  if (loginSchema?.properties) {
    const tokenField = Object.keys(loginSchema.properties).find(k =>
      /token|access_token|accessToken|jwt/i.test(k)
    );
    if (tokenField) {
      // Determine the capture variable name based on the login endpoint's security scheme
      const loginScheme = loginEp.security.length > 0
        ? securitySchemes.find(s => s.name === loginEp.security[0])
        : undefined;
      const captureVar = loginScheme ? schemeVarName(loginScheme, securitySchemes) : "auth_token";
      if (!loginStep.expect.body) loginStep.expect.body = {};
      loginStep.expect.body[tokenField] = { capture: captureVar };
    }
  }
  tests.push(loginStep);

  // 3. Any remaining auth endpoints (not register/login, not logout)
  // Logout/revoke endpoints must NOT be in a setup suite — they invalidate the token
  const others = allAuthEndpoints.filter(ep =>
    ep !== registerEp && ep !== loginEp && !LOGOUT_PATH_RE.test(ep.path)
  );
  for (const ep of others) {
    tests.push(generateStep(ep, securitySchemes));
  }

  return {
    name: "auth",
    setup: true,
    tags: ["auth"],
    fileStem: "auth",
    base_url: "{{base_url}}",
    tests,
  };
}

/** Generate 1-2 minimal tests for quick connectivity and auth validation */
function generateSanitySuite(opts: {
  authEndpoints: EndpointInfo[];
  nonAuthGetEndpoints: EndpointInfo[];
  securitySchemes: SecuritySchemeInfo[];
}): RawSuite | null {
  const { authEndpoints, nonAuthGetEndpoints, securitySchemes } = opts;
  const tests: RawStep[] = [];

  // Priority 1: auth login/token endpoint
  if (authEndpoints.length > 0) {
    const loginEp =
      authEndpoints.find(ep => /\/(login|signin|token)\b/i.test(ep.path) && ep.method.toUpperCase() === "POST") ??
      authEndpoints[0]!;
    tests.push(generateStep(loginEp, securitySchemes));
  }

  // Priority 2: healthcheck or first simple GET with no path params
  const healthEp = selectHealthcheckEndpoint(nonAuthGetEndpoints);
  if (healthEp) {
    tests.push(generateStep(healthEp, securitySchemes));
  }

  if (tests.length === 0) return null;

  return {
    name: "sanity",
    tags: ["sanity"],
    fileStem: "sanity",
    base_url: "{{base_url}}",
    tests: tests.slice(0, 2),
  };
}

/** Main entry point: generate all suites from endpoints */
export function generateSuites(opts: {
  endpoints: EndpointInfo[];
  securitySchemes: SecuritySchemeInfo[];
  /** Path to OpenAPI spec, recorded in suite-level provenance. */
  specPath?: string;
  /** When true, deprecated endpoints are included instead of filtered out. */
  includeDeprecated?: boolean;
  /** ARV-212 (R13/F16): inject `Authorization: Bearer {{<varName>}}` at the
   *  suite level when the spec declares no securitySchemes but the workspace
   *  .env.yaml carries this auth-token variable. Lets generated suites talk
   *  to bare-spec APIs (GitHub) without going unauth. */
  defaultAuthVar?: string;
}): RawSuite[] {
  const { endpoints, securitySchemes, specPath, includeDeprecated, defaultAuthVar } = opts;
  _suiteDefaultAuthVar = defaultAuthVar ?? null;

  // Filter deprecated unless caller opted in. The list of skipped paths is
  // exposed separately via `getSkippedDeprecated` for stdout reporting.
  const active = includeDeprecated ? endpoints : endpoints.filter(ep => !ep.deprecated);

  // Separate auth endpoints
  const authEndpoints = active.filter(isAuthEndpoint);
  const nonAuth = active.filter(ep => !isAuthEndpoint(ep));

  // 1. Detect CRUD groups
  const crudGroups = detectCrudGroups(nonAuth);

  // Collect endpoints consumed by CRUD groups
  const crudEndpointKeys = new Set<string>();
  for (const g of crudGroups) {
    if (g.create) crudEndpointKeys.add(`${g.create.method.toUpperCase()} ${g.create.path}`);
    if (g.list) crudEndpointKeys.add(`${g.list.method.toUpperCase()} ${g.list.path}`);
    if (g.read) crudEndpointKeys.add(`${g.read.method.toUpperCase()} ${g.read.path}`);
    if (g.update) crudEndpointKeys.add(`${g.update.method.toUpperCase()} ${g.update.path}`);
    if (g.delete) crudEndpointKeys.add(`${g.delete.method.toUpperCase()} ${g.delete.path}`);
  }

  // Remaining endpoints (not in any CRUD group, not auth)
  const remaining = nonAuth.filter(ep => !crudEndpointKeys.has(`${ep.method.toUpperCase()} ${ep.path}`));

  const suites: RawSuite[] = [];

  // 2. Group remaining by tag → smoke + smoke-unsafe
  const byTag = groupEndpointsByTag(remaining);

  for (const [tag, tagEndpoints] of byTag) {
    const tagSlug = slugify(tag) || "api";

    // GET endpoints → split into paramless (regular smoke) and path-param (negative+positive smoke)
    const getEndpoints = tagEndpoints.filter(ep => ep.method.toUpperCase() === "GET");
    const paramlessGets = getEndpoints.filter(ep => !endpointHasPathParams(ep));
    const pathParamGets = getEndpoints.filter(ep => endpointHasPathParams(ep));

    // Positive smoke: paramless GETs (no env needed) + path-param GETs
    // (with skip_if guards). TASK-240 — unified naming convention:
    // always emit `smoke-<tag>-positive.yaml`, never the bare
    // `smoke-<tag>.yaml`, so file listings don't have to explain why a
    // tag has only `-negative` (e.g. a vendor-specific tag) or why two
    // siblings differ in suffix shape.
    const positiveTests = [
      ...paramlessGets.map(ep => {
        const step = generateStep(ep, securitySchemes);
        const seededPath = convertPathWithSeeds(ep.path, ep);
        (step as any)[ep.method.toUpperCase()] = seededPath;
        return step;
      }),
      ...pathParamGets.map(ep => {
        const step = generateStep(ep, securitySchemes);
        // Path stays as {{param}} so user-provided env values flow in.
        // skip_if guards an unset path-param without skipping paramless
        // siblings that don't need a fixture.
        const firstPathParam = ep.parameters.find(p => p.in === "path");
        if (firstPathParam) {
          step.skip_if = `{{${firstPathParam.name}}} ==`;
        }
        return step;
      }),
    ];

    if (positiveTests.length > 0) {
      const positiveEndpoints = [...paramlessGets, ...pathParamGets];
      const headers = getSuiteHeaders(positiveEndpoints, securitySchemes);
      // needs-id only when at least one test depends on a path-param
      // fixture — coverage downgrades these suites when env is empty.
      const tags = pathParamGets.length > 0
        ? ["smoke", "positive", "needs-id"]
        : ["smoke", "positive"];

      const suite: RawSuite = {
        name: `${tagSlug}-smoke-positive`,
        tags,
        fileStem: `smoke-${tagSlug}-positive`,
        base_url: "{{base_url}}",
        tests: positiveTests,
      };

      if (headers) {
        suite.headers = headers;
        for (const t of positiveTests) {
          if (t.headers && JSON.stringify(t.headers) === JSON.stringify(headers)) {
            delete (t as any).headers;
          }
        }
      }

      suites.push(suite);
    }

    // Negative smoke: path-param GETs with guaranteed-bad IDs, expect 400/404/422
    if (pathParamGets.length > 0) {
      const tests = pathParamGets.map(ep => {
        const step = generateStep(ep, securitySchemes);
        (step as any)[ep.method.toUpperCase()] = convertPathWithBadIds(ep.path, ep);
        // Negative path: resource doesn't exist. Drop body assertions (response shape varies).
        step.expect = { status: [400, 404, 422] };
        return step;
      });
      const headers = getSuiteHeaders(pathParamGets, securitySchemes);

      const suite: RawSuite = {
        name: `${tagSlug}-smoke-negative`,
        tags: ["smoke", "negative"],
        fileStem: `smoke-${tagSlug}-negative`,
        base_url: "{{base_url}}",
        tests,
      };

      if (headers) {
        suite.headers = headers;
        for (const t of tests) {
          if (t.headers && JSON.stringify(t.headers) === JSON.stringify(headers)) {
            delete (t as any).headers;
          }
        }
      }

      suites.push(suite);
    }

    // Non-GET endpoints: split reset/system endpoints out of smoke-unsafe
    const nonGetEndpoints = tagEndpoints.filter(ep => ep.method.toUpperCase() !== "GET");
    const resetEndpoints = nonGetEndpoints.filter(ep => RESET_PATH_RE.test(ep.path));
    const unsafeEndpoints = nonGetEndpoints.filter(ep => !RESET_PATH_RE.test(ep.path));

    // Reset/system endpoints → [system, reset] suite (never run as part of smoke)
    if (resetEndpoints.length > 0) {
      const tests = resetEndpoints.map(ep => generateStep(ep, securitySchemes));
      const headers = getSuiteHeaders(resetEndpoints, securitySchemes);

      const suite: RawSuite = {
        name: `${tagSlug}-system`,
        tags: ["system", "reset"],
        fileStem: `system-${tagSlug}`,
        base_url: "{{base_url}}",
        tests,
      };

      if (headers) {
        suite.headers = headers;
        for (const t of tests) {
          if (t.headers && JSON.stringify(t.headers) === JSON.stringify(headers)) {
            delete (t as any).headers;
          }
        }
      }

      suites.push(suite);
    }

    // Remaining non-GET endpoints → smoke-unsafe suite
    if (unsafeEndpoints.length > 0) {
      const tests = unsafeEndpoints.map(ep => generateStep(ep, securitySchemes));
      const headers = getSuiteHeaders(unsafeEndpoints, securitySchemes);

      const suite: RawSuite = {
        name: `${tagSlug}-smoke-unsafe`,
        tags: ["smoke", "unsafe"],
        fileStem: `smoke-${tagSlug}-unsafe`,
        base_url: "{{base_url}}",
        tests,
      };

      if (headers) {
        suite.headers = headers;
        for (const t of tests) {
          if (t.headers && JSON.stringify(t.headers) === JSON.stringify(headers)) {
            delete (t as any).headers;
          }
        }
      }

      suites.push(suite);
    }
  }

  // 3. CRUD suites
  for (const group of crudGroups) {
    suites.push(generateCrudSuite(group, securitySchemes));
  }

  // 4. Auth suite (separate — requires real credentials)
  if (authEndpoints.length > 0) {
    const suite = generateAuthSuite(authEndpoints, securitySchemes);
    suites.push(suite);
  }

  // 5. Sanity suite (prepend — 1-2 tests for quick connectivity/auth check)
  const nonAuthGetEndpoints = nonAuth.filter(ep => ep.method.toUpperCase() === "GET");
  const sanitySuite = generateSanitySuite({ authEndpoints, nonAuthGetEndpoints, securitySchemes });

  const allSuites = sanitySuite ? [sanitySuite, ...suites] : suites;

  // Stamp suite-level provenance when a spec path is known.
  const suiteSrc = buildOpenApiSuiteSource(specPath);
  if (suiteSrc) {
    for (const s of allSuites) {
      s.source = suiteSrc;
    }
  }

  _suiteDefaultAuthVar = null;                                                                  // ARV-212
  return allSuites;
}
