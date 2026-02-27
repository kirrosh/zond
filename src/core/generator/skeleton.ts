import type { EndpointInfo, SecuritySchemeInfo } from "./types.ts";
import { generateFromSchema } from "./data-factory.ts";
import { detectCrudGroups, generateCrudChain, getCrudEndpoints } from "./crud.ts";

export interface RawStep {
  name: string;
  [methodKey: string]: unknown;
  expect: {
    status?: number;
    body?: Record<string, Record<string, string>>;
  };
}

export interface RawSuite {
  name: string;
  base_url?: string;
  headers?: Record<string, string>;
  tests: RawStep[];
}

/**
 * Generate skeleton test suites from extracted OpenAPI endpoints.
 * Groups endpoints by first tag (or path prefix).
 * When securitySchemes are provided, generates auth login steps and suite-level headers.
 */
export function generateSkeleton(
  endpoints: EndpointInfo[],
  baseUrl?: string,
  securitySchemes?: SecuritySchemeInfo[],
): RawSuite[] {
  // Group by tag
  const groups = new Map<string, EndpointInfo[]>();

  for (const ep of endpoints) {
    const group = ep.tags[0] ?? deriveGroupFromPath(ep.path);
    if (!groups.has(group)) {
      groups.set(group, []);
    }
    groups.get(group)!.push(ep);
  }

  // Detect bearer auth scheme
  const bearerScheme = securitySchemes?.find(
    (s) => s.type === "http" && s.scheme === "bearer",
  );

  // Detect API key schemes
  const apiKeySchemes = securitySchemes?.filter((s) => s.type === "apiKey") ?? [];

  // Detect basic auth scheme
  const basicScheme = securitySchemes?.find(
    (s) => s.type === "http" && s.scheme === "basic",
  );

  // Detect login endpoint for bearer auth
  const loginEndpoint = bearerScheme ? findLoginEndpoint(endpoints) : undefined;

  const suites: RawSuite[] = [];

  for (const [groupName, eps] of groups) {
    const tests: RawStep[] = [];

    // Check if any endpoint in this group requires auth
    const needsAuth = eps.some((ep) => ep.security.length > 0);

    for (const ep of eps) {
      const step = buildStep(ep);
      tests.push(step);
    }

    const suite: RawSuite = { name: groupName, tests };
    if (baseUrl) {
      suite.base_url = baseUrl;
    }

    // Add auth support for suites that need it
    if (needsAuth) {
      if (bearerScheme && loginEndpoint) {
        // Add login step at the beginning
        const loginStep = buildLoginStep(loginEndpoint);
        suite.tests.unshift(loginStep);
        // Add suite-level Authorization header
        suite.headers = { Authorization: "Bearer {{auth_token}}" };
      }

      // Add API key headers
      for (const apiKey of apiKeySchemes) {
        if (apiKey.in === "header" && apiKey.apiKeyName) {
          if (!suite.headers) suite.headers = {};
          const envVar = apiKey.name.replace(/[^a-zA-Z0-9]/g, "_").toLowerCase();
          suite.headers[apiKey.apiKeyName] = `{{${envVar}}}`;
        }
      }

      // Add Basic auth header
      if (basicScheme) {
        if (!suite.headers) suite.headers = {};
        suite.headers.Authorization = suite.headers.Authorization ?? "Basic {{basic_credentials}}";
      }
    }

    suites.push(suite);
  }

  return suites;
}

/**
 * Generate test suites with CRUD chain detection.
 * CRUD groups get chain suites (POST→GET→PUT→DELETE with captures).
 * Remaining endpoints get skeleton suites.
 */
export function generateSuites(
  endpoints: EndpointInfo[],
  baseUrl?: string,
  securitySchemes?: SecuritySchemeInfo[],
): RawSuite[] {
  const crudGroups = detectCrudGroups(endpoints);
  const crudEndpointSet = getCrudEndpoints(crudGroups);

  // Detect login endpoint for CRUD chains that need auth
  const bearerScheme = securitySchemes?.find(
    s => s.type === "http" && s.scheme === "bearer",
  );
  const loginEndpoint = bearerScheme ? findLoginEndpoint(endpoints) : undefined;

  // Generate CRUD chain suites
  const crudSuites = crudGroups.map(g =>
    generateCrudChain(g, baseUrl, securitySchemes, loginEndpoint),
  );

  // Generate skeleton suites for non-CRUD endpoints
  const remaining = endpoints.filter(ep => !crudEndpointSet.has(ep));
  const skeletonSuites = remaining.length > 0
    ? generateSkeleton(remaining, baseUrl, securitySchemes)
    : [];

  return [...crudSuites, ...skeletonSuites];
}

/**
 * Detect a login endpoint by heuristic:
 * - POST method
 * - path contains /auth, /login, or /token
 * - no security requirement
 * - response has "token" or "access_token" property
 */
export function findLoginEndpoint(endpoints: EndpointInfo[]): EndpointInfo | undefined {
  const authPathPattern = /(\/auth|\/login|\/token)/i;

  return endpoints.find((ep) => {
    if (ep.method !== "POST") return false;
    if (!authPathPattern.test(ep.path)) return false;
    if (ep.security.length > 0) return false;

    // Check if any 2xx response has token/access_token property
    const hasTokenResponse = ep.responses.some((r) => {
      if (r.statusCode < 200 || r.statusCode >= 300) return false;
      if (!r.schema?.properties) return false;
      return "token" in r.schema.properties || "access_token" in r.schema.properties;
    });

    return hasTokenResponse;
  });
}

function buildLoginStep(ep: EndpointInfo): RawStep {
  const step: RawStep = {
    name: "Auth: Login",
    POST: ep.path,
    expect: {
      status: 200,
    },
  };

  // Generate json body with env var placeholders for credentials
  if (ep.requestBodySchema?.properties) {
    const json: Record<string, unknown> = {};
    for (const key of Object.keys(ep.requestBodySchema.properties)) {
      const lower = key.toLowerCase();
      if (lower === "username" || lower === "email" || lower === "login") {
        json[key] = "{{auth_username}}";
      } else if (lower === "password" || lower === "secret") {
        json[key] = "{{auth_password}}";
      } else {
        json[key] = generateFromSchema(
          ep.requestBodySchema.properties[key] as import("openapi-types").OpenAPIV3.SchemaObject,
          key,
        );
      }
    }
    step.json = json;
  }

  // Detect token field name from response schema
  const successResponse = ep.responses.find(
    (r) => r.statusCode >= 200 && r.statusCode < 300 && r.schema?.properties,
  );
  if (successResponse?.schema?.properties) {
    const tokenField = "access_token" in successResponse.schema.properties
      ? "access_token"
      : "token";
    step.expect.body = {
      [tokenField]: { capture: "auth_token", type: "string" },
    };
  }

  step.headers = { "Content-Type": "application/json" };

  return step;
}

function deriveGroupFromPath(path: string): string {
  // /pets/{petId} -> "pets", /health -> "health"
  const segments = path.split("/").filter(Boolean);
  return segments[0] ?? "default";
}

function buildStep(ep: EndpointInfo): RawStep {
  const pathWithPlaceholders = substitutePathParams(ep);
  const stepName = ep.summary ?? `${ep.method} ${ep.path}`;

  const step: RawStep = {
    name: stepName,
    [ep.method]: pathWithPlaceholders,
    expect: {},
  };

  // Headers from spec
  const headers: Record<string, string> = {};

  // Content-Type from requestBody
  if (ep.requestBodyContentType) {
    headers["Content-Type"] = ep.requestBodyContentType;
  }

  // Accept from response content types
  if (ep.responseContentTypes.length > 0) {
    headers["Accept"] = ep.responseContentTypes.includes("application/json")
      ? "application/json"
      : ep.responseContentTypes[0]!;
  }

  // Header parameters
  const headerParams = ep.parameters.filter((p) => p.in === "header");
  for (const p of headerParams) {
    headers[p.name] = generateParamPlaceholder(p);
  }

  if (Object.keys(headers).length > 0) {
    step.headers = headers;
  }

  // Request body
  if (ep.requestBodySchema) {
    step.json = generateFromSchema(ep.requestBodySchema);
  }

  // Query params — add as query map
  const queryParams = ep.parameters.filter((p) => p.in === "query");
  if (queryParams.length > 0) {
    const query: Record<string, string> = {};
    for (const p of queryParams) {
      query[p.name] = generateParamPlaceholder(p);
    }
    step.query = query;
  }

  // Find first 2xx response for happy-path assertions
  const happyResponse = ep.responses
    .filter((r) => r.statusCode >= 200 && r.statusCode < 300)
    .sort((a, b) => a.statusCode - b.statusCode)[0];

  if (happyResponse) {
    step.expect.status = happyResponse.statusCode;

    if (happyResponse.schema) {
      step.expect.body = buildBodyAssertions(happyResponse.schema);
    }
  }

  return step;
}

function substitutePathParams(ep: EndpointInfo): string {
  let path = ep.path;
  const pathParams = ep.parameters.filter((p) => p.in === "path");

  for (const param of pathParams) {
    const placeholder = generateParamPlaceholder(param);
    path = path.replace(`{${param.name}}`, placeholder);
  }

  return path;
}

function generateParamPlaceholder(param: import("openapi-types").OpenAPIV3.ParameterObject): string {
  const schema = param.schema as import("openapi-types").OpenAPIV3.SchemaObject | undefined;
  if (schema) {
    if (schema.type === "integer" || schema.type === "number") {
      return "{{$randomInt}}";
    }
    if (schema.format === "uuid") {
      return "{{$uuid}}";
    }
  }
  // Heuristic by name
  const lower = param.name.toLowerCase();
  if (lower.endsWith("id")) return "{{$randomInt}}";
  return "1";
}

function buildBodyAssertions(
  schema: import("openapi-types").OpenAPIV3.SchemaObject,
): Record<string, { type: string }> | undefined {
  if (schema.type === "object" && schema.properties) {
    const body: Record<string, { type: string }> = {};
    for (const [key, propSchema] of Object.entries(schema.properties)) {
      const prop = propSchema as import("openapi-types").OpenAPIV3.SchemaObject;
      const jsonType = openapiTypeToAssertionType(prop);
      if (jsonType) {
        body[key] = { type: jsonType };
      }
    }
    return Object.keys(body).length > 0 ? body : undefined;
  }

  if (schema.type === "array") {
    return undefined; // Can't do dot-path assertions on top-level array easily
  }

  return undefined;
}

function openapiTypeToAssertionType(schema: import("openapi-types").OpenAPIV3.SchemaObject): string | undefined {
  switch (schema.type) {
    case "string":
      return "string";
    case "integer":
    case "number":
      return "number";
    case "boolean":
      return "boolean";
    case "array":
      return "array";
    case "object":
      return "object";
    default:
      return undefined;
  }
}

/**
 * Write generated suites as YAML files to outputDir.
 */
export async function writeSuites(suites: RawSuite[], outputDir: string): Promise<string[]> {
  const { mkdir, access } = await import("node:fs/promises");
  await mkdir(outputDir, { recursive: true });

  const writtenFiles: string[] = [];

  for (const suite of suites) {
    const fileName = sanitizeFileName(suite.name) + ".yaml";
    const filePath = `${outputDir}/${fileName}`;

    // Skip existing files (incremental generation)
    try {
      await access(filePath);
      continue; // File exists, skip
    } catch {
      // File doesn't exist, write it
    }

    const yamlContent = serializeSuite(suite);
    await Bun.write(filePath, yamlContent);
    writtenFiles.push(filePath);
  }

  return writtenFiles;
}

function sanitizeFileName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * Serialize a suite to YAML string.
 * We build it manually to ensure the method-as-key shorthand format
 * (e.g., `POST: /users`) that our parser expects.
 */
export function serializeSuite(suite: RawSuite): string {
  const lines: string[] = [];
  lines.push(`name: ${yamlScalar(suite.name)}`);
  if (suite.base_url) {
    lines.push(`base_url: ${yamlScalar(suite.base_url)}`);
  }
  if (suite.headers && Object.keys(suite.headers).length > 0) {
    lines.push("headers:");
    for (const [hk, hv] of Object.entries(suite.headers)) {
      lines.push(`  ${hk}: ${yamlScalar(String(hv))}`);
    }
  }
  lines.push("tests:");

  for (const test of suite.tests) {
    lines.push(`  - name: ${yamlScalar(test.name)}`);

    // Write method-as-key (the shorthand)
    for (const method of ["GET", "POST", "PUT", "PATCH", "DELETE"]) {
      if (method in test) {
        lines.push(`    ${method}: ${test[method]}`);
      }
    }

    // headers
    if (test.headers && Object.keys(test.headers as Record<string, string>).length > 0) {
      lines.push("    headers:");
      for (const [hk, hv] of Object.entries(test.headers as Record<string, string>)) {
        lines.push(`      ${hk}: ${yamlScalar(String(hv))}`);
      }
    }

    // json body
    if (test.json !== undefined) {
      lines.push("    json:");
      serializeValue(test.json, 3, lines);
    }

    // query
    if (test.query) {
      lines.push("    query:");
      serializeValue(test.query, 3, lines);
    }

    // expect
    lines.push("    expect:");
    if (test.expect.status !== undefined) {
      lines.push(`      status: ${test.expect.status}`);
    }
    if (test.expect.body) {
      lines.push("      body:");
      for (const [key, rule] of Object.entries(test.expect.body)) {
        lines.push(`        ${key}:`);
        for (const [rk, rv] of Object.entries(rule)) {
          lines.push(`          ${rk}: ${yamlScalar(String(rv))}`);
        }
      }
    }
  }

  return lines.join("\n") + "\n";
}

function serializeValue(value: unknown, indent: number, lines: string[]): void {
  const prefix = "  ".repeat(indent);

  if (value === null || value === undefined) {
    lines.push(`${prefix}null`);
    return;
  }

  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    lines.push(`${prefix}${yamlScalar(String(value))}`);
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      if (typeof item === "object" && item !== null && !Array.isArray(item)) {
        const entries = Object.entries(item as Record<string, unknown>);
        if (entries.length > 0) {
          const [firstKey, firstVal] = entries[0]!;
          lines.push(`${prefix}- ${firstKey}: ${formatInlineValue(firstVal)}`);
          for (let i = 1; i < entries.length; i++) {
            const [k, v] = entries[i]!;
            lines.push(`${prefix}  ${k}: ${formatInlineValue(v)}`);
          }
        } else {
          lines.push(`${prefix}- {}`);
        }
      } else {
        lines.push(`${prefix}- ${formatInlineValue(item)}`);
      }
    }
    return;
  }

  if (typeof value === "object") {
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      if (typeof val === "object" && val !== null) {
        lines.push(`${prefix}${key}:`);
        serializeValue(val, indent + 1, lines);
      } else {
        lines.push(`${prefix}${key}: ${formatInlineValue(val)}`);
      }
    }
  }
}

function formatInlineValue(val: unknown): string {
  if (val === null || val === undefined) return "null";
  if (typeof val === "string") return yamlScalar(val);
  return String(val);
}

function yamlScalar(value: string): string {
  // If it contains special YAML chars or looks like it needs quoting, quote it
  if (
    value === "" ||
    value === "true" ||
    value === "false" ||
    value === "null" ||
    value.includes(":") ||
    value.includes("#") ||
    value.includes("\n") ||
    value.includes("'") ||
    value.includes('"') ||
    value.includes("{") ||
    value.includes("}") ||
    value.includes("[") ||
    value.includes("]") ||
    value.startsWith("&") ||
    value.startsWith("*") ||
    value.startsWith("!") ||
    value.startsWith("%") ||
    value.startsWith("@") ||
    value.startsWith("`") ||
    /^\d+$/.test(value)
  ) {
    // Use double quotes, escape internal double quotes
    return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  }
  return value;
}
