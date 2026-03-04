import { dereference } from "@readme/openapi-parser";
import type { OpenAPIV3 } from "openapi-types";
import type { EndpointInfo, ResponseInfo, SecuritySchemeInfo } from "./types.ts";

const HTTP_METHODS = ["get", "post", "put", "patch", "delete"] as const;

export async function readOpenApiSpec(specPath: string): Promise<OpenAPIV3.Document> {
  // For HTTP URLs, fetch the spec first then dereference the parsed object
  if (specPath.startsWith("http://") || specPath.startsWith("https://")) {
    const resp = await fetch(specPath);
    if (!resp.ok) throw new Error(`Failed to fetch spec: ${resp.status} ${resp.statusText}`);
    const spec = await resp.json();
    const api = await dereference(spec as string);
    return api as OpenAPIV3.Document;
  }
  const api = await dereference(specPath);
  return api as OpenAPIV3.Document;
}

export function extractSecuritySchemes(doc: OpenAPIV3.Document): SecuritySchemeInfo[] {
  const schemes: SecuritySchemeInfo[] = [];
  const securitySchemes = doc.components?.securitySchemes;
  if (!securitySchemes) return schemes;

  for (const [name, schemeObj] of Object.entries(securitySchemes)) {
    const scheme = schemeObj as OpenAPIV3.SecuritySchemeObject;
    const info: SecuritySchemeInfo = {
      name,
      type: scheme.type as SecuritySchemeInfo["type"],
    };
    if (scheme.type === "http") {
      info.scheme = scheme.scheme;
      info.bearerFormat = scheme.bearerFormat;
    }
    if (scheme.type === "apiKey") {
      info.in = scheme.in;
      info.apiKeyName = scheme.name;
    }
    schemes.push(info);
  }
  return schemes;
}

export function extractEndpoints(doc: OpenAPIV3.Document): EndpointInfo[] {
  const endpoints: EndpointInfo[] = [];

  if (!doc.paths) return endpoints;

  for (const [path, pathItem] of Object.entries(doc.paths)) {
    if (!pathItem) continue;

    for (const method of HTTP_METHODS) {
      const operation = pathItem[method] as OpenAPIV3.OperationObject | undefined;
      if (!operation) continue;

      const parameters: OpenAPIV3.ParameterObject[] = [];

      // Path-level parameters
      if (pathItem.parameters) {
        for (const p of pathItem.parameters) {
          parameters.push(p as OpenAPIV3.ParameterObject);
        }
      }

      // Operation-level parameters (override path-level)
      if (operation.parameters) {
        for (const p of operation.parameters) {
          const param = p as OpenAPIV3.ParameterObject;
          const existingIdx = parameters.findIndex(
            (existing) => existing.name === param.name && existing.in === param.in,
          );
          if (existingIdx >= 0) {
            parameters[existingIdx] = param;
          } else {
            parameters.push(param);
          }
        }
      }

      // Request body schema + content type
      let requestBodySchema: OpenAPIV3.SchemaObject | undefined;
      let requestBodyContentType: string | undefined;
      if (operation.requestBody) {
        const rb = operation.requestBody as OpenAPIV3.RequestBodyObject;
        if (rb.content) {
          // Prefer application/json, fall back to first available
          const contentTypes = Object.keys(rb.content);
          requestBodyContentType = contentTypes.includes("application/json")
            ? "application/json"
            : contentTypes[0];
          const chosen = rb.content[requestBodyContentType!];
          if (chosen?.schema) {
            requestBodySchema = chosen.schema as OpenAPIV3.SchemaObject;
          }
        }
      }

      // Responses
      const responses: ResponseInfo[] = [];
      const responseContentTypesSet = new Set<string>();
      if (operation.responses) {
        for (const [statusCode, responseObj] of Object.entries(operation.responses)) {
          const resp = responseObj as OpenAPIV3.ResponseObject;
          const info: ResponseInfo = {
            statusCode: parseInt(statusCode, 10),
            description: resp.description || "",
          };
          if (resp.content) {
            for (const ct of Object.keys(resp.content)) {
              responseContentTypesSet.add(ct);
            }
            const jsonContent = resp.content["application/json"];
            if (jsonContent?.schema) {
              info.schema = jsonContent.schema as OpenAPIV3.SchemaObject;
            }
          }
          responses.push(info);
        }
      }

      // Security: operation-level overrides doc-level
      const securityReqs = operation.security ?? doc.security ?? [];
      const security = securityReqs.flatMap((req) => Object.keys(req));

      endpoints.push({
        path,
        method: method.toUpperCase(),
        operationId: operation.operationId,
        summary: operation.summary,
        tags: operation.tags ?? [],
        parameters,
        requestBodySchema,
        requestBodyContentType,
        responseContentTypes: [...responseContentTypesSet],
        responses,
        security,
        deprecated: operation.deprecated ?? false,
      });
    }
  }

  return endpoints;
}
