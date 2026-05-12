/**
 * ARV-124: per-rule unit tables for the schemathesis-attributed
 * anti-FP layer. Pre-ARV-124 the rules lived in
 * `src/core/checks/checks/_anti_fp.ts`; they now live in
 * `src/core/anti-fp/rules/schemathesis/` and are reached via the
 * shared registry. The data-rejection-case behaviour these tests
 * cover is otherwise unchanged.
 */
import { describe, test, expect, beforeAll } from "bun:test";

import {
  bootstrapAntiFp,
  resetAntiFpBootstrap,
} from "../../../src/core/anti-fp/bootstrap.ts";
import { applyAntiFp } from "../../../src/core/anti-fp/index.ts";
import {
  bodyNegationBecomesValidRule,
  stringTypeMutationBecomesValidRule,
  hasUnverifiableMutationsRule,
  coveragePhaseBoundaryPositiveRule,
} from "../../../src/core/anti-fp/rules/schemathesis/index.ts";
import type { CheckCase } from "../../../src/core/checks/types.ts";

function caseWith(meta: Record<string, unknown>, contentType?: string): CheckCase {
  return {
    operation: {
      path: "/x", method: "POST", operationId: "x", summary: undefined, tags: [], parameters: [],
      requestBodySchema: undefined, requestBodyContentType: undefined,
      responseContentTypes: [], responses: [], security: [],
    },
    request: { method: "POST", url: "http://x/x", headers: contentType ? { "Content-Type": contentType } : {}, body: "{}" },
    mode: "negative",
    kind: "negative_data",
    meta,
  };
}

beforeAll(() => {
  resetAntiFpBootstrap();
  bootstrapAntiFp();
});

describe("rule #1 — _body_negation_becomes_valid_after_serialization", () => {
  test("form-encoded drop_required → skip", () => {
    const r = bodyNegationBecomesValidRule.applies(
      caseWith({ mutation: "drop_required", field_path: "name" }, "application/x-www-form-urlencoded"),
    );
    expect(r?.ruleId).toBe("_body_negation_becomes_valid_after_serialization");
  });
  test("multipart constraint_violation → skip", () => {
    const r = bodyNegationBecomesValidRule.applies(
      caseWith({ mutation: "constraint_violation", field_path: "qty", constraint: "minimum" }, "multipart/form-data; boundary=xxx"),
    );
    expect(r?.ruleId).toBe("_body_negation_becomes_valid_after_serialization");
  });
  test("application/json drop_required → no skip", () => {
    expect(
      bodyNegationBecomesValidRule.applies(
        caseWith({ mutation: "drop_required", field_path: "name" }, "application/json"),
      ),
    ).toBeNull();
  });
  test("form-encoded type_mutation → no skip (this guard is drop/constraint only)", () => {
    expect(
      bodyNegationBecomesValidRule.applies(
        caseWith({ mutation: "type_mutation", from_type: "integer", to_type: "string", to_value: "42" }, "application/x-www-form-urlencoded"),
      ),
    ).toBeNull();
  });
});

describe("rule #2 — _string_type_mutation_becomes_valid_after_serialization", () => {
  test("integer→string numeric → skip", () => {
    expect(
      stringTypeMutationBecomesValidRule.applies(
        caseWith({ mutation: "type_mutation", from_type: "integer", to_type: "string", to_value: "42" }),
      )?.ruleId,
    ).toBe("_string_type_mutation_becomes_valid_after_serialization");
  });
  test("number→string numeric → skip", () => {
    expect(
      stringTypeMutationBecomesValidRule.applies(
        caseWith({ mutation: "type_mutation", from_type: "number", to_type: "string", to_value: "1.5" }),
      )?.ruleId,
    ).toBe("_string_type_mutation_becomes_valid_after_serialization");
  });
  test("boolean→string \"true\" → skip", () => {
    expect(
      stringTypeMutationBecomesValidRule.applies(
        caseWith({ mutation: "type_mutation", from_type: "boolean", to_type: "string", to_value: "true" }),
      )?.ruleId,
    ).toBe("_string_type_mutation_becomes_valid_after_serialization");
  });
  test("integer→string non-numeric → no skip", () => {
    expect(
      stringTypeMutationBecomesValidRule.applies(
        caseWith({ mutation: "type_mutation", from_type: "integer", to_type: "string", to_value: "hello" }),
      ),
    ).toBeNull();
  });
  test("non type-mutation → no skip", () => {
    expect(
      stringTypeMutationBecomesValidRule.applies(
        caseWith({ mutation: "drop_required", field_path: "x" }),
      ),
    ).toBeNull();
  });
});

describe("rule #3 — _has_unverifiable_mutations", () => {
  test("mutation_count=2 → skip", () => {
    expect(hasUnverifiableMutationsRule.applies(caseWith({ mutation_count: 2 }))?.ruleId).toBe("_has_unverifiable_mutations");
  });
  test("mutation_count=1 → no skip", () => {
    expect(hasUnverifiableMutationsRule.applies(caseWith({ mutation_count: 1 }))).toBeNull();
  });
  test("no mutation_count → no skip", () => {
    expect(hasUnverifiableMutationsRule.applies(caseWith({}))).toBeNull();
  });
});

describe("rule #4 — _coverage_phase_boundary_positive (ARV-77 / F20)", () => {
  function positiveCoverageCase(): CheckCase {
    const c = caseWith({ phase: "coverage", boundary: "max-length" });
    c.kind = "positive";
    c.mode = "positive";
    return c;
  }

  test("phase=coverage + kind=positive → skip (boundary body is synthetic)", () => {
    const r = coveragePhaseBoundaryPositiveRule.applies(positiveCoverageCase());
    expect(r?.ruleId).toBe("_coverage_phase_boundary_positive");
  });

  test("phase=coverage + kind=negative_data → no skip (handled by data-rejection guards)", () => {
    const c = positiveCoverageCase();
    c.kind = "negative_data";
    c.mode = "negative";
    expect(coveragePhaseBoundaryPositiveRule.applies(c)).toBeNull();
  });

  test("phase=examples + kind=positive → no skip (examples are realistic, real 422 is signal)", () => {
    const c = positiveCoverageCase();
    c.meta = { phase: "examples" };
    expect(coveragePhaseBoundaryPositiveRule.applies(c)).toBeNull();
  });

  test("no phase meta → no skip (legacy code path stays put)", () => {
    const c = positiveCoverageCase();
    c.meta = undefined;
    expect(coveragePhaseBoundaryPositiveRule.applies(c)).toBeNull();
  });
});

describe("applyAntiFp composition", () => {
  test("returns the first matching suppression on the negative-data scope", () => {
    const r = applyAntiFp(
      caseWith(
        { mutation: "drop_required", field_path: "name", mutation_count: 2 },
        "application/x-www-form-urlencoded",
      ),
      "check:negative_data_rejection",
    );
    // Rule #1 fires first.
    expect(r?.ruleId).toBe("_body_negation_becomes_valid_after_serialization");
  });
  test("returns null when no rule fires", () => {
    expect(
      applyAntiFp(
        caseWith({ mutation: "drop_required", field_path: "name" }, "application/json"),
        "check:negative_data_rejection",
      ),
    ).toBeNull();
  });
  test("scope filtering — positive-only rules are not consulted on the negative-data scope", () => {
    const c: CheckCase = caseWith({ phase: "coverage" });
    c.kind = "positive";
    c.mode = "positive";
    // coverage-phase rule's scope is "check:positive_data_acceptance" — must
    // not fire here.
    expect(applyAntiFp(c, "check:negative_data_rejection")).toBeNull();
  });
});
