import { readFileSync } from "node:fs";
import { rootCertificates } from "node:tls";
import { dereference } from "@readme/openapi-parser";
import type { OpenAPIV3 } from "openapi-types";
import type { EndpointInfo, ResponseInfo, SecuritySchemeInfo } from "./types.ts";
import { disambiguateGenericPathParams } from "./path-param-disambig.ts";

const HTTP_METHODS = ["get", "post", "put", "patch", "delete"] as const;

export interface SpecFetchTlsOptions {
  /** Disable TLS verification entirely (bun `--insecure`). Last resort. */
  insecure?: boolean;
  /** Path to a PEM CA bundle to trust in addition to the public roots.
   *  Falls back to the `NODE_EXTRA_CA_CERTS` env var. */
  caPath?: string;
}

/** MF1 (ARV-367): resolve the bun `fetch` `tls` option for a spec fetch so a
 *  self-signed / internal corporate CA validates *without* disabling TLS.
 *
 *  Precedence: `insecure` (verification off) > explicit `caPath` /
 *  `NODE_EXTRA_CA_CERTS` (extra CA APPENDED to the public roots — never
 *  replacing them, so public specs keep validating) > default (undefined).
 *  Returns undefined when nothing special is needed. Throws if a CA path is
 *  set but unreadable — a misconfigured CA should surface, not fall through
 *  to a confusing "self signed certificate" error. */
export function resolveSpecFetchTls(
  options?: SpecFetchTlsOptions,
): { rejectUnauthorized: false } | { ca: string[] } | undefined {
  if (options?.insecure) return { rejectUnauthorized: false };
  const caPath = options?.caPath ?? process.env.NODE_EXTRA_CA_CERTS;
  if (caPath) {
    let extra: string;
    try {
      extra = readFileSync(caPath, "utf8");
    } catch (e) {
      throw new Error(
        `CA bundle not readable: ${caPath} (${(e as Error).message}). ` +
          `Set --ca / NODE_EXTRA_CA_CERTS to a valid PEM file, or use --insecure.`,
      );
    }
    if (extra.trim()) return { ca: [extra, ...rootCertificates] };
  }
  return undefined;
}

export async function readOpenApiSpec(specPath: string, options?: SpecFetchTlsOptions): Promise<OpenAPIV3.Document> {
  // For HTTP URLs, fetch the spec first then dereference the parsed object
  if (specPath.startsWith("http://") || specPath.startsWith("https://")) {
    const tls = resolveSpecFetchTls(options);
    const resp = await fetch(specPath, { ...(tls ? { tls } : {}) });
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

      // Skip circular-ref sentinel stubs emitted by decycleSchema —
      // they look like `{ "x-circular": true }` (no .name, no .in) and
      // crash downstream code that expects p.name/p.in. ARV-200 (R10/F1).
      const isUsableParam = (p: any): p is OpenAPIV3.ParameterObject =>
        p != null && typeof p === "object" && typeof p.name === "string" && typeof p.in === "string";

      // Path-level parameters
      if (pathItem.parameters) {
        for (const p of pathItem.parameters) {
          if (!isUsableParam(p)) continue;
          parameters.push(p as OpenAPIV3.ParameterObject);
        }
      }

      // Operation-level parameters (override path-level)
      if (operation.parameters) {
        for (const p of operation.parameters) {
          if (!isUsableParam(p)) continue;
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

      // ARV-189: harvest `x-*` vendor extensions. Operation-level wins on
      // key collision over path-level so spec authors can default at the
      // path and override per-operation. Empty result = undefined (avoids
      // a churn-y `extensions: {}` field in serialised endpoint snapshots).
      const extensions = collectExtensions(pathItem, operation);

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
        ...(extensions ? { extensions } : {}),
      });
    }
  }

  // ARV-40: when generic path-param names (`{id}`, `{slug}`, ...) collide
  // across multiple resources, rewrite each to `<parent_singular>_<param>`
  // so the manifest derives per-resource vars and tests stop sharing one
  // global `id`. In-memory only; on-disk spec stays untouched.
  return disambiguateGenericPathParams(endpoints);
}

/** Collect `x-*` vendor extensions from a path item and operation,
 *  with operation values winning on key collision. Returns undefined
 *  when neither has any so callers can omit the field cleanly. */
function collectExtensions(
  pathItem: OpenAPIV3.PathItemObject,
  operation: OpenAPIV3.OperationObject,
): Record<string, unknown> | undefined {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(pathItem)) {
    if (k.startsWith("x-")) out[k] = v;
  }
  for (const [k, v] of Object.entries(operation)) {
    if (k.startsWith("x-")) out[k] = v;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/** Spec authors often mark endpoints as deprecated in the summary or
 *  description text instead of (or in addition to) the `deprecated: true`
 *  flag — common across many SaaS and legacy specs. Without this
 *  fallback, generator emits CRUD suites whose POST returns 404 from a dead
 *  endpoint. (TASK-245) */
/** Matches `(DEPRECATED) ...`, `[DEPRECATED] ...`, `DEPRECATED: ...` at the
 *  start of a string. Also matches markdown `## Deprecated` headings, which
 *  some spec authors use in operation `description` to flag end-of-life
 *  endpoints. */
const DEPRECATED_PREFIX_RE = /^\s*[\(\[]?\s*DEPRECATED\s*[\)\]:\-—\s]/i;
const DEPRECATED_HEADING_RE = /^\s*#+\s*Deprecated\b/im;
function isMarkedDeprecatedInText(summary?: string, description?: string, operationId?: string): boolean {
  if (summary && DEPRECATED_PREFIX_RE.test(summary)) return true;
  if (operationId && DEPRECATED_PREFIX_RE.test(operationId)) return true;
  if (description && (DEPRECATED_PREFIX_RE.test(description) || DEPRECATED_HEADING_RE.test(description))) return true;
  return false;
}
