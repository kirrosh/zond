import type { EndpointInfo, SecuritySchemeInfo, CrudGroup } from "./types.ts";
import { generateFromSchema } from "./data-factory.ts";
import type { OpenAPIV3 } from "openapi-types";

interface RawStep {
  name: string;
  [methodKey: string]: unknown;
  expect: {
    status?: number;
    body?: Record<string, Record<string, string>>;
  };
}

interface RawSuite {
  name: string;
  base_url?: string;
  headers?: Record<string, string>;
  tests: RawStep[];
}

/**
 * Detect CRUD groups from endpoints.
 *
 * Groups endpoints by resource path, looking for patterns like:
 *   POST /pets        (create)
 *   GET  /pets        (list)
 *   GET  /pets/{id}   (read)
 *   PUT  /pets/{id}   (update)  — or PATCH
 *   DELETE /pets/{id} (delete)
 *
 * Returns only groups with at least POST + one other method on the item path.
 */
export function detectCrudGroups(endpoints: EndpointInfo[]): CrudGroup[] {
  // Map: normalized base path → { basePath endpoints, itemPath endpoints, idParam }
  const pathMap = new Map<string, {
    basePath: string;
    itemPath: string | null;
    idParam: string | null;
    endpoints: EndpointInfo[];
  }>();

  for (const ep of endpoints) {
    const segments = ep.path.split("/").filter(Boolean);
    // Build normalized key: replace {param} segments with *
    const normalizedSegments = segments.map(s => s.startsWith("{") ? "*" : s);

    // Find the base resource path (segments before first {param})
    const firstParamIdx = segments.findIndex(s => s.startsWith("{"));
    let baseKey: string;
    let isItemPath: boolean;
    let idParam: string | null = null;

    if (firstParamIdx === -1) {
      // No path params: e.g. /pets, /auth/login
      baseKey = "/" + segments.join("/");
      isItemPath = false;
    } else {
      // Has path params: e.g. /pets/{id}
      baseKey = "/" + segments.slice(0, firstParamIdx).join("/");
      isItemPath = true;
      // Extract the param name (remove { and })
      const paramSegment = segments[firstParamIdx]!;
      idParam = paramSegment.slice(1, -1);
    }

    if (!pathMap.has(baseKey)) {
      pathMap.set(baseKey, {
        basePath: baseKey,
        itemPath: null,
        idParam: null,
        endpoints: [],
      });
    }

    const group = pathMap.get(baseKey)!;
    group.endpoints.push(ep);
    if (isItemPath && idParam) {
      group.itemPath = ep.path;
      group.idParam = idParam;
    }
  }

  // Now build CrudGroups from the path map
  const crudGroups: CrudGroup[] = [];

  for (const [, info] of pathMap) {
    if (!info.itemPath || !info.idParam) continue;

    const group: CrudGroup = {
      resource: deriveResourceName(info.basePath),
      basePath: info.basePath,
      itemPath: info.itemPath,
      idParam: info.idParam,
    };

    for (const ep of info.endpoints) {
      const hasPathParam = ep.path.includes("{");
      const method = ep.method.toUpperCase();

      if (!hasPathParam && method === "POST") {
        group.create = ep;
      } else if (!hasPathParam && method === "GET") {
        group.list = ep;
      } else if (hasPathParam && method === "GET") {
        group.read = ep;
      } else if (hasPathParam && (method === "PUT" || method === "PATCH")) {
        group.update = ep;
      } else if (hasPathParam && method === "DELETE") {
        group.delete = ep;
      }
    }

    // Must have POST (create) + at least one item-level method
    if (group.create && (group.read || group.update || group.delete)) {
      crudGroups.push(group);
    }
  }

  return crudGroups;
}

/**
 * Generate a CRUD chain test suite for a CrudGroup.
 * Produces a POST→GET→PUT→DELETE chain with captures.
 */
export function generateCrudChain(
  group: CrudGroup,
  baseUrl?: string,
  securitySchemes?: SecuritySchemeInfo[],
  loginEndpoint?: EndpointInfo,
): RawSuite {
  const captureVar = `${singularize(group.resource)}_${group.idParam}`;
  const tests: RawStep[] = [];

  // Detect auth
  const bearerScheme = securitySchemes?.find(
    s => s.type === "http" && s.scheme === "bearer",
  );
  const apiKeySchemes = securitySchemes?.filter(s => s.type === "apiKey") ?? [];
  const basicScheme = securitySchemes?.find(
    s => s.type === "http" && s.scheme === "basic",
  );
  const needsAuth = group.create?.security?.length ?? 0 > 0;

  const suite: RawSuite = {
    name: `${group.resource} CRUD`,
    tests,
  };

  if (baseUrl) suite.base_url = baseUrl;

  // Add auth headers and login step
  if (needsAuth) {
    if (bearerScheme && loginEndpoint) {
      tests.push(buildCrudLoginStep(loginEndpoint));
      suite.headers = { Authorization: "Bearer {{auth_token}}" };
    }
    for (const apiKey of apiKeySchemes) {
      if (apiKey.in === "header" && apiKey.apiKeyName) {
        if (!suite.headers) suite.headers = {};
        const envVar = apiKey.name.replace(/[^a-zA-Z0-9]/g, "_").toLowerCase();
        suite.headers[apiKey.apiKeyName] = `{{${envVar}}}`;
      }
    }
    if (basicScheme) {
      if (!suite.headers) suite.headers = {};
      suite.headers.Authorization = suite.headers.Authorization ?? "Basic {{basic_credentials}}";
    }
  }

  // Step 1: Create
  if (group.create) {
    tests.push(buildCreateStep(group, captureVar));
  }

  // Step 2: Read (verify created)
  if (group.read) {
    tests.push(buildReadStep(group, captureVar));
  }

  // Step 3: Update
  if (group.update) {
    tests.push(buildUpdateStep(group, captureVar));
  }

  // Step 4: Delete
  if (group.delete) {
    tests.push(buildDeleteStep(group, captureVar));
  }

  // Step 5: Verify deleted (only if both delete and read exist)
  if (group.delete && group.read) {
    tests.push(buildVerifyDeletedStep(group, captureVar));
  }

  return suite;
}

/**
 * Get all endpoints that belong to any of the given CRUD groups.
 */
export function getCrudEndpoints(groups: CrudGroup[]): Set<EndpointInfo> {
  const set = new Set<EndpointInfo>();
  for (const g of groups) {
    if (g.create) set.add(g.create);
    if (g.list) set.add(g.list);
    if (g.read) set.add(g.read);
    if (g.update) set.add(g.update);
    if (g.delete) set.add(g.delete);
  }
  return set;
}

// ── Internal helpers ──────────────────────────────────

function buildCrudLoginStep(ep: EndpointInfo): RawStep {
  const step: RawStep = {
    name: "Auth: Login",
    POST: ep.path,
    expect: { status: 200 },
  };

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
          ep.requestBodySchema.properties[key] as OpenAPIV3.SchemaObject,
          key,
        );
      }
    }
    step.json = json;
  }

  const successResponse = ep.responses.find(
    r => r.statusCode >= 200 && r.statusCode < 300 && r.schema?.properties,
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

function buildCreateStep(group: CrudGroup, captureVar: string): RawStep {
  const ep = group.create!;
  const successResponse = ep.responses
    .filter(r => r.statusCode >= 200 && r.statusCode < 300)
    .sort((a, b) => a.statusCode - b.statusCode)[0];

  const expectedStatus = successResponse?.statusCode ?? 201;

  const step: RawStep = {
    name: `Create ${singularize(group.resource)}`,
    POST: group.basePath,
    expect: { status: expectedStatus },
  };

  // Generate request body
  if (ep.requestBodySchema) {
    step.json = generateFromSchema(ep.requestBodySchema);
  }

  // Build response assertions with capture for the ID field
  if (successResponse?.schema?.properties) {
    const props = successResponse.schema.properties;
    const body: Record<string, Record<string, string>> = {};

    // Find the ID field to capture
    const idFieldName = findIdField(props, group.idParam);
    if (idFieldName) {
      const idSchema = props[idFieldName] as OpenAPIV3.SchemaObject;
      const idType = openapiTypeToAssertionType(idSchema) ?? "number";
      body[idFieldName] = { capture: captureVar, type: idType };
    }

    // Add type assertions for other fields
    for (const [key, propSchema] of Object.entries(props)) {
      if (key === idFieldName) continue;
      const prop = propSchema as OpenAPIV3.SchemaObject;
      const jsonType = openapiTypeToAssertionType(prop);
      if (jsonType) {
        body[key] = { type: jsonType };
      }
    }

    if (Object.keys(body).length > 0) {
      step.expect.body = body;
    }
  }

  step.headers = { "Content-Type": "application/json" };
  return step;
}

function buildReadStep(group: CrudGroup, captureVar: string): RawStep {
  const ep = group.read!;
  const itemPath = group.itemPath.replace(`{${group.idParam}}`, `{{${captureVar}}}`);

  const successResponse = ep.responses
    .filter(r => r.statusCode >= 200 && r.statusCode < 300)
    .sort((a, b) => a.statusCode - b.statusCode)[0];

  const step: RawStep = {
    name: `Get created ${singularize(group.resource)}`,
    GET: itemPath,
    expect: { status: successResponse?.statusCode ?? 200 },
  };

  // Build body assertions
  if (successResponse?.schema?.properties) {
    const props = successResponse.schema.properties;
    const body: Record<string, Record<string, string>> = {};

    const idFieldName = findIdField(props, group.idParam);
    if (idFieldName) {
      body[idFieldName] = { equals: `{{${captureVar}}}` };
    }

    for (const [key, propSchema] of Object.entries(props)) {
      if (key === idFieldName) continue;
      const prop = propSchema as OpenAPIV3.SchemaObject;
      const jsonType = openapiTypeToAssertionType(prop);
      if (jsonType) {
        body[key] = { type: jsonType };
      }
    }

    if (Object.keys(body).length > 0) {
      step.expect.body = body;
    }
  }

  return step;
}

function buildUpdateStep(group: CrudGroup, captureVar: string): RawStep {
  const ep = group.update!;
  const method = ep.method.toUpperCase();
  const itemPath = group.itemPath.replace(`{${group.idParam}}`, `{{${captureVar}}}`);

  const successResponse = ep.responses
    .filter(r => r.statusCode >= 200 && r.statusCode < 300)
    .sort((a, b) => a.statusCode - b.statusCode)[0];

  const step: RawStep = {
    name: `Update ${singularize(group.resource)}`,
    [method]: itemPath,
    expect: { status: successResponse?.statusCode ?? 200 },
  };

  // Generate update body: one string field gets "Updated FieldName", rest are random
  if (ep.requestBodySchema) {
    const body = generateUpdateBody(ep.requestBodySchema);
    step.json = body.json;

    // Build response assertions with equals check on the updated field
    if (successResponse?.schema?.properties && body.updatedField) {
      const respBody: Record<string, Record<string, string>> = {};

      if (body.updatedField) {
        respBody[body.updatedField] = { equals: body.updatedValue! };
      }

      const idFieldName = findIdField(successResponse.schema.properties, group.idParam);
      if (idFieldName) {
        respBody[idFieldName] = { equals: `{{${captureVar}}}` };
      }

      if (Object.keys(respBody).length > 0) {
        step.expect.body = respBody;
      }
    }
  }

  step.headers = { "Content-Type": "application/json" };
  return step;
}

function buildDeleteStep(group: CrudGroup, captureVar: string): RawStep {
  const ep = group.delete!;
  const itemPath = group.itemPath.replace(`{${group.idParam}}`, `{{${captureVar}}}`);

  const successResponse = ep.responses
    .filter(r => r.statusCode >= 200 && r.statusCode < 300)
    .sort((a, b) => a.statusCode - b.statusCode)[0];

  return {
    name: `Delete ${singularize(group.resource)}`,
    DELETE: itemPath,
    expect: { status: successResponse?.statusCode ?? 204 },
  };
}

function buildVerifyDeletedStep(group: CrudGroup, captureVar: string): RawStep {
  const itemPath = group.itemPath.replace(`{${group.idParam}}`, `{{${captureVar}}}`);

  return {
    name: `Verify ${singularize(group.resource)} deleted`,
    GET: itemPath,
    expect: { status: 404 },
  };
}

// ── Utility functions ──────────────────────────────────

function deriveResourceName(basePath: string): string {
  const segments = basePath.split("/").filter(Boolean);
  return segments[segments.length - 1] ?? "resource";
}

function singularize(name: string): string {
  if (name.endsWith("ies")) return name.slice(0, -3) + "y";
  if (name.endsWith("ses") || name.endsWith("xes") || name.endsWith("zes")) return name.slice(0, -2);
  if (name.endsWith("s") && !name.endsWith("ss")) return name.slice(0, -1);
  return name;
}

function findIdField(
  properties: Record<string, OpenAPIV3.SchemaObject | OpenAPIV3.ReferenceObject>,
  idParam: string,
): string | null {
  // Exact match with idParam name
  if (idParam in properties) return idParam;
  // Try "id" as fallback
  if ("id" in properties) return "id";
  // Try "{resource}Id" pattern
  for (const key of Object.keys(properties)) {
    if (key.toLowerCase() === "id" || key.toLowerCase().endsWith("id")) {
      return key;
    }
  }
  return null;
}

function generateUpdateBody(schema: OpenAPIV3.SchemaObject): {
  json: Record<string, unknown>;
  updatedField: string | null;
  updatedValue: string | null;
} {
  const json: Record<string, unknown> = {};
  let updatedField: string | null = null;
  let updatedValue: string | null = null;

  if (schema.properties) {
    for (const [key, propSchema] of Object.entries(schema.properties)) {
      const prop = propSchema as OpenAPIV3.SchemaObject;

      // For the first string field (non-enum), use a static "Updated" value
      if (!updatedField && prop.type === "string" && !prop.enum) {
        const capitalized = key.charAt(0).toUpperCase() + key.slice(1);
        updatedValue = `Updated ${capitalized}`;
        updatedField = key;
        json[key] = updatedValue;
      } else {
        json[key] = generateFromSchema(prop, key);
      }
    }
  }

  return { json, updatedField, updatedValue };
}

function openapiTypeToAssertionType(schema: OpenAPIV3.SchemaObject): string | undefined {
  switch (schema.type) {
    case "string": return "string";
    case "integer":
    case "number": return "number";
    case "boolean": return "boolean";
    case "array": return "array";
    case "object": return "object";
    default: return undefined;
  }
}
