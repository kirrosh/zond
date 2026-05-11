/**
 * ARV-123 (m-19): in-process registry for anti-FP rules.
 *
 * Module-level mutable state on purpose — rules are registered at
 * bootstrap time (similar to `core/probe/bootstrap.ts`) and read by
 * checks/probes during a run. `reset()` exists for tests; production
 * code never calls it.
 */
import type { FpRule, FpScope, FpSuppression } from "./types.ts";

const rules = new Map<string, FpRule<unknown>>();

/** Register a rule. Re-registering with the same `id` replaces the
 *  prior entry — this keeps test setups simple (swap in a stub) and
 *  matches how the probe-bootstrap pattern handles dedup. */
export function register<Ctx>(rule: FpRule<Ctx>): void {
  rules.set(rule.id, rule as FpRule<unknown>);
}

/** Lookup by id. Used mostly by tests and the `list` filter. */
export function get(id: string): FpRule<unknown> | undefined {
  return rules.get(id);
}

/** List rules in registration order. Optional scope filter keeps the
 *  hot path (checks/probes) from re-implementing the scope-match
 *  predicate. Pass a `scope` like `"check:positive_data_acceptance"`
 *  to get only rules that declared that scope. */
export function list(scope?: FpScope): FpRule<unknown>[] {
  const all = Array.from(rules.values());
  if (!scope) return all;
  return all.filter(r => matchesScope(r, scope));
}

/** Drop every registered rule. Call only from test setup. */
export function reset(): void {
  rules.clear();
}

export function matchesScope(rule: FpRule<unknown>, scope: FpScope): boolean {
  if (Array.isArray(rule.scope)) return rule.scope.includes(scope);
  return rule.scope === scope;
}

