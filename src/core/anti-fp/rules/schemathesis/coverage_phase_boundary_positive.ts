/**
 * ARV-124: migrated from `src/core/checks/checks/_anti_fp.ts` (guard #4).
 *
 * `--phase coverage` enumerates boundary values across the body schema:
 *   - shortest/longest string, min/max int, every enum option, ...
 * Those bodies are JSON-Schema-valid but semantically synthetic — they
 * sit on the contract edge. Real APIs reject them with 422 for reasons
 * that have nothing to do with the contract:
 *   - "from" email must be on a verified-sending-domain,
 *   - "broadcast.from_audience_id" must exist on this tenant,
 *   - rate-limited resource (a plan_limit).
 * Treating each one as `positive_data_acceptance` fail floods the
 * report (171/349 findings on a benchmark run) and drowns real depth
 * signal. Skip when the case is a coverage-phase positive — keep the
 * examples-phase positive (one realistic baseline body) as the strict
 * signal.
 *
 * Source: feedback round-03 F20 / ARV-77.
 */
import type { CheckCase } from "../../../checks/types.ts";
import type { FpRule } from "../../types.ts";

export const coveragePhaseBoundaryPositiveRule: FpRule<CheckCase> = {
  id: "_coverage_phase_boundary_positive",
  scope: "check:positive_data_acceptance",
  references: ["ARV-77"],
  applies(c) {
    const meta = c.meta as { phase?: string } | undefined;
    if (!meta || meta.phase !== "coverage") return null;
    if (c.kind !== "positive") return null;
    return {
      ruleId: "_coverage_phase_boundary_positive",
      scope: "check:positive_data_acceptance",
      reason:
        "boundary-positive bodies are synthetic — server may reject for semantic reasons unrelated to the contract",
    };
  },
};
