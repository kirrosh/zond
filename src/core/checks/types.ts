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
import type { EndpointInfo } from "../generator/types.ts";

export type Severity = "low" | "medium" | "high" | "critical";

export type Phase = "examples" | "coverage" | "all";

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
   *  (intentionally invalid). Some checks only apply to one mode. */
  mode: "positive" | "negative";
}

export interface CheckContext {
  case: CheckCase;
  response: CheckResponse;
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
  /** Filled in by ARV-11 — kept here so the envelope shape is stable
   *  from day one. */
  recommended_action?: string;
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
