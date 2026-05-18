/**
 * Auto-registers built-in checks at first import. ARV-1 ships with one
 * seed check (`not_a_server_error`); ARV-2/3/4 fill in the remaining
 * 11 conformance/security checks alongside it.
 *
 * Side-effect import is intentional: anywhere the runner or CLI loads
 * `core/checks` it triggers this module and the registry is populated
 * exactly once (Node/Bun ESM module cache guarantees idempotency).
 */
import { registerCheck } from "../registry.ts";
import { registerStatefulCheck } from "../stateful.ts";
import { notAServerError } from "./not_a_server_error.ts";
import { statusCodeConformance } from "./status_code_conformance.ts";
import { contentTypeConformance } from "./content_type_conformance.ts";
import { responseHeadersConformance } from "./response_headers_conformance.ts";
import { responseSchemaConformance } from "./response_schema_conformance.ts";
import { missingRequiredHeader } from "./missing_required_header.ts";
import { unsupportedMethod } from "./unsupported_method.ts";
import { ignoredAuth } from "./ignored_auth.ts";
import { useAfterFree } from "./use_after_free.ts";
import { ensureResourceAvailability } from "./ensure_resource_availability.ts";
import { negativeDataRejection } from "./negative_data_rejection.ts";
import { positiveDataAcceptance } from "./positive_data_acceptance.ts";
import { crossCallReferences } from "./cross_call_references.ts";
import { idempotencyReplay } from "./idempotency_replay.ts";
import { paginationInvariants } from "./pagination_invariants.ts";
import { lifecycleTransitions } from "./lifecycle_transitions.ts";
import { openCorsOnSensitive } from "./open_cors_on_sensitive.ts";
import { rateLimitHeadersAbsent } from "./rate_limit_headers_absent.ts";
import { cursorBoundaryFuzzing } from "./cursor_boundary_fuzzing.ts";

let registered = false;

export function registerBuiltinChecks(): void {
  if (registered) return;
  // ARV-1 seed.
  registerCheck(notAServerError);
  // ARV-2 — 6 conformance checks (7 total with the seed).
  registerCheck(statusCodeConformance);
  registerCheck(contentTypeConformance);
  registerCheck(responseHeadersConformance);
  registerCheck(responseSchemaConformance);
  registerCheck(missingRequiredHeader);
  registerCheck(unsupportedMethod);
  // ARV-3 — 3 stateful security checks.
  registerStatefulCheck(ignoredAuth);
  registerStatefulCheck(useAfterFree);
  registerStatefulCheck(ensureResourceAvailability);
  // ARV-4 — 2 data-rejection checks with anti-FP guards.
  registerCheck(negativeDataRejection);
  registerCheck(positiveDataAcceptance);
  // ARV-169 (m-20) — cross-call POST→GET shape-diff probe.
  registerStatefulCheck(crossCallReferences);
  // ARV-170 (m-20) — Idempotency-Key replay probe.
  registerStatefulCheck(idempotencyReplay);
  // ARV-171 (m-20) — cursor pagination invariants.
  registerStatefulCheck(paginationInvariants);
  // ARV-172 (m-20) — declared state-machine + action transitions.
  registerStatefulCheck(lifecycleTransitions);
  // ARV-256 (m-21) — small-team value-add checks.
  registerStatefulCheck(openCorsOnSensitive);
  registerCheck(rateLimitHeadersAbsent);
  // ARV-273 (m-22) — cursor/page-token fuzzing on list endpoints.
  registerStatefulCheck(cursorBoundaryFuzzing);
  registered = true;
}

registerBuiltinChecks();
