/**
 * ARV-11 AC #1 — unit table that asserts the per-check
 * `recommended_action` mapping. One row per (check id, optional status)
 * → expected action, so a careless edit to the static table surfaces
 * here instead of in a downstream agent's triage logic.
 *
 * AC #2 (envelope), AC #3 (SARIF), AC #4 (skill) live in their own
 * pipeline / sarif tests + the ARV-12 skill follow-up.
 */
import { describe, test, expect } from "bun:test";

import { recommendForCheck, RECOMMENDED_ACTION_TABLE } from "../../../src/core/checks/recommended-action.ts";
import { listChecks } from "../../../src/core/checks/index.ts";
import { listStatefulChecks } from "../../../src/core/checks/stateful.ts";
import { RecommendedActionSchema } from "../../../src/cli/json-schemas.ts";

describe("ARV-11 AC #1: recommended_action table", () => {
  const cases: Array<[string, number | undefined, string | undefined]> = [
    // Spec-contract violations → fix_spec.
    ["status_code_conformance", undefined, "fix_spec"],
    ["content_type_conformance", undefined, "fix_spec"],
    ["response_headers_conformance", undefined, "fix_spec"],
    ["response_schema_conformance", undefined, "fix_spec"],

    // ARV-341: server rejected a body WE generated as valid → our
    // spec/generator drifted from the implementation, not a backend bug.
    ["positive_data_acceptance", 422, "fix_spec"],

    // Backend bugs.
    ["not_a_server_error", 503, "report_backend_bug"],
    ["unsupported_method", 200, "report_backend_bug"],
    ["use_after_free", 200, "report_backend_bug"],
    ["ensure_resource_availability", 404, "report_backend_bug"],
    ["cross_call_references", undefined, "report_backend_bug"],
    ["idempotency_replay", undefined, "report_backend_bug"],
    ["pagination_invariants", undefined, "report_backend_bug"],
    ["lifecycle_transitions", undefined, "report_backend_bug"],

    // Validation gap.
    ["negative_data_rejection", 200, "tighten_validation"],

    // Missing header enforcement.
    ["missing_required_header", 200, "add_required_header"],

    // Auth misconfiguration.
    ["ignored_auth", 200, "fix_auth_config"],

    // Server-side hygiene gap — backend should emit rate-limit metadata
    // on 2xx writes (RFC-9239 / OWASP-API-04). Not a caller-side fix.
    // ARV-304 — was incorrectly mapped to fix_auth_config.
    ["rate_limit_headers_absent", 200, "report_backend_bug"],

    // Network-error pseudo-check — branches on status.
    ["network_error", 0, "fix_network_config"],
    ["network_error", 401, "fix_auth_config"],
    ["network_error", 403, "fix_auth_config"],

    // Unknown check id → undefined (caller leaves the field unset).
    ["totally_made_up_check", undefined, undefined],
  ];

  for (const [check, status, expected] of cases) {
    test(`${check} (status=${status ?? "n/a"}) → ${expected ?? "undefined"}`, () => {
      expect(recommendForCheck(check, status)).toBe(expected as never);
    });
  }

  test("every action emitted is a valid enum value", () => {
    for (const action of Object.values(RECOMMENDED_ACTION_TABLE)) {
      expect(RecommendedActionSchema.safeParse(action).success).toBe(true);
    }
    // Plus the dynamic ones from network_error.
    for (const status of [0, 401, 403]) {
      const got = recommendForCheck("network_error", status);
      expect(RecommendedActionSchema.safeParse(got).success).toBe(true);
    }
  });

  test("every registered check has a row in the table", () => {
    // If a new check ships without a row, the agent triage logic for
    // that finding silently degrades to `recommended_action: undefined`
    // — surface it here so the table is kept current.
    const ids = [...listChecks(), ...listStatefulChecks()].map((c) => c.id);
    for (const id of ids) {
      expect(recommendForCheck(id)).toBeDefined();
    }
  });
});

describe("ARV-324: unresolved_fixture downgrades report_backend_bug → fix_fixture", () => {
  const downgradable = [
    "unsupported_method",
    "use_after_free",
    "ensure_resource_availability",
    "cross_call_references",
    "idempotency_replay",
    "pagination_invariants",
    "lifecycle_transitions",
    "cursor_boundary_fuzzing",
  ];

  for (const check of downgradable) {
    test(`${check}: unresolved_fixture=true → fix_fixture`, () => {
      expect(recommendForCheck(check, 400, true)).toBe("fix_fixture");
    });
    test(`${check}: unresolved_fixture=false/undefined → report_backend_bug (unchanged)`, () => {
      expect(recommendForCheck(check, 400, false)).toBe("report_backend_bug");
      expect(recommendForCheck(check, 400)).toBe("report_backend_bug");
    });
  }

  // ARV-341: positive_data_acceptance keeps the ARV-324 fixture downgrade
  // but its default is fix_spec (self-generated body rejected), not
  // report_backend_bug.
  test("positive_data_acceptance: unresolved_fixture=true → fix_fixture", () => {
    expect(recommendForCheck("positive_data_acceptance", 400, true)).toBe("fix_fixture");
  });
  test("positive_data_acceptance: unresolved_fixture=false/undefined → fix_spec", () => {
    expect(recommendForCheck("positive_data_acceptance", 400, false)).toBe("fix_spec");
    expect(recommendForCheck("positive_data_acceptance", 400)).toBe("fix_spec");
  });

  test("not_a_server_error stays report_backend_bug even when unresolved_fixture=true (a 5xx is always worth flagging)", () => {
    expect(recommendForCheck("not_a_server_error", 500, true)).toBe("report_backend_bug");
  });
});
