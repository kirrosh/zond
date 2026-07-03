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
import { classify, type FindingClass } from "../classifier/recommended-action.ts";

/** Check IDs the classifier explicitly recognises. Keeping this typed
 *  guarantees that adding a new check forces a branch in the classifier
 *  switch (tsc errors out at compile time on a stale `STATIC_TABLE` lookup). */
const CHECK_ID_TO_CLASS: Record<string, FindingClass> = {
  status_code_conformance: "check:status_code_conformance",
  content_type_conformance: "check:content_type_conformance",
  response_headers_conformance: "check:response_headers_conformance",
  response_schema_conformance: "check:response_schema_conformance",
  not_a_server_error: "check:not_a_server_error",
  unsupported_method: "check:unsupported_method",
  positive_data_acceptance: "check:positive_data_acceptance",
  use_after_free: "check:use_after_free",
  ensure_resource_availability: "check:ensure_resource_availability",
  negative_data_rejection: "check:negative_data_rejection",
  missing_required_header: "check:missing_required_header",
  ignored_auth: "check:ignored_auth",
  cross_call_references: "check:cross_call_references",
  idempotency_replay: "check:idempotency_replay",
  pagination_invariants: "check:pagination_invariants",
  lifecycle_transitions: "check:lifecycle_transitions",
  open_cors_on_sensitive: "check:open_cors_on_sensitive",
  rate_limit_headers_absent: "check:rate_limit_headers_absent",
  cursor_boundary_fuzzing: "check:cursor_boundary_fuzzing",
  network_error: "check:network_error",
};

/**
 * ARV-56: thin wrapper that maps a check id + status to the unified
 * classifier. Returns `undefined` when the check id isn't in the table
 * — unknown ids are a bug in this map, not a runtime input to coerce.
 */
export function recommendForCheck(
  checkId: string,
  status?: number,
  /** ARV-324: true when `.fixture-gaps.yaml` already confirmed this
   *  operation as a known-empty/inaccessible resource. */
  unresolvedFixture?: boolean,
): RecommendedAction | undefined {
  const findingClass = CHECK_ID_TO_CLASS[checkId];
  if (!findingClass) return undefined;
  return classify({ finding_class: findingClass, status: status ?? null, unresolved_fixture: unresolvedFixture });
}

/** Test-only export — keeps the unit table authoritative without
 *  re-listing entries inside the test file. Derived from classifier
 *  output so the table never drifts from the classifier's switch. */
export const RECOMMENDED_ACTION_TABLE: Readonly<Record<string, RecommendedAction>> = Object.freeze(
  Object.fromEntries(
    Object.entries(CHECK_ID_TO_CLASS)
      .filter(([id]) => id !== "network_error") // dynamic — depends on status
      .map(([id, fc]) => [id, classify({ finding_class: fc })!]),
  ),
);
