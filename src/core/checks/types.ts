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

export type Severity = "low" | "medium" | "high" | "critical";

export type Phase = "examples" | "coverage" | "all";

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

export interface CheckContext {
  case: CheckCase;
  response: CheckResponse;
  /** Pre-built once per run so checks don't pay AJV compile cost
   *  per-case. Optional so unit tests can stub a context without one. */
  schemaValidator?: SchemaValidator;
  /** Original spec doc — checks that need declared headers /
   *  content-types / status codes look them up here. */
  doc?: OpenAPIV3.Document;
}

export type CheckOutcome =
  | { kind: "pass" }
  | { kind: "skip"; reason: string }
  | { kind: "fail"; message: string; evidence?: Record<string, unknown> };

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
}

export interface CheckRunSummary {
  operations: number;
  cases: number;
  checks_run: number;
  findings: number;
  by_severity: Record<Severity, number>;
}

export interface CheckRunData {
  findings: CheckFinding[];
  summary: CheckRunSummary;
}

export function emptySummary(): CheckRunSummary {
  return {
    operations: 0,
    cases: 0,
    checks_run: 0,
    findings: 0,
    by_severity: { low: 0, medium: 0, high: 0, critical: 0 },
  };
}
