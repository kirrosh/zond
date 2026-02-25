import type { EndpointInfo } from "./types.ts";
import { generateFromSchema } from "./data-factory.ts";

interface RawStep {
  name: string;
  [methodKey: string]: unknown;
  expect: {
    status?: number;
    body?: Record<string, { type: string }>;
  };
}

interface RawSuite {
  name: string;
  base_url?: string;
  tests: RawStep[];
}

/**
 * Generate skeleton test suites from extracted OpenAPI endpoints.
 * Groups endpoints by first tag (or path prefix).
 */
export function generateSkeleton(endpoints: EndpointInfo[], baseUrl?: string): RawSuite[] {
  // Group by tag
  const groups = new Map<string, EndpointInfo[]>();

  for (const ep of endpoints) {
    const group = ep.tags[0] ?? deriveGroupFromPath(ep.path);
    if (!groups.has(group)) {
      groups.set(group, []);
    }
    groups.get(group)!.push(ep);
  }

  const suites: RawSuite[] = [];

  for (const [groupName, eps] of groups) {
    const tests: RawStep[] = [];

    for (const ep of eps) {
      const step = buildStep(ep);
      tests.push(step);
    }

    const suite: RawSuite = { name: groupName, tests };
    if (baseUrl) {
      suite.base_url = baseUrl;
    }
    suites.push(suite);
  }

  return suites;
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
  const { mkdir } = await import("node:fs/promises");
  await mkdir(outputDir, { recursive: true });

  const writtenFiles: string[] = [];

  for (const suite of suites) {
    const fileName = sanitizeFileName(suite.name) + ".yaml";
    const filePath = `${outputDir}/${fileName}`;

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
function serializeSuite(suite: RawSuite): string {
  const lines: string[] = [];
  lines.push(`name: ${yamlScalar(suite.name)}`);
  if (suite.base_url) {
    lines.push(`base_url: ${yamlScalar(suite.base_url)}`);
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
