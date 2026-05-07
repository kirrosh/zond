import { describe, test, expect, mock, afterEach } from "bun:test";
import { jsonReporter } from "../../src/core/reporter/json.ts";
import type { TestRunResult } from "../../src/core/runner/types.ts";
import { makeResult } from "../_helpers/reporter-fixtures";

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
