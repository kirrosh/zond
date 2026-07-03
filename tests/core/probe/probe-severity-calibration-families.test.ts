/**
 * ARV-311: mass-assignment + webhooks findings pass through the same
 * severity calibrator security got in ARV-300. Per-family AC#4 coverage:
 * a `.zond/severity.yaml` rule re-severitizes/suppresses a core-tier
 * finding, while probe sentinels round-trip untouched.
 */
import { describe, expect, it } from "bun:test";

import { mergeConfigs } from "../../../src/core/severity/config.ts";
import { calibrateProbeSeverity } from "../../../src/core/severity/probe-adapter.ts";
import type { Severity as MaSeverity } from "../../../src/core/probe/mass-assignment/types.ts";

const MA_SUPPRESS = mergeConfigs([
  {
    source: "test.yaml",
    config: {
      version: 1,
      suppressions: [
        {
          check: "mass_assignment",
          reason: "plan-limited sandbox echoes owner_id",
          when: { "response.status": 200 },
        },
      ],
    },
  },
]);

const DRIFT_DOWNGRADE = mergeConfigs([
  {
    source: "test.yaml",
    config: {
      version: 1,
      checks: { shape_drift: { severity: "low" } },
    },
  },
]);

describe("mass-assignment calibration (ARV-311)", () => {
  it("suppresses a matching high verdict to info + trace", () => {
    const r = calibrateProbeSeverity(
      {
        check: "mass_assignment",
        severity: "high",
        context: {
          finding: { check: "mass_assignment" },
          operation: { method: "POST", path: "/users" },
          response: { status: 200, headers: {} },
        },
      },
      MA_SUPPRESS,
    );
    expect(r.severity).toBe("info");
    expect(r.suppressed).toBe(true);
    expect(r.suppressed_by?.reason).toContain("sandbox");
  });

  it("AC#4: mass-assignment sentinels round-trip untouched", () => {
    const sentinels: MaSeverity[] = ["inconclusive-baseline", "inconclusive-5xx", "ok", "skipped"];
    for (const s of sentinels) {
      const r = calibrateProbeSeverity(
        {
          check: "mass_assignment",
          severity: s,
          context: {
            finding: { check: "mass_assignment" },
            operation: { method: "POST", path: "/users" },
            response: { status: 200, headers: {} },
          },
        },
        MA_SUPPRESS,
      );
      expect(r.severity).toBe(s);
      expect(r.suppressed).toBe(false);
    }
  });
});

describe("webhooks calibration (ARV-311)", () => {
  it("re-severitizes a shape_drift finding from high to low", () => {
    const r = calibrateProbeSeverity(
      {
        check: "shape_drift",
        severity: "high",
        context: {
          finding: { check: "shape_drift" },
          operation: { method: "POST", path: "invoice.paid" },
          response: { status: 0, headers: {} },
        },
      },
      DRIFT_DOWNGRADE,
    );
    expect(r.severity).toBe("low");
  });

  it("leaves an unmatched kind untouched", () => {
    const r = calibrateProbeSeverity(
      {
        check: "unknown_event_type",
        severity: "low",
        context: {
          finding: { check: "unknown_event_type" },
          operation: { method: "POST", path: "x" },
          response: { status: 0, headers: {} },
        },
      },
      DRIFT_DOWNGRADE,
    );
    expect(r.severity).toBe("low");
    expect(r.suppressed).toBe(false);
  });
});
