/**
 * ARV-124: register every shipped anti-FP rule.
 *
 * Mirrors `core/probe/bootstrap.ts` — called once at CLI startup so
 * checks/probes can rely on the registry being populated. Idempotent:
 * repeated calls are no-ops. Tests should pair `resetAntiFpBootstrap()`
 * with `reset()` from the registry to start from a clean slate.
 */
import { register, reset } from "./registry.ts";
import { SCHEMATHESIS_RULES } from "./rules/schemathesis/index.ts";
import { SUBSCRIPTION_GATED_RULES } from "./rules/subscription-gated/index.ts";
import { BASELINE_ECHO_RULE } from "./rules/baseline-echo.ts";

let bootstrapped = false;

export function bootstrapAntiFp(): void {
  if (bootstrapped) return;
  for (const rule of SCHEMATHESIS_RULES) register(rule);
  // ARV-125: subscription/scope-gated 403 wontfix tail in mass-assignment
  // baseline summaries.
  for (const rule of SUBSCRIPTION_GATED_RULES) register(rule);
  // ARV-126: probe:security baseline-echo FP guard. The
  // coverage-phase-boundary rule is shared with checks via its
  // canonical re-export and is already covered by SCHEMATHESIS_RULES.
  register(BASELINE_ECHO_RULE);
  bootstrapped = true;
}

/** Test helper — clears the registry and the bootstrap flag so the
 *  next call re-registers from scratch. */
export function resetAntiFpBootstrap(): void {
  reset();
  bootstrapped = false;
}
