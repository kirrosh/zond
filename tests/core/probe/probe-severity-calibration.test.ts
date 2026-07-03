/**
 * ARV-300: probe findings pass through the severity calibrator, and the
 * verdict rollup is recomputed after suppression. Covers AC#2 (sentinel
 * round-trip) + AC#3 (`when.finding.check: ssrf` suppresses).
 */
import { describe, expect, it } from "bun:test";

import { mergeConfigs } from "../../../src/core/severity/config.ts";
import { calibrateProbeSeverity } from "../../../src/core/severity/probe-adapter.ts";
import { rollupSecuritySeverity } from "../../../src/core/probe/security/orchestrator.ts";
import type { SecurityFinding } from "../../../src/core/probe/security/types.ts";

const SSRF_SUPPRESS = mergeConfigs([
  {
    source: "test.yaml",
    config: {
      version: 1,
      suppressions: [
        {
          check: "ssrf",
          reason: "known SSRF false-positive on Stripe sandbox",
          when: { "response.status": 200 },
        },
      ],
    },
  },
]);

function finding(sev: SecurityFinding["severity"], cls: SecurityFinding["class"], status: number): SecurityFinding {
  return { field: "url", class: cls, payload: "http://x", status, echoed: false, severity: sev, reason: "r" };
}

describe("calibrateProbeSeverity", () => {
  it("AC#3: suppresses a matching ssrf finding to info + trace", () => {
    const r = calibrateProbeSeverity(
      {
        check: "ssrf",
        severity: "high",
        context: {
          finding: { check: "ssrf" },
          operation: { method: "POST", path: "/x" },
          response: { status: 200, headers: {} },
        },
      },
      SSRF_SUPPRESS,
    );
    expect(r.severity).toBe("info");
    expect(r.suppressed).toBe(true);
    expect(r.suppressed_by?.reason).toContain("false-positive");
  });

  it("does not suppress a different class under the same status", () => {
    const r = calibrateProbeSeverity(
      {
        check: "crlf",
        severity: "high",
        context: {
          finding: { check: "crlf" },
          operation: { method: "POST", path: "/x" },
          response: { status: 200, headers: {} },
        },
      },
      SSRF_SUPPRESS,
    );
    expect(r.severity).toBe("high");
    expect(r.suppressed).toBe(false);
  });

  it("AC#2: sentinel severities round-trip untouched even with config", () => {
    for (const sentinel of ["inconclusive", "inconclusive-baseline", "ok", "skipped"] as const) {
      const r = calibrateProbeSeverity(
        {
          check: "ssrf",
          severity: sentinel,
          context: {
            finding: { check: "ssrf" },
            operation: { method: "POST", path: "/x" },
            response: { status: 200, headers: {} },
          },
        },
        SSRF_SUPPRESS,
      );
      expect(r.severity).toBe(sentinel);
      expect(r.suppressed).toBe(false);
    }
  });

  it("passes through unchanged when config is empty", () => {
    const r = calibrateProbeSeverity(
      {
        check: "ssrf",
        severity: "high",
        context: {
          finding: { check: "ssrf" },
          operation: { method: "POST", path: "/x" },
          response: { status: 200, headers: {} },
        },
      },
      { checks: {}, suppressions: [] },
    );
    expect(r.severity).toBe("high");
  });
});

describe("rollupSecuritySeverity after suppression", () => {
  it("drops the verdict from high to low once the ssrf finding is suppressed", () => {
    const findings = [finding("high", "ssrf", 200), finding("low", "crlf", 200)];
    expect(rollupSecuritySeverity(findings)).toBe("high");
    // Simulate calibration suppressing the ssrf high → info.
    findings[0]!.severity = "info";
    expect(rollupSecuritySeverity(findings)).toBe("low");
  });
});
