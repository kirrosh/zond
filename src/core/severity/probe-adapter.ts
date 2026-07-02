/**
 * ARV-300: bridge probe-native severity enums onto the core `Severity`
 * ladder so probe findings pass through the same `.zond/severity.yaml`
 * calibrator as checks findings (ARV-283).
 *
 * Probe enums (SecuritySeverity, mass-assignment Severity, …) are all
 * `Severity ∪ {sentinels}`. The sentinels — inconclusive / -baseline /
 * -5xx / ok / skipped — are "not a finding" outcomes, not impact tiers;
 * they must survive round-trip untouched (never re-severitized, never
 * suppressed). Everything in the core ladder (high/medium/low/info) is
 * eligible for override + suppression.
 *
 * The adapter is enum-agnostic on purpose: it keys off the string value,
 * so one function serves every probe class without importing their types.
 */

import type { Severity } from "./index.ts";
import type { MergedConfig } from "./config.ts";
import type { MatchContext } from "./matcher.ts";
import { calibrate } from "./calibrator.ts";

/** Values shared with the core ladder — the only ones we calibrate. */
const CORE_SEVERITIES: ReadonlySet<string> = new Set([
  "critical",
  "high",
  "medium",
  "low",
  "info",
]);

export interface ProbeCalibrationInput {
  /** Suppression key — matched against `when.finding.check`. For the
   *  security probe this is the attack class (ssrf/crlf/open-redirect). */
  check: string;
  /** Probe-native severity (a superset of the core ladder). */
  severity: string;
  recommendedAction?: string;
  context: MatchContext;
}

export interface ProbeCalibrationResult {
  /** Calibrated severity, or the original sentinel unchanged. Callers
   *  cast back to their own enum — the value is guaranteed to be either
   *  the input sentinel or a member of the core `Severity` ladder. */
  severity: string;
  suppressed: boolean;
  suppressed_by?: { source: string; rule_index: number; reason: string };
}

function isNoop(config: MergedConfig | undefined): config is undefined {
  return (
    !config ||
    (config.suppressions.length === 0 && Object.keys(config.checks).length === 0)
  );
}

/**
 * Run one probe finding through the severity config. Pass-through (no
 * mutation) when the config is empty or the severity is a probe sentinel.
 */
export function calibrateProbeSeverity(
  input: ProbeCalibrationInput,
  config: MergedConfig | undefined,
): ProbeCalibrationResult {
  if (isNoop(config) || !CORE_SEVERITIES.has(input.severity)) {
    return { severity: input.severity, suppressed: false };
  }

  const result = calibrate(
    {
      check: input.check,
      defaultSeverity: input.severity as Severity,
      recommendedAction: input.recommendedAction,
      context: input.context,
    },
    config,
  );

  const out: ProbeCalibrationResult = {
    severity: result.severity,
    suppressed: result.suppressed,
  };
  if (result.suppressed && result.trace.kind === "suppressed") {
    out.suppressed_by = {
      source: result.trace.source ?? "",
      rule_index: result.trace.ruleIndex ?? 0,
      reason: result.trace.reason ?? "",
    };
  }
  return out;
}
