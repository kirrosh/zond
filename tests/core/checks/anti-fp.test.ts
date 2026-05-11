/**
 * Per-guard unit tables for the data-rejection anti-FP layer
 * (m-15 ARV-4 AC #3). One describe-block per guard, each holding a
 * table of [scenario → expected skip|null].
 */
import { describe, test, expect } from "bun:test";

import {
  bodyNegationBecomesValidAfterSerialization,
  stringTypeMutationBecomesValidAfterSerialization,
  hasUnverifiableMutations,
  applyGuards,
} from "../../../src/core/checks/checks/_anti_fp.ts";
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

describe("guard #1 — _body_negation_becomes_valid_after_serialization", () => {
  test("form-encoded drop_required → skip", () => {
    const r = bodyNegationBecomesValidAfterSerialization(
      caseWith({ mutation: "drop_required", field_path: "name" }, "application/x-www-form-urlencoded"),
    );
    expect(r?.guard).toBe("_body_negation_becomes_valid_after_serialization");
  });
  test("multipart constraint_violation → skip", () => {
    const r = bodyNegationBecomesValidAfterSerialization(
      caseWith({ mutation: "constraint_violation", field_path: "qty", constraint: "minimum" }, "multipart/form-data; boundary=xxx"),
    );
    expect(r?.guard).toBe("_body_negation_becomes_valid_after_serialization");
  });
  test("json drop_required → no skip (json doesn't re-validate)", () => {
    const r = bodyNegationBecomesValidAfterSerialization(
      caseWith({ mutation: "drop_required", field_path: "name" }, "application/json"),
    );
    expect(r).toBeNull();
  });
  test("form-encoded type_mutation → no skip (different guard handles this)", () => {
    const r = bodyNegationBecomesValidAfterSerialization(
      caseWith({ mutation: "type_mutation", field_path: "x" }, "application/x-www-form-urlencoded"),
    );
    expect(r).toBeNull();
  });
});

describe("guard #2 — _string_type_mutation_becomes_valid_after_serialization", () => {
  test("integer→\"42\" coerces back → skip", () => {
    const r = stringTypeMutationBecomesValidAfterSerialization(
      caseWith({
        mutation: "type_mutation", field_path: "qty",
        from_type: "integer", to_type: "string", to_value: "42",
      }),
    );
    expect(r?.guard).toMatch(/string_type_mutation/);
  });
  test("integer→\"abc\" doesn't coerce → no skip", () => {
    const r = stringTypeMutationBecomesValidAfterSerialization(
      caseWith({
        mutation: "type_mutation", field_path: "qty",
        from_type: "integer", to_type: "string", to_value: "abc",
      }),
    );
    expect(r).toBeNull();
  });
  test("boolean→\"true\" coerces back → skip", () => {
    const r = stringTypeMutationBecomesValidAfterSerialization(
      caseWith({
        mutation: "type_mutation", field_path: "active",
        from_type: "boolean", to_type: "string", to_value: "true",
      }),
    );
    expect(r?.guard).toMatch(/string_type_mutation/);
  });
  test("string→object → no skip (not a coercible mutation)", () => {
    const r = stringTypeMutationBecomesValidAfterSerialization(
      caseWith({
        mutation: "type_mutation", field_path: "name",
        from_type: "string", to_type: "object", to_value: { x: 1 },
      }),
    );
    expect(r).toBeNull();
  });
});

describe("guard #3 — _has_unverifiable_mutations", () => {
  test("mutation_count=2 → skip", () => {
    const r = hasUnverifiableMutations(caseWith({ mutation_count: 2 }));
    expect(r?.guard).toBe("_has_unverifiable_mutations");
  });
  test("mutation_count=1 → no skip", () => {
    expect(hasUnverifiableMutations(caseWith({ mutation_count: 1 }))).toBeNull();
  });
  test("no mutation_count → no skip", () => {
    expect(hasUnverifiableMutations(caseWith({}))).toBeNull();
  });
});

describe("guard #4 — _coverage_phase_boundary_positive (ARV-77 / F20)", () => {
  // Lazy-import to avoid touching the original module header.
  const mod = require("../../../src/core/checks/checks/_anti_fp.ts") as typeof import("../../../src/core/checks/checks/_anti_fp.ts");
  const guard = mod.coveragePhaseBoundaryPositive;

  function positiveCoverageCase(): CheckCase {
    const c = caseWith({ phase: "coverage", boundary: "max-length" });
    c.kind = "positive";
    c.mode = "positive";
    return c;
  }

  test("phase=coverage + kind=positive → skip (boundary body is synthetic)", () => {
    const r = guard(positiveCoverageCase());
    expect(r?.guard).toBe("_coverage_phase_boundary_positive");
  });

  test("phase=coverage + kind=negative_data → no skip (handled by negative_data_rejection guards)", () => {
    const c = positiveCoverageCase();
    c.kind = "negative_data";
    c.mode = "negative";
    expect(guard(c)).toBeNull();
  });

  test("phase=examples + kind=positive → no skip (examples are realistic, real 422 is signal)", () => {
    const c = positiveCoverageCase();
    c.meta = { phase: "examples" };
    expect(guard(c)).toBeNull();
  });

  test("no phase meta → no skip (legacy code path stays put)", () => {
    const c = positiveCoverageCase();
    c.meta = undefined;
    expect(guard(c)).toBeNull();
  });
});

describe("applyGuards composition", () => {
  test("returns first matching skip", () => {
    const r = applyGuards(caseWith(
      { mutation: "drop_required", field_path: "name", mutation_count: 2 },
      "application/x-www-form-urlencoded",
    ));
    // Guard #1 fires first.
    expect(r?.guard).toBe("_body_negation_becomes_valid_after_serialization");
  });
  test("returns null when no guard fires", () => {
    expect(applyGuards(caseWith({ mutation: "drop_required", field_path: "name" }, "application/json"))).toBeNull();
  });
});
