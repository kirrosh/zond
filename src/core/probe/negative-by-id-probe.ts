/**
 * Negative-coverage probe: hit every {*_id|*_uuid|*_slug}-bearing endpoint
 * with bogus path-params and expect a 4xx (404 / 400 / 410). Closes the
 * gap between positive CRUD chains (which only hit valid resources) and
 * security probes (which look for vulns, not coverage).
 *
 * For an N-resource API this typically lights up 60+ extra endpoint hits
 * per the TASK-275 motivation: an 11% coverage jump that previously took
 * hours of YAML copy-paste. (TASK-275)
 */
import type { OpenAPIV3 } from "openapi-types";
import type { EndpointInfo, SecuritySchemeInfo } from "../generator/types.ts";
import type { RawSuite, RawStep } from "../generator/serializer.ts";
import { pathWithByAliases, getAuthHeaders } from "./shared.ts";

export interface NegativeByIdOptions {
  endpoints: EndpointInfo[];
  securitySchemes: SecuritySchemeInfo[];
}

export interface NegativeByIdResult {
  suites: RawSuite[];
  /** Distinct paths probed (= those that have at least one path-param). */
  probedPaths: number;
  /** Paths skipped because they declare no path parameters (LIST endpoints). */
  skippedPaths: number;
  /** Total emitted steps across all suites. */
  totalProbes: number;
}

/** Statuses we accept for a request hitting a bogus id. 404 is canonical;
 *  400 covers servers that 400 on shape-valid-but-unknown ids; 410 covers
 *  soft-delete / "gone" semantics. Anything else (5xx, 2xx, 401/403 from
 *  *after* the routing decision) means the request was either not handled
 *  cleanly or auth was checked before the id was looked up — both cases
 *  the user should see and decide on, so we let them surface as failures. */
const ACCEPTABLE_STATUSES = [400, 404, 410];

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function pathStem(path: string): string {
  const cleaned = pathWithByAliases(path).replace(/^\//, "").replace(/\//g, "-");
  return slugify(cleaned) || "root";
}

/** Pick a bogus value for a path param based on its declared schema +
 *  param name. The chosen values are valid-shape (so the server reaches
 *  the lookup, not the validator) but guaranteed-not-to-exist. */
export function bogusValueFor(
  param: OpenAPIV3.ParameterObject | undefined,
): string {
  const schema = param?.schema as OpenAPIV3.SchemaObject | undefined;
  const name = (param?.name ?? "").toLowerCase();
  if (schema?.format === "uuid") return "00000000-0000-0000-0000-000000000000";
  if (schema?.type === "integer" || schema?.type === "number") return "999999999";
  if (schema?.format === "email") return "nonexistent@zond-bogus.invalid";
  if (name.includes("slug")) return "zond-bogus-slug";
  // Generic fallback — distinctive enough to grep for in logs, valid-shape
  // for almost any string param.
  return "zond-bogus-id";
}

/** Replace every {param} with a bogus value. */
function pathWithBogusParams(
  path: string,
  parameters: OpenAPIV3.ParameterObject[],
): string {
  return path.replace(/\{([^}]+)\}/g, (_, name: string) => {
    const param = parameters.find((p) => p.name === name && p.in === "path");
    return bogusValueFor(param);
  });
}

function hasPathParam(ep: EndpointInfo): boolean {
  return /\{[^}]+\}/.test(ep.path);
}

interface PathBucket {
  path: string;
  endpoints: EndpointInfo[];
}

function bucketByPath(endpoints: EndpointInfo[]): PathBucket[] {
  const map = new Map<string, PathBucket>();
  for (const ep of endpoints) {
    if (ep.deprecated) continue;
    if (!hasPathParam(ep)) continue;
    let bucket = map.get(ep.path);
    if (!bucket) {
      bucket = { path: ep.path, endpoints: [] };
      map.set(ep.path, bucket);
    }
    bucket.endpoints.push(ep);
  }
  return Array.from(map.values());
}

export function generateNegativeByIdProbes(
  opts: NegativeByIdOptions,
): NegativeByIdResult {
  const { endpoints, securitySchemes } = opts;

  // Track how many input paths *had* at least one parameterized endpoint
  // vs were pure LIST/collection endpoints. Helps the user understand why
  // a 200-endpoint spec only produces 60 probes.
  const pathSet = new Set<string>();
  for (const ep of endpoints) {
    if (!ep.deprecated) pathSet.add(ep.path);
  }

  const buckets = bucketByPath(endpoints);
  const suites: RawSuite[] = [];
  let totalProbes = 0;

  for (const bucket of buckets) {
    const sample = bucket.endpoints[0]!;
    const concretePath = pathWithBogusParams(bucket.path, sample.parameters);
    const headers = getAuthHeaders(sample, securitySchemes);

    const steps: RawStep[] = bucket.endpoints.map((ep) => {
      const method = ep.method.toUpperCase();
      const step: RawStep = {
        name: `${method} ${bucket.path} — bogus id must reject (no 5xx, no 2xx)`,
        source: {
          generator: "negative-by-id-probe",
          endpoint: `${method} ${bucket.path}`,
          response_branch: ACCEPTABLE_STATUSES.map(String).join("|"),
        },
        [method]: concretePath,
        expect: { status: ACCEPTABLE_STATUSES },
      };
      // Body-bearing methods: send a minimal valid JSON object so a server
      // that body-parses *before* id-lookup still goes through its handler.
      // We don't fabricate a "real" body — the goal is to reach the lookup
      // path with a bogus id, not exercise body validation (probe-validation
      // covers that).
      if (method === "POST" || method === "PUT" || method === "PATCH") {
        step.json = {};
      }
      return step;
    });

    totalProbes += steps.length;

    suites.push({
      name: `probe negative-by-id ${bucket.path}`,
      tags: ["probe-negative-by-id", "negative-by-id", "no-5xx", "smoke"],
      source: {
        type: "probe-suite",
        generator: "negative-by-id-probe",
        endpoint: bucket.path,
      },
      fileStem: `probe-negative-by-id-${pathStem(bucket.path)}`,
      base_url: "{{base_url}}",
      ...(headers ? { headers } : {}),
      tests: steps,
    });
  }

  return {
    suites,
    probedPaths: buckets.length,
    skippedPaths: pathSet.size - buckets.length,
    totalProbes,
  };
}
