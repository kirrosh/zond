/**
 * ARV-126: baseline-echo FP guard for `probe:security`.
 *
 * Context: the live security probe sends a mutated body against a
 * 2xx-able baseline. When the response body is byte-for-byte identical
 * to the baseline response — same URL bouncing back unchanged — the
 * server effectively ignored the mutation. classifyInner currently
 * lands such findings at `severity: "low"` with the reason "2xx
 * accepted but no echo observed — verify side-effects manually",
 * which floods the digest with sites that have nothing to verify.
 *
 * This rule consumes a `{responseBody, baselineBody}` context and
 * fires when the two bodies are deeply equal. The probe consults
 * `applyAntiFp(ctx, "probe:security")` after classifyInner returns a
 * low-severity 2xx no-echo finding and, on a hit, downgrades the
 * finding to OK with the rule's reason as the wontfix banner.
 *
 * The deep-equality check is intentionally narrow — referential or
 * shape-only matches would over-suppress (a generic "ok: true" body
 * trivially equals across many endpoints). The probe is responsible
 * for passing the *full* parsed response, not a digest.
 */
import type { FpRule } from "../types.ts";

export interface BaselineEchoCtx {
  /** Parsed response body for the mutated request. */
  responseBody: unknown;
  /** Parsed response body for the pre-mutation baseline. May be
   *  `undefined` when the probe didn't retain a baseline (in which
   *  case the rule never fires — fail-open). */
  baselineBody: unknown;
}

export const BASELINE_ECHO_RULE: FpRule<BaselineEchoCtx> = {
  id: "baseline-echo",
  scope: "probe:security",
  references: ["ARV-126"],
  applies(ctx) {
    if (ctx.baselineBody === undefined) return null;
    if (!Bun.deepEquals(ctx.responseBody, ctx.baselineBody)) return null;
    return {
      ruleId: "baseline-echo",
      scope: "probe:security",
      reason:
        "response body identical to the pre-mutation baseline — server " +
        "ignored the attack payload; no side-effect to verify",
      references: ["ARV-126"],
    };
  },
};
