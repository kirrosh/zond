/**
 * Barrel re-export for `zond probe-mass-assignment`.
 *
 * The probe pipeline lives in `./mass-assignment/`:
 *   - types.ts        — public types / interfaces
 *   - suspects.ts     — suspected-fields table + schema helpers
 *   - classify.ts     — per-field classification + severity finalisation
 *   - cleanup.ts      — best-effort DELETE on baseline POSTs
 *   - digest.ts       — markdown digest formatter
 *   - regression.ts   — regression-suite YAML emission
 *   - orchestrator.ts — runMassAssignmentProbes + probeEndpoint loop
 *
 * History: split out of a 1135-LOC monolith (ARV-296, 2026-05-18) to keep
 * each concern in a focused file. The public API surface is unchanged.
 */
export type {
  Severity,
  FieldVerdict,
  EndpointVerdict,
  MassAssignmentOptions,
  MassAssignmentResult,
} from "./mass-assignment/types.ts";
export { SUSPECTED_FIELDS } from "./mass-assignment/suspects.ts";
export { runMassAssignmentProbes } from "./mass-assignment/orchestrator.ts";
export { isSubscriptionGated } from "./mass-assignment/classify.ts";
export { formatDigestMarkdown } from "./mass-assignment/digest.ts";
export { emitRegressionSuites } from "./mass-assignment/regression.ts";
