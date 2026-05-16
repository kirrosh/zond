/**
 * Category taxonomy regression test (ARV-251, m-21 pivot).
 *
 * Locks the four categories and their assignment per registered check /
 * probe class. Refactors that drop a registered id to the "hygiene"
 * fallback would noise-floor the report — this test catches it.
 */
import { describe, expect, it } from "bun:test";
import {
  categoryFor,
  emptyCategoryBuckets,
  CATEGORY_ORDER,
  type Category,
} from "../../src/core/severity/category.ts";

describe("category taxonomy", () => {
  it("has exactly four categories in fixed order", () => {
    expect(CATEGORY_ORDER).toEqual(["security", "reliability", "contract", "hygiene"]);
  });

  it("empty buckets cover every category with zero", () => {
    expect(emptyCategoryBuckets()).toEqual({
      security: 0, reliability: 0, contract: 0, hygiene: 0,
    });
  });

  it("5xx detection lives in reliability — not security, not contract", () => {
    expect(categoryFor("not_a_server_error")).toBe("reliability");
  });

  it("spec-conformance checks live in contract", () => {
    const contractIds = [
      "status_code_conformance",
      "content_type_conformance",
      "response_headers_conformance",
      "response_schema_conformance",
      "missing_required_header",
      "unsupported_method",
      "negative_data_rejection",
      "positive_data_acceptance",
    ];
    for (const id of contractIds) {
      expect(categoryFor(id)).toBe("contract");
    }
  });

  it("m-20 cross-resource probes live in contract", () => {
    const ids = ["cross_call_references", "idempotency_replay", "pagination_invariants", "lifecycle_transitions"];
    for (const id of ids) {
      expect(categoryFor(id)).toBe("contract");
    }
  });

  it("auth / injection probes live in security", () => {
    const ids = [
      "ignored_auth", "use_after_free", "ensure_resource_availability",
      "mass-assignment", "ssrf", "crlf", "xss", "sqli", "open-redirect",
      "path-traversal", "webhooks",
    ];
    for (const id of ids) {
      expect(categoryFor(id)).toBe("security");
    }
  });

  it("unknown ids fall back to hygiene (loud signal that map needs updating)", () => {
    const cat: Category = categoryFor("totally-unknown-id-xyz");
    expect(cat).toBe("hygiene");
  });
});
