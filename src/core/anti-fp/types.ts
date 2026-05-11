/**
 * ARV-123 (m-19): typed registry for anti-FP guards.
 *
 * Background: anti-FP logic is scattered across the codebase —
 *   - `core/checks/checks/_anti_fp.ts` ships 4 schemathesis-attributed
 *     guards for the data-rejection family;
 *   - `core/probe/mass-assignment-probe.ts` carries inline regex
 *     suppressions (paid-plan / subscription / scope-gating);
 *   - `core/probe/security-probe.ts` does a baseline-echo / boundary
 *     check inline.
 *
 * They share the same shape — "given a finding plus its context, return
 * a structured suppression with attribution" — but each has its own
 * ad-hoc API, which makes it hard to (a) discover the full set, (b)
 * attribute a suppression to its source (schemathesis #N, Sentry
 * plan-limit doc, etc.), and (c) test rules in isolation.
 *
 * This module gives them a common contract. Migration of existing rules
 * lives in ARV-124/125/126 — this task only ships the registry.
 */

/**
 * Scope identifies the family of checks/probes a rule applies to.
 * Convention: `<kind>:<name>`. Examples:
 *   - `check:negative_data_rejection` / `check:positive_data_acceptance`
 *   - `probe:mass-assignment`
 *   - `probe:security` (baseline-echo / boundary)
 *
 * A rule may declare a single scope or an array of scopes. `applyAntiFp`
 * filters the registry by the caller's scope before running rules, so
 * a mass-assignment-only rule never gets evaluated against a data
 * rejection finding.
 */
export type FpScope = string;

export interface FpRule<Ctx = unknown> {
  /** Stable identifier — used for dedup, logs, and downstream
   *  attribution. Convention mirrors schemathesis: snake_case prefixed
   *  with the family (`_body_negation_becomes_valid_after_serialization`).
   *  Last-writer wins on re-register, so test setups can swap rules. */
  id: string;
  /** Single scope or set of scopes this rule covers. */
  scope: FpScope | FpScope[];
  /** Decide whether the rule fires for a given context. Return a
   *  populated suppression to claim the finding, or null to pass. */
  applies(ctx: Ctx): FpSuppression | null;
  /** Static reason used when the rule's logic just wants to flag the
   *  context without composing a runtime string. Optional — most rules
   *  prefer to build a context-specific reason inside `applies`. */
  reason?: string;
  /** Backing evidence — schemathesis issue numbers, Sentry docs, etc.
   *  Surfaced verbatim in the suppression so an agent reading the
   *  output can locate the upstream debate. */
  references?: string[];
}

export interface FpSuppression {
  /** The rule that fired. */
  ruleId: string;
  /** The scope under which the rule fired (resolved scope, not the
   *  rule's declared scope set). */
  scope: FpScope;
  /** Human-readable reason. Built by the rule's `applies` function. */
  reason: string;
  /** Copied through from the rule definition unless the rule overrode
   *  it inside `applies`. */
  references?: string[];
}
