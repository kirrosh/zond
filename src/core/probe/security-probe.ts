/**
 * Barrel re-export for `zond probe-security <classes>`.
 *
 * The probe pipeline lives in `./security/`:
 *   - types.ts        — public types / interfaces
 *   - detectors.ts    — field detectors + payload table
 *   - baseline.ts     — baseline send + snapshot/restore (PUT/PATCH cleanup)
 *   - classify.ts     — per-finding classification + echo detection
 *   - cleanup.ts      — best-effort DELETE on stateful endpoints
 *   - digest.ts       — markdown digest formatter
 *   - regression.ts   — regression-suite YAML emission
 *   - orchestrator.ts — runSecurityProbes + probeOneEndpoint loop
 *
 * History: split out of a 1473-LOC monolith (ARV-295, 2026-05-18) to keep
 * each concern in a focused file. The public API surface is unchanged.
 */
export type {
  SecurityClass,
  SecuritySeverity,
  SecurityFieldHit,
  SecurityFinding,
  SecurityVerdict,
  SecurityProbeOptions,
  CleanupFeasibility,
  SecurityProbeResult,
} from "./security/types.ts";
export { SECURITY_CLASSES } from "./security/types.ts";
export { detectFields } from "./security/detectors.ts";
export { runSecurityProbes } from "./security/orchestrator.ts";
export { classifyEcho } from "./security/classify.ts";
export { formatSecurityDigest } from "./security/digest.ts";
export { emitSecurityRegressionSuites } from "./security/regression.ts";
