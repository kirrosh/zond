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
import { runPool } from "../runner/async-pool.ts";
import type { RateLimiter } from "../runner/rate-limiter.ts";
import { recommendForCheck } from "./recommended-action.ts";
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
  /** ARV-8 — bounded async-pool concurrency at the *operation* level.
   *  `1` (default) = sequential, identical to the pre-ARV-8 behaviour.
   *  Cases within an operation always run sequentially regardless of
   *  this — share state (e.g. CRUD chains) lives at op-level, not
   *  case-level, so case-parallelism would corrupt it. */
  workers?: number;
  /** ARV-8 — gate every outbound HTTP request through the limiter so
   *  bursts of parallel workers respect a global RPS budget (also
   *  reacts to RateLimit-* headers via `note()`). */
  rateLimiter?: RateLimiter;
  /** ARV-141: substitute real fixture values into path-param placeholders so
   *  the deterministic synthetic 404 (`/issues/x`) becomes a real-id 200/422
   *  whenever `.env.yaml` actually has a fixture. This makes `checks run`
   *  reactive to fixture-pack growth — without it, two runs against the same
   *  spec emit pixel-identical findings/skip counts regardless of how many
   *  vars are filled. Keyed by path-param name (e.g. `issue_id`); falls back
   *  to the legacy schema-driven placeholder when the name isn't in the map. */
  pathVars?: Record<string, string>;
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

function fillPathParams(
  path: string,
  op: EndpointInfo,
  pathVars?: Record<string, string>,
): string {
  return path.replace(/\{([^}]+)\}/g, (_, name) => {
    // ARV-141: real fixture wins over schema-derived placeholder.
    const real = pathVars?.[name];
    if (typeof real === "string" && real.length > 0) {
      return encodeURIComponent(real);
    }
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

function buildPositive(op: EndpointInfo, baseUrl: string, pathVars?: Record<string, string>): BuiltCase {
  const url = `${baseUrl.replace(/\/+$/, "")}${fillPathParams(op.path, op, pathVars)}`;
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

function buildMissingHeader(op: EndpointInfo, baseUrl: string, pathVars?: Record<string, string>): BuiltCase | null {
  const required = requiredHeaders(op);
  if (required.length === 0) return null;
  const dropped = required[0]!.name;
  const url = `${baseUrl.replace(/\/+$/, "")}${fillPathParams(op.path, op, pathVars)}`;
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
  opts: { allowX00?: boolean; pathVars?: Record<string, string> },
): BuiltCase[] {
  if (!op.requestBodySchema) return [];
  const m = op.method.toUpperCase();
  if (m === "GET" || m === "DELETE") return [];
  const cases = enumerateBoundaryCases(op.requestBodySchema, { allowX00: opts.allowX00 });
  const url = `${baseUrl.replace(/\/+$/, "")}${fillPathParams(op.path, op, opts.pathVars)}`;
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

function buildNegativeData(op: EndpointInfo, baseUrl: string, pathVars?: Record<string, string>): BuiltCase | null {
  if (!op.requestBodySchema) return null;
  const m = op.method.toUpperCase();
  if (m === "GET" || m === "DELETE") return null;
  const mutated = buildNegativeBody(op.requestBodySchema);
  if (!mutated) return null;
  const url = `${baseUrl.replace(/\/+$/, "")}${fillPathParams(op.path, op, pathVars)}`;
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

/** ARV-61 (feedback round-01 / F1): inject auth headers into a response-phase
 *  case so depth-checks pierce the auth-wall on real APIs. Case-specific
 *  headers win (case-insensitive). `missing_required_header` deliberately
 *  drops one header — if the dropped one matches an auth header, skip the
 *  injection for that key so the probe stays meaningful. */
function injectAuthHeadersIntoCase(built: BuiltCase, authHeaders: Record<string, string>): void {
  if (!authHeaders || Object.keys(authHeaders).length === 0) return;
  const existing = new Set(Object.keys(built.req.headers).map((k) => k.toLowerCase()));
  const droppedLower =
    built.case.kind === "missing_required_header" && typeof built.case.meta?.dropped_header === "string"
      ? (built.case.meta.dropped_header as string).toLowerCase()
      : null;
  for (const [name, value] of Object.entries(authHeaders)) {
    const lower = name.toLowerCase();
    if (existing.has(lower)) continue;
    if (droppedLower === lower) continue;
    built.req.headers[name] = value;
    built.case.request.headers[name] = value;
  }
}

function summarizeResponse(resp: HttpResponse): { status: number; content_type?: string } {
  const ct = resp.headers["content-type"] ?? resp.headers["Content-Type"];
  return { status: resp.status, content_type: ct };
}

/** Build a finding, push it into the per-op buffer, and stream the
 *  ARV-10 NDJSON event. Summary aggregation moved out — the caller
 *  merges per-op buffers in input order so workers > 1 doesn't have to
 *  contend on a shared `summary` object. */
function recordFinding(
  out: CheckFinding[],
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
    recommended_action: recommendForCheck(check.id, resp.status),
  };
  out.push(finding);
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
  // feedback-04#F1: stateful checks (ignored_auth, use_after_free,
  // ensure_resource_availability) live in a separate registry but are
  // accepted by `--check`; selectChecks doesn't know about them and would
  // flag the ids as "unknown". Strip those out so the user only sees
  // warnings for ids that are truly absent from `zond checks list`.
  const statefulIds = new Set(listStatefulChecks().map((c) => c.id));
  const selection: SelectionResult = {
    selected: filterChecksByMode(rawSelection.selected, mode),
    unknown: rawSelection.unknown.filter((id) => !statefulIds.has(id)),
  };
  const summary = emptySummary();
  summary.operations = ops.length;
  summary.checks_run = selection.selected.length;

  // What probe kinds are demanded by the active set this run? Skip
  // generating cases for kinds nobody asked for.
  const neededKinds = new Set<CaseKind>();
  for (const c of selection.selected) for (const k of checkKinds(c)) neededKinds.add(k);

  // ARV-8: pre-compute the path → "first op" assignment for the
  // unsupported_method probe. The pre-ARV-8 code did this lazily inside
  // the op loop (one shared Set, mutate-on-visit) — that race-conditions
  // when ops are processed in parallel (two workers on the same path
  // would each emit a probe). Resolving it up-front keeps "one probe
  // per path" deterministic regardless of `--workers`.
  const unsupportedMethodOwner = new Map<string, EndpointInfo>();
  if (neededKinds.has("unsupported_method")) {
    for (const op of ops) {
      if (!unsupportedMethodOwner.has(op.path)) unsupportedMethodOwner.set(op.path, op);
    }
  }

  const phase = opts.phase ?? "examples";
  const wantsExamples = phase === "examples" || phase === "all";
  const wantsCoverage = phase === "coverage" || phase === "all";

  /** Per-op result — workers push these and the main thread merges them
   *  in input order so `findings[]` and `summary.cases` don't depend on
   *  worker scheduling (matters for snapshot tests + reproducibility). */
  interface OpReport {
    findings: CheckFinding[];
    cases: number;
    /** ARV-26: skip-outcome counts keyed by `"<check_id>: <reason>"`. */
    skipped: Record<string, number>;
  }

  async function processOperation(op: EndpointInfo): Promise<OpReport> {
    const localFindings: CheckFinding[] = [];
    let localCases = 0;
    const localSkipped: Record<string, number> = {};
    if (opts.onEvent) {
      opts.onEvent({
        type: "check_start",
        ts: nowIso(),
        operation: { path: op.path, method: op.method, operationId: op.operationId },
      });
    }
    const cases: BuiltCase[] = [];
    if (wantsExamples && neededKinds.has("positive")) cases.push(buildPositive(op, opts.baseUrl, opts.pathVars));
    if (neededKinds.has("missing_required_header")) {
      const c = buildMissingHeader(op, opts.baseUrl, opts.pathVars);
      if (c) cases.push(c);
    }
    if (wantsExamples && neededKinds.has("negative_data")) {
      const c = buildNegativeData(op, opts.baseUrl, opts.pathVars);
      if (c) cases.push(c);
    }
    if (wantsCoverage && (neededKinds.has("negative_data") || neededKinds.has("positive"))) {
      const boundary = buildCoverageCases(op, opts.baseUrl, { allowX00: opts.allowX00, pathVars: opts.pathVars });
      for (const b of boundary) {
        if (neededKinds.has(b.case.kind)) cases.push(b);
      }
    }
    if (unsupportedMethodOwner.get(op.path) === op) {
      const declared = buckets.get(op.path)?.declared ?? new Set([op.method.toUpperCase()]);
      const c = buildUnsupportedMethod(op, declared, opts.baseUrl);
      if (c) cases.push(c);
    }

    for (const built of cases) {
      if (!caseMatchesMode(built.case.mode, mode)) continue;
      if (opts.authHeaders) injectAuthHeadersIntoCase(built, opts.authHeaders);
      // ARV-8: gate the request through the rate-limiter (no-op when
      // none configured). Acquire happens *inside* the worker so a pool
      // of N workers can't leak more requests/sec than the limiter
      // allows.
      if (opts.rateLimiter) await opts.rateLimiter.acquire();
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
          recommended_action: recommendForCheck("network_error", 0),
        };
        localFindings.push(finding);
        if (opts.onEvent) opts.onEvent({ type: "finding", ts: nowIso(), finding });
        continue;
      }

      localCases += 1;
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
          recordFinding(localFindings, check, built.case, httpResp, outcome.message, outcome.evidence, opts.onEvent);
        }
        if (outcome.kind === "skip") {
          // ARV-26: bucket skips by check+reason so the summary can surface
          // "0 findings BUT 2 skipped (no JSON Schema on this branch)".
          const key = `${check.id}: ${outcome.reason ?? "unspecified"}`;
          localSkipped[key] = (localSkipped[key] ?? 0) + 1;
        }
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
    return { findings: localFindings, cases: localCases, skipped: localSkipped };
  }

  // ARV-8: parallelize the op-loop. workers=1 (default) preserves the
  // sequential code path inside runPool — same microtask interleaving as
  // before, AC #4 backward-compat.
  const workers = opts.workers ?? 1;
  const opReports = await runPool(ops, workers, processOperation);

  const findings: CheckFinding[] = [];
  for (const report of opReports) {
    summary.cases += report.cases;
    for (const [key, n] of Object.entries(report.skipped)) {
      summary.skipped_outcomes[key] = (summary.skipped_outcomes[key] ?? 0) + n;
    }
    for (const f of report.findings) {
      findings.push(f);
      summary.findings += 1;
      summary.by_severity[f.severity] += 1;
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

    // ARV-8: parallelize auth-phase ops and crud-phase groups via the
     // same pool. CRUD-chain integrity stays intact because the *check*
     // owns its own sequential within-chain logic — the pool only runs
     // *independent* groups in parallel.
    const statefulWorkers = opts.workers ?? 1;
    const collected: CheckFinding[] = [];
    function pushStateful(f: CheckFinding): void {
      collected.push(f);
      summary.findings += 1;
      summary.by_severity[f.severity] += 1;
      if (opts.onEvent) opts.onEvent({ type: "finding", ts: nowIso(), finding: f });
    }
    for (const check of activeStateful) {
      if (check.phase === "auth") {
        const applicable = ops.filter((op) => check.applies(op));
        // ARV-154: track per-op cases + skip reasons for the stateful auth
        // path. Previously this loop only forwarded `fail` outcomes; runs
        // like `--check ignored_auth` on a fully-protected API where every
        // baseline passes returned `{operations: 48, cases: 0, findings: 0}`
        // with no skipped_outcomes, making the check look broken when it
        // was actually working (no auth bypass found). Mirror the
        // observability of the non-stateful path: count attempted cases
        // and bucket skip reasons by `<check>: <reason>`.
        type StatefulOutcome =
          | { kind: "fail"; finding: CheckFinding }
          | { kind: "skip"; reason: string }
          | { kind: "pass" };
        const opReports = await runPool<typeof applicable[number], StatefulOutcome>(
          applicable,
          statefulWorkers,
          async (op): Promise<StatefulOutcome> => {
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
              recommended_action: recommendForCheck(check.id),
            };
            return { kind: "fail", finding };
          }
          if (outcome.kind === "skip") {
            return { kind: "skip", reason: outcome.reason ?? "unspecified" };
          }
          return { kind: "pass" };
        });
        for (const o of opReports) {
          summary.cases += 1;
          if (o.kind === "fail") pushStateful(o.finding);
          else if (o.kind === "skip") {
            const key = `${check.id}: ${o.reason}`;
            summary.skipped_outcomes[key] = (summary.skipped_outcomes[key] ?? 0) + 1;
          }
        }
      } else {
        const applicable = crudGroups.filter((g) => check.applies(g));
        // ARV-154: mirror the auth-phase observability — count CRUD groups
        // attempted and record skip reasons, not just failures.
        type StatefulOutcome =
          | { kind: "fail"; finding: CheckFinding }
          | { kind: "skip"; reason: string }
          | { kind: "pass" };
        const groupReports = await runPool<typeof applicable[number], StatefulOutcome>(
          applicable,
          statefulWorkers,
          async (group): Promise<StatefulOutcome> => {
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
              recommended_action: recommendForCheck(check.id),
            };
            return { kind: "fail", finding };
          }
          if (outcome.kind === "skip") {
            return { kind: "skip", reason: outcome.reason ?? "unspecified" };
          }
          return { kind: "pass" };
        });
        for (const o of groupReports) {
          summary.cases += 1;
          if (o.kind === "fail") pushStateful(o.finding);
          else if (o.kind === "skip") {
            const key = `${check.id}: ${o.reason}`;
            summary.skipped_outcomes[key] = (summary.skipped_outcomes[key] ?? 0) + 1;
          }
        }
      }
    }
    findings.push(...collected);
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
