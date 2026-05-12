/**
 * Probe registry bootstrap (m-17 / ARV-49).
 *
 * Called once from the CLI program init. Imports each Probe class and
 * runs `registerProbe`, which validates the contract from `types.ts`
 * and throws if a slot is missing. Boot-time failure is louder than
 * runtime — adding a new probe class without --dry-run / --report
 * support won't ship; that's the whole point of the m-17 contract.
 *
 * Idempotent: repeated calls are no-ops (matters for unit tests that
 * run the bootstrap multiple times).
 */
import { listProbes, registerProbe } from "./registry.ts";
import { SecurityProbe } from "./security-probe-class.ts";
import { MassAssignmentProbe } from "./mass-assignment-probe-class.ts";
import { StaticProbe } from "./static-probe-class.ts";

let bootstrapped = false;

export function bootstrapProbes(): void {
  if (bootstrapped) return;
  if (listProbes().length === 0) {
    registerProbe(new StaticProbe());
    registerProbe(new MassAssignmentProbe());
    registerProbe(new SecurityProbe());
  }
  bootstrapped = true;
}

/** Test helper — resets the singleton so the next `bootstrapProbes()`
 *  re-registers from scratch. Pair with `clearProbes()` from registry. */
export function resetBootstrap(): void {
  bootstrapped = false;
}
