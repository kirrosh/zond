/**
 * Shared bits between the offline `method-probe` (which emits YAML
 * suites) and the live `unsupported_method` check from `core/checks`
 * (m-15 ARV-2). Both ask the same question — "which HTTP methods aren't
 * declared on this path?" — so the constants and helpers live here so
 * the two stay in lock-step (ARV-2 AC #4).
 */
import type { OpenAPIV3 } from "openapi-types";
import type { EndpointInfo } from "../generator/types.ts";

/** ARV-179: full HTTP method complement used for `unsupported_method`
 *  enumeration. Matches schemathesis V4 `DEFAULT_UNEXPECTED_METHODS`
 *  minus the WebDAV-style `query` (not a REST norm) and `CONNECT`
 *  (irrelevant to API routing). `HEAD` is intentionally excluded
 *  because most stacks auto-derive it from `GET`, so a 2xx response is
 *  expected behaviour rather than a leak. */
export const ALL_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "TRACE"] as const;
export type Method = (typeof ALL_METHODS)[number];

/** Statuses we accept for an *undeclared* method on a path. 405 is
 *  canonical, 404 is a common fallback (path not registered for that
 *  method), 401/403 are acceptable when auth is checked before routing. */
export const ACCEPTABLE_UNSUPPORTED_STATUSES = [401, 403, 404, 405] as const;

/** ARV-179: OPTIONS is special — it's legitimately implemented by most
 *  stacks for CORS preflight and may legitimately return 2xx with
 *  `Allow`/`Access-Control-*` headers. A 2xx OPTIONS on an undeclared
 *  path is the spec-compliant outcome, not a finding. Use this helper
 *  in both the offline probe and the live check to keep the policy in
 *  one place. */
export function isPermissibleOptionsResponse(method: string, status: number): boolean {
  return method.toUpperCase() === "OPTIONS" && status >= 200 && status < 300;
}

/**
 * Replace `{name}` segments with valid-shape placeholders so the
 * request can reach the routing layer without being rejected purely on
 * path syntax. Used by both the offline probe and the live check.
 */
export function pathWithMethodPlaceholders(
  path: string,
  parameters: OpenAPIV3.ParameterObject[],
): string {
  return path.replace(/\{([^}]+)\}/g, (_, name: string) => {
    const param = parameters.find((p) => p.name === name && p.in === "path");
    const schema = param?.schema as OpenAPIV3.SchemaObject | undefined;
    if (schema?.format === "uuid") return "00000000-0000-0000-0000-000000000000";
    if (schema?.type === "integer" || schema?.type === "number") return "999999999";
    return "nonexistent-zzzzz";
  });
}

export function bucketEndpointsByPath(endpoints: EndpointInfo[]): Map<string, {
  path: string;
  declared: Set<string>;
  sample: EndpointInfo;
}> {
  const map = new Map<string, { path: string; declared: Set<string>; sample: EndpointInfo }>();
  for (const ep of endpoints) {
    if (ep.deprecated) continue;
    let bucket = map.get(ep.path);
    if (!bucket) {
      bucket = { path: ep.path, declared: new Set(), sample: ep };
      map.set(ep.path, bucket);
    }
    bucket.declared.add(ep.method.toUpperCase());
  }
  return map;
}
