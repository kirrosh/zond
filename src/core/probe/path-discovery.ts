/**
 * Path-param fixture auto-discovery (TASK-92).
 *
 * Live probe runtime hook: before marking an endpoint as skipped because
 * `.env.yaml` doesn't supply a value for a path placeholder
 * (e.g. `/domains/{domain_id}` without `domain_id` in env), try to find a
 * sibling list endpoint (`GET /domains`), call it once per run, and extract
 * `data[0].id` (or compatible shape). Result cached per `GET listPath`.
 *
 * Failure modes (returned as `miss`, not exception):
 *   • no `GET <listPath>` in spec
 *   • list returned non-2xx
 *   • list response has no extractable id
 *   • list returned an empty array
 *   • listPath itself depends on unresolved params we couldn't discover
 */
import type { EndpointInfo, SecuritySchemeInfo } from "../generator/types.ts";
import { executeRequest } from "../runner/http-client.ts";
import { substituteString } from "../parser/variables.ts";
import { convertPath, captureFieldFor, liveAuthHeaders } from "./shared.ts";

export type DiscoveryHit = { kind: "hit"; values: Record<string, string> };
export type DiscoveryMiss = { kind: "miss"; reason: string };
export type DiscoveryResult = DiscoveryHit | DiscoveryMiss;

export interface DiscoveryCache {
  /** key = `GET ${listPath}` (raw, with {placeholders}) */
  results: Map<string, DiscoveryResult>;
  /** keys currently being resolved — used to break cycles. */
  inFlight: Set<string>;
}

export function createDiscoveryCache(): DiscoveryCache {
  return { results: new Map(), inFlight: new Set() };
}

export interface DiscoverOptions {
  ep: EndpointInfo;
  unresolved: string[];
  allEndpoints: EndpointInfo[];
  schemes: SecuritySchemeInfo[];
  vars: Record<string, string>;
  cache: DiscoveryCache;
  timeoutMs?: number;
}

export async function discoverPathParams(opts: DiscoverOptions): Promise<DiscoveryResult> {
  const discovered: Record<string, string> = {};
  for (const name of opts.unresolved) {
    const listPath = parentCollectionPath(opts.ep.path, name);
    if (!listPath) {
      return { kind: "miss", reason: `cannot derive list-path for {${name}} from ${opts.ep.path}` };
    }
    const result = await discoverFromList({
      paramName: name,
      listPath,
      allEndpoints: opts.allEndpoints,
      schemes: opts.schemes,
      vars: { ...opts.vars, ...discovered },
      cache: opts.cache,
      timeoutMs: opts.timeoutMs,
    });
    if (result.kind === "miss") return result;
    Object.assign(discovered, result.values);
  }
  return { kind: "hit", values: discovered };
}

interface DiscoverFromListOpts {
  paramName: string;
  listPath: string;
  allEndpoints: EndpointInfo[];
  schemes: SecuritySchemeInfo[];
  vars: Record<string, string>;
  cache: DiscoveryCache;
  timeoutMs?: number;
}

async function discoverFromList(opts: DiscoverFromListOpts): Promise<DiscoveryResult> {
  const cacheKey = `GET ${opts.listPath}`;
  const cached = opts.cache.results.get(cacheKey);
  if (cached) {
    if (cached.kind === "hit") {
      const v = pickValue(cached.values);
      if (v !== undefined) return { kind: "hit", values: { [opts.paramName]: v } };
      return { kind: "miss", reason: `cached list ${opts.listPath} has no usable id` };
    }
    return cached;
  }
  if (opts.cache.inFlight.has(cacheKey)) {
    return { kind: "miss", reason: `cycle detected resolving ${opts.listPath}` };
  }

  const listEp = opts.allEndpoints.find(
    e => e.method.toUpperCase() === "GET" && e.path === opts.listPath && !e.deprecated,
  );
  if (!listEp) {
    const miss: DiscoveryMiss = { kind: "miss", reason: `no GET ${opts.listPath} in spec` };
    opts.cache.results.set(cacheKey, miss);
    return miss;
  }

  opts.cache.inFlight.add(cacheKey);
  try {
    // Resolve listEp's own path placeholders (nested-collection case).
    const baseUrl = (opts.vars["base_url"] ?? "").replace(/\/+$/, "");
    const templated = `${baseUrl}${convertPath(listEp.path)}`;
    let urlVars = opts.vars;
    let urlSubstituted = String(substituteString(templated, urlVars));
    let stillUnresolved = collectUnresolved(urlSubstituted);
    if (stillUnresolved.length > 0) {
      const inner = await discoverPathParams({
        ep: listEp,
        unresolved: stillUnresolved,
        allEndpoints: opts.allEndpoints,
        schemes: opts.schemes,
        vars: opts.vars,
        cache: opts.cache,
        timeoutMs: opts.timeoutMs,
      });
      if (inner.kind === "miss") {
        const miss: DiscoveryMiss = {
          kind: "miss",
          reason: `parent of {${opts.paramName}} unresolved (${inner.reason})`,
        };
        opts.cache.results.set(cacheKey, miss);
        return miss;
      }
      urlVars = { ...opts.vars, ...inner.values };
      urlSubstituted = String(substituteString(templated, urlVars));
      stillUnresolved = collectUnresolved(urlSubstituted);
      if (stillUnresolved.length > 0) {
        const miss: DiscoveryMiss = {
          kind: "miss",
          reason: `parent of {${opts.paramName}} unresolved after discovery: ${stillUnresolved.join(", ")}`,
        };
        opts.cache.results.set(cacheKey, miss);
        return miss;
      }
    }

    const url = appendLimitOne(urlSubstituted, listEp);
    const headers: Record<string, string> = {
      accept: "application/json",
      ...liveAuthHeaders(listEp, opts.schemes, urlVars),
    };

    let resp;
    try {
      resp = await executeRequest(
        { method: "GET", url, headers },
        { timeout: opts.timeoutMs ?? 30000, retries: 0 },
      );
    } catch (err) {
      const miss: DiscoveryMiss = {
        kind: "miss",
        reason: `GET ${opts.listPath} network error: ${err instanceof Error ? err.message : String(err)}`,
      };
      opts.cache.results.set(cacheKey, miss);
      return miss;
    }
    if (resp.status < 200 || resp.status >= 300) {
      const miss: DiscoveryMiss = {
        kind: "miss",
        reason: `GET ${opts.listPath} returned ${resp.status}`,
      };
      opts.cache.results.set(cacheKey, miss);
      return miss;
    }
    const id = extractFirstId(resp.body_parsed ?? resp.body, listEp);
    if (id === undefined) {
      // Distinguish empty-list from has-items-but-no-id-shape.
      const empty = isEmptyList(resp.body_parsed ?? resp.body);
      const miss: DiscoveryMiss = {
        kind: "miss",
        reason: empty
          ? `auto-discovery: GET ${opts.listPath} returned empty list`
          : `GET ${opts.listPath} response has no extractable id`,
      };
      opts.cache.results.set(cacheKey, miss);
      return miss;
    }
    const hit: DiscoveryHit = { kind: "hit", values: { [opts.paramName]: id } };
    opts.cache.results.set(cacheKey, hit);
    return hit;
  } finally {
    opts.cache.inFlight.delete(cacheKey);
  }
}

/** Walk segments of `path`, return everything before the first `{paramName}` segment. */
export function parentCollectionPath(path: string, paramName: string): string | undefined {
  const segments = path.split("/");
  const idx = segments.findIndex(seg => seg === `{${paramName}}`);
  if (idx <= 0) return undefined;
  return segments.slice(0, idx).join("/") || "/";
}

function collectUnresolved(url: string): string[] {
  return Array.from(url.matchAll(/\{\{([^}]+)\}\}/g)).map(m => m[1]!);
}

function appendLimitOne(url: string, listEp: EndpointInfo): string {
  const hasLimitParam = listEp.parameters.some(
    p => p.in === "query" && (p.name === "limit" || p.name === "per_page" || p.name === "page_size"),
  );
  if (!hasLimitParam) return url;
  const sep = url.includes("?") ? "&" : "?";
  const name = listEp.parameters.find(
    p => p.in === "query" && (p.name === "limit" || p.name === "per_page" || p.name === "page_size"),
  )!.name;
  return `${url}${sep}${name}=1`;
}

/**
 * Body-FK auto-discovery (TASK-137).
 *
 * Mirror of `discoverPathParams` for body-level FK fields. probe-mass-assignment
 * builds its baseline body from the spec; required FK fields like
 * `audience_id` / `project_slug` get filled with `{{$randomString}}` and the
 * server returns 4xx → INCONCLUSIVE-baseline. We can do better: scan the
 * request schema for FK-named fields, find a likely list endpoint
 * (`GET /audiences` for `audience_id`), call it once, cache the id.
 *
 * The map returned is **suffix-aware**: `*_slug` → `slug`, `*_uuid` → `uuid`,
 * else `id`. This matches what the env-var name implies — the same rule
 * `zond discover` (TASK-136) uses for its CLI flow.
 */
const BODY_FK_SUFFIXES = ["_id", "_uuid", "_slug", "_key"] as const;

interface BodyFkField {
  /** Variable / body-field name (e.g. `audience_id`). */
  name: string;
  /** Resource stem (e.g. `audience`). */
  stem: string;
  /** Field expected on response item (`id`/`slug`/`uuid`/`key`). */
  preferredField: string;
}

export function collectBodyFkFields(
  schema: import("openapi-types").OpenAPIV3.SchemaObject | undefined,
): BodyFkField[] {
  if (!schema || !schema.properties) return [];
  const required = new Set(schema.required ?? []);
  const out: BodyFkField[] = [];
  for (const name of Object.keys(schema.properties)) {
    if (!required.has(name)) continue;
    for (const suffix of BODY_FK_SUFFIXES) {
      if (name.endsWith(suffix)) {
        const stem = name.slice(0, -suffix.length);
        if (!stem) break;
        const preferredField = suffix === "_id" ? "id" : suffix.slice(1);
        out.push({ name, stem, preferredField });
        break;
      }
    }
  }
  return out;
}

/** Walk the spec for a likely list endpoint owning the given stem. We accept
 *  collection-level GET on `/<stem>s`, `/<stem>`, or any path ending in those.
 *  Skips path-templated lists (need parent context). */
function findOwnerListEndpoint(
  stem: string,
  endpoints: EndpointInfo[],
): EndpointInfo | undefined {
  const candidates = [`${stem}s`, stem, stem.replace(/y$/, "ies"), stem.replace(/s$/, "")];
  for (const candidate of candidates) {
    if (!candidate) continue;
    const re = new RegExp(`/${candidate}/?$`, "i");
    const ep = endpoints.find(
      e =>
        e.method.toUpperCase() === "GET" &&
        !e.deprecated &&
        !e.path.includes("{") &&
        re.test(e.path),
    );
    if (ep) return ep;
  }
  return undefined;
}

export interface BodyFkDiscoveryOptions {
  ep: EndpointInfo;
  allEndpoints: EndpointInfo[];
  schemes: SecuritySchemeInfo[];
  vars: Record<string, string>;
  cache: DiscoveryCache;
  timeoutMs?: number;
}

export interface BodyFkDiscoveryResult {
  /** Discovered values to merge into vars (only when missing in vars). */
  values: Record<string, string>;
  /** Field names that look like FK but couldn't be resolved (with reason). */
  misses: Array<{ field: string; reason: string }>;
}

export async function discoverBodyFkVars(
  opts: BodyFkDiscoveryOptions,
): Promise<BodyFkDiscoveryResult> {
  const fields = collectBodyFkFields(opts.ep.requestBodySchema);
  const values: Record<string, string> = {};
  const misses: Array<{ field: string; reason: string }> = [];

  for (const field of fields) {
    if (opts.vars[field.name] !== undefined && opts.vars[field.name] !== "") {
      // already supplied by the user — nothing to do.
      continue;
    }
    const listEp = findOwnerListEndpoint(field.stem, opts.allEndpoints);
    if (!listEp) {
      misses.push({ field: field.name, reason: `no GET /<${field.stem}s> in spec` });
      continue;
    }

    const cacheKey = `GET ${listEp.path}#${field.preferredField}`;
    const cached = opts.cache.results.get(cacheKey);
    if (cached) {
      if (cached.kind === "hit" && cached.values[field.name] !== undefined) {
        values[field.name] = cached.values[field.name]!;
      } else if (cached.kind === "miss") {
        misses.push({ field: field.name, reason: cached.reason });
      }
      continue;
    }

    const baseUrl = (opts.vars["base_url"] ?? "").replace(/\/+$/, "");
    const url = `${baseUrl}${listEp.path}`;
    const headers: Record<string, string> = {
      accept: "application/json",
      ...liveAuthHeaders(listEp, opts.schemes, opts.vars),
    };

    let resp;
    try {
      resp = await executeRequest(
        { method: "GET", url, headers },
        { timeout: opts.timeoutMs ?? 30000, retries: 0 },
      );
    } catch (err) {
      const reason = `network error on GET ${listEp.path}: ${err instanceof Error ? err.message : String(err)}`;
      opts.cache.results.set(cacheKey, { kind: "miss", reason });
      misses.push({ field: field.name, reason });
      continue;
    }
    if (resp.status < 200 || resp.status >= 300) {
      const reason = `GET ${listEp.path} → ${resp.status}`;
      opts.cache.results.set(cacheKey, { kind: "miss", reason });
      misses.push({ field: field.name, reason });
      continue;
    }
    const id = pickFieldFromBody(
      resp.body_parsed ?? resp.body,
      field.preferredField,
    );
    if (id === undefined) {
      const reason = `GET ${listEp.path} response has no usable ${field.preferredField} field`;
      opts.cache.results.set(cacheKey, { kind: "miss", reason });
      misses.push({ field: field.name, reason });
      continue;
    }
    opts.cache.results.set(cacheKey, { kind: "hit", values: { [field.name]: id } });
    values[field.name] = id;
  }

  return { values, misses };
}

function pickFieldFromBody(body: unknown, preferred: string): string | undefined {
  const tryItem = (item: unknown): string | undefined => {
    if (!item || typeof item !== "object") return undefined;
    const obj = item as Record<string, unknown>;
    for (const key of [preferred, "id", "slug", "uuid", "key"]) {
      if (key in obj) {
        const v = obj[key];
        if (typeof v === "string" || typeof v === "number") return String(v);
      }
    }
    return undefined;
  };
  if (Array.isArray(body)) return tryItem(body[0]);
  if (body && typeof body === "object") {
    const obj = body as Record<string, unknown>;
    for (const wrap of ["data", "items", "results", "records"]) {
      const arr = obj[wrap];
      if (Array.isArray(arr) && arr.length > 0) return tryItem(arr[0]);
    }
  }
  return undefined;
}

/** Try several common SaaS list-response shapes. */
export function extractFirstId(body: unknown, listEp: EndpointInfo): string | undefined {
  if (Array.isArray(body)) {
    return idFromItem(body[0], listEp);
  }
  if (body && typeof body === "object") {
    const obj = body as Record<string, unknown>;
    for (const key of ["data", "items", "results", "records"]) {
      const arr = obj[key];
      if (Array.isArray(arr) && arr.length > 0) {
        return idFromItem(arr[0], listEp);
      }
    }
  }
  return undefined;
}

function idFromItem(item: unknown, listEp: EndpointInfo): string | undefined {
  if (!item || typeof item !== "object") return undefined;
  const obj = item as Record<string, unknown>;
  // Prefer "id"; fall back to first uuid-shaped field hinted by spec.
  if (typeof obj["id"] === "string" || typeof obj["id"] === "number") {
    return String(obj["id"]);
  }
  const hinted = captureFieldFor(listEp);
  if (hinted in obj && (typeof obj[hinted] === "string" || typeof obj[hinted] === "number")) {
    return String(obj[hinted]);
  }
  return undefined;
}

function isEmptyList(body: unknown): boolean {
  if (Array.isArray(body)) return body.length === 0;
  if (body && typeof body === "object") {
    const obj = body as Record<string, unknown>;
    for (const key of ["data", "items", "results", "records"]) {
      const arr = obj[key];
      if (Array.isArray(arr)) return arr.length === 0;
    }
  }
  return false;
}

function pickValue(values: Record<string, string>): string | undefined {
  for (const v of Object.values(values)) if (typeof v === "string") return v;
  return undefined;
}
