import type { OpenAPIV3 } from "openapi-types";
import type { EndpointInfo, SecuritySchemeInfo, CrudGroup } from "./types.ts";
import type { RawSuite, RawStep } from "./serializer.ts";
import { generateFromSchema } from "./data-factory.ts";
import { groupEndpointsByTag } from "./chunker.ts";

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

/** Convert OpenAPI path params {param} to test interpolation {{param}} */
function convertPath(path: string): string {
  return path.replace(/\{([^}]+)\}/g, "{{$1}}");
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function getExpectedStatus(ep: EndpointInfo): number {
  const success = ep.responses.find(r => r.statusCode >= 200 && r.statusCode < 300);
  if (success) return success.statusCode;
  if (ep.responses.length > 0) return ep.responses[0]!.statusCode;
  return 200;
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

function getAuthHeaders(
  ep: EndpointInfo,
  schemes: SecuritySchemeInfo[],
): Record<string, string> | undefined {
  if (ep.security.length === 0) return undefined;

  for (const secName of ep.security) {
    const scheme = schemes.find(s => s.name === secName);
    if (!scheme) continue;

    if (scheme.type === "http" && scheme.scheme === "bearer") {
      return { Authorization: "Bearer {{auth_token}}" };
    }
    if (scheme.type === "apiKey" && scheme.in === "header" && scheme.apiKeyName) {
      return { [scheme.apiKeyName]: "{{api_key}}" };
    }
  }

  return undefined;
}

function getRequiredQueryParams(ep: EndpointInfo): Record<string, unknown> | undefined {
  const queryParams = ep.parameters.filter(p => p.in === "query" && p.required);
  if (queryParams.length === 0) return undefined;

  const query: Record<string, unknown> = {};
  for (const p of queryParams) {
    if (p.schema) {
      query[p.name] = generateFromSchema(p.schema as OpenAPIV3.SchemaObject, p.name);
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
    step.json = generateFromSchema(ep.requestBodySchema);
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
    const step: RawStep = {
      name: group.update.operationId ?? `Update ${group.resource.replace(/s$/, "")}`,
      [method]: convertPath(group.itemPath).replace(`{{${group.idParam}}}`, `{{${captureVar}}}`),
      expect: {
        status: getExpectedStatus(group.update),
      },
    };
    if (group.update.requestBodySchema) {
      step.json = generateFromSchema(group.update.requestBodySchema);
    }
    tests.push(step);
  }

  // 4. Delete
  if (group.delete) {
    const step: RawStep = {
      name: group.delete.operationId ?? `Delete ${group.resource.replace(/s$/, "")}`,
      DELETE: convertPath(group.itemPath).replace(`{{${group.idParam}}}`, `{{${captureVar}}}`),
      expect: {
        status: getExpectedStatus(group.delete),
      },
    };
    tests.push(step);

    // 5. Verify deleted
    if (group.read) {
      tests.push({
        name: `Verify ${group.resource.replace(/s$/, "")} deleted`,
        GET: convertPath(group.itemPath).replace(`{{${group.idParam}}}`, `{{${captureVar}}}`),
        expect: {
          status: 404,
        },
      });
    }
  }

  const suite: RawSuite = {
    name: `${group.resource}-crud`,
    tags: ["crud"],
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
export function findUnresolvedVars(suite: RawSuite, envKeys?: Set<string>): string[] {
  const KNOWN = new Set(["base_url", "auth_token", "api_key"]);
  if (envKeys) for (const k of envKeys) KNOWN.add(k);
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

    // GET endpoints → smoke suite
    const getEndpoints = tagEndpoints.filter(ep => ep.method.toUpperCase() === "GET");
    if (getEndpoints.length > 0) {
      const tests = getEndpoints.map(ep => generateStep(ep, securitySchemes));
      const headers = getSuiteHeaders(getEndpoints, securitySchemes);

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

    // Non-GET endpoints → smoke-unsafe suite
    const unsafeEndpoints = tagEndpoints.filter(ep => ep.method.toUpperCase() !== "GET");
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
    const tests = authEndpoints.map(ep => generateStep(ep, securitySchemes));
    const headers = getSuiteHeaders(authEndpoints, securitySchemes);

    const suite: RawSuite = {
      name: "auth",
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

    suites.push(suite);
  }

  return suites;
}
