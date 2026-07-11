/**
 * Type contracts for the `zond checks` framework (m-15 ARV-1).
 *
 * A `Check` is a single named conformance/security probe applied to one
 * operation × one HTTP response. The `runner` resolves the spec into
 * operations, generates a request via `core/generator/data-factory`,
 * sends it via `core/runner/send-request`, and feeds each (case,
 * response) pair to every active check.
 *
 * Names mirror schemathesis V4 1-to-1 so benchmarks and findings carry
 * across (see `backlog/milestones/m-15`). New checks register themselves
 * in `checks/index.ts` via `registerCheck`.
 */
import type { OpenAPIV3 } from "openapi-types";
import type { EndpointInfo } from "../generator/types.ts";
import type { SchemaValidator } from "../runner/schema-validator.ts";
import type { RecommendedAction } from "../diagnostics/failure-hints.ts";

// Severity unified in src/core/severity (ARV-250). Re-exported here for
// backwards-compatible imports across the checks subsystem; the canonical
// definition is in core/severity. Adds 'info' tier (previously absent in
// checks, now needed for hygiene-class findings per m-21 pivot).
import type { Severity } from "../severity/index.ts";
import { emptySeverityBuckets } from "../severity/index.ts";
import type { Category } from "../severity/category.ts";
import { emptyCategoryBuckets } from "../severity/category.ts";
export type { Severity, Category };

export type Phase = "examples" | "coverage" | "fuzz" | "all";

/** Probe shapes a check may need. ARV-1 shipped only `positive`; ARV-2
 *  adds two more for header/method-rejection checks; ARV-4 will add
 *  `negative_data` for the data-rejection pair. The runner generates a
 *  case for each kind that at least one active check declares. */
export type CaseKind =
  | "positive"
  | "missing_required_header"
  | "unsupported_method"
  | "negative_data";

export interface CheckReference {
  /** CWE / OWASP / RFC identifier — free form, agent-readable. */
  id: string;
  /** Optional URL for the human reader. */
  url?: string;
}

export interface CheckResponse {
  status: number;
  headers: Record<string, string>;
  body: unknown;
  duration_ms: number;
}

export interface CheckCase {
  /** The operation under test (path + method + parameters). */
  operation: EndpointInfo;
  /** Resolved request that produced the response below. */
  request: {
    method: string;
    url: string;
    headers: Record<string, string>;
    body?: string;
  };
  /** Mode the case was generated under — positive (valid) or negative
   *  (intentionally invalid). Drives the ARV-7 `--mode` filter. */
  mode: "positive" | "negative";
  /** Probe shape — what the case is *built* to exercise. A check only
   *  runs against a case whose `kind` it declared (or all if it
   *  declared none — defaults to `positive`). */
  kind: CaseKind;
  /** For probe-style cases, an opaque hint the check itself produced
   *  (e.g. the header name that was dropped, the method that was
   *  swapped in). Lets a check emit a precise finding without parsing
   *  the request back out. */
  meta?: Record<string, unknown>;
}

/** ARV-179: per-run knobs surfaced from `RunCheckOptions` into the
 *  check itself. Add new fields here when a check needs an opt-in
 *  behaviour that doesn't deserve its own check id. Keep this lean —
 *  most knobs belong upstream in the case-generator, not in the
 *  check's response-side logic. */
export interface CheckRuntimeOptions {
  /** ARV-179: require strict 405 for `unsupported_method` (matches
   *  schemathesis V4 default). Off by default — zond's pragmatic policy
   *  accepts 401/403/404 as legitimate rejections of an undeclared
   *  method (common nginx/gateway behaviour). */
  strict405?: boolean;
  /** ARV-181: require strict 401 for `ignored_auth` no-auth / bogus-auth
   *  variants (matches schemathesis V4 default). Off by default — zond's
   *  pragmatic policy accepts any 4xx as a legitimate auth-reject (403,
   *  404, 422 are common). With this on, only 401 passes — a 403 on
   *  no_auth becomes a finding "expected 401, got 403". */
  strict401?: boolean;
}

export interface CheckContext {
  case: CheckCase;
  response: CheckResponse;
  /** Pre-built once per run so checks don't pay AJV compile cost
   *  per-case. Optional so unit tests can stub a context without one. */
  schemaValidator?: SchemaValidator;
  /** Original spec doc — checks that need declared headers /
   *  content-types / status codes look them up here. */
  doc?: OpenAPIV3.Document;
  /** ARV-179: per-run knobs (see CheckRuntimeOptions). */
  options?: CheckRuntimeOptions;
}

export type CheckOutcome =
  | { kind: "pass" }
  | { kind: "skip"; reason: string }
  | {
      kind: "fail";
      message: string;
      evidence?: Record<string, unknown>;
      /** ARV-284: per-finding severity override. When set, runner uses
       *  this in place of `Check.severity` — lets a check emit different
       *  severities based on context (e.g. `negative_data_rejection`
       *  with `additionalProperties-violation` evidence → LOW, with
       *  `pattern-violation` → MEDIUM, with 5xx response → HIGH). The
       *  declared `Check.severity` stays as the natural fallback /
       *  documentation tier. The agent re-severitizes from the raw
       *  evidence downstream. */
      severity?: Severity;
      /** ARV-310: attribute the finding to a specific operation instead of
       *  the CRUD group's canonical create/read op. cursor_boundary_fuzzing
       *  probes the GET list endpoint — without this the finding lands on the
       *  POST create and reads as "a create endpoint that doesn't paginate". */
      operation?: { path: string; method: string; operationId?: string };
      /** ARV-312: observed HTTP status of the response the check acted on.
       *  Auth/stateful checks send their own requests, so the runner has no
       *  response to summarize and otherwise records `status: 0` — a phantom
       *  that reads as "no response captured". Set this so the finding carries
       *  the real status (and severity gating can key off it). */
      responseStatus?: number;
    };

export interface Check {
  /** Stable identifier — must match schemathesis name where possible. */
  id: string;
  severity: Severity;
  /** Default expected outcome ("server should NOT 5xx", etc) — surfaced
   *  by `zond checks list` so an agent can read the contract. */
  defaultExpected: string;
  references: CheckReference[];
  /** Probe shapes this check consumes. Default `["positive"]` — most
   *  conformance checks just inspect the standard response. ARV-2's
   *  `missing_required_header` / `unsupported_method` declare their
   *  own kinds so the runner generates the matching probe case. */
  caseKinds?: CaseKind[];
  /** Whether this check is meaningful for the given operation. Used by
   *  the runner to skip checks that don't apply (e.g. auth-related
   *  checks on operations with no security requirement). */
  applies(operation: EndpointInfo): boolean;
  run(ctx: CheckContext): CheckOutcome;
}

export interface CheckFinding {
  check: string;
  severity: Severity;
  /** ARV-251: finding category drives per-section roll-up in reports.
   *  Optional for backwards compat — when absent, downstream code derives
   *  it via `categoryFor(check)`. Storing it on the finding keeps probe
   *  emitters and check emitters using the same shape. */
  category?: Category;
  operation: { path: string; method: string; operationId?: string };
  request_signature: string;
  response_summary: { status: number; content_type?: string };
  message: string;
  evidence?: Record<string, unknown>;
  /** ARV-11 — closed enum so agents can route on it without parsing
   *  the message. Resolved by `recommendForCheck()` keyed on the
   *  check id (and response status for `network_error`). Optional
   *  because synthetic findings (e.g. unit-test fakes) may skip it. */
  recommended_action?: RecommendedAction;
  /** Suppression trace — present when a finding was removed from the
   *  gate counts (today only the deterministic broken-baseline guard,
   *  ARV-307, marks findings this way). CI summary excludes such findings
   *  from gate counts via this field's presence; presence of
   *  `suppressed_by` is the canonical "suppressed" signal. */
  suppressed_by?: {
    source: string;
    rule_index: number;
    reason: string;
  };
}

export interface CheckRunSummary {
  operations: number;
  cases: number;
  checks_run: number;
  findings: number;
  by_severity: Record<Severity, number>;
  /** ARV-251: per-category roll-up — small teams use this to triage
   *  "0 security, 12 reliability, 40 contract, 200 hygiene" instead of
   *  reading one flat severity pile. */
  by_category: Record<Category, number>;
  /** ARV-26: count of `kind: "skip"` outcomes returned by checks, keyed by
   *  `"<check_id>: <reason>"`. Surfaces the gap between probe and runtime
   *  validators — e.g. `response_schema_conformance: no JSON Schema on this
   *  response branch ×2` tells the user why "0 findings" doesn't mean "all
   *  green" (probe got 4xx, response schema only declared on 2xx). */
  skipped_outcomes: Record<string, number>;
  /** ARV-83: same data as `skipped_outcomes`, but split into `{check, reason,
   *  count}` so consumers don't have to colon-tokenise a key whose reason
   *  text may itself contain colons. Sorted by count descending. The legacy
   *  `skipped_outcomes` field is kept for back-compat with existing parsers
   *  / NDJSON readers. */
  skipped_outcomes_grouped: Array<{ check: string; reason: string; count: number }>;
  /** Count of findings suppressed by the deterministic broken-baseline
   *  guard (ARV-307). Excluded from `findings`/`by_severity` so CI gates
   *  ignore them, but surfaced here for audit-trail reconciliation. */
  suppressed?: number;
}

/** ARV-60: spec-level rollup of a systemic gap that manifests on N
 *  operations. When ≥80% of a check's applicable operations share the same
 *  root cause (same response status undeclared, same missing-schema skip
 *  reason, or zero cases when a detector finds no pair), the runner emits
 *  a single `SpecFinding` instead of (or in addition to) the N per-op rows.
 *
 *  Consumed by the CLI to print one summary line; surfaced verbatim in the
 *  JSON envelope and as a dedicated `spec_finding` NDJSON event. Per-op
 *  findings are NOT removed from `findings[]` — agents that prefer per-op
 *  triage keep their existing surface; agents that triage by spec hit just
 *  one row per drift. */
export interface SpecFinding {
  check: string;
  /** Classifier so consumers can branch:
   *  - `status_drift`: response status code clustered across operations
   *    (status_code_conformance / negative_data_rejection / ignored_auth).
   *  - `missing_declaration`: every applicable case skipped for the same
   *    "spec didn't declare X" reason (response_schema_conformance,
   *    response_headers_conformance).
   *  - `no_detector`: check is applicable to ≥5 operations but ran 0 cases
   *    (use_after_free without DELETE+GET pair, cross_call_references
   *    without followups in scope).
   *  - `broken_baseline`: ARV-307 — the positive/success baseline was
   *    degenerate (>90% of positive probes returned non-2xx, e.g. a
   *    fully auth-rejected scan). The conformance checks' per-op findings
   *    are baseline artifacts, so they're rolled up into this one row and
   *    removed from `findings[]` (mirrors the stateful broken-baseline skip).
   *  - `other`: skip-cluster that doesn't fit the above. */
  kind: "status_drift" | "missing_declaration" | "no_detector" | "broken_baseline" | "other";
  /** Severity inherited from the underlying findings (status_drift) or
   *  fixed to "info" for missing_declaration / no_detector — those signal
   *  "spec gap, not server bug" so the team knows where to act. */
  severity: Severity;
  category?: Category;
  /** One-line root cause statement — surfaces what zond observed. */
  reason: string;
  /** Actionable next step. References a spec edit, a tolerate flag, or
   *  another zond command. Empty string when no automatic suggestion. */
  fix_hint: string;
  /** Operations the rollup covers (path + method). count = length. */
  affected_operations: Array<{ path: string; method: string; operationId?: string }>;
  count: number;
  /** Applicable population the cluster was measured against. ratio =
   *  count / applicable. Lets consumers re-threshold without re-running. */
  applicable: number;
}

export interface CheckRunData {
  findings: CheckFinding[];
  summary: CheckRunSummary;
  /** ARV-60: spec-level rollup, see SpecFinding. Always present (empty
   *  array when no clusters cross the 80% threshold). */
  spec_findings: SpecFinding[];
}

export function emptySummary(): CheckRunSummary {
  return {
    operations: 0,
    cases: 0,
    checks_run: 0,
    findings: 0,
    by_severity: emptySeverityBuckets(),
    by_category: emptyCategoryBuckets(),
    skipped_outcomes: {},
    skipped_outcomes_grouped: [],
    suppressed: 0,
  };
}

/** ARV-83: turn the legacy `<check>: <reason>` keys into a structured
 *  array. The split parses the colon-separator at the first occurrence; if
 *  the reason itself contains colons, only the LEADING `check_id:` is
 *  stripped, preserving the rest verbatim. */
export function groupSkippedOutcomes(
  outcomes: Record<string, number>,
): Array<{ check: string; reason: string; count: number }> {
  const out: Array<{ check: string; reason: string; count: number }> = [];
  for (const [key, count] of Object.entries(outcomes)) {
    const idx = key.indexOf(": ");
    if (idx > 0) {
      out.push({ check: key.slice(0, idx), reason: key.slice(idx + 2), count });
    } else {
      out.push({ check: key, reason: "", count });
    }
  }
  out.sort((a, b) => b.count - a.count);
  return out;
}
