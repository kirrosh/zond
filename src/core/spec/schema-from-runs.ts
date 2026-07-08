/**
 * ARV-175: extract 2xx response bodies from a persisted run and infer a
 * JSON Schema per (endpoint, status). The output `patch.schema.json` is the
 * input to `refresh-api --merge-schema` (ARV-176), which folds it into the
 * spec overlay so `response_schema_conformance` has something to check on
 * APIs whose upstream spec declares no response schemas.
 */

import { inferSchema, type JsonSchema } from "./infer-schema.ts";
import { specPathToRegex, normalizePath } from "../generator/coverage-scanner.ts";
import type { EndpointInfo } from "../generator/types.ts";

export interface SchemaFromRunsResult {
  /** endpoint label (`METHOD /path/{tpl}`) → status code → inferred schema. */
  patch: Record<string, Record<string, JsonSchema>>;
  /** Per-group accounting for the CLI to report. */
  groups: Array<{
    endpoint: string;
    status: string;
    samples: number;
    emitted: boolean;
    reason?: string;
  }>;
}

export interface ResultRow {
  request_method: string | null;
  request_url: string | null;
  response_status: number | null;
  response_body: string | null;
}

/** Strip base URL, query, and trailing slash from a concrete request URL,
 *  leaving just the path for spec-template matching. */
function pathOf(rawUrl: string): string {
  let p = rawUrl;
  // Drop scheme+host if present.
  const schemeIdx = p.indexOf("://");
  if (schemeIdx !== -1) {
    const afterScheme = p.slice(schemeIdx + 3);
    const slash = afterScheme.indexOf("/");
    p = slash === -1 ? "/" : afterScheme.slice(slash);
  }
  const q = p.indexOf("?");
  if (q !== -1) p = p.slice(0, q);
  return p.replace(/\/+$/, "") || "/";
}

/** Match a concrete path to the most specific spec endpoint (fewest params
 *  wins, so `/users/me` beats `/users/{id}`). Returns the endpoint label. */
function matchEndpoint(
  method: string,
  concretePath: string,
  endpoints: EndpointInfo[],
): string | null {
  const norm = normalizePath(concretePath);
  const candidates = endpoints
    .filter((e) => e.method.toUpperCase() === method.toUpperCase())
    .filter((e) => specPathToRegex(e.path).test(norm))
    .sort((a, b) => paramCount(a.path) - paramCount(b.path));
  const best = candidates[0];
  return best ? `${best.method.toUpperCase()} ${best.path}` : null;
}

function paramCount(path: string): number {
  return (path.match(/\{[^}]+\}/g) ?? []).length;
}

export interface SchemaFromRunsOptions {
  results: ResultRow[];
  endpoints: EndpointInfo[];
  /** Minimum 2xx samples per (endpoint, status) group to emit a schema. */
  minSamples: number;
}

export function schemaFromRuns(opts: SchemaFromRunsOptions): SchemaFromRunsResult {
  const { results, endpoints, minSamples } = opts;
  // (endpoint → status → parsed bodies)
  const buckets = new Map<string, Map<string, unknown[]>>();
  // Preserve unmatched URLs so the CLI can hint at spec/base-url drift.
  for (const r of results) {
    if (r.response_status == null || r.response_status < 200 || r.response_status >= 300) continue;
    if (!r.response_body || !r.request_url || !r.request_method) continue;
    let body: unknown;
    try {
      body = JSON.parse(r.response_body);
    } catch {
      continue; // non-JSON 2xx body — nothing to infer for application/json
    }
    const endpoint = matchEndpoint(r.request_method, pathOf(r.request_url), endpoints);
    if (!endpoint) continue;
    const status = String(r.response_status);
    if (!buckets.has(endpoint)) buckets.set(endpoint, new Map());
    const byStatus = buckets.get(endpoint)!;
    if (!byStatus.has(status)) byStatus.set(status, []);
    byStatus.get(status)!.push(body);
  }

  const patch: SchemaFromRunsResult["patch"] = {};
  const groups: SchemaFromRunsResult["groups"] = [];
  // Deterministic order: sort by endpoint then status.
  for (const endpoint of [...buckets.keys()].sort()) {
    const byStatus = buckets.get(endpoint)!;
    for (const status of [...byStatus.keys()].sort()) {
      const samples = byStatus.get(status)!;
      if (samples.length < minSamples) {
        groups.push({ endpoint, status, samples: samples.length, emitted: false, reason: `<${minSamples} samples` });
        continue;
      }
      const schema = inferSchema(samples);
      if (!patch[endpoint]) patch[endpoint] = {};
      patch[endpoint]![status] = schema;
      groups.push({ endpoint, status, samples: samples.length, emitted: true });
    }
  }
  return { patch, groups };
}
