/**
 * ARV-41: a run that only executed probe suites should be detectable so
 * `zond coverage` (no selector) can warn that the latest run will look
 * lower than the previous smoke/CRUD run, instead of silently presenting
 * an apparent regression after `zond run apis/<api>/probes/...`.
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isProbeOnlyRun } from "../../src/cli/commands/coverage.ts";
import { closeDb, getDb } from "../../src/db/schema.ts";
import { createRun } from "../../src/db/queries/runs.ts";
import { saveResults } from "../../src/db/queries/results.ts";
import type { TestRunResult } from "../../src/core/runner/types.ts";

function suiteResult(suite_file: string, suite_name: string): TestRunResult {
  return {
    suite_name,
    suite_file,
    started_at: "2026-05-10T12:00:00Z",
    finished_at: "2026-05-10T12:00:01Z",
    total: 1,
    passed: 1,
    failed: 0,
    skipped: 0,
    steps: [{
      name: "step",
      status: "pass",
      duration_ms: 10,
      request: { method: "GET", url: "https://api.example.com/x", headers: {} },
      response: { status: 200, headers: {}, body: "{}", duration_ms: 10 },
      assertions: [],
      captures: {},
    }],
  };
}

describe("ARV-41: isProbeOnlyRun", () => {
  let workDir: string;
  let savedCwd: string;

  beforeEach(() => {
    workDir = mkdtempSync(join(tmpdir(), "zond-arv41-"));
    writeFileSync(join(workDir, "zond.config.yml"), "version: 1\n", "utf-8");
    savedCwd = process.cwd();
    process.chdir(workDir);
    getDb();
  });

  afterEach(() => {
    process.chdir(savedCwd);
    closeDb();
    rmSync(workDir, { recursive: true, force: true });
  });

  test("run whose every suite_file lives under apis/<api>/probes/ is probe-only", () => {
    const id = createRun({ started_at: "2026-05-10T12:00:00Z" });
    saveResults(id, [
      suiteResult("apis/resend/probes/static/POST_emails-validation.yaml", "p1"),
      suiteResult("apis/resend/probes/static/GET_domains-validation.yaml", "p2"),
    ]);
    expect(isProbeOnlyRun(id)).toBe(true);
  });

  test("mixed run (probes + tests) is NOT probe-only", () => {
    const id = createRun({ started_at: "2026-05-10T12:00:00Z" });
    saveResults(id, [
      suiteResult("apis/resend/probes/static/POST_emails-validation.yaml", "p1"),
      suiteResult("apis/resend/tests/smoke-domains-positive.yaml", "smoke"),
    ]);
    expect(isProbeOnlyRun(id)).toBe(false);
  });

  test("run with only test suites is NOT probe-only", () => {
    const id = createRun({ started_at: "2026-05-10T12:00:00Z" });
    saveResults(id, [
      suiteResult("apis/resend/tests/smoke-domains-positive.yaml", "smoke"),
    ]);
    expect(isProbeOnlyRun(id)).toBe(false);
  });

  test("run with no results is conservatively NOT probe-only", () => {
    const id = createRun({ started_at: "2026-05-10T12:00:00Z" });
    expect(isProbeOnlyRun(id)).toBe(false);
  });
});
