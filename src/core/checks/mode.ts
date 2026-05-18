/**
 * `--mode positive|negative|all` filter (m-15 ARV-7).
 *
 * Splits the registered check catalog along the positive-vs-negative
 * axis so an agent can run *just* contract verification (positive) or
 * *just* malicious-input probes (negative) on the same spec without
 * juggling a long `--check` list.
 *
 * Centralized table — both response-phase `Check`s and stateful
 * security checks declare their mode here. Tests snapshot the table so
 * adding a new check forces an explicit decision rather than letting it
 * silently land in the "all" bucket and surface in both modes.
 */
import type { Check } from "./types.ts";
import type { StatefulCheck } from "./stateful.ts";

export type Mode = "positive" | "negative" | "all";

export const MODE_BY_CHECK: Record<string, Mode> = {
  // Conformance checks fire on every response — both modes.
  not_a_server_error: "all",
  status_code_conformance: "all",
  content_type_conformance: "all",
  response_headers_conformance: "all",
  response_schema_conformance: "all",
  // Probes that *only* make sense as malicious input.
  missing_required_header: "negative",
  unsupported_method: "negative",
  negative_data_rejection: "negative",
  // The "happy-path didn't break" sanity probe.
  positive_data_acceptance: "positive",
  // Security checks (stateful) — they verify a *bad* outcome (auth
  // bypass, dangling reads). Not part of the positive contract.
  ignored_auth: "negative",
  use_after_free: "negative",
  // Availability is positive-flavored — it asserts the server *can*
  // serve the listed resource. Useful in `--mode positive` runs.
  ensure_resource_availability: "all",
  // ARV-169 (m-20): cross-call drift is a contract-verification check
  // (does GET reflect POST?), not a malicious-input probe. Positive.
  cross_call_references: "positive",
  // ARV-170 (m-20): idempotency replay verifies a *contract* the server
  // advertises (Idempotency-Key honored). Positive.
  idempotency_replay: "positive",
  // ARV-171 (m-20): pagination invariants verify the cursor contract.
  pagination_invariants: "positive",
  // ARV-172 (m-20): lifecycle verifies the declared state machine.
  lifecycle_transitions: "positive",
  // ARV-256 (m-21): open-CORS check sends an attacker Origin and
  // inspects response — categorically negative-mode probe.
  open_cors_on_sensitive: "negative",
  // ARV-256 (m-21): rate-limit headers check inspects 2xx responses
  // for advertised rate-limit metadata — runs on the positive path.
  rate_limit_headers_absent: "positive",
  // ARV-273 (m-22): cursor-fuzzing sends malformed cursor values and
  // expects 4xx — classic negative-mode probe.
  cursor_boundary_fuzzing: "negative",
};

export function modeFor(checkId: string): Mode {
  return MODE_BY_CHECK[checkId] ?? "all";
}

export function filterChecksByMode<T extends Check | StatefulCheck>(
  checks: T[],
  mode: Mode,
): T[] {
  if (mode === "all") return checks;
  return checks.filter((c) => {
    const cm = modeFor(c.id);
    if (cm === "all") return true;
    return cm === mode;
  });
}

/** True if a built case (with `mode: "positive" | "negative"`) should be
 *  sent in the requested run-mode. The runner uses this to short-circuit
 *  request emission for cases the active mode doesn't care about. */
export function caseMatchesMode(caseMode: "positive" | "negative", runMode: Mode): boolean {
  if (runMode === "all") return true;
  return runMode === caseMode;
}
