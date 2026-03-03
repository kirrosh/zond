import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { OpenAPIV3 } from "openapi-types";
import { readOpenApiSpec } from "../../core/generator/index.ts";

function generateTestSnippet(params: {
  method: string;
  path: string;
  operationId?: string;
  pathParams: string[];
  queryParams: Array<{ name: string; required?: boolean }>;
  requestBody?: { required?: boolean; schema?: OpenAPIV3.SchemaObject };
  hasSecurity: boolean;
  successStatus: string;
}): string {
  const { method, path, operationId, pathParams, queryParams, requestBody, hasSecurity, successStatus } = params;

  // Build URL with path params as {{paramName}}
  const urlPath = path.replace(/\{([^}]+)\}/g, (_, name) => `{{${name}}}`);
  const url = `{{base_url}}${urlPath}`;

  const lines: string[] = [];
  const testName = operationId ?? `${method} ${path}`;
  lines.push(`- name: "${testName}"`);
  lines.push(`  ${method}: "${url}"`);

  if (hasSecurity) {
    lines.push(`  headers:`);
    lines.push(`    Authorization: "Bearer {{auth_token}}"`);
  }

  // Required query params
  const requiredQuery = queryParams.filter(p => p.required);
  if (requiredQuery.length > 0) {
    lines.push(`  query:`);
    for (const p of requiredQuery) {
      lines.push(`    ${p.name}: "{{${p.name}}}"`);
    }
  }

  // Request body for POST/PUT/PATCH
  if (requestBody && ["POST", "PUT", "PATCH"].includes(method)) {
    const schema = requestBody.schema as OpenAPIV3.SchemaObject | undefined;
    const required = Array.isArray(schema?.required) ? schema.required : [];
    const properties = schema?.properties as Record<string, OpenAPIV3.SchemaObject> | undefined;
    if (properties && Object.keys(properties).length > 0) {
      lines.push(`  json:`);
      for (const [propName, propSchema] of Object.entries(properties)) {
        if (!required.includes(propName)) continue;
        const type = (propSchema as OpenAPIV3.SchemaObject).type ?? "string";
        const placeholder = type === "integer" || type === "number" ? 0 : type === "boolean" ? false : `"{{${propName}}}"`;
        lines.push(`    ${propName}: ${placeholder}`);
      }
    }
  }

  lines.push(`  expect:`);
  lines.push(`    status: ${successStatus}`);

  return lines.join("\n");
}

export function registerDescribeEndpointTool(server: McpServer) {
  server.registerTool("describe_endpoint", {
    description:
      "Full details for one endpoint: params grouped by type, request body schema, " +
      "all response schemas + response headers, security, deprecated flag. " +
      "Use when a test fails and you need complete endpoint spec without reading the whole file.",
    inputSchema: {
      specPath: z.string().describe("Path to OpenAPI spec file (JSON or YAML) or HTTP URL"),
      method: z.string().describe('HTTP method, e.g. "GET", "POST", "PUT"'),
      path: z.string().describe('Endpoint path, e.g. "/pets/{petId}"'),
    },
  }, async ({ specPath, method, path: endpointPath }) => {
    try {
      const doc = await readOpenApiSpec(specPath) as OpenAPIV3.Document;

      // Normalize inputs
      const methodLower = method.toLowerCase() as OpenAPIV3.HttpMethods;
      const normalizedPath = endpointPath.replace(/\/+$/, "") || "/";

      // Find operation — try exact match first, then case-insensitive path match
      let operation: OpenAPIV3.OperationObject | undefined;
      let resolvedPath = normalizedPath;

      const paths = doc.paths ?? {};

      if (paths[normalizedPath]?.[methodLower]) {
        operation = paths[normalizedPath][methodLower] as OpenAPIV3.OperationObject;
      } else {
        // Case-insensitive fallback
        const lowerTarget = normalizedPath.toLowerCase();
        for (const [p, pathItem] of Object.entries(paths)) {
          if (p.toLowerCase() === lowerTarget && pathItem?.[methodLower]) {
            operation = pathItem[methodLower] as OpenAPIV3.OperationObject;
            resolvedPath = p;
            break;
          }
        }
      }

      if (!operation) {
        const available = Object.entries(paths).flatMap(([p, pathItem]) =>
          Object.keys(pathItem ?? {})
            .filter(k => ["get","post","put","patch","delete","head","options","trace"].includes(k))
            .map(k => `${k.toUpperCase()} ${p}`)
        ).sort();
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({
              error: `Endpoint ${method.toUpperCase()} ${endpointPath} not found in spec`,
              availableEndpoints: available,
            }, null, 2),
          }],
          isError: true,
        };
      }

      const pathItem = paths[resolvedPath] ?? {};

      // Merge path-level and operation-level parameters (operation overrides by name+in)
      const pathLevelParams = (pathItem.parameters ?? []) as OpenAPIV3.ParameterObject[];
      const opLevelParams = (operation.parameters ?? []) as OpenAPIV3.ParameterObject[];

      const paramMap = new Map<string, OpenAPIV3.ParameterObject>();
      for (const p of pathLevelParams) paramMap.set(`${p.in}:${p.name}`, p);
      for (const p of opLevelParams) paramMap.set(`${p.in}:${p.name}`, p); // operation overrides

      // Group by "in"
      const grouped: Record<string, object[]> = { path: [], query: [], header: [], cookie: [] };
      for (const p of paramMap.values()) {
        const loc = p.in in grouped ? p.in : "query";
        const schema = p.schema as OpenAPIV3.SchemaObject | undefined;
        grouped[loc]!.push({
          name: p.name,
          required: p.required ?? false,
          ...(schema?.type ? { type: schema.type } : {}),
          ...(schema?.format ? { format: schema.format } : {}),
          ...(schema?.enum ? { enum: schema.enum } : {}),
          ...(schema?.default !== undefined ? { default: schema.default } : {}),
          ...(p.description ? { description: p.description } : {}),
        });
      }

      // Request body
      let requestBody: object | undefined;
      if (operation.requestBody) {
        const rb = operation.requestBody as OpenAPIV3.RequestBodyObject;
        const contentTypes = Object.keys(rb.content ?? {});
        const preferredCt = contentTypes.find(ct => ct.includes("application/json")) ?? contentTypes[0];
        const mediaObj = preferredCt ? rb.content[preferredCt] : undefined;
        requestBody = {
          required: rb.required ?? false,
          ...(preferredCt ? { contentType: preferredCt } : {}),
          ...(mediaObj?.schema ? { schema: mediaObj.schema } : {}),
          ...(rb.description ? { description: rb.description } : {}),
        };
      }

      // Responses
      const responses: Record<string, object> = {};
      for (const [statusCode, respObj] of Object.entries(operation.responses ?? {})) {
        const resp = respObj as OpenAPIV3.ResponseObject;
        const contentTypes = Object.keys(resp.content ?? {});
        const preferredCt = contentTypes.find(ct => ct.includes("application/json")) ?? contentTypes[0];
        const mediaObj = preferredCt ? resp.content?.[preferredCt] : undefined;

        // Response headers
        const headers: Record<string, object> = {};
        for (const [hName, hObj] of Object.entries(resp.headers ?? {})) {
          const h = hObj as OpenAPIV3.HeaderObject;
          headers[hName] = {
            ...(h.description ? { description: h.description } : {}),
            ...(h.schema ? { schema: h.schema } : {}),
          };
        }

        responses[statusCode] = {
          description: resp.description,
          headers,
          ...(preferredCt ? { contentType: preferredCt } : {}),
          ...(mediaObj?.schema ? { schema: mediaObj.schema } : {}),
        };
      }

      // Security — merge doc-level and operation-level
      const docSecurity = (doc.security ?? []) as OpenAPIV3.SecurityRequirementObject[];
      const opSecurity = (operation.security ?? docSecurity) as OpenAPIV3.SecurityRequirementObject[];
      const securityNames = [...new Set(opSecurity.flatMap(req => Object.keys(req)))];

      // Derive success status (first 2xx, or first response code)
      const responseCodes = Object.keys(operation.responses ?? {});
      const successStatus = responseCodes.find(c => c.startsWith("2")) ?? responseCodes[0] ?? "200";

      // Build testSnippet
      const pathParamNames = [...paramMap.values()]
        .filter(p => p.in === "path")
        .map(p => p.name);
      const queryParamsList = [...paramMap.values()]
        .filter(p => p.in === "query")
        .map(p => ({ name: p.name, required: p.required }));
      const reqBodyForSnippet = requestBody
        ? { required: (operation.requestBody as OpenAPIV3.RequestBodyObject)?.required, schema: (requestBody as any).schema }
        : undefined;

      const testSnippet = generateTestSnippet({
        method: method.toUpperCase(),
        path: resolvedPath,
        operationId: operation.operationId,
        pathParams: pathParamNames,
        queryParams: queryParamsList,
        requestBody: reqBodyForSnippet,
        hasSecurity: securityNames.length > 0,
        successStatus,
      });

      const result = {
        method: method.toUpperCase(),
        path: resolvedPath,
        ...(operation.operationId ? { operationId: operation.operationId } : {}),
        ...(operation.summary ? { summary: operation.summary } : {}),
        ...(operation.description ? { description: operation.description } : {}),
        ...(operation.tags?.length ? { tags: operation.tags } : {}),
        deprecated: operation.deprecated ?? false,
        security: securityNames,
        parameters: grouped,
        ...(requestBody ? { requestBody } : {}),
        responses,
        testSnippet,
      };

      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      };
    } catch (err) {
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ error: (err as Error).message }, null, 2) }],
        isError: true,
      };
    }
  });
}
