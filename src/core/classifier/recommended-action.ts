/**
 * ARV-56: single producer of `recommended_action` across every source
 * that emits findings — run results (`db diagnose`), spec lint
 * (`lint-spec.Issue`), probe-security findings, probe-mass-assignment
 * verdicts, and conformance checks (`zond checks run`).
 *
 * Before this module, "what action does an agent take?" was answered in
 * five different places:
 *   - `recommendedAction` / `recommendedActionForGenerated`     (db-analysis)
 *   - `recommendForCheck`                                       (checks runner)
 *   - `stampRecommendedAction` (mass-assignment) + per-severity policy
 *   - `stampAction`            (security) + per-severity policy
 *   - inline `"fix_spec"` literal                               (lint)
 *
 * Each accumulated branches independently — ARV-11 added per-check
 * actions, ARV-42 added a generator-aware override, TASK-294 layered
 * probe severity mappings, the env-issue detector then overrode the
 * result of all of them. By the time ARV-56 landed, the same logical
 * question — "given this finding, what should the agent do?" — had four
 * different entry points with subtle drift.
 *
 * This file owns that question. Every producer hands the classifier a
 * `ClassifierContext` (a frozen description of the finding) and gets
 * back a `RecommendedAction`. The classifier is **pure** — no I/O, no
 * config reads, no side effects — so it can be table-tested.
 *
 * The thin wrappers (`recommendedAction`, `recommendedActionForGenerated`,
 * `recommendForCheck`, `stampRecommendedAction`, `stampAction`) now
 * delegate here instead of carrying their own switches. Removing a
 * branch means editing one switch in this file.
 */

import type { RecommendedAction } from "../diagnostics/failure-hints.ts";
import type { RunKind } from "../runner/run-kind.ts";

export type FindingClass =
  // db-analysis run-result rows ────────────────────────────────────
  | "test:network_error"
  | "test:api_error"
  | "test:assertion_failed"

  // checks/<id>  ────────────────────────────────────────────────────
  | "check:status_code_conformance"
  | "check:content_type_conformance"
  | "check:response_headers_conformance"
  | "check:response_schema_conformance"
  | "check:not_a_server_error"
  | "check:unsupported_method"
  | "check:positive_data_acceptance"
  | "check:use_after_free"
  | "check:ensure_resource_availability"
  | "check:negative_data_rejection"
  | "check:missing_required_header"
  | "check:ignored_auth"
  | "check:cross_call_references"
  | "check:network_error"

  // probe verdicts (severity already classified upstream) ───────────
  | "probe:mass_assignment"
  | "probe:security"

  // lint-spec ───────────────────────────────────────────────────────
  | "lint:issue";

/** Optional severity hint — probe families surface a 5-level enum;
 *  here we only care about the buckets the action mapping branches on. */
export type FindingSeverity =
  | "high"
  | "medium"
  | "inconclusive-5xx"
  | "inconclusive-baseline"
  | "low"
  | "ok"
  | "skipped";

export interface ClassifierContext {
  finding_class: FindingClass;
  /** HTTP status code observed for the finding, when applicable.
   *  null/undefined means "unknown / not relevant". */
  status?: number | null;
  /** Severity already assigned by the probe layer (mass-assignment /
   *  security). The classifier reads it instead of re-deriving from
   *  status — severity captures multi-step reasoning (baseline + attack
   *  + follow-up GET) that status alone can't recover. */
  severity?: FindingSeverity;
  /** Run kind for the finding's parent run — currently informational; the
   *  classifier may consult it in the future to e.g. downgrade probe-run
   *  signal. Captured now so the contract is forward-compatible. */
  run_kind?: RunKind;
  /** Provenance of the failing test (only relevant for test:* classes). */
  provenance?: { type?: string; generator?: string } | null;
  /** Suite path used to detect generator-emitted tests. */
  suite_path?: string | null;
  /** When the env-issue detector flagged the suite, it overrides the
   *  classifier's default. Producers set this *after* clustering. */
  baseline_status?: number | null;
  /** ARV-103 (F8): true when at least one assertion on the failing step
   *  has `kind: "schema"`. Schema violations are real contract bugs — per
   *  zond/SKILL.md L376-377 they should route to report_backend_bug, not
   *  fix_test_logic. Producers (db-analysis) set this after walking the
   *  step's assertions array. */
  schema_violation?: boolean;
}

/**
 * Decide the action for a finding. Returns `undefined` only for finding
 * classes that intentionally don't carry an action (e.g. severity:low
 * security findings — the producer should leave the field unset rather
 * than coerce a value).
 */
export function classify(ctx: ClassifierContext): RecommendedAction | undefined {
  switch (ctx.finding_class) {
    // ── Run-result rows (db diagnose) ───────────────────────────────
    case "test:api_error":
      return "report_backend_bug";

    case "test:network_error":
      if (ctx.status === 401 || ctx.status === 403) return "fix_auth_config";
      return "fix_network_config";

    case "test:assertion_failed": {
      // 401/403 → auth always wins.
      if (ctx.status === 401 || ctx.status === 403) return "fix_auth_config";
      // ARV-103 (F8): schema-kind assertions are real contract bugs (the
      // server returned a body that violates its own spec). Route to
      // report_backend_bug — same bucket as 5xx. Skill (zond/SKILL.md
      // L376-377) explicitly says "treat them like 5xx, do not edit the
      // expectation away". Wins over the generator-aware override below
      // because regenerate_suite would silently re-emit the same broken
      // assertion against the same broken response.
      if (ctx.schema_violation) return "report_backend_bug";
      // ARV-42: generator-emitted suites get a different default — editing
      // the YAML gets clobbered on the next `zond audit`.
      const generated = isGeneratedSource(ctx.provenance, ctx.suite_path);
      if (generated) {
        if (ctx.status === 404) return "fix_fixture";
        if (ctx.status === 400 || ctx.status === 422) return "regenerate_suite";
      }
      return "fix_test_logic";
    }

    // ── checks/<id> ────────────────────────────────────────────────
    case "check:status_code_conformance":
    case "check:content_type_conformance":
    case "check:response_headers_conformance":
    case "check:response_schema_conformance":
      return "fix_spec";

    case "check:not_a_server_error":
    case "check:unsupported_method":
    case "check:positive_data_acceptance":
    case "check:use_after_free":
    case "check:ensure_resource_availability":
    case "check:cross_call_references":
      return "report_backend_bug";

    case "check:negative_data_rejection":
      return "tighten_validation";

    case "check:missing_required_header":
      return "add_required_header";

    case "check:ignored_auth":
      return "fix_auth_config";

    case "check:network_error":
      if (ctx.status === 401 || ctx.status === 403) return "fix_auth_config";
      return "fix_network_config";

    // ── Probe verdicts ─────────────────────────────────────────────
    case "probe:mass_assignment":
      switch (ctx.severity) {
        case "high":
        case "medium":
        case "inconclusive-5xx":
          return "report_backend_bug";
        case "inconclusive-baseline":
          return "fix_fixture";
        default:
          return undefined; // low / ok / skipped: no action
      }

    case "probe:security":
      // TASK-294 policy: high/low both routed to backend-bug. Low is
      // "server returned 2xx without echoing the payload" — still a
      // surprising acceptance the backend should review.
      if (ctx.severity === "high" || ctx.severity === "low") {
        return "report_backend_bug";
      }
      return undefined;

    // ── Lint findings ─────────────────────────────────────────────
    case "lint:issue":
      return "fix_spec";
  }
}

function isGeneratedSource(
  provenance: ClassifierContext["provenance"],
  suite_path: ClassifierContext["suite_path"],
): boolean {
  if (provenance?.type === "openapi-generated") return true;
  if (provenance?.generator && provenance.generator.toLowerCase().includes("zond")) return true;
  if (typeof suite_path === "string" && /(^|\/)apis\/[^/]+\/tests\//.test(suite_path)) return true;
  return false;
}
