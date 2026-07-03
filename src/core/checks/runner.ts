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
import { buildApiResourceMap } from "../generator/resources-builder.ts";
import type { CrudGroup } from "../generator/types.ts";
import type { EndpointInfo } from "../generator/types.ts";
import { generateFromSchema } from "../generator/data-factory.ts";
import {
  enumerateBoundaryCases,
  enumerateParamBoundaryCases,
  type ParamCoverageCase,
} from "../generator/coverage-phase.ts";
import { executeRequest } from "../runner/http-client.ts";
import { reserveRequest, MAX_REQUESTS_SKIP_REASON, type RequestBudget } from "../runner/executor.ts";
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
import type { MergedConfig } from "../severity/config.ts";
import { calibrate } from "../severity/calibrator.ts";
import { runPool } from "../runner/async-pool.ts";
import type { RateLimiter } from "../runner/rate-limiter.ts";
import { recommendForCheck } from "./recommended-action.ts";
import { gapKey } from "../workspace/fixture-gaps.ts";
import { endpointSkipsCheck, reasonForSkip } from "./zond-extensions.ts";
import {
  emptySummary,
  groupSkippedOutcomes,
  type CaseKind,
  type Check,
  type CheckCase,
  type CheckFinding,
  type CheckRunData,
  type CheckRunSummary,
  type SpecFinding,
} from "./types.ts";
import type { Severity } from "../severity/index.ts";
import { categoryFor } from "../severity/category.ts";
import {
  computeSpecFindings,
  applyBrokenBaselineGuard,
  type PerCheckObservations,
} from "./spec-findings.ts";

/**
 * ARV-265: per-HTTP-case audit envelope. One emitted per request the
 * checks runner actually dispatches (or attempted to dispatch — the
 * `error` field is set for transport-layer failures and skipped cases).
 *
 *   - `phase`: which sub-loop emitted the case. Lets the persistence
 *              adapter group them under `suite_name = "checks/<phase>"`.
 *   - `kind`:  per-response CaseKind ("positive" / "negative_data" / …)
 *              when phase === "response". For stateful checks it is the
 *              check id (e.g. "ignored_auth", "crud_lifecycle"), since
 *              one stateful check owns the whole sub-chain.
 *   - `verdict`: best-effort outcome — "pass"/"fail" mirror the per-check
 *                verdict (passes are bucketed when ALL checks on the case
 *                passed); "error" = network/transport failure; "skip" =
 *                pre-cap skips (max-requests budget exhausted).
 *   - `checkId`: the canonical check id for the case. For per-response
 *                cases without a single owning check, this is the
 *                first-fired check id; for stateful, it's the check itself.
 */
export interface ChecksCaseEvent {
  phase: "response" | "stateful_auth" | "stateful_crud";
  checkId: string;
  kind: string;
  operation: { method: string; path: string; operationId?: string };
  request: HttpRequest;
  response?: HttpResponse;
  durationMs: number;
  verdict: "pass" | "fail" | "error" | "skip";
  error?: string;
}

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
  /** ARV-265 — fires once per HTTP case actually dispatched (both
   *  per-response and stateful phases). Lets the CLI surface every touch
   *  into `runs`/`results` so `audit-coverage` can attribute it back.
   *  Network-failure cases also fire (with `error` set) so the audit metric
   *  counts attempts as well as successes. Must not throw. */
  onCase?: (event: ChecksCaseEvent) => void;
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
  /** ARV-179: opt-in strict-405 semantics for `unsupported_method`.
   *  Off by default — see `CheckRuntimeOptions.strict405` for rationale. */
  strict405?: boolean;
  /** ARV-181: opt-in strict-401 semantics for `ignored_auth`. Off by
   *  default — see `CheckRuntimeOptions.strict401` for rationale. */
  strict401?: boolean;
  /** ARV-169 (m-20): per-resource overrides for stateful checks
   *  (cross-call drift today; idempotency/pagination/lifecycle next).
   *  CLI loads them from `.api-resources.yaml` + `.api-resources.local.yaml`
   *  and hands them in; tests pass a literal Map. Optional — undefined
   *  ⇒ each probe uses its built-in defaults. */
  resourceConfigs?: Map<string, {
    readbackDiff?: import("../generator/resources-builder.ts").ReadbackDiffConfig;
    idempotency?: import("../generator/resources-builder.ts").IdempotencyConfig;
    pagination?: import("../generator/resources-builder.ts").PaginationConfig;
    lifecycle?: import("../generator/resources-builder.ts").LifecycleConfig;
  }>;
  /** ARV-141: substitute real fixture values into path-param placeholders so
   *  the deterministic synthetic 404 (`/issues/x`) becomes a real-id 200/422
   *  whenever `.env.yaml` actually has a fixture. This makes `checks run`
   *  reactive to fixture-pack growth — without it, two runs against the same
   *  spec emit pixel-identical findings/skip counts regardless of how many
   *  vars are filled. Keyed by path-param name (e.g. `issue_id`); falls back
   *  to the legacy schema-driven placeholder when the name isn't in the map. */
  pathVars?: Record<string, string>;
  /** ARV-324: operations `.fixture-gaps.yaml` already confirmed as a
   *  known-empty/inaccessible resource (keyed by `"METHOD /path"` via
   *  `gapKey()`). A finding on one of these operations gets
   *  `recommended_action: fix_fixture` instead of `report_backend_bug` —
   *  it's a known gap in our own test data, not new backend evidence. */
  fixtureGaps?: Set<string>;
  /** ARV-227: hard cap on outbound HTTP requests for the entire run.
   *  Once `used >= limit`, every subsequent case short-circuits and the
   *  summary surfaces the cap via `summary.skipped_outcomes
   *  ["max-requests-cap-reached"]`. Stateful-phase sends count toward
   *  the same budget so a cap of 100 means 100 requests total across
   *  per-response + stateful, not per-phase. Undefined ⇒ uncapped. */
  maxRequests?: number;
  /** ARV-292: skip the stateful (CRUD + auth) phase entirely. Driven by
   *  `--budget quick` from the CLI. Skipped stateful ids are surfaced
   *  in `summary.skipped_outcomes` so the user sees what was dropped. */
  skipStateful?: boolean;
  /** ARV-283: severity calibration overlay loaded from
   *  `.zond/severity.yaml` and/or `apis/<api>/.zond-severity.yaml`.
   *  Optional — undefined ⇒ findings emit at the built-in severity.
   *  When set, every emitted finding passes through `calibrate()` and
   *  may be re-severitized or suppressed. The CLI loads it via
   *  `loadSeverityConfig()` and forwards it; tests can pass a literal
   *  MergedConfig (build with `mergeConfigs([{config, source}])`). */
  severityConfig?: MergedConfig;
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

/** ARV-184: emit one BuiltCase per required header — drop that header
 *  in isolation so `missing_required_header` can identify *which* one
 *  the server fails to enforce. Pre-fix this emitted just the first
 *  required header (`required[0]`), which on Stripe-style specs with
 *  multiple per-op headers (Stripe-Version, Stripe-Account, ...) gave
 *  ≤1 finding per op vs schemathesis V4 ~42 in the same overlap. */
function buildMissingHeader(op: EndpointInfo, baseUrl: string, pathVars?: Record<string, string>): BuiltCase[] {
  const required = requiredHeaders(op);
  if (required.length === 0) return [];
  const url = `${baseUrl.replace(/\/+$/, "")}${fillPathParams(op.path, op, pathVars)}`;
  const body = buildBody(op);
  const method = op.method.toUpperCase();
  return required.map((header) => {
    const headers = buildBaseHeaders(op, { withRequired: true });
    delete headers[header.name];
    const req: HttpRequest = { method, url, headers, body };
    return {
      req,
      case: {
        operation: op,
        request: { method: req.method, url: req.url, headers: req.headers, body: req.body },
        mode: "negative" as const,
        kind: "missing_required_header" as const,
        meta: { dropped_header: header.name },
      },
    };
  });
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

/** ARV-180: build a URL whose path/query parameters reflect a coverage
 *  mutation. The positive baseline fills every param with a valid
 *  shape; this helper takes that baseline and swaps the named param
 *  with the mutation value (or drops it, for `drop-required-query`).
 *  Path mutations rewrite the placeholder for the named param only —
 *  all other path-vars keep their valid baseline values, so the URL
 *  still reaches the routing layer. */
function buildParamMutatedUrl(
  baseUrl: string,
  op: EndpointInfo,
  mut: ParamCoverageCase,
  pathVars: Record<string, string> | undefined,
): string {
  // Start with the valid baseline path (placeholders filled).
  let pathStr = op.path;
  if (mut.location === "path") {
    // Rewrite only the targeted placeholder; everything else gets the
    // valid baseline (path-vars > schema-derived placeholder).
    pathStr = op.path.replace(/\{([^}]+)\}/g, (_, name) => {
      if (name === mut.paramName) return encodeURIComponent(String(mut.value));
      const real = pathVars?.[name];
      if (typeof real === "string" && real.length > 0) return encodeURIComponent(real);
      const match = op.parameters.find(
        (p) => (p as OpenAPIV3.ParameterObject).in === "path"
          && (p as OpenAPIV3.ParameterObject).name === name,
      );
      return match
        ? encodeURIComponent(placeholderForParam(match as OpenAPIV3.ParameterObject))
        : "1";
    });
  } else {
    pathStr = fillPathParams(op.path, op, pathVars);
  }
  let url = `${baseUrl.replace(/\/+$/, "")}${pathStr}`;
  if (mut.location === "query") {
    const qp = new URLSearchParams();
    // Seed required query params with valid baseline values so the
    // mutation is single-site.
    for (const p of op.parameters) {
      const pp = p as OpenAPIV3.ParameterObject;
      if (pp.in !== "query") continue;
      if (pp.name === mut.paramName) {
        if (mut.scenario === "drop-required-query") continue; // drop
        qp.append(pp.name, String(mut.value));
        continue;
      }
      if (pp.required === true) {
        qp.append(pp.name, placeholderForParam(pp));
      }
    }
    const qs = qp.toString();
    if (qs.length > 0) url += `?${qs}`;
  }
  return url;
}

/** ARV-180: emit one BuiltCase per (param × scenario) for the
 *  operation. All cases ride as `kind: "negative_data"` so
 *  `negative_data_rejection` evaluates "did the server reject?", and
 *  `status_code_conformance` (now declares `negative_data` in its
 *  caseKinds) evaluates "is the resulting status code documented?".
 *  This is the cheap-fix gap for `status_code_conformance` on
 *  GET-heavy APIs where the body-coverage walker emits zero cases. */
function buildParamCoverageCases(
  op: EndpointInfo,
  baseUrl: string,
  opts: { allowX00?: boolean; pathVars?: Record<string, string> },
): BuiltCase[] {
  const params = op.parameters as OpenAPIV3.ParameterObject[];
  const mutations = enumerateParamBoundaryCases(params, { allowX00: opts.allowX00 });
  if (mutations.length === 0) return [];
  const m = op.method.toUpperCase();
  const headers = buildBaseHeaders(op, { withRequired: true });
  const body = buildBody(op);
  const out: BuiltCase[] = [];
  for (const mut of mutations) {
    const url = buildParamMutatedUrl(baseUrl, op, mut, opts.pathVars);
    const req: HttpRequest = { method: m, url, headers, body };
    out.push({
      req,
      case: {
        operation: op,
        request: { method: req.method, url: req.url, headers: req.headers, body: req.body },
        mode: "negative",
        kind: "negative_data",
        meta: {
          phase: "coverage",
          param_scenario: mut.scenario,
          param_name: mut.paramName,
          param_location: mut.location,
          mutation: "param-boundary",
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

/** For `unsupported_method` we send every method that isn't declared on
 *  the *path bucket*. ARV-179: pre-fix this emitted just `missing[0]`,
 *  which produced ≈1 finding per path on real APIs (vs schemathesis's
 *  per-method enumeration that finds 100+ on the same target). The
 *  check itself coalesces results per-(path, undeclared-method) pair,
 *  so a path with 4 missing methods yields up to 4 findings. The
 *  per-path "one owner" rule still applies — only the owner-op emits
 *  the bucket — so we don't double-count on multi-method paths. */
function buildUnsupportedMethod(
  op: EndpointInfo,
  declaredOnPath: Set<string>,
  baseUrl: string,
): BuiltCase[] {
  const declaredUpper = new Set(Array.from(declaredOnPath, (m) => m.toUpperCase()));
  const missing = ALL_METHODS.filter((m) => !declaredUpper.has(m));
  if (missing.length === 0) return [];
  const concretePath = pathWithMethodPlaceholders(op.path, op.parameters);
  const url = `${baseUrl.replace(/\/+$/, "")}${concretePath}`;
  return missing.map((method) => {
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
  });
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

/** ARV-319: `CrudGroup.create`/`.list`/`.read`/`.update`/`.delete` are ALL
 *  optional — a group can be update/delete-only (no create, no read), which
 *  is common on wide specs like Stripe. Pick whichever canonical operation
 *  exists, in create > list > read > update > delete order, for use as a
 *  representative op (finding attribution, x-zond-skip lookup, ndjson
 *  event). Returns undefined only if the group somehow has none of the
 *  five — callers must not assume non-null. */
function representativeOp(g: CrudGroup): EndpointInfo | undefined {
  return g.create ?? g.list ?? g.read ?? g.update ?? g.delete;
}

/** Build a finding, push it into the per-op buffer, and stream the
 *  ARV-10 NDJSON event. Summary aggregation moved out — the caller
 *  merges per-op buffers in input order so workers > 1 doesn't have to
 *  contend on a shared `summary` object.
 *
 *  ARV-283: severity passes through `applyCalibration` before emit so
 *  a `.zond/severity.yaml` rule can re-severitize or suppress. The
 *  emitted finding always reaches the buffer + ndjson stream so
 *  audit-trail survives; suppressed findings get `severity:
 *  "info-suppressed"` + `suppressed_by` instead of being dropped. */
function recordFinding(
  out: CheckFinding[],
  check: Check,
  c: CheckCase,
  resp: HttpResponse,
  message: string,
  evidence: Record<string, unknown> | undefined,
  onEvent: ((event: NdjsonEvent) => void) | undefined,
  severityConfig: MergedConfig | undefined,
  /** ARV-284: per-finding severity from CheckOutcome — overrides
   *  the check's natural tier when the check wants to dispatch by
   *  evidence (e.g. negative_data_rejection LOW for additionalProperties,
   *  HIGH for 5xx response). */
  outcomeSeverity?: Severity,
  /** ARV-324: known-gap index, see `RunChecksOptions.fixtureGaps`. */
  fixtureGaps?: Set<string>,
): void {
  const unresolvedFixture = fixtureGaps?.has(gapKey(c.operation.method, c.operation.path)) ?? false;
  const action = recommendForCheck(check.id, resp.status, unresolvedFixture);
  const finding: CheckFinding = {
    check: check.id,
    severity: outcomeSeverity ?? check.severity,
    operation: { path: c.operation.path, method: c.operation.method, operationId: c.operation.operationId },
    request_signature: `${c.request.method} ${c.request.url}`,
    response_summary: summarizeResponse(resp),
    message,
    evidence,
    recommended_action: action,
  };
  applyCalibration(finding, resp, severityConfig);
  out.push(finding);
  if (onEvent) onEvent({ type: "finding", ts: nowIso(), check: check.id, finding });
}

/** ARV-283: mutate a finding in-place with the calibrated severity +
 *  suppression trace. Idempotent; pass-through when `config` is
 *  undefined or EMPTY_MERGED_CONFIG. Caller counts suppressed entries
 *  via the `info-suppressed` severity, not the trace presence. */
function applyCalibration(
  finding: CheckFinding,
  resp: HttpResponse | { status: number; headers?: Record<string, string>; content_type?: string },
  config: MergedConfig | undefined,
): void {
  if (!config || (config.suppressions.length === 0 && Object.keys(config.checks).length === 0)) return;
  const headers = "headers" in resp && resp.headers ? resp.headers : {};
  const result = calibrate(
    {
      check: finding.check,
      defaultSeverity: finding.severity,
      recommendedAction: finding.recommended_action,
      context: {
        finding: {
          check: finding.check,
          recommended_action: finding.recommended_action,
          message: finding.message,
          evidence: finding.evidence,
        },
        operation: {
          method: finding.operation.method.toUpperCase(),
          path: finding.operation.path,
          operationId: finding.operation.operationId,
        },
        response: {
          status: finding.response_summary.status,
          headers,
          content_type: finding.response_summary.content_type,
        },
      },
    },
    config,
  );
  finding.severity = result.severity;
  if (result.suppressed && result.trace.kind === "suppressed") {
    finding.suppressed_by = {
      source: result.trace.source ?? "",
      rule_index: result.trace.ruleIndex ?? 0,
      reason: result.trace.reason ?? "",
    };
  }
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

  const checkRuntimeOptions = {
    strict405: opts.strict405 === true,
    strict401: opts.strict401 === true,
  };

  // ARV-227: shared budget across per-response + stateful phases.
  // Mutated in-place by `reserveRequest`; safe under our worker model
  // because JS is single-threaded between awaits.
  const requestBudget: RequestBudget | undefined =
    opts.maxRequests !== undefined && opts.maxRequests > 0
      ? { limit: opts.maxRequests, used: 0 }
      : undefined;

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
    /** ARV-60: check ids that returned `applies(op) === true` for this
     *  operation. Counted at merge-time to derive each check's
     *  applicable-operation population for spec_findings rollup. One
     *  entry per check per op (deduplicated within the op). */
    applicableChecks: string[];
    /** ARV-60: per-check case count for this op (passed + failed +
     *  skipped). Summed at merge-time. */
    casesByCheck: Record<string, number>;
    /** ARV-307: positive (expected-success) probe responses observed on
     *  this op — feeds the run-level broken-baseline guard. */
    positiveTotal: number;
    positiveTwoxx: number;
  }

  async function processOperation(op: EndpointInfo): Promise<OpReport> {
    const localFindings: CheckFinding[] = [];
    let localCases = 0;
    let localPositiveTotal = 0;
    let localPositiveTwoxx = 0;
    const localSkipped: Record<string, number> = {};
    // ARV-60: per-check observations for this op — `applies()` membership
    // and case-count. Deduplicated within the op (one applies-vote per
    // check regardless of how many case kinds we generate against it).
    const localApplicable = new Set<string>();
    const localCasesByCheck: Record<string, number> = {};
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
      cases.push(...buildMissingHeader(op, opts.baseUrl, opts.pathVars));
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
      // ARV-180: param-axis coverage. Emits negative_data cases for
      // path/query parameter mutations (drop-required-query, wrong-type,
      // invalid-format, invalid-enum, boundary violations). On GET-heavy
      // APIs the body-axis walker above emits zero cases, so this is the
      // only coverage signal for `status_code_conformance` and
      // `negative_data_rejection` on those operations.
      if (neededKinds.has("negative_data")) {
        for (const b of buildParamCoverageCases(op, opts.baseUrl, { allowX00: opts.allowX00, pathVars: opts.pathVars })) {
          cases.push(b);
        }
      }
    }
    if (unsupportedMethodOwner.get(op.path) === op) {
      const declared = buckets.get(op.path)?.declared ?? new Set([op.method.toUpperCase()]);
      cases.push(...buildUnsupportedMethod(op, declared, opts.baseUrl));
    }

    for (const built of cases) {
      if (!caseMatchesMode(built.case.mode, mode)) continue;
      if (opts.authHeaders) injectAuthHeadersIntoCase(built, opts.authHeaders);
      // ARV-227: stop dispatching new HTTP requests once the cap is
      // reached. Bucket the skip so the summary surfaces it, then keep
      // looping so we still tally the would-have-run count for the user.
      if (!reserveRequest(requestBudget)) {
        localSkipped[`max_requests: ${MAX_REQUESTS_SKIP_REASON}`] =
          (localSkipped[`max_requests: ${MAX_REQUESTS_SKIP_REASON}`] ?? 0) + 1;
        if (opts.onCase) {
          opts.onCase({
            phase: "response",
            checkId: built.case.kind,
            kind: built.case.kind,
            operation: { path: op.path, method: op.method, operationId: op.operationId },
            request: built.req,
            durationMs: 0,
            verdict: "skip",
            error: MAX_REQUESTS_SKIP_REASON,
          });
        }
        continue;
      }
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
        applyCalibration(finding, { status: 0, headers: {} }, opts.severityConfig);
        localFindings.push(finding);
        if (opts.onEvent) opts.onEvent({ type: "finding", ts: nowIso(), check: "network_error", finding });
        if (opts.onCase) {
          opts.onCase({
            phase: "response",
            checkId: "network_error",
            kind: built.case.kind,
            operation: { path: op.path, method: op.method, operationId: op.operationId },
            request: built.req,
            durationMs: 0,
            verdict: "error",
            error: (err as Error).message,
          });
        }
        continue;
      }

      localCases += 1;
      // ARV-307: tally the positive-probe baseline. Only the positive case
      // kind is "expected to succeed" — negative/boundary cases legitimately
      // 4xx, so they must not count toward the broken-baseline ratio.
      if (built.case.kind === "positive") {
        localPositiveTotal += 1;
        if (httpResp.status >= 200 && httpResp.status < 300) localPositiveTwoxx += 1;
      }
      const checkResp = {
        status: httpResp.status,
        headers: httpResp.headers,
        body: httpResp.body_parsed ?? httpResp.body,
        duration_ms: httpResp.duration_ms,
      };
      // ARV-265: accumulate per-case verdict. The case is "fail" if any
      // applicable check on it failed, "pass" if at least one ran and all
      // passed, "skip" if every check was skipped. Owning check id is the
      // first one that returned a verdict — used as a hint for triage.
      let caseVerdict: "pass" | "fail" | "skip" = "skip";
      let caseCheckId: string = built.case.kind;
      for (const check of selection.selected) {
        if (!checkKinds(check).includes(built.case.kind)) continue;
        if (!check.applies(op)) continue;
        // ARV-189: per-operation `x-zond-skip` / `x-zond-public` opt-out.
        // Fires AFTER applies() so the applicability count still reflects
        // the universe of checks that *would* have run; the spec-level
        // skip is surfaced through the skipped-outcomes summary instead.
        if (endpointSkipsCheck(op, check.id)) {
          const key = `${check.id}: ${reasonForSkip(op, check.id)}`;
          localSkipped[key] = (localSkipped[key] ?? 0) + 1;
          continue;
        }
        // ARV-60: applies()=true → bump applicability + cases-by-check.
        localApplicable.add(check.id);
        localCasesByCheck[check.id] = (localCasesByCheck[check.id] ?? 0) + 1;
        const outcome = check.run({
          case: built.case,
          response: checkResp,
          schemaValidator,
          doc,
          options: checkRuntimeOptions,
        });
        if (outcome.kind === "fail") {
          recordFinding(localFindings, check, built.case, httpResp, outcome.message, outcome.evidence, opts.onEvent, opts.severityConfig, outcome.severity, opts.fixtureGaps);
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
            severity: check.severity,
            verdict: outcome.kind,
            operation: { path: op.path, method: op.method, operationId: op.operationId },
            request_signature: `${built.case.request.method} ${built.case.request.url}`,
            response: summarizeResponse(httpResp),
          });
        }
        // ARV-265: a case fails as soon as one check on it fails.
        if (outcome.kind === "fail") {
          caseVerdict = "fail";
          if (caseCheckId === built.case.kind) caseCheckId = check.id;
        } else if (outcome.kind === "pass" && caseVerdict !== "fail") {
          caseVerdict = "pass";
          if (caseCheckId === built.case.kind) caseCheckId = check.id;
        }
      }
      // ARV-265: one audit row per case, regardless of how many checks ran.
      if (opts.onCase) {
        opts.onCase({
          phase: "response",
          checkId: caseCheckId,
          kind: built.case.kind,
          operation: { path: op.path, method: op.method, operationId: op.operationId },
          request: built.req,
          response: httpResp,
          durationMs: httpResp.duration_ms,
          verdict: caseVerdict,
        });
      }
    }
    return {
      findings: localFindings,
      cases: localCases,
      skipped: localSkipped,
      applicableChecks: [...localApplicable],
      casesByCheck: localCasesByCheck,
      positiveTotal: localPositiveTotal,
      positiveTwoxx: localPositiveTwoxx,
    };
  }

  // ARV-8: parallelize the op-loop. workers=1 (default) preserves the
  // sequential code path inside runPool — same microtask interleaving as
  // before, AC #4 backward-compat.
  const workers = opts.workers ?? 1;
  const opReports = await runPool(ops, workers, processOperation);

  let findings: CheckFinding[] = [];
  /** ARV-60: per-check accumulator for spec_findings rollup. Built from
   *  the per-op `applicableChecks` and `casesByCheck` fields each worker
   *  returns; skipped is reconstructed from `summary.skipped_outcomes`
   *  after the loop. */
  const perCheckApplicable: Map<string, number> = new Map();
  const perCheckCases: Map<string, number> = new Map();
  // ARV-307: run-level positive-probe baseline health.
  let positiveTotal = 0;
  let positiveTwoxx = 0;
  for (const report of opReports) {
    summary.cases += report.cases;
    positiveTotal += report.positiveTotal;
    positiveTwoxx += report.positiveTwoxx;
    for (const [key, n] of Object.entries(report.skipped)) {
      summary.skipped_outcomes[key] = (summary.skipped_outcomes[key] ?? 0) + n;
    }
    for (const id of report.applicableChecks) {
      perCheckApplicable.set(id, (perCheckApplicable.get(id) ?? 0) + 1);
    }
    for (const [id, n] of Object.entries(report.casesByCheck)) {
      perCheckCases.set(id, (perCheckCases.get(id) ?? 0) + n);
    }
    for (const f of report.findings) {
      // ARV-251: stamp finding category from check id if not already
      // present. Probes carry their own category; checks derive it
      // from the check id. The bucket increment is the same code path.
      if (!f.category) f.category = categoryFor(f.check);
      findings.push(f);
      // ARV-283: suppressed findings stay in the buffer (for ndjson
      // audit-trail) but skip the summary tallies that drive CI gates.
      if (f.suppressed_by) {
        summary.suppressed = (summary.suppressed ?? 0) + 1;
        continue;
      }
      summary.findings += 1;
      summary.by_severity[f.severity] += 1;
      summary.by_category[f.category] += 1;
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

  if (opts.skipStateful && activeStateful.length > 0) {
    const key = `stateful-skipped:budget`;
    summary.skipped_outcomes[key] = (summary.skipped_outcomes[key] ?? 0) + activeStateful.length;
  }

  if (!opts.skipStateful && activeStateful.length > 0) {
    const baseHarness = makeHarness(opts.baseUrl, doc, {
      authHeaders: opts.authHeaders,
      bootstrapCleanupFailed: opts.bootstrapCleanupFailed,
      timeoutMs: opts.timeoutMs,
      // ARV-181: stateful checks (ignored_auth) need the same
      // fixture-driven path-var substitution that ARV-141 wired into
      // the per-response runner — without this the synthetic baseline
      // lands on literal `/{event_id}` and the broken-baseline guard
      // skips the whole op.
      pathVars: opts.pathVars,
      options: checkRuntimeOptions,
      resourceConfigs: opts.resourceConfigs,
      // ARV-227: same budget instance as the per-response phase so a
      // cap of N applies to the whole run, not per-phase.
      requestBudget,
    });
    // ARV-265: per-check harness wrapper that fires onCase for every
    // HTTP call the stateful check performs. The phase tag distinguishes
    // auth vs crud — used by the persistence adapter to bucket suite names.
    function harnessFor(checkId: string, phase: "stateful_auth" | "stateful_crud"): typeof baseHarness {
      if (!opts.onCase) return baseHarness;
      return {
        ...baseHarness,
        send: async (req, sendOpts) => {
          try {
            const resp = await baseHarness.send(req, sendOpts);
            opts.onCase!({
              phase,
              checkId,
              kind: checkId,
              operation: { method: req.method, path: req.url },
              request: req,
              response: resp,
              durationMs: resp.duration_ms,
              verdict: "pass",
            });
            return resp;
          } catch (err) {
            opts.onCase!({
              phase,
              checkId,
              kind: checkId,
              operation: { method: req.method, path: req.url },
              request: req,
              durationMs: 0,
              verdict: "error",
              error: (err as Error).message,
            });
            throw err;
          }
        },
      };
    }
    // ARV-332: build CRUD groups from the *filtered* op set (`ops`), not
    // `allOps`. Under a read-only scope (`--include method:GET`) the filter
    // strips POST/PUT/PATCH, so no group carries a `create`/`update` and the
    // mutating stateful checks (ensure_resource_availability, use_after_free)
    // self-skip via `applies(g)` — instead of leaking a live POST create
    // despite the GET-only filter. Read-only stateful checks (pagination
    // invariants, observation-mode lifecycle) still run on the list/read ops.
    const crudGroups = activeStateful.some((c) => c.phase === "crud")
      ? augmentWithListOnlyGroups(detectCrudGroups(ops), ops)
      : [];
    summary.checks_run += activeStateful.length;

    // ARV-8: parallelize auth-phase ops and crud-phase groups via the
     // same pool. CRUD-chain integrity stays intact because the *check*
     // owns its own sequential within-chain logic — the pool only runs
     // *independent* groups in parallel.
    const statefulWorkers = opts.workers ?? 1;
    const collected: CheckFinding[] = [];
    function pushStateful(f: CheckFinding): void {
      if (!f.category) f.category = categoryFor(f.check);
      // ARV-283: stateful findings carry no upstream HTTP response shape
      // — pass a synthetic context with just the status from
      // response_summary so suppressions that key off status/method/path
      // still match. Header-keyed suppressions don't fire on stateful
      // (no headers preserved); that's an acceptable Phase A limitation.
      applyCalibration(
        f,
        {
          status: f.response_summary.status,
          headers: {},
          content_type: f.response_summary.content_type,
        },
        opts.severityConfig,
      );
      collected.push(f);
      if (f.suppressed_by) {
        summary.suppressed = (summary.suppressed ?? 0) + 1;
      } else {
        summary.findings += 1;
        summary.by_severity[f.severity] += 1;
        summary.by_category[f.category] += 1;
      }
      if (opts.onEvent) opts.onEvent({ type: "finding", ts: nowIso(), check: f.check, finding: f });
    }
    for (const check of activeStateful) {
      if (check.phase === "auth") {
        const allApplicable = ops.filter((op) => check.applies(op));
        // ARV-189: spec-level x-zond-skip removes endpoints from the
        // worker pool entirely. The skip is surfaced via skipped_outcomes
        // so the operator sees how many ops were spec-suppressed.
        const applicable: typeof allApplicable = [];
        for (const op of allApplicable) {
          if (endpointSkipsCheck(op, check.id)) {
            const key = `${check.id}: ${reasonForSkip(op, check.id)}`;
            summary.skipped_outcomes[key] = (summary.skipped_outcomes[key] ?? 0) + 1;
            summary.cases += 1;
            continue;
          }
          applicable.push(op);
        }
        // ARV-60: track applicability + cases for spec_findings rollup.
        perCheckApplicable.set(check.id, (perCheckApplicable.get(check.id) ?? 0) + applicable.length);
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
        const authHarness = harnessFor(check.id, "stateful_auth");
        const opReports = await runPool<typeof applicable[number], StatefulOutcome>(
          applicable,
          statefulWorkers,
          async (op): Promise<StatefulOutcome> => {
          let outcome;
          try {
            outcome = await check.run(op, authHarness);
          } catch (err) {
            outcome = { kind: "skip" as const, reason: `error: ${(err as Error).message}` };
          }
          // ARV-314: emit check_result for stateful checks too, so the ndjson
          // event schema is stable regardless of --check selection (the
          // per-response phase already does this). Without it a consumer keyed
          // on .type=="check_result" got zero rows from a stateful-only run.
          if (opts.onEvent && (outcome.kind === "pass" || outcome.kind === "fail")) {
            opts.onEvent({
              type: "check_result",
              ts: nowIso(),
              check: check.id,
              severity: check.severity,
              verdict: outcome.kind,
              operation: { path: op.path, method: op.method, operationId: op.operationId },
              request_signature: `${op.method.toUpperCase()} ${op.path}`,
              response: { status: (outcome.kind === "fail" ? outcome.responseStatus : undefined) ?? 0 },
            });
          }
          if (outcome.kind === "fail") {
            // ARV-286 (follow-up ARV-284): respect per-finding severity
            // returned by stateful check via `outcome.severity` — declared
            // `check.severity` is the proof-cap baseline.
            const finding: CheckFinding = {
              check: check.id,
              severity: outcome.severity ?? check.severity,
              operation: { path: op.path, method: op.method, operationId: op.operationId },
              request_signature: `${op.method.toUpperCase()} ${op.path}`,
              response_summary: { status: outcome.responseStatus ?? 0 },
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
          perCheckCases.set(check.id, (perCheckCases.get(check.id) ?? 0) + 1);
          if (o.kind === "fail") pushStateful(o.finding);
          else if (o.kind === "skip") {
            const key = `${check.id}: ${o.reason}`;
            summary.skipped_outcomes[key] = (summary.skipped_outcomes[key] ?? 0) + 1;
          }
        }
      } else {
        const allApplicable = crudGroups.filter((g) => check.applies(g));
        // ARV-189: spec-level x-zond-skip on the resource's canonical
        // endpoint (create > list > read) opts the entire CRUD group
        // out — `x-zond-skip: [...]` placed on POST /widgets suppresses
        // every stateful check listed there for the whole widget chain.
        const applicable: typeof allApplicable = [];
        for (const g of allApplicable) {
          const repOp = representativeOp(g);
          if (repOp && endpointSkipsCheck(repOp, check.id)) {
            const key = `${check.id}: ${reasonForSkip(repOp, check.id)}`;
            summary.skipped_outcomes[key] = (summary.skipped_outcomes[key] ?? 0) + 1;
            summary.cases += 1;
            continue;
          }
          applicable.push(g);
        }
        // ARV-60: track applicability + cases for spec_findings rollup.
        perCheckApplicable.set(check.id, (perCheckApplicable.get(check.id) ?? 0) + applicable.length);
        // ARV-154: mirror the auth-phase observability — count CRUD groups
        // attempted and record skip reasons, not just failures.
        type StatefulOutcome =
          | { kind: "fail"; finding: CheckFinding }
          | { kind: "skip"; reason: string }
          | { kind: "pass" };
        const crudHarness = harnessFor(check.id, "stateful_crud");
        const groupReports = await runPool<typeof applicable[number], StatefulOutcome>(
          applicable,
          statefulWorkers,
          async (group): Promise<StatefulOutcome> => {
          let outcome;
          try {
            outcome = await check.run(group, crudHarness);
          } catch (err) {
            outcome = { kind: "skip" as const, reason: `error: ${(err as Error).message}` };
          }
          // ARV-314: emit check_result for CRUD-stateful checks too (see the
          // auth loop above) so the ndjson event schema stays stable.
          // ARV-319: `group.create`/`.read` are BOTH optional (a group can be
          // update/delete/list-only) — the earlier `group.create ?? group.read!`
          // non-null assertion crashed with "undefined is not an object" the
          // first time a check passed/failed on such a group (Stripe has
          // plenty: update-only or list-only resources). representativeOp()
          // widens the fallback chain and stays undefined-safe.
          const groupRepOp = representativeOp(group);
          const outcomeOp = outcome.kind === "fail" ? outcome.operation : undefined;
          const evOp = outcomeOp ?? groupRepOp;
          if (opts.onEvent && (outcome.kind === "pass" || outcome.kind === "fail") && evOp) {
            opts.onEvent({
              type: "check_result",
              ts: nowIso(),
              check: check.id,
              severity: check.severity,
              verdict: outcome.kind,
              operation: evOp,
              request_signature: `${evOp.method.toUpperCase()} ${evOp.path} (chain)`,
              response: { status: (outcome.kind === "fail" ? outcome.responseStatus : undefined) ?? 0 },
            });
          }
          if (outcome.kind === "fail") {
            // ARV-310: prefer the check's explicit operation attribution (e.g.
            // cursor_boundary_fuzzing → the GET list it probed) over the
            // group's canonical create/read op. ARV-319: groupRepOp can be
            // undefined for a group with no create/list/read/update/delete
            // (shouldn't happen if `check.applies()` gated correctly, but
            // this path must not crash if it does) — fall back to a
            // synthetic operation rather than dereferencing undefined.
            const opFor = outcome.operation ?? (groupRepOp
              ? { path: groupRepOp.path, method: groupRepOp.method, operationId: groupRepOp.operationId }
              : { path: group.basePath, method: "UNKNOWN" });
            // ARV-287/288 (follow-up ARV-284): respect per-finding severity
            // from stateful CRUD checks (cross_call_references,
            // pagination_invariants) — declared severity is the proof-cap
            // baseline.
            const finding: CheckFinding = {
              check: check.id,
              severity: outcome.severity ?? check.severity,
              operation: opFor,
              request_signature: `${opFor.method.toUpperCase()} ${opFor.path} (chain)`,
              response_summary: { status: outcome.responseStatus ?? 0 },
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
          perCheckCases.set(check.id, (perCheckCases.get(check.id) ?? 0) + 1);
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

  // ARV-307: run-level broken-baseline guard for the conformance family.
  // When the positive-probe baseline was degenerate (>90% non-2xx), the
  // conformance findings are baseline artifacts — replace the per-op pile
  // with a single broken_baseline spec_finding and decrement the summary
  // tallies for the removed findings so CI gates and category rollups match.
  const baselineGuard = applyBrokenBaselineGuard({ findings, positiveTotal, positiveTwoxx });
  const extraSpecFindings: SpecFinding[] = [];
  if (baselineGuard.specFinding) {
    findings = baselineGuard.kept;
    for (const f of baselineGuard.removed) {
      summary.findings -= 1;
      summary.by_severity[f.severity] -= 1;
      if (f.category) summary.by_category[f.category] -= 1;
    }
    const reasonKey = `status_code_conformance: broken-baseline (${baselineGuard.removed.length} conformance finding(s) suppressed)`;
    summary.skipped_outcomes[reasonKey] = (summary.skipped_outcomes[reasonKey] ?? 0) + baselineGuard.removed.length;
    extraSpecFindings.push(baselineGuard.specFinding);
  }

  const highOrCritical = findings.filter(
    (f) => f.severity === "high" || f.severity === "critical",
  ).length;

  // ARV-60: spec-level rollup. Build per-check observations from the
  // accumulators above + the skipped-outcome buckets keyed by
  // `<check_id>: <reason>`. Then compute clusters that cross the 80%
  // threshold so the CLI / JSON envelope / NDJSON stream all agree on
  // which findings are really "one spec gap × N sites".
  const perCheck: Map<string, PerCheckObservations> = new Map();
  const allCheckIds = new Set<string>([
    ...perCheckApplicable.keys(),
    ...perCheckCases.keys(),
  ]);
  for (const id of allCheckIds) {
    const skipped: Record<string, number> = {};
    const prefix = `${id}: `;
    for (const [key, n] of Object.entries(summary.skipped_outcomes)) {
      if (key.startsWith(prefix)) skipped[key] = n;
    }
    perCheck.set(id, {
      applicable: perCheckApplicable.get(id) ?? 0,
      cases: perCheckCases.get(id) ?? 0,
      skipped,
    });
  }
  // ARV-307: broken-baseline rollup(s) prepend the computed clusters so the
  // reader sees "your baseline is broken" before any residual per-op rows.
  const spec_findings = [...extraSpecFindings, ...computeSpecFindings(findings, perCheck)];
  // ARV-83: build the structured view of `skipped_outcomes` once, after
  // all per-op/per-group writers have settled. Sorted by descending count
  // so the most-impactful skip reason lands first.
  summary.skipped_outcomes_grouped = groupSkippedOutcomes(summary.skipped_outcomes);

  // ARV-60: emit each spec finding as its own NDJSON event before the
  // terminal summary line, so a streaming consumer sees rollups in the
  // same order the CLI prints them.
  if (opts.onEvent) {
    for (const sf of spec_findings) {
      opts.onEvent({ type: "spec_finding", ts: nowIso(), check: sf.check, spec_finding: sf });
    }
  }

  // ARV-10: terminal event so downstream consumers know the run wrapped
  // (vs. the producer crashing). Mirrors what the JSON envelope's
  // `summary` field carries, just delivered as the final NDJSON line.
  if (opts.onEvent) opts.onEvent({ type: "summary", ts: nowIso(), summary });

  return {
    data: { findings, summary, spec_findings },
    selection,
    high_or_critical: highOrCritical,
  };
}

/**
 * ARV-219 follow-up: `detectCrudGroups` only emits groups for resources
 * with a POST endpoint, so list-only collections (workflow runs, search
 * results, public lists) never reach the stateful CRUD phase. Several
 * stateful checks operate on lists alone:
 *   - `pagination_invariants` (page/cursor disjointness)
 *   - `lifecycle_transitions` observation mode (observed ⊆ declared states)
 *
 * Synthesize minimal groups for list-only resources surfaced by the
 * resource-map builder (which already knows how to identify
 * implicit-list paths via `ownerListPaths`). The synthesized group
 * carries just `list` + optional `read` — sufficient for the lookups
 * each list-only check performs. Resources already covered by a real
 * CRUD group (matched by name) are not duplicated.
 */
function augmentWithListOnlyGroups(crudGroups: CrudGroup[], allOps: EndpointInfo[]): CrudGroup[] {
  let map;
  try {
    map = buildApiResourceMap({ endpoints: allOps, specHash: "transient" });
  } catch {
    // Defensive: never fail the run because the resource map couldn't
    // be built (real CRUD groups still run).
    return crudGroups;
  }
  const existing = new Set(crudGroups.map(g => g.resource));
  const findEp = (label: string | undefined): EndpointInfo | undefined => {
    if (!label) return undefined;
    const idx = label.indexOf(" ");
    if (idx === -1) return undefined;
    const method = label.slice(0, idx).toUpperCase();
    const path = label.slice(idx + 1);
    return allOps.find(e => e.method.toUpperCase() === method && e.path === path);
  };
  const augmented: CrudGroup[] = [];
  for (const r of map.resources) {
    if (existing.has(r.resource)) continue;
    if (!r.endpoints.list) continue;
    const listEp = findEp(r.endpoints.list);
    if (!listEp) continue;
    const readEp = findEp(r.endpoints.read);
    augmented.push({
      resource: r.resource,
      basePath: r.basePath,
      itemPath: r.itemPath,
      idParam: r.idParam,
      list: listEp,
      ...(readEp ? { read: readEp } : {}),
    });
  }
  return augmented.length > 0 ? [...crudGroups, ...augmented] : crudGroups;
}
