import { dereference } from "@readme/openapi-parser";
import type { OpenAPIV3 } from "openapi-types";
import type { EndpointInfo, ResponseInfo, SecuritySchemeInfo } from "./types.ts";
import { disambiguateGenericPathParams } from "./path-param-disambig.ts";

const HTTP_METHODS = ["get", "post", "put", "patch", "delete"] as const;

export async function readOpenApiSpec(specPath: string, options?: { insecure?: boolean }): Promise<OpenAPIV3.Document> {
  // For HTTP URLs, fetch the spec first then dereference the parsed object
  if (specPath.startsWith("http://") || specPath.startsWith("https://")) {
    const resp = await fetch(specPath, {
      ...(options?.insecure ? { tls: { rejectUnauthorized: false } } : {}),
    });
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
            // OpenAPI allows examples at the media-type level (sibling to schema).
            // Lift them onto the schema so the generator sees a single signal.
            if (requestBodySchema.example === undefined) {
              if ((chosen as OpenAPIV3.MediaTypeObject).example !== undefined) {
                requestBodySchema = {
                  ...requestBodySchema,
                  example: (chosen as OpenAPIV3.MediaTypeObject).example,
                };
              } else if (chosen.examples) {
                const firstNamed = Object.values(chosen.examples)[0];
                if (firstNamed && typeof firstNamed === "object" && "value" in firstNamed) {
                  requestBodySchema = {
                    ...requestBodySchema,
                    example: (firstNamed as OpenAPIV3.ExampleObject).value,
                  };
                }
              }
            }
          }
        }
      }

      // Responses
      const responses: ResponseInfo[] = [];
      const responseContentTypesSet = new Set<string>();
      if (operation.responses) {
        for (const [statusCode, responseObj] of Object.entries(operation.responses)) {
          const parsedStatus = parseInt(statusCode, 10);
          // Skip non-numeric keys like "default" — they have no asserting status code.
          if (!Number.isFinite(parsedStatus)) continue;
          const resp = responseObj as OpenAPIV3.ResponseObject;
          const info: ResponseInfo = {
            statusCode: parsedStatus,
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

      // ETag optimistic locking: detect if endpoint requires If-Match header
      const requiresEtag =
        responses.some(r => r.statusCode === 412) ||
        parameters.some(p => p.name.toLowerCase() === "if-match" && p.in === "header");

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
        deprecated: (operation.deprecated ?? false) || isMarkedDeprecatedInText(operation.summary, operation.description, operation.operationId),
        requiresEtag,
      });
    }
  }

  // ARV-40: when generic path-param names (`{id}`, `{slug}`, ...) collide
  // across multiple resources, rewrite each to `<parent_singular>_<param>`
  // so the manifest derives per-resource vars and tests stop sharing one
  // global `id`. In-memory only; on-disk spec stays untouched.
  return disambiguateGenericPathParams(endpoints);
}

/** Spec authors often mark endpoints as deprecated in the summary or
 *  description text instead of (or in addition to) the `deprecated: true`
 *  flag — Sentry, GitHub legacy, Stripe-like APIs all do this. Without this
 *  fallback, generator emits CRUD suites whose POST returns 404 from a dead
 *  endpoint. (TASK-245) */
/** Matches `(DEPRECATED) ...`, `[DEPRECATED] ...`, `DEPRECATED: ...` at the
 *  start of a string. Also matches markdown `## Deprecated` headings, which
 *  Sentry uses in operation `description` to flag end-of-life endpoints. */
const DEPRECATED_PREFIX_RE = /^\s*[\(\[]?\s*DEPRECATED\s*[\)\]:\-—\s]/i;
const DEPRECATED_HEADING_RE = /^\s*#+\s*Deprecated\b/im;
function isMarkedDeprecatedInText(summary?: string, description?: string, operationId?: string): boolean {
  if (summary && DEPRECATED_PREFIX_RE.test(summary)) return true;
  if (operationId && DEPRECATED_PREFIX_RE.test(operationId)) return true;
  if (description && (DEPRECATED_PREFIX_RE.test(description) || DEPRECATED_HEADING_RE.test(description))) return true;
  return false;
}
