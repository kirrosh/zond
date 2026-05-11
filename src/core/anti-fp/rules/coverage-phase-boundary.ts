/**
 * ARV-126: canonical location for the coverage-phase-boundary FP guard.
 *
 * The schemathesis-attributed variant
 * (`rules/schemathesis/coverage_phase_boundary_positive.ts`) is
 * check-only — `--phase coverage` doesn't exist on the live security
 * probe — so the two rules don't collapse into one. This file
 * re-exports the existing rule under a stable top-level name so the
 * registry has a single discoverable entry per family
 * (`rules/baseline-echo.ts` + `rules/coverage-phase-boundary.ts`) per
 * task wording, and keeps the schemathesis source-of-truth in its
 * attributed subfolder.
 *
 * If a probe:security boundary suppression is ever needed, add it
 * alongside the existing rule below — bundled together they make the
 * registry's `coverage-phase-boundary` slot self-contained.
 */
export { coveragePhaseBoundaryPositiveRule as COVERAGE_PHASE_BOUNDARY_RULE } from "./schemathesis/coverage_phase_boundary_positive.ts";
