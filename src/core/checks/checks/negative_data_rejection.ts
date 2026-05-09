/**
 * `negative_data_rejection` (m-15 ARV-4) — schemathesis-equivalent.
 * The runner builds a single-site negative case (one mutation against
 * a valid body, see `_negative_mutator.ts`); if the server still
 * accepts it (status outside 4xx/5xx + 401/403/404 admin set), we
 * raise a finding — *unless* an anti-FP guard fires (see `_anti_fp.ts`).
 *
 * Default expected: 400 / 401 / 403 / 404 / 422 / 428 / 5xx.
 *   2xx and 3xx with our payload are findings.
 */
import type { Check } from "../types.ts";
import { applyGuards } from "./_anti_fp.ts";

const ACCEPTABLE = (status: number): boolean => {
  if (status === 400 || status === 401 || status === 403 || status === 404 || status === 422 || status === 428) return true;
  if (status >= 500 && status < 600) return true; // 5xx accepted: a bug, but not a *silent* accept
  return false;
};

export const negativeDataRejection: Check = {
  id: "negative_data_rejection",
  severity: "high",
  defaultExpected: "Server must reject invalid bodies with 400/401/403/404/422/428 (or 5xx)",
  references: [{ id: "OWASP-API-08" }],
  caseKinds: ["negative_data"],
  applies: (op) => Boolean(op.requestBodySchema),
  run({ case: c, response }) {
    if (ACCEPTABLE(response.status)) return { kind: "pass" };
    const skip = applyGuards(c);
    if (skip) {
      return { kind: "skip", reason: `${skip.guard}: ${skip.reason}` };
    }
    return {
      kind: "fail",
      message: `Server accepted an invalid body (status ${response.status}) — single-site mutation: ${
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (c.meta as any)?.mutation
      } @ ${
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (c.meta as any)?.field_path
      }`,
      evidence: { status: response.status, mutation: c.meta },
    };
  },
};
