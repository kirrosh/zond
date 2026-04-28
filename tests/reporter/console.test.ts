import { describe, test, expect, mock, afterEach } from "bun:test";
import {
  formatDuration,
  formatStep,
  formatFailures,
  formatSuiteResult,
  formatGrandTotal,
  consoleReporter,
} from "../../src/core/reporter/console.ts";
import type { TestRunResult, StepResult } from "../../src/core/runner/types.ts";

function makeStep(overrides?: Partial<StepResult>): StepResult {
  return {
    name: "Test step",
    status: "pass",
    duration_ms: 100,
    request: { method: "GET", url: "http://localhost/test", headers: {} },
    response: {
      status: 200,
      headers: {},
      body: "{}",
      body_parsed: {},
      duration_ms: 100,
    },
    assertions: [],
    captures: {},
    ...overrides,
  };
}

function makeResult(overrides?: Partial<TestRunResult>): TestRunResult {
  return {
    suite_name: "Test Suite",
    started_at: "2024-01-01T00:00:00.000Z",
    finished_at: "2024-01-01T00:00:01.000Z",
    total: 1,
    passed: 1,
    failed: 0,
    skipped: 0,
    steps: [makeStep()],
    ...overrides,
  };
}

// --- formatDuration ---

describe("formatDuration", () => {
  test("milliseconds for < 1000ms", () => {
    expect(formatDuration(450)).toBe("450ms");
    expect(formatDuration(0)).toBe("0ms");
    expect(formatDuration(999)).toBe("999ms");
  });

  test("seconds with one decimal for >= 1000ms", () => {
    expect(formatDuration(1000)).toBe("1.0s");
    expect(formatDuration(1200)).toBe("1.2s");
    expect(formatDuration(59999)).toBe("60.0s");
  });

  test("minutes + seconds for >= 60000ms", () => {
    expect(formatDuration(60000)).toBe("1m");
    expect(formatDuration(65000)).toBe("1m 5s");
    expect(formatDuration(125000)).toBe("2m 5s");
  });
});

// --- formatStep (no color) ---

describe("formatStep", () => {
  test("pass step shows checkmark", () => {
    const out = formatStep(makeStep({ name: "Create user", duration_ms: 450 }), false);
    expect(out).toContain("\u2713");
    expect(out).toContain("Create user");
    expect(out).toContain("(450ms)");
  });

  test("fail step shows cross", () => {
    const out = formatStep(makeStep({ name: "Update user", status: "fail", duration_ms: 310 }), false);
    expect(out).toContain("\u2717");
    expect(out).toContain("Update user");
    expect(out).toContain("(310ms)");
  });

  test("skip step shows circle", () => {
    const out = formatStep(makeStep({ name: "Verify", status: "skip", duration_ms: 0 }), false);
    expect(out).toContain("\u25CB");
    expect(out).toContain("Verify");
    expect(out).toContain("(skipped)");
  });

  test("skip step shows reason inline when error is set", () => {
    const out = formatStep(
      makeStep({ name: "Get domain", status: "skip", duration_ms: 0, error: "depends on missing capture: domain_id" }),
      false,
    );
    expect(out).toContain("(skipped: depends on missing capture: domain_id)");
  });

  test("error step shows cross with error label", () => {
    const out = formatStep(makeStep({ name: "Broken", status: "error", duration_ms: 0 }), false);
    expect(out).toContain("\u2717");
    expect(out).toContain("Broken");
    expect(out).toContain("(error)");
  });
});

// --- formatFailures ---

describe("formatFailures", () => {
  test("shows failed assertion details", () => {
    const step = makeStep({
      status: "fail",
      assertions: [
        { field: "status", rule: "equals 200", passed: false, actual: 500, expected: 200 },
        { field: "body.name", rule: "type string", passed: true, actual: "John", expected: "string" },
      ],
    });
    const out = formatFailures(step, false);
    expect(out).toContain("status: expected equals 200 but got 500");
    expect(out).not.toContain("body.name"); // passed assertion not shown
  });

  test("shows error message for error steps", () => {
    const step = makeStep({ status: "error", error: "Connection refused" });
    const out = formatFailures(step, false);
    expect(out).toContain("Error: Connection refused");
  });

  test("returns empty for step with no failures", () => {
    const step = makeStep({
      status: "fail",
      assertions: [{ field: "status", rule: "equals 200", passed: true, actual: 200, expected: 200 }],
    });
    const out = formatFailures(step, false);
    expect(out).toBe("");
  });
});

// --- formatSuiteResult ---

describe("formatSuiteResult", () => {
  test("formats mixed results correctly", () => {
    const result = makeResult({
      suite_name: "Users CRUD",
      total: 3,
      passed: 1,
      failed: 1,
      skipped: 1,
      steps: [
        makeStep({ name: "Create user", status: "pass", duration_ms: 450 }),
        makeStep({
          name: "Update user",
          status: "fail",
          duration_ms: 310,
          assertions: [{ field: "status", rule: "equals 200", passed: false, actual: 500, expected: 200 }],
        }),
        makeStep({ name: "Verify deleted", status: "skip", duration_ms: 0 }),
      ],
    });

    const out = formatSuiteResult(result, false);
    expect(out).toContain("Users CRUD");
    expect(out).toContain("\u2713");
    expect(out).toContain("\u2717");
    expect(out).toContain("\u25CB");
    expect(out).toContain("1 passed");
    expect(out).toContain("1 failed");
    expect(out).toContain("1 skipped");
    expect(out).toContain("status: expected equals 200 but got 500");
  });

  test("handles suite with zero steps", () => {
    const result = makeResult({ total: 0, passed: 0, failed: 0, skipped: 0, steps: [] });
    const out = formatSuiteResult(result, false);
    expect(out).toContain("0 tests");
  });
});

// --- formatGrandTotal ---

describe("formatGrandTotal", () => {
  test("aggregates multiple suites", () => {
    const results = [
      makeResult({
        passed: 3, failed: 0, skipped: 0, total: 3,
        started_at: "2024-01-01T00:00:00.000Z",
        finished_at: "2024-01-01T00:00:01.000Z",
      }),
      makeResult({
        passed: 1, failed: 1, skipped: 1, total: 3,
        started_at: "2024-01-01T00:00:00.000Z",
        finished_at: "2024-01-01T00:00:02.000Z",
      }),
    ];

    const out = formatGrandTotal(results, false);
    expect(out).toContain("Total:");
    expect(out).toContain("4 passed");
    expect(out).toContain("1 failed");
    expect(out).toContain("1 skipped");
    expect(out).toContain("2.0s");
  });
});

// --- consoleReporter.report ---

function captureConsoleLog() {
  const origLog = console.log;
  let output = "";
  console.log = mock((...args: unknown[]) => {
    output += args.map(String).join(" ") + "\n";
  });
  return {
    getOutput: () => output,
    restore: () => { console.log = origLog; },
  };
}

describe("consoleReporter.report", () => {
  let restoreFn: (() => void) | undefined;

  afterEach(() => {
    restoreFn?.();
  });

  test("writes output to stdout", () => {
    const cap = captureConsoleLog();
    restoreFn = cap.restore;

    consoleReporter.report([makeResult({ suite_name: "My Suite" })], { color: false });
    expect(cap.getOutput()).toContain("My Suite");
    expect(cap.getOutput()).toContain("\u2713");
  });

  test("handles empty results", () => {
    const cap = captureConsoleLog();
    restoreFn = cap.restore;

    consoleReporter.report([], { color: false });
    expect(cap.getOutput()).toContain("No test suites found");
  });

  test("shows grand total for multiple suites", () => {
    const cap = captureConsoleLog();
    restoreFn = cap.restore;

    consoleReporter.report(
      [makeResult({ suite_name: "A" }), makeResult({ suite_name: "B" })],
      { color: false },
    );
    const output = cap.getOutput();
    expect(output).toContain("A");
    expect(output).toContain("B");
    expect(output).toContain("Total:");
  });

  test("no ANSI codes when color is false", () => {
    const cap = captureConsoleLog();
    restoreFn = cap.restore;

    consoleReporter.report([makeResult()], { color: false });
    expect(cap.getOutput()).not.toContain("\x1b[");
  });
});
