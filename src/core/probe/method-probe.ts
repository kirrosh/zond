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
import { pathWithByAliases, getAuthHeaders } from "./shared.ts";
import {
  ALL_METHODS,
  ACCEPTABLE_UNSUPPORTED_STATUSES,
  bucketEndpointsByPath,
  pathWithMethodPlaceholders,
  type Method,
} from "./method-shared.ts";

// 405-or-equivalent statuses for an *undeclared* method probe. ARV-2
// (m-15) extracted this list to method-shared.ts so the live
// `unsupported_method` check stays in lock-step with the offline probe.
const ACCEPTABLE_STATUSES = [...ACCEPTABLE_UNSUPPORTED_STATUSES];

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
  // TASK-159 (m-9 P3): preserve placeholder name (`by-org`, `by-proj`)
  // instead of collapsing every `{x}` to a generic `by-id`.
  const cleaned = pathWithByAliases(path)
    .replace(/^\//, "")
    .replace(/\//g, "-");
  return slugify(cleaned) || "root";
}

// pathWithPlaceholders + bucketByPath moved to ./method-shared.ts for
// reuse by the live `unsupported_method` check (m-15 ARV-2).
const pathWithPlaceholders = pathWithMethodPlaceholders;
const bucketByPath = (endpoints: EndpointInfo[]): Array<{
  path: string;
  declared: Set<string>;
  sample: EndpointInfo;
}> => Array.from(bucketEndpointsByPath(endpoints).values());

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
        source: {
          generator: "method-probe",
          endpoint: `${method} ${bucket.path}`,
          response_branch: ACCEPTABLE_STATUSES.map(String).join("|"),
        },
        [method]: convertPath(concretePath),
        expect: { status: ACCEPTABLE_STATUSES },
      };
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
      source: {
        type: "probe-suite",
        generator: "method-probe",
        endpoint: bucket.path,
      },
      fileStem: `probe-methods-${stem}`,
      base_url: "{{base_url}}",
      ...(headers ? { headers } : {}),
      tests: steps,
    });
  }

  return { suites, probedPaths, skippedPaths, totalProbes };
}
