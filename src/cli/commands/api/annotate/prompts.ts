/**
 * ARV-187: shared prompt utilities — extract per-resource CRUD slices
 * from a parsed OpenAPI document so each subcommand can build a tight,
 * cheap prompt for the LLM.
 *
 * Per-resource slicing (vs. send-the-whole-spec) is the cost-control
 * pattern AutoRestTest / KAT both use: keeps each call <4k tokens and
 * lets us cache by `sha256(slice + prompt_version + model)`.
 */

import type { OpenAPIV3 } from "openapi-types";
import type { ResourceYaml } from "../../discover.ts";

export interface ResourceSlice {
  resource: string;
  basePath: string;
  itemPath: string;
  /** Concrete EndpointInfo-like dump per role with the *relevant* spec
   *  bits inlined (summary, description, parameters, request schema,
   *  example bodies, x-codeSamples). Designed to be JSON.stringify'd
   *  straight into the prompt. */
  endpoints: {
    list?: EndpointDump;
    create?: EndpointDump;
    read?: EndpointDump;
    update?: EndpointDump;
    delete?: EndpointDump;
  };
}

export interface EndpointDump {
  method: string;
  path: string;
  operationId?: string;
  summary?: string;
  description?: string;
  parameters?: Array<{
    name: string;
    in: string;
    required?: boolean;
    description?: string;
    schema?: unknown;
  }>;
  requestBody?: {
    contentType?: string;
    description?: string;
    schema?: unknown;
    example?: unknown;
  };
  responses?: Record<string, { description?: string; schema?: unknown }>;
  /** Stripe/Redocly convention — prose curl examples live here. */
  xCodeSamples?: unknown;
}

/**
 * Build per-resource CRUD slices from spec + the upstream resource map.
 * We trust the resource map's endpoint pointers (already computed by
 * the catalog builder) rather than re-doing path-grouping. Each slice
 * carries the spec-fragments the LLM needs to reason about that
 * resource — no more, no less.
 */
export function buildResourceSlices(
  doc: OpenAPIV3.Document,
  resources: ResourceYaml[],
): ResourceSlice[] {
  return resources.map((r) => {
    const out: ResourceSlice = {
      resource: r.resource,
      basePath: r.basePath,
      itemPath: r.itemPath,
      endpoints: {},
    };
    for (const role of ["list", "create", "read", "update", "delete"] as const) {
      const label = r.endpoints[role];
      if (!label) continue;
      const parsed = parseLabel(label);
      if (!parsed) continue;
      const dump = dumpEndpoint(doc, parsed.method, parsed.path);
      if (dump) out.endpoints[role] = dump;
    }
    return out;
  });
}

function parseLabel(label: string): { method: string; path: string } | null {
  const parts = label.trim().split(/\s+/);
  if (parts.length < 2) return null;
  return { method: parts[0]!.toLowerCase(), path: parts[1]! };
}

function dumpEndpoint(doc: OpenAPIV3.Document, method: string, path: string): EndpointDump | null {
  const pathItem = doc.paths?.[path] as OpenAPIV3.PathItemObject | undefined;
  if (!pathItem) return null;
  const op = (pathItem as Record<string, unknown>)[method] as OpenAPIV3.OperationObject | undefined;
  if (!op) return null;

  const parameters: EndpointDump["parameters"] = [];
  for (const p of [...(pathItem.parameters ?? []), ...(op.parameters ?? [])]) {
    if ("$ref" in p) continue;
    parameters.push({
      name: p.name,
      in: p.in,
      required: p.required,
      description: truncate(p.description, 240),
      schema: simplifySchema(p.schema as OpenAPIV3.SchemaObject | undefined),
    });
  }

  let requestBody: EndpointDump["requestBody"];
  if (op.requestBody && !("$ref" in op.requestBody)) {
    const rb = op.requestBody as OpenAPIV3.RequestBodyObject;
    const contentEntries = Object.entries(rb.content ?? {});
    const [ct, media] = contentEntries[0] ?? [];
    if (media) {
      requestBody = {
        contentType: ct,
        description: truncate(rb.description, 240),
        schema: simplifySchema(media.schema as OpenAPIV3.SchemaObject | undefined),
        example: media.example,
      };
    }
  }

  const responses: EndpointDump["responses"] = {};
  for (const [code, resp] of Object.entries(op.responses ?? {})) {
    if (resp && !("$ref" in resp)) {
      const r = resp as OpenAPIV3.ResponseObject;
      const content = Object.values(r.content ?? {})[0];
      responses[code] = {
        description: truncate(r.description, 240),
        schema: simplifySchema(content?.schema as OpenAPIV3.SchemaObject | undefined),
      };
    }
  }

  return {
    method: method.toUpperCase(),
    path,
    operationId: op.operationId,
    summary: truncate(op.summary, 240),
    description: truncate(op.description, 600),
    parameters: parameters.length > 0 ? parameters : undefined,
    requestBody,
    responses: Object.keys(responses).length > 0 ? responses : undefined,
    xCodeSamples: (op as Record<string, unknown>)["x-codeSamples"],
  };
}

/**
 * Strip refs and nested noise from a schema dump. We don't need full
 * fidelity — the LLM just needs to know the field names + types + any
 * descriptions that hint at example values. Drops `additionalProperties`,
 * collapses `oneOf/anyOf` to the first variant, truncates descriptions.
 */
function simplifySchema(s: OpenAPIV3.SchemaObject | undefined): unknown {
  if (!s) return undefined;
  if ((s as OpenAPIV3.ReferenceObject).$ref) return { $ref: (s as OpenAPIV3.ReferenceObject).$ref };
  const out: Record<string, unknown> = {};
  if (s.type) out.type = s.type;
  if (s.format) out.format = s.format;
  if (s.enum) out.enum = s.enum;
  if (s.example !== undefined) out.example = s.example;
  if (s.default !== undefined) out.default = s.default;
  if (s.description) out.description = truncate(s.description, 240);
  if (s.required) out.required = s.required;
  if (s.properties) {
    out.properties = Object.fromEntries(
      Object.entries(s.properties).map(([k, v]) => [k, simplifySchema(v as OpenAPIV3.SchemaObject)]),
    );
  }
  const asArr = s as OpenAPIV3.ArraySchemaObject;
  if (asArr.items) out.items = simplifySchema(asArr.items as OpenAPIV3.SchemaObject);
  const o = s as Record<string, unknown>;
  if (Array.isArray(o.oneOf) && o.oneOf.length > 0) out.oneOf_first = simplifySchema(o.oneOf[0] as OpenAPIV3.SchemaObject);
  if (Array.isArray(o.anyOf) && o.anyOf.length > 0) out.anyOf_first = simplifySchema(o.anyOf[0] as OpenAPIV3.SchemaObject);
  return out;
}

function truncate(s: string | undefined, n: number): string | undefined {
  if (!s) return undefined;
  return s.length > n ? s.slice(0, n) + "…" : s;
}

