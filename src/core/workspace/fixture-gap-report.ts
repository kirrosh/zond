/**
 * ARV-349/350: deterministic fixture-gap report for `prepare-fixtures`.
 *
 * prepare-fixtures is a single-pass discover (ARV-336 removed the autonomous
 * seed engine). It fills FK ids it can resolve from list endpoints, but it
 * used to neither fill NOR flag two other classes of gap, so suites ran with
 * unresolved placeholders and produced noisy 400/404s:
 *
 *   - undefinedVars (ARV-349): a suite references {{bank_code}} / {{tax_id}}
 *     that nothing produces — not an env value, not a prior-step capture, not
 *     a manifest entry. The user / agent must supply it.
 *   - unseededRoots (ARV-350): a REQUIRED manifest var (e.g. {{account}}) that
 *     is empty in env, referenced by a suite, and captured by no step — the
 *     dependency-chain HEAD that gates dependent CRUD suites (persons-crud,
 *     external_accounts-crud all skip: "required fixture {{account}} is empty").
 *     Source-agnostic on purpose: real manifests model this root as `path`
 *     required:true with an empty default, not necessarily `capture-chain`.
 *
 * REPORT ONLY — never invents a value (ARV-349 #2) and never auto-seeds
 * (ARV-350 #2). Deterministic (same suites+env+manifest → same report), so it
 * belongs in zond; supplying the values is the agent's/user's job.
 */

import type { TestSuite } from "../parser/types.ts";
import {
  preflightCheckVars,
  collectCapturesAndSets,
  collectStepRefs,
} from "../runner/preflight-vars.ts";

export interface FixtureGapReport {
  /** Suite {{vars}} with no producer (not env, capture, param, or generator). */
  undefinedVars: { variable: string; refs: number; suites: string[] }[];
  /** Required manifest vars that are empty, suite-referenced, and step-unseeded. */
  unseededRoots: { variable: string }[];
}

export function reportFixtureGaps(
  suites: TestSuite[],
  env: Record<string, string>,
  requiredEmptyVars: Set<string>,
): FixtureGapReport {
  // Match runtime capture scoping: only `setup: true` suites share their
  // captures into other suites (TestSuite.setup); a regular suite's captures
  // stay local to itself. So a var is "seeded" for suite S iff env holds it,
  // a setup suite captures it, or S itself captures it.
  const setupProduced = new Set<string>();
  for (const suite of suites) {
    if (!suite.setup) continue;
    for (const step of suite.tests) collectCapturesAndSets(step, setupProduced);
  }

  // Unseeded root = required + empty in env + SOME referencing suite cannot
  // produce it (not a setup capture, not captured within that suite). This
  // catches cross-suite roots like {{account}}: crud-accounts creates it, but
  // persons-crud references it without a create → that suite skips at runtime.
  const rootSet = new Set<string>();
  for (const suite of suites) {
    const seeded = new Set<string>(setupProduced);
    for (const step of suite.tests) collectCapturesAndSets(step, seeded);
    for (const step of suite.tests) {
      for (const v of collectStepRefs(step)) {
        if (requiredEmptyVars.has(v) && !seeded.has(v)) rootSet.add(v);
      }
    }
  }
  const unseededRoots = [...rootSet].sort().map(variable => ({ variable }));

  // Undefined vars = preflight hits, minus the roots we already called out
  // (a root absent from env would otherwise land in both buckets).
  const byVar = new Map<string, { refs: number; suites: Set<string> }>();
  for (const h of preflightCheckVars(suites, env)) {
    if (rootSet.has(h.variable)) continue;
    let e = byVar.get(h.variable);
    if (!e) { e = { refs: 0, suites: new Set() }; byVar.set(h.variable, e); }
    e.refs++;
    e.suites.add(h.suite);
  }
  const undefinedVars = [...byVar.entries()]
    .map(([variable, e]) => ({ variable, refs: e.refs, suites: [...e.suites].sort() }))
    .sort((a, b) => a.variable.localeCompare(b.variable));

  return { undefinedVars, unseededRoots };
}
