/**
 * Pipeline that turns an OpenAPI spec into `CheckFinding`s by:
 *   1. enumerating operations,
 *   2. for each op, generating one case per *requested* probe kind
 *      (positive / missing_required_header / unsupported_method),
 *   3. sending each request,
 *   4. running every active check whose `caseKinds` includes the kind.
 *
 * The runner only generates kinds an active check actually needs — so
 * a `--check not_a_server_error` run never sends the extra probe
 * requests; a `--check unsupported_method` run sends only the method
 * probe, etc.
 */
import type { OpenAPIV3 } from "openapi-types";

import { extractEndpoints, readOpenApiSpec } from "../generator/index.ts";
import { detectCrudGroups } from "../generator/suite-generator.ts";
import type { EndpointInfo } from "../generator/types.ts";
import { generateFromSchema } from "../generator/data-factory.ts";
import { enumerateBoundaryCases } from "../generator/coverage-phase.ts";
import { executeRequest } from "../runner/http-client.ts";
import { createSchemaValidator, type SchemaValidator } from "../runner/schema-validator.ts";
import type { HttpRequest, HttpResponse } from "../runner/types.ts";
import {
  ALL_METHODS,
  bucketEndpointsByPath,
  pathWithMethodPlaceholders,
} from "../probe/method-shared.ts";

import "./checks/index.ts"; // side-effect: register builtins
import { selectChecks, type SelectionResult } from "./registry.ts";
import { listStatefulChecks, makeHarness } from "./stateful.ts";
import { caseMatchesMode, filterChecksByMode, type Mode } from "./mode.ts";
import { buildNegativeBody } from "./checks/_negative_mutator.ts";
import { nowIso, type NdjsonEvent } from "../reporter/ndjson.ts";
import {
  emptySummary,
  type CaseKind,
  type Check,
  type CheckCase,
  type CheckFinding,
  type CheckRunData,
  type CheckRunSummary,
} from "./types.ts";

export interface RunChecksOptions {
  specPath: string;
  baseUrl: string;
  include?: string[];
  exclude?: string[];
  timeoutMs?: number;
  /** Limit the operation set — used by `--include`/`--exclude` regex
   *  filtering in ARV-9. ARV-1 only exposes the hook. */
  operationFilter?: (op: EndpointInfo) => boolean;
  /** ARV-3 — auth headers fed to stateful security checks. CLI lifts
   *  these from `--auth-header` flags and/or the api's `.env.yaml`. */
  authHeaders?: Record<string, string>;
  /** ARV-3 AC #6 — when true, security checks return skip with a
   *  warning. The CLI surfaces this as `--bootstrap-cleanup-failed`. */
  bootstrapCleanupFailed?: boolean;
  /** ARV-6 — `examples` (current default: one positive + the
   *  single-site negative mutator) vs `coverage` (deterministic
   *  boundary-value enumeration over the body schema) vs `all` (both).
   *  Coverage cases carry `meta.boundary` and `meta.phase = "coverage"`
   *  for the SARIF reporter and reproducer hints. */
  phase?: "examples" | "coverage" | "all";
  /** ARV-6 AC #5 — gate the NUL byte (\x00) in string boundaries.
   *  Off by default because some HTTP/JSON stacks panic on it. */
  allowX00?: boolean;
  /** ARV-7 — `positive` (contract verification only), `negative`
   *  (malicious input only), `all` (default — both). Drops both checks
   *  and cases that don't belong to the requested mode. */
  mode?: Mode;
  /** ARV-10 — synchronous streaming hook. Fires per
   *  `check_start` / `check_result` / `finding` / `summary` event so the
   *  NDJSON reporter can flush each line as it happens (instead of
   *  buffering until the run finishes). Must not throw — exceptions are
   *  the caller's responsibility (the runner doesn't catch). */
  onEvent?: (event: NdjsonEvent) => void;
}

export interface RunChecksResult {
  data: CheckRunData;
  selection: SelectionResult;
  /** HIGH/CRITICAL findings count — drives the exit code. */
  high_or_critical: number;
}

function placeholderForParam(p: OpenAPIV3.ParameterObject): string {
  const schema = p.schema as OpenAPIV3.SchemaObject | undefined;
  if (schema?.format === "uuid") return "00000000-0000-0000-0000-000000000000";
  if (schema?.type === "integer" || schema?.type === "number") return "1";
  return "x";
}

function fillPathParams(path: string, op: EndpointInfo): string {
  return path.replace(/\{([^}]+)\}/g, (_, name) => {
    const match = op.parameters.find(
      (p) => (p as OpenAPIV3.ParameterObject).in === "path"
        && (p as OpenAPIV3.ParameterObject).name === name,
    );
    return match
      ? encodeURIComponent(placeholderForParam(match as OpenAPIV3.ParameterObject))
      : "1";
  });
}

function requiredHeaders(op: EndpointInfo): OpenAPIV3.ParameterObject[] {
  return op.parameters.filter(
    (p) => (p as OpenAPIV3.ParameterObject).in === "header"
      && (p as OpenAPIV3.ParameterObject).required === true,
  ) as OpenAPIV3.ParameterObject[];
}

function buildBaseHeaders(op: EndpointInfo, opts: { withRequired: boolean }): Record<string, string> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (opts.withRequired) {
    for (const h of requiredHeaders(op)) {
      headers[h.name] = "x";
    }
  }
  if (op.requestBodySchema && op.method.toUpperCase() !== "GET" && op.method.toUpperCase() !== "DELETE") {
    headers["Content-Type"] = op.requestBodyContentType ?? "application/json";
  }
  return headers;
}

function buildBody(op: EndpointInfo): string | undefined {
  if (!op.requestBodySchema) return undefined;
  const m = op.method.toUpperCase();
  if (m === "GET" || m === "DELETE") return undefined;
  return JSON.stringify(generateFromSchema(op.requestBodySchema));
}

interface BuiltCase {
  req: HttpRequest;
  case: CheckCase;
}

function buildPositive(op: EndpointInfo, baseUrl: string): BuiltCase {
  const url = `${baseUrl.replace(/\/+$/, "")}${fillPathParams(op.path, op)}`;
  const headers = buildBaseHeaders(op, { withRequired: true });
  const body = buildBody(op);
  const req: HttpRequest = { method: op.method.toUpperCase(), url, headers, body };
  const c: CheckCase = {
    operation: op,
    request: { method: req.method, url: req.url, headers: req.headers, body: req.body },
    mode: "positive",
    kind: "positive",
  };
  return { req, case: c };
}

function buildMissingHeader(op: EndpointInfo, baseUrl: string): BuiltCase | null {
  const required = requiredHeaders(op);
  if (required.length === 0) return null;
  const dropped = required[0]!.name;
  const url = `${baseUrl.replace(/\/+$/, "")}${fillPathParams(op.path, op)}`;
  const headers = buildBaseHeaders(op, { withRequired: true });
  delete headers[dropped];
  const body = buildBody(op);
  const req: HttpRequest = { method: op.method.toUpperCase(), url, headers, body };
  const c: CheckCase = {
    operation: op,
    request: { method: req.method, url: req.url, headers: req.headers, body: req.body },
    mode: "negative",
    kind: "missing_required_header",
    meta: { dropped_header: dropped },
  };
  return { req, case: c };
}

/** ARV-6: emit one BuiltCase per (field × boundary) over the body schema.
 *  Valid boundaries ride as `kind: "positive"` so positive_data_acceptance
 *  evaluates them; invalid boundaries ride as `kind: "negative_data"` so
 *  negative_data_rejection evaluates them. Both carry `meta.boundary` and
 *  `meta.phase: "coverage"` so the finding surfaces *which* boundary the
 *  server tripped on. */
function buildCoverageCases(
  op: EndpointInfo,
  baseUrl: string,
  opts: { allowX00?: boolean },
): BuiltCase[] {
  if (!op.requestBodySchema) return [];
  const m = op.method.toUpperCase();
  if (m === "GET" || m === "DELETE") return [];
  const cases = enumerateBoundaryCases(op.requestBodySchema, { allowX00: opts.allowX00 });
  const url = `${baseUrl.replace(/\/+$/, "")}${fillPathParams(op.path, op)}`;
  const headers = buildBaseHeaders(op, { withRequired: true });
  const out: BuiltCase[] = [];
  for (const cc of cases) {
    const body = JSON.stringify(cc.body);
    const req: HttpRequest = { method: m, url, headers, body };
    const kind: CaseKind = cc.valid ? "positive" : "negative_data";
    out.push({
      req,
      case: {
        operation: op,
        request: { method: req.method, url: req.url, headers: req.headers, body: req.body },
        mode: cc.valid ? "positive" : "negative",
        kind,
        meta: {
          phase: "coverage",
          boundary: cc.boundary,
          field_path: cc.field_path,
          mutation: "boundary",
        },
      },
    });
  }
  return out;
}

function buildNegativeData(op: EndpointInfo, baseUrl: string): BuiltCase | null {
  if (!op.requestBodySchema) return null;
  const m = op.method.toUpperCase();
  if (m === "GET" || m === "DELETE") return null;
  const mutated = buildNegativeBody(op.requestBodySchema);
  if (!mutated) return null;
  const url = `${baseUrl.replace(/\/+$/, "")}${fillPathParams(op.path, op)}`;
  const headers = buildBaseHeaders(op, { withRequired: true });
  const body = JSON.stringify(mutated.body);
  const req: HttpRequest = { method: m, url, headers, body };
  const c: CheckCase = {
    operation: op,
    request: { method: req.method, url: req.url, headers: req.headers, body: req.body },
    mode: "negative",
    kind: "negative_data",
    meta: { ...mutated.meta },
  };
  return { req, case: c };
}

/** For `unsupported_method` we send a method that isn't declared on
 *  the *path bucket*. The check operates on the whole path, so we ask
 *  the runner to emit at most one probe per path (using one of the
 *  declared operations as the carrier of `op` metadata). */
function buildUnsupportedMethod(
  op: EndpointInfo,
  declaredOnPath: Set<string>,
  baseUrl: string,
): BuiltCase | null {
  const missing = ALL_METHODS.filter((m) => !declaredOnPath.has(m));
  if (missing.length === 0) return null;
  const method = missing[0]!;
  const concretePath = pathWithMethodPlaceholders(op.path, op.parameters);
  const url = `${baseUrl.replace(/\/+$/, "")}${concretePath}`;
  const headers: Record<string, string> = { Accept: "application/json" };
  let body: string | undefined;
  if (method === "POST" || method === "PUT" || method === "PATCH") {
    headers["Content-Type"] = "application/json";
    body = "{}";
  }
  const req: HttpRequest = { method, url, headers, body };
  const c: CheckCase = {
    operation: op,
    request: { method, url, headers, body },
    mode: "negative",
    kind: "unsupported_method",
    meta: { undeclared_method: method },
  };
  return { req, case: c };
}

function checkKinds(c: Check): CaseKind[] {
  return c.caseKinds ?? ["positive"];
}

function summarizeResponse(resp: HttpResponse): { status: number; content_type?: string } {
  const ct = resp.headers["content-type"] ?? resp.headers["Content-Type"];
  return { status: resp.status, content_type: ct };
}

function recordFinding(
  out: CheckFinding[],
  summary: CheckRunSummary,
  check: Check,
  c: CheckCase,
  resp: HttpResponse,
  message: string,
  evidence: Record<string, unknown> | undefined,
  onEvent: ((event: NdjsonEvent) => void) | undefined,
): void {
  const finding: CheckFinding = {
    check: check.id,
    severity: check.severity,
    operation: { path: c.operation.path, method: c.operation.method, operationId: c.operation.operationId },
    request_signature: `${c.request.method} ${c.request.url}`,
    response_summary: summarizeResponse(resp),
    message,
    evidence,
  };
  out.push(finding);
  summary.findings += 1;
  summary.by_severity[check.severity] += 1;
  // ARV-10: stream the finding *immediately* so an NDJSON consumer
  // doesn't wait until the whole run finishes. Snapshot via JSON
  // round-trip would be cheaper to reason about, but a shallow copy is
  // sufficient — `findings[]` is only mutated by push and `evidence`
  // isn't mutated after construction here.
  if (onEvent) onEvent({ type: "finding", ts: nowIso(), finding });
}

export async function runChecks(opts: RunChecksOptions): Promise<RunChecksResult> {
  const doc = await readOpenApiSpec(opts.specPath);
  const allOps = extractEndpoints(doc);
  const ops = opts.operationFilter ? allOps.filter(opts.operationFilter) : allOps;
  const buckets = bucketEndpointsByPath(allOps);
  const schemaValidator: SchemaValidator = createSchemaValidator(doc);

  const mode: Mode = opts.mode ?? "all";
  const rawSelection = selectChecks({ include: opts.include, exclude: opts.exclude });
  // ARV-7: drop checks the active mode doesn't care about — `selection`
  // is what the runner sends to checks; `rawSelection` is what the user
  // *asked for* (kept on the result so warnings still surface unknown ids).
  const selection: SelectionResult = {
    selected: filterChecksByMode(rawSelection.selected, mode),
    unknown: rawSelection.unknown,
  };
  const findings: CheckFinding[] = [];
  const summary = emptySummary();
  summary.operations = ops.length;
  summary.checks_run = selection.selected.length;

  // What probe kinds are demanded by the active set this run? Skip
  // generating cases for kinds nobody asked for.
  const neededKinds = new Set<CaseKind>();
  for (const c of selection.selected) for (const k of checkKinds(c)) neededKinds.add(k);

  // Track unsupported_method per path (one probe is enough) so we don't
  // hammer the same `OPTIONS /widgets` four times for four declared ops.
  const probedUnsupportedPaths = new Set<string>();

  const phase = opts.phase ?? "examples";
  const wantsExamples = phase === "examples" || phase === "all";
  const wantsCoverage = phase === "coverage" || phase === "all";

  for (const op of ops) {
    // ARV-10: announce each operation once, regardless of how many cases
    // it spawns. Consumers use this for progress UI / liveness.
    if (opts.onEvent) {
      opts.onEvent({
        type: "check_start",
        ts: nowIso(),
        operation: { path: op.path, method: op.method, operationId: op.operationId },
      });
    }
    const cases: BuiltCase[] = [];
    if (wantsExamples && neededKinds.has("positive")) cases.push(buildPositive(op, opts.baseUrl));
    if (neededKinds.has("missing_required_header")) {
      const c = buildMissingHeader(op, opts.baseUrl);
      if (c) cases.push(c);
    }
    if (wantsExamples && neededKinds.has("negative_data")) {
      const c = buildNegativeData(op, opts.baseUrl);
      if (c) cases.push(c);
    }
    if (wantsCoverage && (neededKinds.has("negative_data") || neededKinds.has("positive"))) {
      // ARV-6: deterministic boundary-value enumeration. Filter out
      // kinds nobody asked for so a `--check positive_data_acceptance`
      // run doesn't pay for invalid-boundary requests.
      const boundary = buildCoverageCases(op, opts.baseUrl, { allowX00: opts.allowX00 });
      for (const b of boundary) {
        if (neededKinds.has(b.case.kind)) cases.push(b);
      }
    }
    if (neededKinds.has("unsupported_method") && !probedUnsupportedPaths.has(op.path)) {
      const declared = buckets.get(op.path)?.declared ?? new Set([op.method.toUpperCase()]);
      const c = buildUnsupportedMethod(op, declared, opts.baseUrl);
      if (c) {
        cases.push(c);
        probedUnsupportedPaths.add(op.path);
      }
    }

    for (const built of cases) {
      // ARV-7: skip cases whose mode doesn't match the run-mode. We
      // build them all up-front so `--mode all` and `--mode negative`
      // share the same code path; the filter just decides which go on
      // the wire.
      if (!caseMatchesMode(built.case.mode, mode)) continue;
      let httpResp: HttpResponse;
      try {
        httpResp = await executeRequest(built.req, { timeout: opts.timeoutMs ?? 30000 });
      } catch (err) {
        const finding: CheckFinding = {
          check: "network_error",
          severity: "medium",
          operation: { path: op.path, method: op.method, operationId: op.operationId },
          request_signature: `${built.req.method} ${built.req.url}`,
          response_summary: { status: 0 },
          message: `Network error: ${(err as Error).message}`,
        };
        findings.push(finding);
        summary.findings += 1;
        summary.by_severity.medium += 1;
        if (opts.onEvent) opts.onEvent({ type: "finding", ts: nowIso(), finding });
        continue;
      }

      summary.cases += 1;
      const checkResp = {
        status: httpResp.status,
        headers: httpResp.headers,
        body: httpResp.body_parsed ?? httpResp.body,
        duration_ms: httpResp.duration_ms,
      };
      for (const check of selection.selected) {
        if (!checkKinds(check).includes(built.case.kind)) continue;
        if (!check.applies(op)) continue;
        const outcome = check.run({
          case: built.case,
          response: checkResp,
          schemaValidator,
          doc,
        });
        if (outcome.kind === "fail") {
          recordFinding(findings, summary, check, built.case, httpResp, outcome.message, outcome.evidence, opts.onEvent);
        }
        // ARV-10: emit one check_result per (case × check) so an NDJSON
        // consumer can compute pass-rate / progress *during* the run —
        // skips don't count toward verdict (they're a routing decision,
        // not a contract outcome).
        if (opts.onEvent && (outcome.kind === "pass" || outcome.kind === "fail")) {
          opts.onEvent({
            type: "check_result",
            ts: nowIso(),
            check: check.id,
            verdict: outcome.kind,
            operation: { path: op.path, method: op.method, operationId: op.operationId },
            request_signature: `${built.case.request.method} ${built.case.request.url}`,
            response: summarizeResponse(httpResp),
          });
        }
      }
    }
  }

  // ── Stateful phase (ARV-3) ─────────────────────────────────────────
  // Stateful checks share the same --check / --exclude-check filters as
  // the response-phase ones. We honour `selection` ids and only run a
  // stateful check whose id was either explicitly included or not
  // explicitly excluded.
  const includeSet = opts.include && opts.include.length > 0 ? new Set(opts.include) : null;
  const excludeSet = new Set(opts.exclude ?? []);
  const activeStateful = filterChecksByMode(
    listStatefulChecks().filter((c) => {
      if (excludeSet.has(c.id)) return false;
      if (includeSet && !includeSet.has(c.id)) return false;
      return true;
    }),
    mode,
  );

  if (activeStateful.length > 0) {
    const harness = makeHarness(opts.baseUrl, doc, {
      authHeaders: opts.authHeaders,
      bootstrapCleanupFailed: opts.bootstrapCleanupFailed,
      timeoutMs: opts.timeoutMs,
    });
    const crudGroups = activeStateful.some((c) => c.phase === "crud") ? detectCrudGroups(allOps) : [];
    summary.checks_run += activeStateful.length;

    for (const check of activeStateful) {
      if (check.phase === "auth") {
        for (const op of ops) {
          if (!check.applies(op)) continue;
          let outcome;
          try {
            outcome = await check.run(op, harness);
          } catch (err) {
            outcome = { kind: "skip" as const, reason: `error: ${(err as Error).message}` };
          }
          if (outcome.kind === "fail") {
            const finding: CheckFinding = {
              check: check.id,
              severity: check.severity,
              operation: { path: op.path, method: op.method, operationId: op.operationId },
              request_signature: `${op.method.toUpperCase()} ${op.path}`,
              response_summary: { status: 0 },
              message: outcome.message,
              evidence: outcome.evidence,
            };
            findings.push(finding);
            summary.findings += 1;
            summary.by_severity[check.severity] += 1;
            if (opts.onEvent) opts.onEvent({ type: "finding", ts: nowIso(), finding });
          }
        }
      } else {
        for (const group of crudGroups) {
          if (!check.applies(group)) continue;
          let outcome;
          try {
            outcome = await check.run(group, harness);
          } catch (err) {
            outcome = { kind: "skip" as const, reason: `error: ${(err as Error).message}` };
          }
          if (outcome.kind === "fail") {
            const repOp = group.create ?? group.read!;
            const finding: CheckFinding = {
              check: check.id,
              severity: check.severity,
              operation: { path: repOp.path, method: repOp.method, operationId: repOp.operationId },
              request_signature: `${repOp.method.toUpperCase()} ${repOp.path} (chain)`,
              response_summary: { status: 0 },
              message: outcome.message,
              evidence: outcome.evidence,
            };
            findings.push(finding);
            summary.findings += 1;
            summary.by_severity[check.severity] += 1;
            if (opts.onEvent) opts.onEvent({ type: "finding", ts: nowIso(), finding });
          }
        }
      }
    }
  }

  const highOrCritical = findings.filter(
    (f) => f.severity === "high" || f.severity === "critical",
  ).length;

  // ARV-10: terminal event so downstream consumers know the run wrapped
  // (vs. the producer crashing). Mirrors what the JSON envelope's
  // `summary` field carries, just delivered as the final NDJSON line.
  if (opts.onEvent) opts.onEvent({ type: "summary", ts: nowIso(), summary });

  return {
    data: { findings, summary },
    selection,
    high_or_critical: highOrCritical,
  };
}
