/**
 * Shared helpers for probe generators (negative-probe, mass-assignment-probe).
 */
import type { OpenAPIV3 } from "openapi-types";
import type { EndpointInfo, SecuritySchemeInfo } from "../generator/types.ts";

export function convertPath(path: string): string {
  return path.replace(/\{([^}]+)\}/g, "{{$1}}");
}

export function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export function endpointStem(ep: EndpointInfo): string {
  const path = ep.path
    .replace(/\{[^}]+\}/g, "by-id")
    .replace(/^\//, "")
    .replace(/\//g, "-");
  return slugify(`${ep.method.toLowerCase()}-${path}`);
}

export function getAuthHeaders(
  ep: EndpointInfo,
  schemes: SecuritySchemeInfo[],
): Record<string, string> | undefined {
  if (ep.security.length === 0) return undefined;
  for (const secName of ep.security) {
    const scheme = schemes.find((s) => s.name === secName);
    if (!scheme) continue;
    if (scheme.type === "http") {
      if (scheme.scheme === "bearer" || !scheme.scheme) {
        return { Authorization: "Bearer {{auth_token}}" };
      }
      if (scheme.scheme === "basic") {
        return { Authorization: "Basic {{auth_token}}" };
      }
    }
    if (scheme.type === "apiKey" && scheme.in === "header" && scheme.apiKeyName) {
      if (scheme.apiKeyName === "Authorization") {
        return { Authorization: "Bearer {{auth_token}}" };
      }
      return { [scheme.apiKeyName]: "{{api_key}}" };
    }
  }
  return undefined;
}

/** Path with placeholders replaced by valid-but-nonexistent IDs. */
export function pathWithPlaceholders(ep: EndpointInfo, badId: string): string {
  return ep.path.replace(/\{([^}]+)\}/g, (_, name: string) => {
    const param = ep.parameters.find((p) => p.name === name && p.in === "path");
    const schema = param?.schema as OpenAPIV3.SchemaObject | undefined;
    if (badId === "valid-shape") {
      if (schema?.format === "uuid") return "00000000-0000-0000-0000-000000000000";
      if (schema?.type === "integer" || schema?.type === "number") return "999999999";
      return "nonexistent-zzzzz";
    }
    return badId;
  });
}

export function isMutating(method: string): boolean {
  const m = method.toUpperCase();
  return m === "POST" || m === "PUT" || m === "PATCH";
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Find DELETE counterpart for resource-creating endpoint:
 *  - POST  /collection           → DELETE /collection/{id}
 *  - PUT   /collection/{id}      → DELETE /collection/{id}
 *  - PATCH /collection/{id}      → DELETE /collection/{id}
 */
export function findDeleteCounterpart(
  ep: EndpointInfo,
  all: EndpointInfo[],
): EndpointInfo | undefined {
  const m = ep.method.toUpperCase();
  if (m === "POST") {
    const re = new RegExp(`^${escapeRegex(ep.path)}/\\{[^}]+\\}$`);
    return all.find(e => e.method.toUpperCase() === "DELETE" && !e.deprecated && re.test(e.path));
  }
  if (m === "PUT" || m === "PATCH") {
    return all.find(e => e.method.toUpperCase() === "DELETE" && !e.deprecated && e.path === ep.path);
  }
  return undefined;
}

/**
 * Find GET-by-id counterpart for follow-up reads after a mutating request:
 *  - POST  /collection           → GET /collection/{id}
 *  - PUT   /collection/{id}      → GET /collection/{id}    (same path)
 *  - PATCH /collection/{id}      → GET /collection/{id}    (same path)
 */
export function findGetByIdCounterpart(
  ep: EndpointInfo,
  all: EndpointInfo[],
): EndpointInfo | undefined {
  const m = ep.method.toUpperCase();
  if (m === "POST") {
    const re = new RegExp(`^${escapeRegex(ep.path)}/\\{[^}]+\\}$`);
    return all.find(e => e.method.toUpperCase() === "GET" && !e.deprecated && re.test(e.path));
  }
  if (m === "PUT" || m === "PATCH") {
    return all.find(e => e.method.toUpperCase() === "GET" && !e.deprecated && e.path === ep.path);
  }
  return undefined;
}

/** Pick the response field that holds the new resource's id. */
export function captureFieldFor(ep: EndpointInfo): string {
  const success = ep.responses.find(r => r.statusCode >= 200 && r.statusCode < 300 && r.schema);
  const schema = success?.schema;
  if (schema?.properties) {
    if ("id" in schema.properties) return "id";
    for (const [name, propSchema] of Object.entries(schema.properties)) {
      const s = propSchema as OpenAPIV3.SchemaObject;
      if (s.type === "integer" || s.format === "uuid") return name;
    }
  }
  return "id";
}

export function headersEqual(a: Record<string, string>, b: Record<string, string>): boolean {
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  for (const k of ka) if (a[k] !== b[k]) return false;
  return true;
}

export function hasJsonBody(ep: EndpointInfo): boolean {
  return (
    ep.method !== "GET" &&
    ep.method !== "DELETE" &&
    ep.requestBodyContentType === "application/json" &&
    ep.requestBodySchema !== undefined
  );
}
