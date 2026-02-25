import { describe, test, expect, mock, afterEach } from "bun:test";
import { junitReporter } from "../../src/core/reporter/junit.ts";
import type { TestRunResult, StepResult } from "../../src/core/runner/types.ts";

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

function makeStep(overrides?: Partial<StepResult>): StepResult {
  return {
    name: "Get user",
    status: "pass",
    duration_ms: 450,
    request: { method: "GET", url: "http://localhost/users/1", headers: {} },
    response: {
      status: 200,
      headers: { "content-type": "application/json" },
      body: '{"id":1}',
      body_parsed: { id: 1 },
      duration_ms: 450,
    },
    assertions: [{ field: "status", rule: "equals 200", passed: true, actual: 200, expected: 200 }],
    captures: {},
    ...overrides,
  };
}

function makeResult(overrides?: Partial<TestRunResult>): TestRunResult {
  return {
    suite_name: "Users CRUD",
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

function captureLog() {
  const origLog = console.log;
  let output = "";
  console.log = mock((...args: unknown[]) => {
    output += args.map(String).join(" ") + "\n";
  });
  return {
    get: () => output.trim(),
    restore: () => { console.log = origLog; },
  };
}

// ──────────────────────────────────────────────
// XML structure
// ──────────────────────────────────────────────

describe("JUnit Reporter — XML structure", () => {
  let restoreFn: (() => void) | undefined;
  afterEach(() => restoreFn?.());

  test("outputs XML declaration and root element", () => {
    const cap = captureLog();
    restoreFn = cap.restore;

    junitReporter.report([makeResult()]);
    const xml = cap.get();

    expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(xml).toContain("<testsuites");
    expect(xml).toContain("</testsuites>");
  });

  test("root testsuites has correct aggregated attributes", () => {
    const cap = captureLog();
    restoreFn = cap.restore;

    const results = [
      makeResult({ total: 3, passed: 2, failed: 1, steps: [makeStep(), makeStep({ status: "fail", duration_ms: 310 }), makeStep()] }),
      makeResult({ suite_name: "Suite B", total: 2, passed: 2, steps: [makeStep(), makeStep()] }),
    ];
    junitReporter.report(results);
    const xml = cap.get();

    expect(xml).toContain('tests="5"');
    expect(xml).toContain('failures="1"');
  });

  test("each result becomes a testsuite element", () => {
    const cap = captureLog();
    restoreFn = cap.restore;

    junitReporter.report([
      makeResult({ suite_name: "Suite A" }),
      makeResult({ suite_name: "Suite B" }),
    ]);
    const xml = cap.get();

    expect(xml).toContain('name="Suite A"');
    expect(xml).toContain('name="Suite B"');
    expect((xml.match(/<testsuite /g) ?? []).length).toBe(2);
  });

  test("testsuite attributes: tests, failures, errors, skipped", () => {
    const cap = captureLog();
    restoreFn = cap.restore;

    junitReporter.report([makeResult({ total: 2, passed: 1, failed: 1, skipped: 0 })]);
    const xml = cap.get();

    expect(xml).toContain('tests="2"');
    expect(xml).toContain('failures="1"');
    expect(xml).toContain('errors="0"');
    expect(xml).toContain('skipped="0"');
  });

  test("passing step renders self-closing testcase", () => {
    const cap = captureLog();
    restoreFn = cap.restore;

    junitReporter.report([makeResult()]);
    const xml = cap.get();

    expect(xml).toContain('<testcase name="Get user"');
    expect(xml).toContain('"/>');
    expect(xml).not.toContain("<failure");
    expect(xml).not.toContain("<error");
    expect(xml).not.toContain("<skipped");
  });

  test("skipped step renders <skipped/> element", () => {
    const cap = captureLog();
    restoreFn = cap.restore;

    const step = makeStep({ name: "Verify deleted", status: "skip", duration_ms: 0 });
    junitReporter.report([makeResult({ total: 1, passed: 0, skipped: 1, steps: [step] })]);
    const xml = cap.get();

    expect(xml).toContain('<testcase name="Verify deleted"');
    expect(xml).toContain("<skipped/>");
  });

  test("failed step renders <failure> with message", () => {
    const cap = captureLog();
    restoreFn = cap.restore;

    const step = makeStep({
      name: "Update user",
      status: "fail",
      duration_ms: 310,
      assertions: [
        { field: "status", rule: "equals 200", passed: false, actual: 500, expected: 200 },
      ],
    });
    junitReporter.report([makeResult({ total: 1, passed: 0, failed: 1, steps: [step] })]);
    const xml = cap.get();

    expect(xml).toContain('<testcase name="Update user"');
    expect(xml).toContain("<failure");
    expect(xml).toContain("</failure>");
    expect(xml).toContain("equals 200");
  });

  test("error step renders <error> element", () => {
    const cap = captureLog();
    restoreFn = cap.restore;

    const step = makeStep({
      name: "Create user",
      status: "error",
      duration_ms: 50,
      error: "Connection refused",
    });
    junitReporter.report([makeResult({ total: 1, passed: 0, failed: 0, steps: [step] })]);
    const xml = cap.get();

    expect(xml).toContain("<error");
    expect(xml).toContain("Connection refused");
    expect(xml).toContain("</error>");
  });

  test("empty results produce empty testsuites", () => {
    const cap = captureLog();
    restoreFn = cap.restore;

    junitReporter.report([]);
    const xml = cap.get();

    expect(xml).toContain('tests="0"');
    expect(xml).toContain("<testsuites");
    expect(xml).toContain("</testsuites>");
  });
});

// ──────────────────────────────────────────────
// Time formatting
// ──────────────────────────────────────────────

describe("JUnit Reporter — time formatting", () => {
  let restoreFn: (() => void) | undefined;
  afterEach(() => restoreFn?.());

  test("time is in seconds with 3 decimal places", () => {
    const cap = captureLog();
    restoreFn = cap.restore;

    junitReporter.report([makeResult({ steps: [makeStep({ duration_ms: 450 })] })]);
    const xml = cap.get();

    expect(xml).toContain('time="0.450"');
  });

  test("aggregates step times for testsuite time", () => {
    const cap = captureLog();
    restoreFn = cap.restore;

    const steps = [makeStep({ duration_ms: 100 }), makeStep({ duration_ms: 200 })];
    junitReporter.report([makeResult({ total: 2, passed: 2, steps })]);
    const xml = cap.get();

    // testsuite time = 0.300
    expect(xml).toContain('time="0.300"');
  });

  test("root testsuites time is total across all suites", () => {
    const cap = captureLog();
    restoreFn = cap.restore;

    junitReporter.report([
      makeResult({ steps: [makeStep({ duration_ms: 100 })] }),
      makeResult({ suite_name: "B", steps: [makeStep({ duration_ms: 200 })] }),
    ]);
    const xml = cap.get();

    // root time = 0.300
    const match = xml.match(/<testsuites[^>]+time="([^"]+)"/);
    expect(match?.[1]).toBe("0.300");
  });
});

// ──────────────────────────────────────────────
// XML escaping
// ──────────────────────────────────────────────

describe("JUnit Reporter — XML escaping", () => {
  let restoreFn: (() => void) | undefined;
  afterEach(() => restoreFn?.());

  test("escapes & < > in suite name", () => {
    const cap = captureLog();
    restoreFn = cap.restore;

    junitReporter.report([makeResult({ suite_name: "A & B <Suite>" })]);
    const xml = cap.get();

    expect(xml).toContain("A &amp; B &lt;Suite&gt;");
    expect(xml).not.toContain("A & B <Suite>");
  });

  test("escapes & < > in step name", () => {
    const cap = captureLog();
    restoreFn = cap.restore;

    junitReporter.report([makeResult({ steps: [makeStep({ name: 'Create "item" & verify' })] })]);
    const xml = cap.get();

    expect(xml).toContain("Create &quot;item&quot; &amp; verify");
  });

  test("escapes failure message", () => {
    const cap = captureLog();
    restoreFn = cap.restore;

    const step = makeStep({
      status: "fail",
      assertions: [{ field: "body", rule: "contains <html>", passed: false, actual: "<html>", expected: "json" }],
    });
    junitReporter.report([makeResult({ total: 1, passed: 0, failed: 1, steps: [step] })]);
    const xml = cap.get();

    expect(xml).toContain("&lt;html&gt;");
    expect(xml).not.toContain("<html>");
  });
});
