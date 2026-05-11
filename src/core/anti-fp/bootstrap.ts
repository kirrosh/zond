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

let bootstrapped = false;

export function bootstrapAntiFp(): void {
  if (bootstrapped) return;
  for (const rule of SCHEMATHESIS_RULES) register(rule);
  bootstrapped = true;
}

/** Test helper — clears the registry and the bootstrap flag so the
 *  next call re-registers from scratch. */
export function resetAntiFpBootstrap(): void {
  reset();
  bootstrapped = false;
}
