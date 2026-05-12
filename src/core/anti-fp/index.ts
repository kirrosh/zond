/**
 * ARV-123 (m-19): public surface of the anti-FP registry.
 *
 * Callers (checks / probes) interact with a single helper —
 * `applyAntiFp(ctx, scope)` — which walks every rule registered for
 * `scope`, returns the first suppression that fires, or null. The
 * suppression object carries the rule id, the resolved scope, a
 * human reason, and the upstream references the rule was attributed
 * to.
 *
 * The registry itself is exported for migration tooling (ARV-124..126)
 * and for tests; production callers should prefer the helper.
 */
export type { FpRule, FpScope, FpSuppression } from "./types.ts";
export { register, get, list, reset, matchesScope } from "./registry.ts";

import { list } from "./registry.ts";
import type { FpScope, FpSuppression } from "./types.ts";

export function applyAntiFp<Ctx>(ctx: Ctx, scope: FpScope): FpSuppression | null {
  for (const rule of list(scope)) {
    const hit = rule.applies(ctx);
    if (hit) {
      return {
        ruleId: hit.ruleId || rule.id,
        scope,
        reason: hit.reason,
        references: hit.references ?? rule.references,
      };
    }
  }
  return null;
}
