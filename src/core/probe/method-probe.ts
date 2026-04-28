/**
 * HTTP method completeness probe (T48).
 *
 * Goal: catch the class of bugs where an API responds to *unsupported* HTTP
 * methods with anything other than 405 / 404. A 500 here means an unhandled
 * exception in the routing layer; a 200/201 means a forgotten or shadowed
 * route; both are bug candidates.
 *
 * For every path declared in the spec, we look at which of {GET, POST, PUT,
 * PATCH, DELETE} are *not* declared and emit one probe step per missing
 * method. Each probe expects status in [404, 405, 401, 403] — anything else
 * (notably 5xx, 200, 201) is a regular test failure surfaced via the
 * existing runner / reporter / `zond db diagnose` flow.
 *
 * The probes are deterministic — same spec → same suites — so the generated
 * YAML can be committed as a regression test.
 */
import type { OpenAPIV3 } from "openapi-types";
import type { EndpointInfo, SecuritySchemeInfo } from "../generator/types.ts";
import type { RawSuite, RawStep } from "../generator/serializer.ts";

// ──────────────────────────────────────────────
// Constants
// ──────────────────────────────────────────────

const ALL_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;
type Method = (typeof ALL_METHODS)[number];

/** Statuses we accept on a *missing* method. 405 is canonical, 404 is a
 *  common fallback (path not registered for that method), 401/403 are
 *  acceptable when auth is checked before routing. Anything else — notably
 *  5xx (unhandled), 200/201 (silent acceptance) — is a probe failure. */
const ACCEPTABLE_STATUSES = [401, 403, 404, 405];

// ──────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────

export interface MethodProbeOptions {
  endpoints: EndpointInfo[];
  securitySchemes: SecuritySchemeInfo[];
}

export interface MethodProbeResult {
  suites: RawSuite[];
  /** Number of distinct paths probed. */
  probedPaths: number;
  /** Paths skipped because every method in {GET,POST,PUT,PATCH,DELETE} is declared. */
  skippedPaths: number;
  /** Total generated probe steps. */
  totalProbes: number;
}

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

function convertPath(path: string): string {
  return path.replace(/\{([^}]+)\}/g, "{{$1}}");
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function pathStem(path: string): string {
  const cleaned = path
    .replace(/\{[^}]+\}/g, "by-id")
    .replace(/^\//, "")
    .replace(/\//g, "-");
  return slugify(cleaned) || "root";
}

/** Replace path params with valid-shape placeholders so the request can
 *  reach the routing layer without being rejected purely on path syntax. */
function pathWithPlaceholders(
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

function getAuthHeaders(
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

interface PathBucket {
  path: string;
  /** Methods declared on this path, normalized to upper-case. */
  declared: Set<string>;
  /** A representative endpoint we can borrow auth/path-param shape from. */
  sample: EndpointInfo;
}

function bucketByPath(endpoints: EndpointInfo[]): PathBucket[] {
  const map = new Map<string, PathBucket>();
  for (const ep of endpoints) {
    if (ep.deprecated) continue;
    let bucket = map.get(ep.path);
    if (!bucket) {
      bucket = { path: ep.path, declared: new Set(), sample: ep };
      map.set(ep.path, bucket);
    }
    bucket.declared.add(ep.method.toUpperCase());
  }
  return Array.from(map.values());
}

// ──────────────────────────────────────────────
// Public API
// ──────────────────────────────────────────────

export function generateMethodProbes(opts: MethodProbeOptions): MethodProbeResult {
  const { endpoints, securitySchemes } = opts;
  const methodSet: readonly Method[] = ALL_METHODS;

  const buckets = bucketByPath(endpoints);
  const suites: RawSuite[] = [];
  let probedPaths = 0;
  let skippedPaths = 0;
  let totalProbes = 0;

  for (const bucket of buckets) {
    const missing = methodSet.filter((m) => !bucket.declared.has(m));
    if (missing.length === 0) {
      skippedPaths++;
      continue;
    }

    const concretePath = pathWithPlaceholders(
      bucket.path,
      bucket.sample.parameters,
    );
    const headers = getAuthHeaders(bucket.sample, securitySchemes);

    const steps: RawStep[] = missing.map((method) => {
      const step: RawStep = {
        name: `${method} ${bucket.path} — undeclared method must reject (no 5xx, no 2xx)`,
        [method]: convertPath(concretePath),
        expect: { status: ACCEPTABLE_STATUSES },
      };
      if (headers) step.headers = headers;
      // Body-bearing methods on an undeclared route — send a minimal valid
      // JSON object to provoke any body-parsing path while the router is
      // still expected to reject the method first.
      if (method === "POST" || method === "PUT" || method === "PATCH") {
        (step as any).json = {};
      }
      return step;
    });

    probedPaths++;
    totalProbes += steps.length;

    const stem = pathStem(bucket.path);
    suites.push({
      name: `probe methods ${bucket.path}`,
      tags: ["probe-methods", "negative-method", "no-5xx", "smoke"],
      fileStem: `probe-methods-${stem}`,
      tests: steps,
    });
  }

  return { suites, probedPaths, skippedPaths, totalProbes };
}
