/**
 * Regression fixture-pack (m-15 ARV-4 AC #2). Each JSON file in
 * tests/regression/schemathesis-fps/ encodes a closed schemathesis
 * issue that historically produced a false positive in their
 * data-rejection check. The pack drives `applyGuards` and asserts
 * that the named anti-FP guard kicks in — so no FP can return.
 */
import { describe, test, expect } from "bun:test";
import { readdirSync, readFileSync } from "fs";
import { join } from "path";

import { applyGuards } from "../../src/core/checks/checks/_anti_fp.ts";
import type { CheckCase } from "../../src/core/checks/types.ts";

const FIXTURE_DIR = join(import.meta.dir, "schemathesis-fps");

interface Fixture {
  issue: string;
  summary: string;
  case_meta: Record<string, unknown>;
  content_type: string;
  expected_guard: string;
}

function loadFixtures(): Array<{ name: string; fx: Fixture }> {
  return readdirSync(FIXTURE_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => ({ name: f, fx: JSON.parse(readFileSync(join(FIXTURE_DIR, f), "utf-8")) as Fixture }));
}

function caseFromFixture(fx: Fixture): CheckCase {
  return {
    operation: {
      path: "/x", method: "POST", operationId: "x", summary: undefined, tags: [], parameters: [],
      requestBodySchema: undefined, requestBodyContentType: undefined,
      responseContentTypes: [], responses: [], security: [],
    },
    request: { method: "POST", url: "http://x/x", headers: { "Content-Type": fx.content_type }, body: "{}" },
    mode: "negative",
    kind: "negative_data",
    meta: fx.case_meta,
  };
}

describe("schemathesis FP fixture-pack — every case is suppressed by the named guard", () => {
  const fixtures = loadFixtures();

  test("at least the 6 documented FPs are present", () => {
    const issues = fixtures.map((f) => f.fx.issue);
    expect(issues).toContain("schemathesis#2312");
    expect(issues).toContain("schemathesis#2482");
    expect(issues).toContain("schemathesis#2713");
    expect(issues).toContain("schemathesis#2726");
    expect(issues).toContain("schemathesis#2978");
    expect(issues).toContain("schemathesis#3712");
  });

  for (const { name, fx } of fixtures) {
    test(`${name} — guarded by ${fx.expected_guard}`, () => {
      const skip = applyGuards(caseFromFixture(fx));
      expect(skip).not.toBeNull();
      expect(skip!.guard).toBe(fx.expected_guard);
    });
  }
});
