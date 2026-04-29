import type { OpenAPIV3 } from "openapi-types";
import type { EndpointInfo, SecuritySchemeInfo, CrudGroup } from "./types.ts";
import type { RawSuite, RawStep } from "./serializer.ts";
import { generateFromSchema, generateMultipartFromSchema } from "./data-factory.ts";
import { groupEndpointsByTag } from "./chunker.ts";

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

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
 *   2. First declared response if no 2xx (rare — usually 4xx-only specs).
 *   3. Method-aware default for specs that omit responses entirely
 *      (Resend OpenAPI does this for several mutating endpoints — the actual
 *      runtime returns 201/204, but the spec is silent and the old default of
 *      200 caused tests to fail at runtime).
 */
function getExpectedStatus(ep: EndpointInfo): number {
  const success = ep.responses.find(r => r.statusCode >= 200 && r.statusCode < 300);
  if (success) return success.statusCode;
  if (ep.responses.length > 0) return ep.responses[0]!.statusCode;
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
function schemeVarName(scheme: SecuritySchemeInfo, allSchemes: SecuritySchemeInfo[]): string {
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
  if (ep.security.length === 0) return undefined;

  for (const secName of ep.security) {
    const scheme = schemes.find(s => s.name === secName);
    if (!scheme) continue;

    if (scheme.type === "http") {
      if (scheme.scheme === "bearer" || !scheme.scheme) {
        return { Authorization: `Bearer {{${schemeVarName(scheme, schemes)}}}` };
      }
      if (scheme.scheme === "basic") {
        return { Authorization: `Basic {{${schemeVarName(scheme, schemes)}}}` };
      }
    }
    if (scheme.type === "apiKey" && scheme.in === "header" && scheme.apiKeyName) {
      if (scheme.apiKeyName === "Authorization") {
        return { Authorization: `Bearer {{${schemeVarName(scheme, schemes)}}}` };
      }
      return { [scheme.apiKeyName]: "{{api_key}}" };
    }
  }

  return undefined;
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
  if (!first) return undefined;

  const firstJson = JSON.stringify(first);
  const allSame = headerSets.every(h => JSON.stringify(h) === firstJson);
  return allSame ? first : undefined;
}

/** Find the best field to capture from POST response (for CRUD chains) */
function getCaptureField(ep: EndpointInfo): string {
  const schema = getSuccessSchema(ep);
  if (schema?.properties) {
    if ("id" in schema.properties) return "id";
    for (const [name, propSchema] of Object.entries(schema.properties)) {
      const s = propSchema as OpenAPIV3.SchemaObject;
      if (s.type === "integer" || s.format === "uuid") return name;
    }
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
// Public API
// ──────────────────────────────────────────────

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
    } else {
      step.json = generateFromSchema(ep.requestBodySchema);
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

/** Detect CRUD groups from a list of endpoints */
export function detectCrudGroups(endpoints: EndpointInfo[]): CrudGroup[] {
  const groups: CrudGroup[] = [];
  const postEndpoints = endpoints.filter(ep => ep.method.toUpperCase() === "POST" && !ep.deprecated);

  for (const createEp of postEndpoints) {
    const basePath = createEp.path;

    // Find item endpoints: basePath/{param}
    const itemPattern = new RegExp(`^${escapeRegex(basePath)}/\\{([^}]+)\\}$`);
    const itemEndpoints = endpoints.filter(ep => !ep.deprecated && itemPattern.test(ep.path));

    if (itemEndpoints.length === 0) continue;

    const itemPath = itemEndpoints[0]!.path;
    const idMatch = itemPath.match(/\{([^}]+)\}$/);
    if (!idMatch) continue;
    const idParam = idMatch[1]!;

    const read = itemEndpoints.find(ep => ep.method.toUpperCase() === "GET");
    if (!read) continue; // Minimum: POST + GET/{id}

    const update = itemEndpoints.find(ep => ["PUT", "PATCH"].includes(ep.method.toUpperCase()));
    const del = itemEndpoints.find(ep => ep.method.toUpperCase() === "DELETE");
    const list = endpoints.find(ep => ep.method.toUpperCase() === "GET" && ep.path === basePath && !ep.deprecated);

    const resource = basePath.split("/").filter(Boolean).pop() ?? "resource";

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

  return groups;
}

/** Generate a CRUD chain suite from a CrudGroup */
export function generateCrudSuite(
  group: CrudGroup,
  securitySchemes: SecuritySchemeInfo[],
): RawSuite {
  const captureField = group.create ? getCaptureField(group.create) : "id";
  const captureVar = `${group.resource.replace(/s$/, "")}_id`;
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
      name: group.read.operationId ?? `Read created ${group.resource.replace(/s$/, "")}`,
      GET: convertPath(group.itemPath).replace(`{{${group.idParam}}}`, `{{${captureVar}}}`),
      expect: {
        status: getExpectedStatus(group.read),
        body: getBodyAssertions(group.read),
      },
    };
    tests.push(step);
  }

  // 3. Update
  if (group.update) {
    const method = group.update.method.toUpperCase();
    const itemPath = convertPath(group.itemPath).replace(`{{${group.idParam}}}`, `{{${captureVar}}}`);
    const etagVar = `${group.resource.replace(/s$/, "")}_etag`;

    // If endpoint requires ETag (optimistic locking), capture it from a GET step first
    if (group.update.requiresEtag && group.read) {
      tests.push({
        name: `Get ETag before update ${group.resource.replace(/s$/, "")}`,
        GET: itemPath,
        expect: {
          status: getExpectedStatus(group.read),
          headers: { ETag: { capture: etagVar } },
        },
      });
    }

    const step: RawStep = {
      name: group.update.operationId ?? `Update ${group.resource.replace(/s$/, "")}`,
      [method]: itemPath,
      expect: {
        status: getExpectedStatus(group.update),
      },
    };
    if (group.update.requiresEtag) {
      step.headers = { "If-Match": `"{{${etagVar}}}"` };
    }
    if (group.update.requestBodySchema) {
      step.json = generateFromSchema(group.update.requestBodySchema);
    }
    tests.push(step);
  }

  // 4. Delete
  if (group.delete) {
    const itemPath = convertPath(group.itemPath).replace(`{{${group.idParam}}}`, `{{${captureVar}}}`);
    const etagVar = `${group.resource.replace(/s$/, "")}_etag`;

    // If delete requires ETag and update didn't already capture it, add a GET step
    const updateAlreadyCapturedEtag = group.update?.requiresEtag;
    if (group.delete.requiresEtag && group.read && !updateAlreadyCapturedEtag) {
      tests.push({
        name: `Get ETag before delete ${group.resource.replace(/s$/, "")}`,
        GET: itemPath,
        expect: {
          status: getExpectedStatus(group.read),
          headers: { ETag: { capture: etagVar } },
        },
      });
    }

    // T44: cleanup must run even if earlier assertions failed (tainted captures)
    const step: RawStep = {
      name: group.delete.operationId ?? `Delete ${group.resource.replace(/s$/, "")}`,
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
        name: `Verify ${group.resource.replace(/s$/, "")} deleted`,
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
export function generateSanitySuite(opts: {
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
}): RawSuite[] {
  const { endpoints, securitySchemes } = opts;

  // Filter deprecated
  const active = endpoints.filter(ep => !ep.deprecated);

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

    // Regular smoke: paramless GETs (e.g. list endpoints, health checks)
    if (paramlessGets.length > 0) {
      const tests = paramlessGets.map(ep => {
        const step = generateStep(ep, securitySchemes);
        const seededPath = convertPathWithSeeds(ep.path, ep);
        (step as any)[ep.method.toUpperCase()] = seededPath;
        return step;
      });
      const headers = getSuiteHeaders(paramlessGets, securitySchemes);

      const suite: RawSuite = {
        name: `${tagSlug}-smoke`,
        tags: ["smoke"],
        fileStem: `smoke-${tagSlug}`,
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

    // Positive smoke: path-param GETs with {{var}} placeholders + skip_if for unset env
    if (pathParamGets.length > 0) {
      const tests = pathParamGets.map(ep => {
        const step = generateStep(ep, securitySchemes);
        // Path stays as {{param}} so user-provided env values flow in
        // Pick the first path param for skip_if guard (the resource ID)
        const firstPathParam = ep.parameters.find(p => p.in === "path");
        if (firstPathParam) {
          step.skip_if = `{{${firstPathParam.name}}} ==`;
        }
        return step;
      });
      const headers = getSuiteHeaders(pathParamGets, securitySchemes);

      const suite: RawSuite = {
        name: `${tagSlug}-smoke-positive`,
        tags: ["smoke", "positive", "needs-id"],
        fileStem: `smoke-${tagSlug}-positive`,
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

  return sanitySuite ? [sanitySuite, ...suites] : suites;
}
