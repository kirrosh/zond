/**
 * ARV-124: schemathesis-attributed rule bundle. Each export is a
 * standalone FpRule for testing/introspection; the side-effect-free
 * list is re-exported as `SCHEMATHESIS_RULES` so the bootstrap can
 * register them in one batch.
 */
import { bodyNegationBecomesValidRule } from "./body_negation_becomes_valid.ts";
import { coveragePhaseBoundaryPositiveRule } from "./coverage_phase_boundary_positive.ts";
import { hasUnverifiableMutationsRule } from "./has_unverifiable_mutations.ts";
import { stringTypeMutationBecomesValidRule } from "./string_type_mutation_becomes_valid.ts";

export {
  bodyNegationBecomesValidRule,
  coveragePhaseBoundaryPositiveRule,
  hasUnverifiableMutationsRule,
  stringTypeMutationBecomesValidRule,
};

export const SCHEMATHESIS_RULES = [
  bodyNegationBecomesValidRule,
  stringTypeMutationBecomesValidRule,
  hasUnverifiableMutationsRule,
  coveragePhaseBoundaryPositiveRule,
] as const;
