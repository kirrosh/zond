import { describe, test, expect } from "bun:test";
import {
  ProgressTracker,
  formatProgressLine,
} from "../../src/core/runner/progress-tracker.ts";
import { formatEta } from "../../src/core/util/format-eta.ts";
import type { StepResult } from "../../src/core/runner/types.ts";

function passingStep(durationMs = 100): StepResult {
  return {
    name: "step",
    status: "pass",
    duration_ms: durationMs,
    request: { method: "GET", url: "http://x", headers: {} },
    response: { status: 200, headers: {}, body: "", duration_ms: durationMs },
    assertions: [],
    captures: {},
  };
}

function skippedStep(): StepResult {
  return {
    name: "step",
    status: "skip",
    duration_ms: 0,
    request: { method: "", url: "", headers: {} },
    assertions: [],
    captures: {},
    error: "max-requests-cap-reached",
  };
}

describe("formatEta", () => {
  test("seconds", () => {
    expect(formatEta(5)).toBe("5s");
    expect(formatEta(59)).toBe("59s");
  });
  test("minutes", () => {
    expect(formatEta(60)).toBe("1m");
    expect(formatEta(125)).toBe("2m5s");
    expect(formatEta(364)).toBe("6m4s");
  });
  test("hours", () => {
    expect(formatEta(3600)).toBe("1h");
    expect(formatEta(3725)).toBe("1h2m");
  });
  test("non-finite → ?", () => {
    expect(formatEta(Infinity)).toBe("?");
    expect(formatEta(-1)).toBe("?");
  });
});

describe("ProgressTracker", () => {
  test("counts only HTTP responses, not skips", () => {
    const t = new ProgressTracker(10, 1000);
    t.recordStep(passingStep());
    t.recordStep(passingStep());
    t.recordStep(skippedStep());
    const snap = t.snapshot(2000);
    expect(snap.completedSteps).toBe(3);
    expect(snap.httpRequests).toBe(2);
    expect(snap.totalSteps).toBe(10);
  });

  test("derives ETA from observed step rate", () => {
    // 2 steps in 1 second → 2 steps/s → remaining 8 → ETA 4s
    const t = new ProgressTracker(10, 0);
    t.recordStep(passingStep());
    t.recordStep(passingStep());
    const snap = t.snapshot(1000);
    expect(snap.etaSeconds).toBeCloseTo(4, 1);
    expect(snap.effectiveRps).toBeCloseTo(2, 1);
  });

  test("zero progress → Infinity ETA", () => {
    const t = new ProgressTracker(10, 0);
    const snap = t.snapshot(500);
    expect(snap.etaSeconds).toBe(Infinity);
  });
});

describe("formatProgressLine", () => {
  test("includes elapsed, counters, %, rps, ETA", () => {
    const t = new ProgressTracker(100, 0);
    for (let i = 0; i < 25; i++) t.recordStep(passingStep());
    const line = formatProgressLine(t.snapshot(5000));
    // ~25 steps in 5s → 5 req/s, 25% done, 75 remaining → ETA 15s
    expect(line).toContain("zond:");
    expect(line).toContain("25/100 steps");
    expect(line).toContain("(25%)");
    expect(line).toContain("25 req");
    expect(line).toContain("req/s");
    expect(line).toContain("ETA");
  });

  test("unknown ETA shows '?'", () => {
    const t = new ProgressTracker(10, 0);
    const line = formatProgressLine(t.snapshot(0));
    expect(line).toContain("ETA ?");
  });
});
