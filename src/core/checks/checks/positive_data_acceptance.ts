/**
 * `positive_data_acceptance` (m-15 ARV-4) — schemathesis-equivalent.
 * Runs against the standard positive case (kind="positive"). When the
 * server *rejects* a generated-as-valid body with a schema-validation
 * status (400 / 422), it's either our generator was wrong or the spec
 * is over-strict — both worth flagging.
 *
 * Auth/lookup statuses (401/403/404/409) are skipped: they aren't
 * schema-validation rejects. 5xx is skipped here too because
 * `not_a_server_error` already covers it.
 */
import type { Check } from "../types.ts";

export const positiveDataAcceptance: Check = {
  id: "positive_data_acceptance",
  severity: "medium",
  defaultExpected: "Server must accept a generated-as-valid body (2xx)",
  references: [{ id: "OWASP-API-08" }],
  applies: (op) => Boolean(op.requestBodySchema),
  run({ response }) {
    const s = response.status;
    if (s >= 200 && s < 300) return { kind: "pass" };
    // Auth / not-found / conflict / server-error → not a schema-rejection signal.
    if (s === 401 || s === 403 || s === 404 || s === 409) return { kind: "pass" };
    if (s >= 500) return { kind: "skip", reason: "5xx covered by not_a_server_error" };
    if (s !== 400 && s !== 422) return { kind: "skip", reason: `status ${s} not a schema-validation reject` };
    return {
      kind: "fail",
      message: `Server rejected a generated-as-valid body with ${s} — generator or spec disagrees with the implementation`,
      evidence: { status: s },
    };
  },
};
