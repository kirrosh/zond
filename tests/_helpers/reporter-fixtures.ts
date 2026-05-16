import type { StepResult, TestRunResult } from "../../src/core/runner/types";

export function makeStep(overrides?: Partial<StepResult>): StepResult {
  return {
    name: "step",
    status: "pass",
    duration_ms: 100,
    request: { method: "GET", url: "http://localhost/test", headers: {} },
    response: {
      status: 200,
      headers: { "content-type": "application/json" },
      body: "{}",
      body_parsed: {},
      duration_ms: 100,
    },
    assertions: [],
    captures: {},
    ...overrides,
  };
}

/**
 * Two call shapes:
 *   makeResult()                     → 1 default step, totals derived
 *   makeResult({ ... })              → overrides applied; totals stay as given (or default 1/1/0/0)
 *   makeResult([step, step, ...])    → totals derived from the step array
 */
export function makeResult(arg?: Partial<TestRunResult> | StepResult[]): TestRunResult {
  if (Array.isArray(arg)) {
    const steps = arg;
    return {
      suite_name: "Test Suite",
      started_at: "2024-01-01T00:00:00.000Z",
      finished_at: "2024-01-01T00:00:01.000Z",
      total: steps.length,
      passed: steps.filter(s => s.status === "pass").length,
      failed: steps.filter(s => s.status === "fail").length,
      skipped: steps.filter(s => s.status === "skip").length,
      steps,
    };
  }
  return {
    suite_name: "Test Suite",
    started_at: "2024-01-01T00:00:00.000Z",
    finished_at: "2024-01-01T00:00:01.000Z",
    total: 1,
    passed: 1,
    failed: 0,
    skipped: 0,
    steps: [makeStep()],
    ...arg,
  };
}
