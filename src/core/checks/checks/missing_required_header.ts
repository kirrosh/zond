/**
 * `missing_required_header` — schemathesis-equivalent. Sends a request
 * with one declared-required header dropped; the server must reject
 * with a 4xx (400 / 401 / 403 / 406 / 422). Anything else (2xx, 3xx,
 * 5xx) is a finding.
 *
 * The runner generates the probe case (kind="missing_required_header")
 * only when at least one operation declares a required header — we
 * skip otherwise to avoid a second wave of pointless requests.
 */
import type { Check } from "../types.ts";

const ACCEPTABLE_REJECT_STATUSES = new Set([400, 401, 403, 406, 422, 412]);

export const missingRequiredHeader: Check = {
  id: "missing_required_header",
  severity: "high",
  defaultExpected: "Server must reject the request with 4xx when a required header is missing",
  references: [{ id: "OWASP-API-04" }],
  caseKinds: ["missing_required_header"],
  applies: (op) =>
    op.parameters.some((p) => p.in === "header" && p.required === true),
  run({ case: c, response }) {
    const status = response.status;
    if (status >= 500) {
      return {
        kind: "fail",
        message: `Server 5xx'd when required header was dropped (${c.meta?.dropped_header}) — should be a 4xx rejection`,
        evidence: { dropped_header: c.meta?.dropped_header, status },
      };
    }
    if (ACCEPTABLE_REJECT_STATUSES.has(status)) return { kind: "pass" };
    if (status >= 400 && status < 500) return { kind: "pass" }; // any 4xx counts
    return {
      kind: "fail",
      message: `Server accepted request without required header "${c.meta?.dropped_header}" (status ${status})`,
      evidence: { dropped_header: c.meta?.dropped_header, status },
    };
  },
};
