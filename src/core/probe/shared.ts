/**
 * Shared helpers for probe generators (negative-probe, mass-assignment-probe).
 */
import type { OpenAPIV3 } from "openapi-types";
import type { EndpointInfo, SecuritySchemeInfo } from "../generator/types.ts";

export function convertPath(path: string): string {
  return path.replace(/\{([^}]+)\}/g, "{{$1}}");
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * Build a short, distinguishable alias for an OpenAPI path-param name —
 * used to keep probe filenames readable when several `{...id}` segments
 * collapse to the same `by-id` (TASK-159, m-9 P3).
 *
 *   organization_id_or_slug → "org"
 *   project_id_or_slug      → "proj"
 *   replay_id               → "replay"
 *   userId                  → "user"
 *   foo                     → "foo"
 *   id                      → "id"
 *
 * The general rule: drop trailing `_id` / `_slug` / `_or_slug` /
 * `Id` / `Slug`, then slugify and trim to the first segment. We also
 * canonicalise a couple of common Sentry-style names to short aliases
 * (`organization` → `org`, `project` → `proj`).
 */
export function placeholderAlias(rawName: string): string {
  let name = rawName.trim();
  // Strip the OpenAPI noisy suffixes.
  name = name.replace(/_or_slug$/i, "");
  name = name.replace(/(_id|_slug)$/i, "");
  name = name.replace(/(Id|Slug)$/g, "");
  const slug = slugify(name);
  if (!slug || slug === "id") return "id";
  // Canonical short aliases for frequent long names.
  const canonical: Record<string, string> = {
    organization: "org",
    project: "proj",
    repository: "repo",
    environment: "env",
    application: "app",
    integration: "intg",
    notification: "notif",
  };
  const first = slug.split("-")[0]!;
  if (canonical[first]) return canonical[first];
  // Fall back to the slug, capped at 12 chars so really long names don't
  // blow up the filename.
  return slug.length > 12 ? slug.slice(0, 12) : slug;
}

/**
 * Replace every `{name}` segment in an OpenAPI path with `by-<alias>`,
 * preserving placeholder identity (TASK-159).
 */
export function pathWithByAliases(path: string): string {
  return path.replace(/\{([^}]+)\}/g, (_, name) => `by-${placeholderAlias(name)}`);
}

export function endpointStem(ep: EndpointInfo): string {
  const path = pathWithByAliases(ep.path)
    .replace(/^\//, "")
    .replace(/\//g, "-");
  return slugify(`${ep.method.toLowerCase()}-${path}`);
}

export function getAuthHeaders(
  ep: EndpointInfo,
  schemes: SecuritySchemeInfo[],
  tokenVarFor?: (s: SecuritySchemeInfo) => string,
): Record<string, string> | undefined {
  if (ep.security.length === 0) return undefined;
  const tokenVar = (s: SecuritySchemeInfo) => tokenVarFor?.(s) ?? "auth_token";
  for (const secName of ep.security) {
    const scheme = schemes.find((s) => s.name === secName);
    if (!scheme) continue;
    if (scheme.type === "http") {
      if (scheme.scheme === "bearer" || !scheme.scheme) {
        return { Authorization: `Bearer {{${tokenVar(scheme)}}}` };
      }
      if (scheme.scheme === "basic") {
        return { Authorization: `Basic {{${tokenVar(scheme)}}}` };
      }
    }
    if (scheme.type === "apiKey" && scheme.in === "header" && scheme.apiKeyName) {
      if (scheme.apiKeyName === "Authorization") {
        return { Authorization: `Bearer {{${tokenVar(scheme)}}}` };
      }
      return { [scheme.apiKeyName]: "{{api_key}}" };
    }
  }
  return undefined;
}

/** Path with placeholders replaced by valid-but-nonexistent IDs. */
function pathWithPlaceholders(ep: EndpointInfo, badId: string): string {
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

/**
 * Render a path for probe execution. The "attacked" param (if any) is replaced
 * with `attacked.value`; remaining params are rendered as either runtime
 * placeholders (`{{name}}`, resolved from `.env.yaml` by `zond run`) when
 * `useRealParents=true`, or as synthetic-by-type sentinels in the legacy mode.
 *
 * The output is the final path string written into the YAML — no further
 * `convertPath` pass is required (and would in fact corrupt the doubled
 * braces).
 *
 * Why `useRealParents` exists (TASK-135 / m-8): probe-validation used to bake
 * `nonexistent-zzzzz` into every parent path-param, which short-circuits to
 * 404 on real APIs (e.g. `/orgs/zzzzz/repos/{repo}/commits` never reaches the
 * `{repo}` validator). Using the real parent slug from the env restores
 * recall — the API actually walks past the parent and starts validating the
 * leaf, so 5xx bugs there become observable.
 */
export function renderPath(
  ep: EndpointInfo,
  attacked: { name: string; value: string } | null,
  opts: { useRealParents: boolean },
): string {
  return ep.path.replace(/\{([^}]+)\}/g, (_, name: string) => {
    if (attacked && name === attacked.name) return attacked.value;
    if (opts.useRealParents) return `{{${name}}}`;
    const param = ep.parameters.find((p) => p.name === name && p.in === "path");
    const schema = param?.schema as OpenAPIV3.SchemaObject | undefined;
    if (schema?.format === "uuid") return "00000000-0000-0000-0000-000000000000";
    if (schema?.type === "integer" || schema?.type === "number") return "999999999";
    return "nonexistent-zzzzz";
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
 * Strip a single trailing slash so `/keys/` and `/keys` compare equal.
 * Sentry-style APIs mix both forms; without this normalisation, the
 * counterpart lookup misses on every collection that ends in `/`,
 * leaking created resources during probe runs.
 */
function stripTrailingSlash(p: string): string {
  return p.length > 1 && p.endsWith("/") ? p.slice(0, -1) : p;
}

function pathsEqual(a: string, b: string): boolean {
  return stripTrailingSlash(a) === stripTrailingSlash(b);
}

/**
 * Find DELETE counterpart for resource-creating endpoint:
 *  - POST  /collection           → DELETE /collection/{id}
 *  - PUT   /collection/{id}      → DELETE /collection/{id}
 *  - PATCH /collection/{id}      → DELETE /collection/{id}
 *
 *  Trailing-slash tolerant on both sides (TASK-139-style fix carried
 *  into shared.ts after round-4 dogfooding showed POST /keys/ on Sentry
 *  leaked DSN keys because the regex required identical slash forms).
 */
export function findDeleteCounterpart(
  ep: EndpointInfo,
  all: EndpointInfo[],
): EndpointInfo | undefined {
  const m = ep.method.toUpperCase();
  const base = stripTrailingSlash(ep.path);
  if (m === "POST") {
    const re = new RegExp(`^${escapeRegex(base)}/\\{[^}]+\\}/?$`);
    return all.find(e => e.method.toUpperCase() === "DELETE" && !e.deprecated && re.test(e.path));
  }
  if (m === "PUT" || m === "PATCH") {
    return all.find(e => e.method.toUpperCase() === "DELETE" && !e.deprecated && pathsEqual(e.path, ep.path));
  }
  return undefined;
}

/**
 * Find GET-by-id counterpart for follow-up reads after a mutating request:
 *  - POST  /collection           → GET /collection/{id}
 *  - PUT   /collection/{id}      → GET /collection/{id}    (same path)
 *  - PATCH /collection/{id}      → GET /collection/{id}    (same path)
 *
 *  See `findDeleteCounterpart` for the trailing-slash rationale.
 */
export function findGetByIdCounterpart(
  ep: EndpointInfo,
  all: EndpointInfo[],
): EndpointInfo | undefined {
  const m = ep.method.toUpperCase();
  const base = stripTrailingSlash(ep.path);
  if (m === "POST") {
    const re = new RegExp(`^${escapeRegex(base)}/\\{[^}]+\\}/?$`);
    return all.find(e => e.method.toUpperCase() === "GET" && !e.deprecated && re.test(e.path));
  }
  if (m === "PUT" || m === "PATCH") {
    return all.find(e => e.method.toUpperCase() === "GET" && !e.deprecated && pathsEqual(e.path, ep.path));
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

/**
 * Resolve auth headers with live values from `vars` (used by probe runtimes
 * and path-discovery). Mirrors `getAuthHeaders` but produces concrete header
 * values, not `{{auth_token}}` placeholders.
 */
export function liveAuthHeaders(
  ep: EndpointInfo,
  schemes: SecuritySchemeInfo[],
  vars: Record<string, string>,
): Record<string, string> {
  if (ep.security.length === 0) return {};
  for (const secName of ep.security) {
    const scheme = schemes.find(s => s.name === secName);
    if (!scheme) continue;
    if (scheme.type === "http") {
      if (scheme.scheme === "bearer" || !scheme.scheme) {
        const tok = vars["auth_token"];
        if (tok) return { Authorization: `Bearer ${tok}` };
      }
      if (scheme.scheme === "basic") {
        const tok = vars["auth_token"];
        if (tok) return { Authorization: `Basic ${tok}` };
      }
    }
    if (scheme.type === "apiKey" && scheme.in === "header" && scheme.apiKeyName) {
      if (scheme.apiKeyName === "Authorization") {
        const tok = vars["auth_token"];
        if (tok) return { Authorization: `Bearer ${tok}` };
      }
      const key = vars["api_key"];
      if (key) return { [scheme.apiKeyName]: key };
    }
  }
  return {};
}

export function hasJsonBody(ep: EndpointInfo): boolean {
  return (
    ep.method !== "GET" &&
    ep.method !== "DELETE" &&
    ep.requestBodyContentType === "application/json" &&
    ep.requestBodySchema !== undefined
  );
}
