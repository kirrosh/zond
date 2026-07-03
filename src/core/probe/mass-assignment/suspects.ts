import type { OpenAPIV3 } from "openapi-types";
import type { EndpointInfo } from "../../generator/types.ts";

/**
 * Sentinel values are deliberately distinctive so that — if they appear in a
 * follow-up GET response — we can be confident the server actually persisted
 * them rather than coincidentally generating the same value.
 */
export const SUSPECTED_FIELDS: Record<string, unknown> = {
  is_admin: true,
  is_system: true,
  verified: true,
  role: "admin",
  account_id: "00000000-0000-0000-0000-00000000beef",
  owner_id: "00000000-0000-0000-0000-00000000beef",
  user_id: "00000000-0000-0000-0000-00000000beef",
};

/** Sentinel values for server-assigned fields lifted from response schema. */
const SERVER_FIELD_SENTINEL = {
  uuid: "00000000-0000-0000-0000-00000000dead",
  isoDate: "2000-01-01T00:00:00.000Z",
  string: "zond-injected",
  integer: -424242,
  number: -424242,
  boolean: false,
};

function requestPropertyNames(schema?: OpenAPIV3.SchemaObject): Set<string> {
  const out = new Set<string>();
  if (!schema) return out;
  if (schema.properties) {
    for (const k of Object.keys(schema.properties)) out.add(k);
  }
  for (const composite of [schema.allOf, schema.oneOf, schema.anyOf]) {
    if (Array.isArray(composite)) {
      for (const sub of composite) {
        const s = sub as OpenAPIV3.SchemaObject;
        if (s.properties) for (const k of Object.keys(s.properties)) out.add(k);
      }
    }
  }
  return out;
}

export function isStrictContract(schema?: OpenAPIV3.SchemaObject): boolean {
  if (!schema) return false;
  return schema.additionalProperties === false;
}

function pickServerFieldSentinel(s: OpenAPIV3.SchemaObject): unknown {
  if (s.format === "uuid") return SERVER_FIELD_SENTINEL.uuid;
  if (s.format === "date-time" || s.format === "date") return SERVER_FIELD_SENTINEL.isoDate;
  switch (s.type) {
    case "string": return SERVER_FIELD_SENTINEL.string;
    case "integer": return SERVER_FIELD_SENTINEL.integer;
    case "number": return SERVER_FIELD_SENTINEL.number;
    case "boolean": return SERVER_FIELD_SENTINEL.boolean;
    default: return SERVER_FIELD_SENTINEL.string;
  }
}

/** Server-assigned fields = response 2xx schema props that don't appear in request schema. */
export function serverAssignedExtras(ep: EndpointInfo): Record<string, unknown> {
  const reqProps = requestPropertyNames(ep.requestBodySchema);
  const success = ep.responses.find(r => r.statusCode >= 200 && r.statusCode < 300 && r.schema);
  const respProps = success?.schema?.properties;
  const out: Record<string, unknown> = {};
  if (!respProps) return out;
  for (const [name, schema] of Object.entries(respProps)) {
    if (reqProps.has(name)) continue;
    out[name] = pickServerFieldSentinel(schema as OpenAPIV3.SchemaObject);
  }
  return out;
}

/** Extra fields that aren't legitimate request-body properties. */
export function suspectedExtras(
  ep: EndpointInfo,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  const reqProps = requestPropertyNames(ep.requestBodySchema);
  const out: Record<string, unknown> = {};
  // ARV-252: per-run extras (CLI --suspect-field) compose with the
  // curated SUSPECTED_FIELDS list. Later additions win on key collision
  // so a user can override a sentinel value if needed.
  const merged: Record<string, unknown> = { ...SUSPECTED_FIELDS, ...extra };
  for (const [name, value] of Object.entries(merged)) {
    if (!reqProps.has(name)) out[name] = value;
  }
  return out;
}
