/**
 * ARV-124: migrated from `src/core/checks/checks/_anti_fp.ts` (guard #3).
 *
 * Multiple disjoint mutations make accept/reject ambiguous: the server
 * might accept due to one site even while rejecting another. Our
 * single-site mutator emits exactly one mutation, so the guard fires
 * only when callers attach `mutation_count > 1` to `case.meta` — used
 * by future shrinkers / batched probes.
 *
 * Scope covers both data-rejection checks so a multi-site mutation
 * payload that survives into either side gets suppressed consistently.
 *
 * Source: schemathesis #2713.
 */
import type { CheckCase } from "../../../checks/types.ts";
import type { FpRule } from "../../types.ts";

export const hasUnverifiableMutationsRule: FpRule<CheckCase> = {
  id: "_has_unverifiable_mutations",
  scope: ["check:negative_data_rejection", "check:positive_data_acceptance"],
  references: ["#2713"],
  applies(c) {
    const meta = c.meta as { mutation_count?: number } | undefined;
    if (!meta) return null;
    if (typeof meta.mutation_count === "number" && meta.mutation_count > 1) {
      return {
        ruleId: "_has_unverifiable_mutations",
        scope: "check:negative_data_rejection",
        reason: `${meta.mutation_count} mutations on disjoint sites — finding can't be attributed`,
        references: ["#2713"],
      };
    }
    return null;
  },
};
