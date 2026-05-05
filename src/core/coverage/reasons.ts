/**
 * Coverage reasons engine — pure function: spec endpoints + run results +
 * workspace context → matrix cells with explicit reason codes.
 *
 * The matrix has rows per endpoint (METHOD path) and three status-class
 * columns (`2xx`, `4xx`, `5xx`). Each cell carries:
 *   - status: covered | partial | uncovered
 *   - reasons: zero or more codes that explain the cell state
 *   - results: stored step results that contributed to this cell
 *
 * "Default" branch is intentionally omitted — extractEndpoints already
 * skips OpenAPI's "default" status code, so making a column for it would
 * be permanently empty and noisy.
 *
 * The function is intentionally I/O-free: callers (server, exporter, CLI)
 * load endpoints/results/fixtures separately and feed them in. This keeps
 * the engine trivial to unit-test.
 */
import type { EndpointInfo } from "../generator/types.ts";
import type { StoredStepResult } from "../../db/queries.ts";

export type StatusClass = "2xx" | "4xx" | "5xx";
export const STATUS_CLASSES: StatusClass[] = ["2xx", "4xx", "5xx"];

export type ReasonCode =
  | "covered"
  | "partial-failed"
  | "not-generated"
  | "no-spec"
  | "deprecated"
  | "no-fixtures"
  | "ephemeral-only"
  | "auth-scope-mismatch"
  | "tag-filtered";

export interface CellResultRef {
  resultId: number;
  runId: number;
  status: string;
  responseStatus: number | null;
  failureClass: string | null;
  testName: string;
  suiteFile: string | null;
}

export interface MatrixCell {
  status: "covered" | "partial" | "uncovered";
  reasons: ReasonCode[];
  results: CellResultRef[];
}

export interface MatrixRow {
  endpoint: string;
  method: string;
  path: string;
  tags: string[];
  deprecated: boolean;
  security: string[];
  declaredStatuses: number[];
  cells: Record<StatusClass, MatrixCell>;
}

export interface BuildMatrixInput {
  endpoints: EndpointInfo[];
  results: StoredStepResult[];
  fixturesAffected: Map<string, { name: string; required: boolean; source: string }[]>;
  envVars: Set<string>;
  ephemeralEndpoints: Set<string>;
  tagFilter: string[];
  profile: "safe" | "full";
}

export interface MatrixTotals {
  endpoints: number;
  cells: number;
  covered: number;
  partial: number;
  uncovered: number;
  byReason: Record<ReasonCode, number>;
}

export interface CoverageMatrix {
  rows: MatrixRow[];
  totals: MatrixTotals;
}

function endpointKey(method: string, path: string): string {
  return `${method.toUpperCase()} ${path}`;
}

function classifyStatus(code: number): StatusClass | null {
  if (code >= 200 && code < 300) return "2xx";
  if (code >= 400 && code < 500) return "4xx";
  if (code >= 500 && code < 600) return "5xx";
  return null;
}

/**
 * Build a regex that matches a concrete URL path against an OpenAPI path
 * template. `/pets/{id}` becomes `^/pets/[^/]+$`.
 */
function specPathToRegex(specPath: string): RegExp {
  const pattern = specPath.replace(/\{[^}]+\}/g, "[^/]+");
  return new RegExp(`^${pattern}$`);
}

function extractPathname(url: string | null): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.pathname;
  } catch {
    if (url.startsWith("/")) {
      const q = url.indexOf("?");
      return q === -1 ? url : url.slice(0, q);
    }
    return null;
  }
}

function matchResultToEndpoint(
  result: StoredStepResult,
  endpointsByKey: Map<string, EndpointInfo>,
  endpointsByMethod: Map<string, { ep: EndpointInfo; rx: RegExp }[]>,
): EndpointInfo | null {
  const provEp = (result.provenance as Record<string, unknown> | null)?.endpoint;
  if (typeof provEp === "string") {
    const sp = provEp.indexOf(" ");
    const normalised = sp === -1
      ? provEp
      : `${provEp.slice(0, sp).toUpperCase()}${provEp.slice(sp)}`;
    const direct = endpointsByKey.get(normalised);
    if (direct) return direct;
  }
  const method = result.request_method?.toUpperCase();
  if (!method) return null;
  const candidates = endpointsByMethod.get(method);
  if (!candidates) return null;
  const pathname = extractPathname(result.request_url);
  if (!pathname) return null;
  for (const c of candidates) if (c.rx.test(pathname)) return c.ep;
  return null;
}

function pathParamNames(path: string): string[] {
  return [...path.matchAll(/\{([^}]+)\}/g)].map((m) => m[1]!);
}

function hasMissingPathFixtures(
  ep: EndpointInfo,
  fixturesAffected: Map<string, { name: string; required: boolean; source: string }[]>,
  envVars: Set<string>,
): boolean {
  const params = pathParamNames(ep.path);
  if (params.length === 0) return false;
  const label = endpointKey(ep.method, ep.path);
  const declared = fixturesAffected.get(label) ?? [];
  // Manifest entry per param? Required + missing = no-fixtures.
  const required = declared.filter((f) => f.source === "path" && f.required);
  for (const f of required) if (!envVars.has(f.name)) return true;
  // Manifest may not enumerate every param when it was generated before this
  // endpoint existed, so also require: every {param} must map to an env var.
  for (const p of params) {
    if (envVars.has(p)) continue;
    const declaredForP = declared.find((f) => f.name === p);
    if (declaredForP && envVars.has(declaredForP.name)) continue;
    return true;
  }
  return false;
}

function hasMissingAuthFixtures(ep: EndpointInfo, envVars: Set<string>): boolean {
  if (ep.security.length === 0) return false;
  // Convention: a security scheme name maps to one of `<name>`, `<name>_token`,
  // or the lowercased `<name>_token` env var. The endpoint is satisfied if
  // *any* of its required schemes has a configured token.
  for (const scheme of ep.security) {
    const variants = [scheme, `${scheme}_token`, `${scheme.toLowerCase()}_token`, "auth_token"];
    if (variants.some((v) => envVars.has(v))) return false;
  }
  return true;
}

function declaredStatusClasses(ep: EndpointInfo): Set<StatusClass> {
  const out = new Set<StatusClass>();
  for (const r of ep.responses) {
    const cls = classifyStatus(r.statusCode);
    if (cls) out.add(cls);
  }
  return out;
}

export function buildCoverageMatrix(input: BuildMatrixInput): CoverageMatrix {
  const endpointsByKey = new Map<string, EndpointInfo>();
  const endpointsByMethod = new Map<string, { ep: EndpointInfo; rx: RegExp }[]>();
  for (const ep of input.endpoints) {
    endpointsByKey.set(endpointKey(ep.method, ep.path), ep);
    const method = ep.method.toUpperCase();
    const list = endpointsByMethod.get(method) ?? [];
    list.push({ ep, rx: specPathToRegex(ep.path) });
    endpointsByMethod.set(method, list);
  }

  // Bucket results: key = "METHOD path" → statusClass → list of refs.
  const buckets = new Map<string, Record<StatusClass, CellResultRef[]>>();
  for (const r of input.results) {
    const ep = matchResultToEndpoint(r, endpointsByKey, endpointsByMethod);
    if (!ep) continue;
    const key = endpointKey(ep.method, ep.path);
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { "2xx": [], "4xx": [], "5xx": [] };
      buckets.set(key, bucket);
    }
    if (r.response_status == null) continue;
    const cls = classifyStatus(r.response_status);
    if (!cls) continue;
    bucket[cls].push({
      resultId: r.id,
      runId: r.run_id,
      status: r.status,
      responseStatus: r.response_status,
      failureClass: r.failure_class,
      testName: r.test_name,
      suiteFile: r.suite_file,
    });
  }

  const totals: MatrixTotals = {
    endpoints: input.endpoints.length,
    cells: 0,
    covered: 0,
    partial: 0,
    uncovered: 0,
    byReason: {
      "covered": 0, "partial-failed": 0, "not-generated": 0, "no-spec": 0,
      "deprecated": 0, "no-fixtures": 0, "ephemeral-only": 0,
      "auth-scope-mismatch": 0, "tag-filtered": 0,
    },
  };

  const filterTags = new Set(input.tagFilter);
  const rows: MatrixRow[] = input.endpoints.map((ep) => {
    const key = endpointKey(ep.method, ep.path);
    const bucket = buckets.get(key) ?? { "2xx": [], "4xx": [], "5xx": [] };
    const declared = declaredStatusClasses(ep);
    const tagFiltered = filterTags.size > 0 && !ep.tags.some((t) => filterTags.has(t));
    const cells: Record<StatusClass, MatrixCell> = { "2xx": null!, "4xx": null!, "5xx": null!};

    for (const cls of STATUS_CLASSES) {
      const refs = bucket[cls];
      const passing = refs.some((r) => r.status === "pass");
      const failing = refs.some((r) => r.status !== "pass");
      const reasons: ReasonCode[] = [];
      let cellStatus: MatrixCell["status"];
      if (passing && !failing) {
        cellStatus = "covered";
        reasons.push("covered");
      } else if (passing && failing) {
        cellStatus = "covered";
        reasons.push("covered", "partial-failed");
      } else if (failing) {
        cellStatus = "partial";
        reasons.push("partial-failed");
      } else {
        cellStatus = "uncovered";
        if (!declared.has(cls)) reasons.push("no-spec");
        if (ep.deprecated) reasons.push("deprecated");
        if (input.ephemeralEndpoints.has(key) && input.profile === "safe") reasons.push("ephemeral-only");
        if (tagFiltered) reasons.push("tag-filtered");
        if (hasMissingPathFixtures(ep, input.fixturesAffected, input.envVars)) reasons.push("no-fixtures");
        if (hasMissingAuthFixtures(ep, input.envVars)) reasons.push("auth-scope-mismatch");
        if (reasons.length === 0) reasons.push("not-generated");
      }
      // Always tag deprecated even on covered cells — it's an awareness flag.
      if (ep.deprecated && !reasons.includes("deprecated")) reasons.push("deprecated");

      cells[cls] = { status: cellStatus, reasons, results: refs };

      totals.cells += 1;
      if (cellStatus === "covered") totals.covered += 1;
      else if (cellStatus === "partial") totals.partial += 1;
      else totals.uncovered += 1;
      for (const code of reasons) totals.byReason[code] += 1;
    }

    return {
      endpoint: key,
      method: ep.method.toUpperCase(),
      path: ep.path,
      tags: ep.tags,
      deprecated: !!ep.deprecated,
      security: ep.security,
      declaredStatuses: ep.responses.map((r) => r.statusCode).sort((a, b) => a - b),
      cells,
    };
  });

  return { rows, totals };
}
