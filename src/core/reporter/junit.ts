import type { TestRunResult, StepResult } from "../runner/types.ts";
import type { Reporter, ReporterOptions } from "./types.ts";

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function formatTime(ms: number): string {
  return (ms / 1000).toFixed(3);
}

function renderTestcase(step: StepResult): string {
  const time = formatTime(step.duration_ms);
  const name = escapeXml(step.name);

  if (step.status === "pass") {
    return `    <testcase name="${name}" time="${time}"/>`;
  }

  if (step.status === "skip") {
    return `    <testcase name="${name}" time="${time}">\n      <skipped/>\n    </testcase>`;
  }

  if (step.status === "fail") {
    const failedAssertions = step.assertions.filter((a) => !a.passed);
    const message = failedAssertions.length > 0
      ? escapeXml(`${failedAssertions[0]!.rule}: expected ${JSON.stringify(failedAssertions[0]!.expected)}, got ${JSON.stringify(failedAssertions[0]!.actual)}`)
      : escapeXml(step.error ?? "Assertion failed");
    const body = failedAssertions
      .map((a) => escapeXml(`${a.rule}: expected ${JSON.stringify(a.expected)}, got ${JSON.stringify(a.actual)}`))
      .join("\n");
    return `    <testcase name="${name}" time="${time}">\n      <failure message="${message}">${body}</failure>\n    </testcase>`;
  }

  // error
  const message = escapeXml(step.error ?? "Unknown error");
  return `    <testcase name="${name}" time="${time}">\n      <error message="${message}">${message}</error>\n    </testcase>`;
}

function renderTestsuite(result: TestRunResult): string {
  const name = escapeXml(result.suite_name);
  const failures = result.failed;
  const tests = result.total;
  const errors = result.steps.filter((s) => s.status === "error").length;
  const skipped = result.skipped;
  const time = formatTime(result.steps.reduce((sum, s) => sum + s.duration_ms, 0));

  const testcases = result.steps.map(renderTestcase).join("\n");

  return `  <testsuite name="${name}" tests="${tests}" failures="${failures}" errors="${errors}" skipped="${skipped}" time="${time}">\n${testcases}\n  </testsuite>`;
}

export function generateJunitXml(results: TestRunResult[]): string {
  const totalTests = results.reduce((s, r) => s + r.total, 0);
  const totalFailures = results.reduce((s, r) => s + r.failed, 0);
  const totalErrors = results.reduce((s, r) => s + r.steps.filter((s) => s.status === "error").length, 0);
  const totalTime = formatTime(results.reduce((s, r) => s + r.steps.reduce((ss, step) => ss + step.duration_ms, 0), 0));

  const suites = results.map(renderTestsuite).join("\n");

  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<testsuites tests="${totalTests}" failures="${totalFailures}" errors="${totalErrors}" time="${totalTime}">`,
    suites,
    `</testsuites>`,
  ].join("\n");
}

export const junitReporter: Reporter = {
  report(results: TestRunResult[], _options?: ReporterOptions): void {
    console.log(generateJunitXml(results));
  },
};
