/**
 * ARV-283 Phase A: severity calibrator — top-level orchestrator.
 *
 * Input:  one finding shape + the response context
 * Output: a calibrated severity + optional `suppressed_by` trace
 *
 * Resolution order (matches AC#6 — `severity explain` will print this
 * chain verbatim in Phase C):
 *   1. Suppressions — first matching rule wins; emit `info-suppressed`
 *      and stop. Per-API rules are appended after workspace in the
 *      merged stack, but since first-match wins inside the union,
 *      ordering is preserved as authored.
 *   2. Per-check `by_action` override — if finding.recommended_action
 *      matches a key, use that severity.
 *   3. Per-check `severity` override.
 *   4. Built-in severity (passed in by caller).
 *
 * Why this layered API: the caller (recordFinding, probe emitters)
 * holds the built-in severity already; the calibrator just receives
 * it as the floor. Decouples disk I/O from emission path.
 */

import type { Severity } from "./index.ts";
import type { MergedConfig } from "./config.ts";
import type { MatchContext } from "./matcher.ts";
import { matchesAll } from "./matcher.ts";

export interface CalibrationInput {
  /** The check id (mass_assignment, rate_limit_headers_absent, etc). */
  check: string;
  /** Severity the producer would emit absent any config. */
  defaultSeverity: Severity;
  /** Recommended action enum if the finding has one (drives
   *  `by_action` lookups). */
  recommendedAction?: string;
  /** Match context for `when:` evaluation. */
  context: MatchContext;
}

/** Trace of which config rule changed (or suppressed) the severity. */
export interface CalibrationTrace {
  kind: "default" | "override" | "by_action" | "suppressed";
  source?: string;
  /** For override/by_action: the resolved severity */
  appliedSeverity?: Severity;
  /** For suppressed: the matching rule index + reason */
  ruleIndex?: number;
  reason?: string;
}

export interface CalibrationResult {
  /** Final severity after suppressions / overrides. Suppressed
   *  findings come back as `info` (so downstream consumers stay
   *  single-shape); use `suppressed: true` to distinguish from
   *  naturally-INFO findings. */
  severity: Severity;
  suppressed: boolean;
  trace: CalibrationTrace;
}

/**
 * Apply the merged config to one finding. Returns the calibrated
 * severity + trace. Callers should:
 *   - write `result.severity` into the finding's `severity` field
 *   - when `result.suppressed`, attach `result.trace` as
 *     `finding.suppressed_by` so the audit-trail survives in ndjson
 *   - exclude suppressed findings from CI gate counts (handled by
 *     downstream summary code, not here)
 */
export function calibrate(
  input: CalibrationInput,
  config: MergedConfig,
): CalibrationResult {
  // 1. Suppressions — first match wins.
  for (const rule of config.suppressions) {
    if (rule.check !== input.check) continue;
    if (!matchesAll(rule.when, input.context)) continue;
    return {
      severity: "info",
      suppressed: true,
      trace: {
        kind: "suppressed",
        source: rule.sourceFile,
        ruleIndex: rule.index,
        reason: rule.reason,
      },
    };
  }

  // 2-3. Per-check override
  const override = config.checks[input.check];
  if (override) {
    // by_action wins when it has a key for this finding's action
    if (input.recommendedAction && override.by_action) {
      const sev = override.by_action[input.recommendedAction as keyof typeof override.by_action];
      if (sev) {
        return {
          severity: sev,
          suppressed: false,
          trace: { kind: "by_action", appliedSeverity: sev },
        };
      }
    }
    if (override.severity) {
      return {
        severity: override.severity,
        suppressed: false,
        trace: { kind: "override", appliedSeverity: override.severity },
      };
    }
  }

  // 4. Built-in default
  return {
    severity: input.defaultSeverity,
    suppressed: false,
    trace: { kind: "default", appliedSeverity: input.defaultSeverity },
  };
}
