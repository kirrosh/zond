import { dereference } from "@readme/openapi-parser";
import type { OpenAPIV3 } from "openapi-types";
import type { EndpointInfo, ResponseInfo } from "./types.ts";

const HTTP_METHODS = ["get", "post", "put", "patch", "delete"] as const;

export async function readOpenApiSpec(specPath: string): Promise<OpenAPIV3.Document> {
  const api = await dereference(specPath);
  return api as OpenAPIV3.Document;
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
      });
    }
  }

  return endpoints;
}
