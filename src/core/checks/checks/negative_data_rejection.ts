/**
 * `negative_data_rejection` (m-15 ARV-4) — schemathesis-equivalent.
 * The runner builds a single-site negative case (one mutation against
 * a valid body, see `_negative_mutator.ts`); if the server still
 * accepts it (status outside 4xx/5xx + 401/403/404 admin set), we
 * raise a finding — *unless* an anti-FP guard fires (see `_anti_fp.ts`).
 *
 * Default expected: 400 / 401 / 403 / 404 / 422 / 428 / 5xx.
 *   2xx and 3xx with our payload are findings.
 *
 * Severity matrix (ARV-284, dispatched per finding via outcome.severity
 * — see `severityForEvidence` below):
 *
 *   - MEDIUM: concrete schema breach silently accepted (maxLength+1,
 *             type-mismatch, pattern-violation, format-invalid,
 *             drop-required, uniqueItems-violation, drop-required-query).
 *             Server should reject; evidence single-signal but breach
 *             is concrete.
 *   - LOW:    `additionalProperties-violation` (unknown body fields
 *             silently dropped is documented forward-compat in many
 *             APIs — Stripe by design) and `wrong-type` query params
 *             on GET list endpoints (often "invalid id → empty
 *             result" documented behaviour). Single-signal, ambiguous
 *             intent.
 *
 * Note: 5xx on a negative mutation does NOT escalate this check —
 * `not_a_server_error` (separate check, severity HIGH by design) owns
 * the 5xx signal, and `ACCEPTABLE()` below treats 5xx as a non-silent
 * accept so this check passes for those cases. Avoids double-counting.
 *
 * Per ARV-250's proof-cap principle (no evidence → no high severity):
 * single-signal proof caps at LOW; concrete schema breach escalates to
 * MEDIUM. The declared `severity: "low"` is the natural fallback /
 * proof-cap baseline; stronger findings use `outcome.severity` to
 * override.
 *
 * Users can re-calibrate any of these per-API via `.zond/severity.yaml`
 * (ARV-283) — e.g. promote `additionalProperties-violation` to MEDIUM
 * for a strict-validating API that documents rejection, or suppress
 * `wrong-type` query on GET for a Stripe-style "empty list" vendor.
 */
import type { Check, CheckOutcome } from "../types.ts";
import type { Severity } from "../../severity/index.ts";
import { applyAntiFp } from "../../anti-fp/index.ts";

const ACCEPTABLE = (status: number): boolean => {
  if (status === 400 || status === 401 || status === 403 || status === 404 || status === 422 || status === 428) return true;
  if (status >= 500 && status < 600) return true; // 5xx accepted: a bug, but not a *silent* accept
  return false;
};

/** Body-boundary labels we treat as LOW (often by-design vendor
 *  behaviour, single-signal, ambiguous intent). All other boundary
 *  labels emitted by `coverage-phase.ts:enumerateBoundaryCases` —
 *  maxLength+1, pattern-violation, uuid-invalid, drop-required:X, etc.
 *  — are concrete schema breaches and stay MEDIUM. */
const LOW_BODY_BOUNDARIES: ReadonlySet<string> = new Set([
  "additionalProperties-violation",
]);

/** Param-scenario labels (`coverage-phase.ts:enumerateParamBoundaryCases`)
 *  we treat as LOW. `wrong-type` is the classic "Stripe returns empty
 *  list for invalid id" pattern — many APIs document this; flagging
 *  HIGH/MEDIUM produces noise. `drop-required-query` stays MEDIUM (a
 *  declared-required param being silently optional is a concrete
 *  contract gap, not vendor convention). */
const LOW_PARAM_SCENARIOS_ON_GET: ReadonlySet<string> = new Set([
  "wrong-type",
]);

interface MutationMeta {
  mutation?: string;
  boundary?: string;
  param_scenario?: string;
  param_location?: string;
}

function severityForEvidence(
  meta: MutationMeta | undefined,
  method: string,
): Severity {
  if (!meta) return "low";

  // Param-side mutations (query / path wrong-type, drop-required-query).
  if (meta.mutation === "param-boundary") {
    const scenario = meta.param_scenario ?? "";
    if (
      meta.param_location === "query"
      && method.toUpperCase() === "GET"
      && LOW_PARAM_SCENARIOS_ON_GET.has(scenario)
    ) {
      return "low";
    }
    // drop-required-query, wrong-type on non-GET, wrong-type on path
    // params: concrete contract violations server should reject.
    return "medium";
  }

  // Body-boundary mutations (additionalProperties, maxLength+1, etc).
  if (meta.mutation === "boundary") {
    const boundary = meta.boundary ?? "";
    if (LOW_BODY_BOUNDARIES.has(boundary)) return "low";
    return "medium";
  }

  // Unknown mutation kind — single-signal fallback.
  return "low";
}

export const negativeDataRejection: Check = {
  id: "negative_data_rejection",
  // ARV-284: declared severity is the *natural* tier (proof-cap baseline
  // per ARV-250 — single-signal caps at LOW). Per-finding severity is
  // dispatched via `outcome.severity` in `run()` below, so summary
  // tables can show HIGH for 5xx and MEDIUM for concrete schema breach
  // without globally setting the check to HIGH (which masks calibration).
  severity: "low",
  defaultExpected: "Server must reject invalid bodies with 400/401/403/404/422/428 (or 5xx)",
  references: [{ id: "OWASP-API-08" }],
  caseKinds: ["negative_data"],
  applies: (op) => Boolean(op.requestBodySchema),
  run({ case: c, response }): CheckOutcome {
    if (ACCEPTABLE(response.status)) return { kind: "pass" };
    const skip = applyAntiFp(c, "check:negative_data_rejection");
    if (skip) {
      return { kind: "skip", reason: `${skip.ruleId}: ${skip.reason}` };
    }
    const meta = c.meta as MutationMeta | undefined;
    return {
      kind: "fail",
      message: `Server accepted an invalid body (status ${response.status}) — single-site mutation: ${
        meta?.mutation ?? "unknown"
      } @ ${meta?.boundary ?? meta?.param_scenario ?? "?"}`,
      evidence: { status: response.status, mutation: meta },
      severity: severityForEvidence(meta, c.operation.method),
    };
  },
};
