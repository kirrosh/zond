/**
 * Unit tests for the SARIF v2.1.0 reporter (m-15 ARV-5).
 *
 * Acceptance:
 *   - schema validity (ajv + draft-04 + bundled SARIF schema)
 *   - deterministic output (same input → byte-identical SARIF JSON)
 *   - stable partialFingerprints across two runs of the same finding
 */
import { describe, test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import Ajv2019 from "ajv-draft-04";

import {
  generateSarifReport,
  ruleIdFor,
  jsonPointerForOperation,
  partialFingerprintFor,
  specHashOf,
} from "../../../src/core/checks/sarif.ts";
import "../../../src/core/checks/checks/index.ts";
import type { CheckFinding } from "../../../src/core/checks/types.ts";

// Trigger built-in registration so tool.driver.rules is populated.
const SARIF_SCHEMA = JSON.parse(
  readFileSync(resolve(import.meta.dir, "../../fixtures/sarif/sarif-schema-2.1.0.json"), "utf8"),
) as Record<string, unknown>;

function findings(): CheckFinding[] {
  return [
    {
      check: "not_a_server_error",
      severity: "high",
      operation: { path: "/widgets", method: "GET", operationId: "listWidgets" },
      request_signature: "GET /widgets",
      response_summary: { status: 500, content_type: "application/json" },
      message: "Server returned 500",
      evidence: { actual: 500 },
    },
    {
      check: "ignored_auth",
      severity: "critical",
      operation: { path: "/users/{id}", method: "GET", operationId: "getUser" },
      request_signature: "GET /users/{id}",
      response_summary: { status: 200 },
      message: "Endpoint accessible without auth",
    },
    {
      check: "negative_data_rejection",
      severity: "medium",
      operation: { path: "/orders", method: "POST", operationId: "createOrder" },
      request_signature: "POST /orders",
      response_summary: { status: 200, content_type: "application/json" },
      message: "Server accepted invalid body",
      evidence: { mutated_field: "qty" },
    },
  ];
}

const SPEC_CONTENT = '{"openapi":"3.0.0","info":{"title":"x","version":"1"},"paths":{}}';

describe("SARIF reporter", () => {
  test("AC#1 — output validates against the SARIF v2.1.0 JSON Schema", () => {
    const ajv = new Ajv2019({ strict: false, allErrors: true });
    const validate = ajv.compile(SARIF_SCHEMA);
    const sarif = generateSarifReport({
      findings: findings(),
      specContent: SPEC_CONTENT,
      toolVersion: "0.0.0-test",
    });
    const ok = validate(sarif);
    if (!ok) {
      const msg = ajv.errorsText(validate.errors, { separator: "\n  " });
      throw new Error(`SARIF validation failed:\n  ${msg}`);
    }
    expect(ok).toBe(true);
  });

  test("AC#2 — three findings emit a stable snapshot", () => {
    const sarif = generateSarifReport({
      findings: findings(),
      specContent: SPEC_CONTENT,
      toolVersion: "0.0.0-test",
      specUri: "spec.json",
    });

    expect(sarif.version).toBe("2.1.0");
    expect(sarif.runs).toHaveLength(1);
    const run = sarif.runs[0]!;
    expect(run.tool.driver.name).toBe("zond");
    expect(run.tool.driver.version).toBe("0.0.0-test");
    expect(run.results).toHaveLength(3);

    // Findings are sorted deterministically by ruleId.
    const ids = run.results.map((r) => r.ruleId);
    expect(ids).toEqual([
      "conformance-not_a_server_error",
      "data-rejection-negative_data_rejection",
      "security-ignored_auth",
    ]);

    expect(run.results[0]!.level).toBe("error");        // high → error
    expect(run.results[1]!.level).toBe("warning");      // medium → warning
    expect(run.results[2]!.level).toBe("error");        // critical → error

    // ruleIndex matches the position in tool.driver.rules.
    for (const r of run.results) {
      const descriptor = run.tool.driver.rules[r.ruleIndex]!;
      expect(descriptor.id).toBe(r.ruleId);
    }

    // jsonPointer escaping: /users/{id} -> /paths/~1users~1{id}/get
    const ignoredAuth = run.results.find((r) => r.ruleId === "security-ignored_auth")!;
    const snippet = ignoredAuth.locations[0]!.physicalLocation.region.snippet.text;
    expect(snippet).toBe("/paths/~1users~1{id}/get");
    expect(ignoredAuth.locations[0]!.logicalLocations[0]!.fullyQualifiedName).toBe(
      "/paths/~1users~1{id}/get",
    );
  });

  test("AC#3 — partialFingerprints.primary is stable across two runs", () => {
    const a = generateSarifReport({
      findings: findings(),
      specContent: SPEC_CONTENT,
      toolVersion: "0.0.0-test",
    });
    const b = generateSarifReport({
      findings: findings(),
      specContent: SPEC_CONTENT,
      toolVersion: "0.0.0-test",
    });
    const fpA = a.runs[0]!.results.map((r) => r.partialFingerprints.primary);
    const fpB = b.runs[0]!.results.map((r) => r.partialFingerprints.primary);
    expect(fpA).toEqual(fpB);
    // Each finding has a unique fingerprint — sanity check that we're
    // not collapsing every result to the same hash.
    expect(new Set(fpA).size).toBe(fpA.length);
  });

  test("AC#3 — fingerprint changes when the spec content changes", () => {
    const a = generateSarifReport({
      findings: findings().slice(0, 1),
      specContent: SPEC_CONTENT,
      toolVersion: "0.0.0-test",
    });
    const b = generateSarifReport({
      findings: findings().slice(0, 1),
      specContent: SPEC_CONTENT + " ",
      toolVersion: "0.0.0-test",
    });
    expect(a.runs[0]!.results[0]!.partialFingerprints.primary).not.toBe(
      b.runs[0]!.results[0]!.partialFingerprints.primary,
    );
  });

  test("ruleId follows <category>-<check_id> form (oasdiff-style)", () => {
    expect(ruleIdFor("not_a_server_error")).toBe("conformance-not_a_server_error");
    expect(ruleIdFor("ignored_auth")).toBe("security-ignored_auth");
    expect(ruleIdFor("negative_data_rejection")).toBe("data-rejection-negative_data_rejection");
  });

  test("partialFingerprintFor is deterministic and key-sensitive", () => {
    const ruleId = "security-ignored_auth";
    const ptr = jsonPointerForOperation("/users/{id}", "GET");
    const hash = specHashOf("openapi:1");
    const fp1 = partialFingerprintFor(ruleId, ptr, hash);
    const fp2 = partialFingerprintFor(ruleId, ptr, hash);
    expect(fp1).toBe(fp2);
    expect(fp1).toMatch(/^[0-9a-f]{40}$/);
    expect(partialFingerprintFor(ruleId, ptr, "different")).not.toBe(fp1);
  });

  test("driver.rules contains all registered checks", () => {
    const sarif = generateSarifReport({
      findings: [],
      specContent: SPEC_CONTENT,
      toolVersion: "0.0.0-test",
    });
    const ids = sarif.runs[0]!.tool.driver.rules.map((r) => r.id);
    // Built-ins from ARV-1..4 — 12 checks. Adding new checks should
    // grow this list but never shrink it.
    expect(ids.length).toBeGreaterThanOrEqual(12);
    expect(ids).toContain("conformance-not_a_server_error");
    expect(ids).toContain("security-ignored_auth");
    expect(ids).toContain("data-rejection-positive_data_acceptance");
  });
});
