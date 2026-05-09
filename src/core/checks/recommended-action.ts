/**
 * ARV-11 (m-15): per-check `recommended_action` table.
 *
 * Each `CheckFinding` carries one closed-enum action so an agent can
 * route on it without parsing the free-form `message`. The mapping is
 * deterministic — given the check id and (for a couple of fan-out cases)
 * the response status, exactly one action comes out.
 *
 * Keep this file thin and table-driven. The shared enum lives in
 * `core/diagnostics/failure-hints.ts` so `db diagnose` (TASK-294) and
 * `zond checks run` (ARV-11) can never drift.
 */
import type { RecommendedAction } from "../diagnostics/failure-hints.ts";

/** Static table — most checks have one canonical action regardless of
 *  what the server did. Dynamic cases (today: just `network_error`)
 *  are handled by the function below. */
const STATIC_TABLE: Record<string, RecommendedAction> = {
  // Spec contract violations — the server's behaviour was reasonable
  // but the spec doesn't predict it; update the spec.
  status_code_conformance: "fix_spec",
  content_type_conformance: "fix_spec",
  response_headers_conformance: "fix_spec",
  response_schema_conformance: "fix_spec",

  // Backend bugs — spec is fine, server isn't.
  not_a_server_error: "report_backend_bug",
  unsupported_method: "report_backend_bug",
  positive_data_acceptance: "report_backend_bug",
  use_after_free: "report_backend_bug",
  ensure_resource_availability: "report_backend_bug",

  // Validation gaps — server accepted something it shouldn't have.
  negative_data_rejection: "tighten_validation",

  // Header enforcement gap — spec said `required: true`, server didn't
  // care. Either fix the server or relax the spec — `add_required_header`
  // signals the more common fix (enforce on the server).
  missing_required_header: "add_required_header",

  // Auth misconfiguration — security scheme present but not enforced.
  ignored_auth: "fix_auth_config",
};

/**
 * Resolve the action for a finding. Returns `undefined` when no rule
 * applies — callers should leave `recommended_action` unset rather than
 * forcing a fallback (an unknown id is a *bug* in this table, not a
 * runtime input to coerce).
 *
 * @param checkId  the finding's `check` id (e.g. `not_a_server_error`).
 * @param status   the response status — only consulted for the dynamic
 *                 cases below (kept in the signature so future entries
 *                 can branch on it without touching call sites).
 */
export function recommendForCheck(
  checkId: string,
  status?: number,
): RecommendedAction | undefined {
  // network_error is synthesised by the runner when the request itself
  // failed — no `Check` object exists, but findings still need an
  // action. 401/403 routes to auth-config (matches `db diagnose`'s
  // policy in `failure-hints.ts`), everything else is a transport
  // misconfiguration.
  if (checkId === "network_error") {
    if (status === 401 || status === 403) return "fix_auth_config";
    return "fix_network_config";
  }
  return STATIC_TABLE[checkId];
}

/** Test-only export — keeps the unit table authoritative without
 *  re-listing entries inside the test file. */
export const RECOMMENDED_ACTION_TABLE: Readonly<Record<string, RecommendedAction>> = STATIC_TABLE;
