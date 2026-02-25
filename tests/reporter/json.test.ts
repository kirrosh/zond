import { describe, test, expect, mock, afterEach } from "bun:test";
import { jsonReporter } from "../../src/core/reporter/json.ts";
import type { TestRunResult } from "../../src/core/runner/types.ts";

function makeResult(overrides?: Partial<TestRunResult>): TestRunResult {
  return {
    suite_name: "Test Suite",
    started_at: "2024-01-01T00:00:00.000Z",
    finished_at: "2024-01-01T00:00:01.000Z",
    total: 1,
    passed: 1,
    failed: 0,
    skipped: 0,
    steps: [
      {
        name: "Step 1",
        status: "pass",
        duration_ms: 100,
        request: { method: "GET", url: "http://localhost/test", headers: {} },
        response: {
          status: 200,
          headers: { "content-type": "application/json" },
          body: '{"ok":true}',
          body_parsed: { ok: true },
          duration_ms: 100,
        },
        assertions: [{ field: "status", rule: "equals 200", passed: true, actual: 200, expected: 200 }],
        captures: {},
      },
    ],
    ...overrides,
  };
}

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

describe("JSON Reporter", () => {
  let restoreFn: (() => void) | undefined;

  afterEach(() => {
    restoreFn?.();
  });

  test("outputs valid JSON matching input", () => {
    const cap = captureConsoleLog();
    restoreFn = cap.restore;

    const results = [makeResult()];
    jsonReporter.report(results);

    const parsed = JSON.parse(cap.getOutput().trim());
    expect(parsed).toEqual(results);
  });

  test("outputs pretty-printed JSON with 2-space indent", () => {
    const cap = captureConsoleLog();
    restoreFn = cap.restore;

    jsonReporter.report([makeResult()]);

    const output = cap.getOutput();
    expect(output).toContain("\n");
    expect(output).toContain('  "suite_name"');
  });

  test("handles multiple results", () => {
    const cap = captureConsoleLog();
    restoreFn = cap.restore;

    const results = [makeResult({ suite_name: "Suite A" }), makeResult({ suite_name: "Suite B" })];
    jsonReporter.report(results);

    const parsed = JSON.parse(cap.getOutput().trim());
    expect(parsed).toHaveLength(2);
    expect(parsed[0].suite_name).toBe("Suite A");
    expect(parsed[1].suite_name).toBe("Suite B");
  });

  test("handles empty results", () => {
    const cap = captureConsoleLog();
    restoreFn = cap.restore;

    jsonReporter.report([]);

    const parsed = JSON.parse(cap.getOutput().trim());
    expect(parsed).toEqual([]);
  });
});
