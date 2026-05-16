/**
 * Severity matrix regression test (ARV-250, m-21 pivot).
 *
 * Locks the unified severity ladder and the proof-cap rule. If a future
 * change adds a new tier, allows CRITICAL without end-to-end proof, or
 * lets HIGH escape with single-signal proof, this test fails loudly.
 */
import { describe, expect, it } from "bun:test";
import {
  capSeverityByProof,
  emptySeverityBuckets,
  isAtLeast,
  maxSeverity,
  rankSeverity,
  severityToSarifLevel,
  SEVERITY_ORDER,
  type Severity,
} from "../../src/core/severity/index.ts";

describe("severity ladder", () => {
  it("has exactly five tiers in fixed order: critical > high > medium > low > info", () => {
    expect(SEVERITY_ORDER).toEqual(["critical", "high", "medium", "low", "info"]);
  });

  it("rank is monotonic — lower number = more severe", () => {
    expect(rankSeverity("critical")).toBeLessThan(rankSeverity("high"));
    expect(rankSeverity("high")).toBeLessThan(rankSeverity("medium"));
    expect(rankSeverity("medium")).toBeLessThan(rankSeverity("low"));
    expect(rankSeverity("low")).toBeLessThan(rankSeverity("info"));
  });

  it("isAtLeast / maxSeverity behave consistently", () => {
    expect(isAtLeast("high", "medium")).toBe(true);
    expect(isAtLeast("low", "high")).toBe(false);
    expect(maxSeverity(["info", "high", "low"])).toBe("high");
    expect(maxSeverity([])).toBe("info");
  });

  it("empty buckets cover every tier with zero", () => {
    expect(emptySeverityBuckets()).toEqual({
      critical: 0, high: 0, medium: 0, low: 0, info: 0,
    });
  });
});

describe("proof-cap rule (ARV-250)", () => {
  it("static proof caps at info — spec-lint can never escape info tier", () => {
    expect(capSeverityByProof("critical", "static")).toBe("info");
    expect(capSeverityByProof("high", "static")).toBe("info");
    expect(capSeverityByProof("low", "static")).toBe("info");
  });

  it("single_signal proof caps at low — accept-without-confirmation can never reach medium+", () => {
    expect(capSeverityByProof("critical", "single_signal")).toBe("low");
    expect(capSeverityByProof("high", "single_signal")).toBe("low");
    expect(capSeverityByProof("medium", "single_signal")).toBe("low");
    expect(capSeverityByProof("low", "single_signal")).toBe("low");
  });

  it("evidence_chain proof caps at high — chained findings can never reach critical", () => {
    expect(capSeverityByProof("critical", "evidence_chain")).toBe("high");
    expect(capSeverityByProof("high", "evidence_chain")).toBe("high");
    expect(capSeverityByProof("medium", "evidence_chain")).toBe("medium");
    expect(capSeverityByProof("low", "evidence_chain")).toBe("low");
  });

  it("end_to_end proof allows critical — but does not promote below-claim severity", () => {
    expect(capSeverityByProof("critical", "end_to_end")).toBe("critical");
    expect(capSeverityByProof("high", "end_to_end")).toBe("high");
    expect(capSeverityByProof("low", "end_to_end")).toBe("low");
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
