/**
 * ARV-125 / ARV-126: subscription/scope-gated anti-FP rule bundle.
 * Same pattern as `rules/schemathesis/index.ts` — each rule is
 * exported individually for tests, the side-effect-free list is
 * consumed by `bootstrapAntiFp`.
 */
import { PAID_PLAN_403_RULE } from "./paid-plan-403.ts";

export { PAID_PLAN_403_RULE };

export const SUBSCRIPTION_GATED_RULES = [PAID_PLAN_403_RULE] as const;
