/**
 * ARV-56: contract tests for the single `recommended_action` producer.
 *
 * Each row asserts what action the classifier returns for a given
 * `ClassifierContext`. The combinations exercised come from the four
 * historical sources of `recommended_action`:
 *
 *   - test failure rows           (db diagnose)
 *   - check findings              (zond checks run)
 *   - probe verdicts              (mass-assignment / security)
 *   - lint issues                 (lint-spec)
 *
 * The point of the suite is not just "given X, expect Y" — it's that
 * removing a switch arm in the classifier file forces a red test,
 * making the contract explicit.
 */
import { describe, test, expect } from "bun:test";

import {
  classify,
  type ClassifierContext,
} from "../../src/core/classifier/recommended-action.ts";
import type { RecommendedAction } from "../../src/core/diagnostics/failure-hints.ts";

interface Row {
  name: string;
  ctx: ClassifierContext;
  expected: RecommendedAction | undefined;
}

const TABLE: Row[] = [
  // ── test:* (db diagnose) ────────────────────────────────────────
  { name: "api_error → report_backend_bug",
    ctx: { finding_class: "test:api_error", status: 500 },
    expected: "report_backend_bug" },
  { name: "api_error ignores generated-source flag",
    ctx: { finding_class: "test:api_error", status: 503, suite_path: "apis/x/tests/y.yaml" },
    expected: "report_backend_bug" },

  { name: "network_error 401 → fix_auth_config",
    ctx: { finding_class: "test:network_error", status: 401 },
    expected: "fix_auth_config" },
  { name: "network_error 403 → fix_auth_config",
    ctx: { finding_class: "test:network_error", status: 403 },
    expected: "fix_auth_config" },
  { name: "network_error other → fix_network_config",
    ctx: { finding_class: "test:network_error", status: 0 },
    expected: "fix_network_config" },
  { name: "network_error null status → fix_network_config",
    ctx: { finding_class: "test:network_error", status: null },
    expected: "fix_network_config" },

  { name: "assertion_failed 401 → fix_auth_config",
    ctx: { finding_class: "test:assertion_failed", status: 401 },
    expected: "fix_auth_config" },
  { name: "assertion_failed plain → fix_test_logic",
    ctx: { finding_class: "test:assertion_failed", status: 200 },
    expected: "fix_test_logic" },
  // ARV-103 (F8): schema-kind assertions are real backend bugs, route to
  // report_backend_bug — same bucket as 5xx. Wins over the
  // generator-aware regenerate_suite default below; otherwise the next
  // `zond generate` would silently re-emit the same broken assertion
  // against the same broken response and the contract bug stays hidden.
  { name: "assertion_failed schema-kind 200 → report_backend_bug",
    ctx: { finding_class: "test:assertion_failed", status: 200, schema_violation: true },
    expected: "report_backend_bug" },
  { name: "assertion_failed schema-kind generated 200 → report_backend_bug (wins over generator override)",
    ctx: { finding_class: "test:assertion_failed", status: 200, schema_violation: true, suite_path: "apis/r/tests/x.yaml" },
    expected: "report_backend_bug" },
  { name: "assertion_failed schema-kind 401 still routes auth (auth wins over schema)",
    ctx: { finding_class: "test:assertion_failed", status: 401, schema_violation: true },
    expected: "fix_auth_config" },
  { name: "assertion_failed generated 404 → fix_fixture",
    ctx: { finding_class: "test:assertion_failed", status: 404, suite_path: "apis/r/tests/x.yaml" },
    expected: "fix_fixture" },
  { name: "assertion_failed generated 400 → regenerate_suite",
    ctx: { finding_class: "test:assertion_failed", status: 400, suite_path: "apis/r/tests/x.yaml" },
    expected: "regenerate_suite" },
  { name: "assertion_failed generated 422 → regenerate_suite",
    ctx: { finding_class: "test:assertion_failed", status: 422, suite_path: "apis/r/tests/x.yaml" },
    expected: "regenerate_suite" },
  { name: "assertion_failed generated 500 → fix_test_logic (5xx isn't fixture/regenerate)",
    ctx: { finding_class: "test:assertion_failed", status: 500, suite_path: "apis/r/tests/x.yaml" },
    expected: "fix_test_logic" },
  { name: "assertion_failed provenance openapi-generated 404 → fix_fixture",
    ctx: { finding_class: "test:assertion_failed", status: 404, provenance: { type: "openapi-generated" } },
    expected: "fix_fixture" },
  { name: "assertion_failed ad-hoc suite 400 → fix_test_logic (not generated)",
    ctx: { finding_class: "test:assertion_failed", status: 400, suite_path: "apis/r/scratch.yaml" },
    expected: "fix_test_logic" },

  // ── check:* (zond checks run) ───────────────────────────────────
  { name: "check:status_code_conformance → fix_spec",
    ctx: { finding_class: "check:status_code_conformance" }, expected: "fix_spec" },
  { name: "check:content_type_conformance → fix_spec",
    ctx: { finding_class: "check:content_type_conformance" }, expected: "fix_spec" },
  { name: "check:response_headers_conformance → fix_spec",
    ctx: { finding_class: "check:response_headers_conformance" }, expected: "fix_spec" },
  { name: "check:response_schema_conformance → fix_spec",
    ctx: { finding_class: "check:response_schema_conformance" }, expected: "fix_spec" },
  { name: "check:not_a_server_error → report_backend_bug",
    ctx: { finding_class: "check:not_a_server_error" }, expected: "report_backend_bug" },
  { name: "check:unsupported_method → report_backend_bug",
    ctx: { finding_class: "check:unsupported_method" }, expected: "report_backend_bug" },
  { name: "check:positive_data_acceptance → report_backend_bug",
    ctx: { finding_class: "check:positive_data_acceptance" }, expected: "report_backend_bug" },
  { name: "check:use_after_free → report_backend_bug",
    ctx: { finding_class: "check:use_after_free" }, expected: "report_backend_bug" },
  { name: "check:ensure_resource_availability → report_backend_bug",
    ctx: { finding_class: "check:ensure_resource_availability" }, expected: "report_backend_bug" },
  { name: "check:cross_call_references → report_backend_bug",
    ctx: { finding_class: "check:cross_call_references" }, expected: "report_backend_bug" },
  { name: "check:idempotency_replay → report_backend_bug",
    ctx: { finding_class: "check:idempotency_replay" }, expected: "report_backend_bug" },
  { name: "check:pagination_invariants → report_backend_bug",
    ctx: { finding_class: "check:pagination_invariants" }, expected: "report_backend_bug" },
  { name: "check:lifecycle_transitions → report_backend_bug",
    ctx: { finding_class: "check:lifecycle_transitions" }, expected: "report_backend_bug" },
  { name: "check:negative_data_rejection → tighten_validation",
    ctx: { finding_class: "check:negative_data_rejection" }, expected: "tighten_validation" },
  { name: "check:missing_required_header → add_required_header",
    ctx: { finding_class: "check:missing_required_header" }, expected: "add_required_header" },
  { name: "check:ignored_auth → fix_auth_config",
    ctx: { finding_class: "check:ignored_auth" }, expected: "fix_auth_config" },
  { name: "check:network_error 401 → fix_auth_config",
    ctx: { finding_class: "check:network_error", status: 401 }, expected: "fix_auth_config" },
  { name: "check:network_error 0 → fix_network_config",
    ctx: { finding_class: "check:network_error", status: 0 }, expected: "fix_network_config" },

  // ── probe:mass_assignment (severity-driven) ─────────────────────
  { name: "probe:mass_assignment high → report_backend_bug",
    ctx: { finding_class: "probe:mass_assignment", severity: "high" },
    expected: "report_backend_bug" },
  { name: "probe:mass_assignment medium → report_backend_bug",
    ctx: { finding_class: "probe:mass_assignment", severity: "medium" },
    expected: "report_backend_bug" },
  { name: "probe:mass_assignment inconclusive-5xx → report_backend_bug",
    ctx: { finding_class: "probe:mass_assignment", severity: "inconclusive-5xx" },
    expected: "report_backend_bug" },
  { name: "probe:mass_assignment inconclusive-baseline → fix_fixture",
    ctx: { finding_class: "probe:mass_assignment", severity: "inconclusive-baseline" },
    expected: "fix_fixture" },
  { name: "probe:mass_assignment low → undefined (no action stamped)",
    ctx: { finding_class: "probe:mass_assignment", severity: "low" },
    expected: undefined },
  { name: "probe:mass_assignment ok → undefined",
    ctx: { finding_class: "probe:mass_assignment", severity: "ok" },
    expected: undefined },
  { name: "probe:mass_assignment skipped → undefined",
    ctx: { finding_class: "probe:mass_assignment", severity: "skipped" },
    expected: undefined },

  // ── probe:security (severity-driven) ────────────────────────────
  { name: "probe:security high → report_backend_bug",
    ctx: { finding_class: "probe:security", severity: "high" },
    expected: "report_backend_bug" },
  { name: "probe:security low → report_backend_bug (TASK-294 policy)",
    ctx: { finding_class: "probe:security", severity: "low" },
    expected: "report_backend_bug" },
  { name: "probe:security medium → undefined (not stamped today)",
    ctx: { finding_class: "probe:security", severity: "medium" },
    expected: undefined },
  { name: "probe:security ok → undefined",
    ctx: { finding_class: "probe:security", severity: "ok" },
    expected: undefined },

  // ── lint:issue ─────────────────────────────────────────────────
  { name: "lint:issue → fix_spec",
    ctx: { finding_class: "lint:issue" }, expected: "fix_spec" },
];

describe("ARV-56: classifier contract table", () => {
  for (const row of TABLE) {
    test(row.name, () => {
      expect(classify(row.ctx)).toBe(row.expected as RecommendedAction);
    });
  }

  test("table covers at least 30 cases", () => {
    expect(TABLE.length).toBeGreaterThanOrEqual(30);
  });
});
