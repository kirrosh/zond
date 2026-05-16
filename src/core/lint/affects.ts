import type { RuleId } from "./types.ts";

/**
 * Cross-reference: which other zond commands are made noisier or less reliable
 * by an unfixed issue of each rule. Surfaced in JSON output as `affects[]` so
 * agents and IDEs can predict which probe runs will produce false-positive 5xx
 * or which `--validate-schema` checks will silently no-op.
 */
export const RULE_AFFECTS: Record<RuleId, string[]> = {
  // Group A — lax examples mislead generators and downstream consumers.
  A1: ["run:--validate-schema", "generate"],
  A2: ["run:--validate-schema", "generate"],
  A3: ["run:--validate-schema", "generate"],
  A4: ["run:--validate-schema", "generate"],
  A5: ["generate"],
  A6: [],

  // Group B — loose schema lets the spec accept what the server rejects.
  B1: ["probe-validation:invalid-path-uuid", "probe-methods"],
  B2: ["probe-validation:invalid-path-uuid"],
  B3: ["probe-validation:boundary-string"],
  B4: ["probe-validation:boundary-string"],
  B5: ["run:--validate-schema"],
  B6: ["run:--validate-schema"],
  B7: ["run:--validate-schema"],
  B8: ["probe-mass-assignment"],
  B9: ["probe-validation:missing-required"],
};
