/**
 * ARV-125: migrated from `core/probe/mass-assignment-probe.ts` —
 * inline pattern match for subscription/scope-gated 403 responses.
 *
 * Background (ARV-104 / F9): mass-assignment probing against Sentry's
 * 46-endpoint org slice produced an INCONCLUSIVE baseline on every
 * paid-plan endpoint. The default `inconclusiveBaselineSummary` tail
 * tells the triage agent to "fix fixture / FK / path-params and
 * re-probe" — but there's nothing to fix: the endpoint is gated by
 * subscription/scope, and the agent will crank-turn fixture edits
 * forever. The pattern match swaps the tail to a wontfix banner.
 *
 * Lives in the anti-FP registry as `sentry/paid-plan-403`. Scope is
 * `probe:mass-assignment` (with `probe:security` listed too — the
 * live security probe hits the same surface and surfaces the same
 * gated bodies through ARV-126's migration of its baseline-echo
 * check).
 *
 * Context payload: `{ status, message }`. The mass-assignment probe
 * already extracts the hint string from the response body; passing
 * the extracted string keeps the rule body-format-agnostic so future
 * callers (security probe) can reuse it without replicating the
 * extractor.
 */
import type { FpRule } from "../../types.ts";

export interface PaidPlan403Ctx {
  /** HTTP status of the baseline response. Rule applies only at 403. */
  status: number;
  /** Server-supplied message extracted from the response body. The
   *  rule does not parse JSON — callers extract their preferred field
   *  (Sentry uses `detail` / `message`) and pass the string. */
  message?: string;
}

/** Lower-cased anchored fragments for the SaaS-flavoured wordings we
 *  encounter in the wild. Each entry is one independent signal — a
 *  body matching any one of them is treated as subscription-gated. */
export const SUBSCRIPTION_GATED_PATTERNS: RegExp[] = [
  /\bpaid plan\b/i,
  /\bsubscription (?:required|needed)\b/i,
  /\bnot (?:available|enabled) (?:on|for) your\b/i,
  /\bplan (?:does not include|doesn['']?t include)\b/i,
  /\brequires? (?:the )?[\w:-]+ scope\b/i,
  /\bmissing (?:the )?[\w:-]+ scope\b/i,
  /\bfeature (?:is )?(?:not enabled|disabled|not available)\b/i,
  /\binsufficient (?:permissions?|scope)\b/i,
];

/** Exported predicate for callers that want a quick yes/no without
 *  composing an `applyAntiFp` call (the probe still exposes its own
 *  re-export of this for back-compat with pre-ARV-125 tests). */
export function matchesSubscriptionGated(message: string): boolean {
  for (const re of SUBSCRIPTION_GATED_PATTERNS) {
    if (re.test(message)) return true;
  }
  return false;
}

export const PAID_PLAN_403_RULE: FpRule<PaidPlan403Ctx> = {
  id: "sentry/paid-plan-403",
  scope: ["probe:mass-assignment", "probe:security"],
  references: ["ARV-104", "Sentry plan-limit doc"],
  applies(ctx) {
    if (ctx.status !== 403) return null;
    if (!ctx.message || !matchesSubscriptionGated(ctx.message)) return null;
    return {
      ruleId: "sentry/paid-plan-403",
      scope: "probe:mass-assignment",
      reason:
        "endpoint is env/subscription-gated (paid plan, role/scope, feature flag); " +
        "not a fixture issue — wontfix unless scope changes",
      references: ["ARV-104", "Sentry plan-limit doc"],
    };
  },
};
