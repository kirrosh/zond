import { describe, test, expect } from "bun:test";
import { lintSpec, defaultConfig, type Issue } from "../../src/core/lint/index.ts";
import { readOpenApiSpec } from "../../src/core/generator/openapi-reader.ts";

const FIXTURES = `${import.meta.dir}/../fixtures`;

function ofRule(issues: Issue[], rule: string): Issue[] {
  return issues.filter(i => i.rule === rule);
}

describe("lint-spec acceptance — petstore (good spec baseline)", () => {
  test("petstore-simple.json has 0 HIGH issues", async () => {
    const doc = await readOpenApiSpec(`${FIXTURES}/petstore-simple.json`);
    const result = lintSpec(doc, defaultConfig());
    const high = result.issues.filter(i => i.severity === "high");
    expect(high).toEqual([]);
  });
});

describe("lint-spec acceptance — bugs-sample (synthetic spec with deliberate bugs)", () => {
  // Distilled from the original Resend benchmark: contains the Postgres-style
  // timestamp regression case, plus path-params/cursors/pagination params with
  // missing constraints — small enough to read at a glance, large enough to
  // exercise multi-rule interactions on real-shaped paths.
  const samplePath = `${FIXTURES}/openapi-bugs-sample.json`;

  test("catches the Postgres-style timestamp via A1", async () => {
    const doc = await readOpenApiSpec(samplePath);
    const a1 = ofRule(lintSpec(doc, defaultConfig()).issues, "A1");
    expect(a1.length).toBeGreaterThanOrEqual(1);
    expect(a1[0]!.severity).toBe("high");
    expect(a1[0]!.message).toContain("2023-10-06:23:47:56.678Z");
    expect(a1[0]!.affects).toContain("run:--validate-schema");
  });

  test("finds ≥10 issues across B1/B3/B4 (RejectedPositiveData class)", async () => {
    const doc = await readOpenApiSpec(samplePath);
    const issues = lintSpec(doc, defaultConfig()).issues;
    const sum = ofRule(issues, "B1").length + ofRule(issues, "B3").length + ofRule(issues, "B4").length;
    expect(sum).toBeGreaterThanOrEqual(10);
  });

  test("every issue carries a non-empty jsonpointer", async () => {
    const doc = await readOpenApiSpec(samplePath);
    for (const i of lintSpec(doc, defaultConfig()).issues) {
      expect(i.jsonpointer.startsWith("/")).toBe(true);
    }
  });

  test("disabling heuristics via --rule !B2,!B5,!B6,!B9 leaves only formal rules", async () => {
    const doc = await readOpenApiSpec(samplePath);
    const cfg = defaultConfig();
    cfg.rules.B2 = "off";
    cfg.rules.B5 = "off";
    cfg.rules.B6 = "off";
    cfg.rules.B9 = "off";
    for (const i of lintSpec(doc, cfg).issues) {
      expect(["B2", "B5", "B6", "B9"]).not.toContain(i.rule);
    }
  });
});
