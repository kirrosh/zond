import { describe, test, expect } from "bun:test";
import {
  buildLargeProbeNotice,
  LARGE_PROBE_THRESHOLD,
} from "../../src/cli/commands/probe/static.ts";

describe("buildLargeProbeNotice", () => {
  test("empty when totalProbes below threshold", () => {
    expect(buildLargeProbeNotice(LARGE_PROBE_THRESHOLD - 1, 100)).toEqual([]);
    expect(buildLargeProbeNotice(0, 0)).toEqual([]);
  });

  test("emits ETAs for rate-limits 10/30/60 and a --max-per-endpoint hint", () => {
    const lines = buildLargeProbeNotice(10927, 1170);
    expect(lines.length).toBeGreaterThan(0);
    const blob = lines.join("\n");
    expect(blob).toContain("10927 probe(s)");
    expect(blob).toContain("1170 endpoint(s)");
    expect(blob).toContain("--rate-limit 10");
    expect(blob).toContain("--rate-limit 30");
    expect(blob).toContain("--rate-limit 60");
    // 10927 / 30 ≈ 364s → 6m4s
    expect(blob).toContain("6m4s");
    expect(blob).toContain("--max-per-endpoint 3");
  });

  test("sample estimate is capped at totalProbes", () => {
    // Tiny endpoint count but huge probe count → 3×endpoints could exceed totals
    const lines = buildLargeProbeNotice(3000, 10);
    const blob = lines.join("\n");
    expect(blob).toContain("(~30 probe(s))");
  });

  test("returns empty when no endpoints were probed", () => {
    expect(buildLargeProbeNotice(5000, 0)).toEqual([]);
  });
});
