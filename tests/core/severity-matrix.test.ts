/**
 * Severity matrix regression test (ARV-250, m-21 pivot).
 *
 * Locks the unified severity ladder. If a future change adds or
 * reorders a tier, this test fails loudly.
 */
import { describe, expect, it } from "bun:test";
import {
  emptySeverityBuckets,
  rankSeverity,
  severityToSarifLevel,
  type Severity,
} from "../../src/core/severity/index.ts";

describe("severity ladder", () => {
  it("rank is monotonic — lower number = more severe", () => {
    expect(rankSeverity("critical")).toBeLessThan(rankSeverity("high"));
    expect(rankSeverity("high")).toBeLessThan(rankSeverity("medium"));
    expect(rankSeverity("medium")).toBeLessThan(rankSeverity("low"));
    expect(rankSeverity("low")).toBeLessThan(rankSeverity("info"));
  });

  it("empty buckets cover every tier with zero", () => {
    expect(emptySeverityBuckets()).toEqual({
      critical: 0, high: 0, medium: 0, low: 0, info: 0,
    });
  });
});

describe("SARIF level mapping", () => {
  it("critical and high → error; medium → warning; low and info → note", () => {
    const m: Record<Severity, ReturnType<typeof severityToSarifLevel>> = {
      critical: "error",
      high: "error",
      medium: "warning",
      low: "note",
      info: "note",
    };
    for (const [sev, level] of Object.entries(m) as [Severity, string][]) {
      expect(severityToSarifLevel(sev)).toBe(level as ReturnType<typeof severityToSarifLevel>);
    }
  });
});
