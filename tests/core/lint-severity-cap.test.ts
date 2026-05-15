/**
 * Lint severity cap regression (ARV-255, m-21 pivot).
 *
 * Locks the "spec-lint can never escape LOW/INFO" contract:
 *
 * - DEFAULT_SEVERITY map emits exactly the two tiers — LOW for real
 *   spec violations, INFO for style/documentation gaps.
 * - User overrides via `--rule R=high|medium` are silently downgraded
 *   to LOW by normaliseSetting().
 * - --rule R=info is honoured (no upgrade either).
 */
import { describe, expect, it } from "bun:test";
import { DEFAULT_SEVERITY, ALL_RULES } from "../../src/core/lint/types.ts";
import { loadConfig } from "../../src/core/lint/config.ts";

describe("lint severity cap (ARV-255)", () => {
  it("DEFAULT_SEVERITY emits only LOW or INFO — no HIGH/MEDIUM anywhere", () => {
    for (const rule of ALL_RULES) {
      const sev = DEFAULT_SEVERITY[rule];
      expect(sev === "low" || sev === "info").toBe(true);
    }
  });

  it("at least one rule is LOW (real-violation tier should not be empty)", () => {
    const lows = ALL_RULES.filter((r) => DEFAULT_SEVERITY[r] === "low");
    expect(lows.length).toBeGreaterThan(0);
  });

  it("bulk volume is INFO (style/documentation rules dominate)", () => {
    const infos = ALL_RULES.filter((r) => DEFAULT_SEVERITY[r] === "info");
    const lows = ALL_RULES.filter((r) => DEFAULT_SEVERITY[r] === "low");
    expect(infos.length).toBeGreaterThanOrEqual(lows.length);
  });

  it("--rule R=high override silently caps to LOW", () => {
    const cfg = loadConfig({ cliRule: "B1=high" });
    expect(cfg.rules.B1).toBe("low");
  });

  it("--rule R=medium override silently caps to LOW", () => {
    const cfg = loadConfig({ cliRule: "A1=medium" });
    expect(cfg.rules.A1).toBe("low");
  });

  it("--rule R=info override stays INFO", () => {
    const cfg = loadConfig({ cliRule: "B7=info" });
    expect(cfg.rules.B7).toBe("info");
  });

  it("--rule R=low override stays LOW", () => {
    const cfg = loadConfig({ cliRule: "A2=low" });
    expect(cfg.rules.A2).toBe("low");
  });

  it("DEFAULT_SEVERITY assignments match the pivot rationale (structural=LOW, style=INFO)", () => {
    // A1/A2: example violates format/enum — real spec bug. LOW.
    expect(DEFAULT_SEVERITY.A1).toBe("low");
    expect(DEFAULT_SEVERITY.A2).toBe("low");
    // B1: path-param without format/pattern — affects validation. LOW.
    expect(DEFAULT_SEVERITY.B1).toBe("low");
    // B7: response without schema — affects testability. LOW.
    expect(DEFAULT_SEVERITY.B7).toBe("low");
    // B2: additionalProperties missing — style preference. INFO.
    expect(DEFAULT_SEVERITY.B2).toBe("info");
    // B4: missing operation-id — naming hygiene. INFO.
    expect(DEFAULT_SEVERITY.B4).toBe("info");
  });
});
