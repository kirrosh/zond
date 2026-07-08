/**
 * ARV-158: audit HTML report drill-down. Verifies that when runs in the
 * audit session have failures, the rendered HTML embeds per-run
 * collapsible sections with by_recommended_action buckets + first
 * example + concrete drill-down commands — instead of just "3 failed
 * stages" with no detail.
 */
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { writeAuditReport, type ReportInput } from "../../src/cli/commands/audit.ts";
import type { DiagnoseResult } from "../../src/core/diagnostics/db-analysis.ts";

function makeDiagnose(overrides: Partial<DiagnoseResult> = {}): DiagnoseResult {
  return {
    run: {
      id: 42,
      started_at: "2026-05-16T00:00:00.000Z",
      environment: null,
      duration_ms: 1000,
    },
    summary: {
      total: 10,
      passed: 7,
      failed: 3,
      api_errors: 1,
      assertion_failures: 2,
      network_errors: 0,
    },
    failures: [],
    by_recommended_action: {
      report_backend_bug: {
        count: 1,
        examples: [{
          suite: "crud",
          test: "create-project",
          method: "POST",
          path: "/v1/projects",
          status: 500,
          reason: "TypeError: cannot read 'slug'",
        }],
      },
      fix_auth_config: {
        count: 4,
        examples: [
          { suite: "github-smoke", test: "GetNotifications", method: "GET", path: "/notifications", status: 401, reason: "expected 200, got 401" },
          { suite: "github-smoke", test: "GetIssues", method: "GET", path: "/issues", status: 401 },
        ],
      },
    },
    ...overrides,
  };
}

function baseInput(drilldown: ReportInput["drilldown"] = []): ReportInput {
  return {
    api: "demo",
    apiDir: "/tmp/apis/demo",
    stages: [
      { key: "run-tests", name: "run tests", status: "failed", exit_code: 1, duration_ms: 1000 },
      { key: "coverage", name: "coverage (session union)", status: "ok", exit_code: 0, duration_ms: 100 },
    ],
    totalMs: 1100,
    coverage: null,
    coverageStage: null,
    options: { api: "demo" },
    drilldown,
  };
}

describe("audit HTML drill-down (ARV-158)", () => {
  let tmp: string;
  let outPath: string;

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), "zond-arv158-"));
    outPath = join(tmp, "audit-report.html");
  });
  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  test("empty drilldown → no 'Failures by run' header (backwards-compat)", async () => {
    await writeAuditReport(outPath, baseInput([]));
    const html = await readFile(outPath, "utf-8");
    expect(html).not.toContain("Failures by run");
    // Static drill-down section still present.
    expect(html).toContain("Re-run audit");
  });

  test("AC: drilldown with 1 failed run → <details> block + bucket rows + run-id command", async () => {
    const input = baseInput([
      {
        run: { id: 42, failed: 3, total: 10, passed: 7 },
        diagnose: makeDiagnose(),
      },
    ]);
    await writeAuditReport(outPath, input);
    const html = await readFile(outPath, "utf-8");

    // Header present + summary in <summary>.
    expect(html).toContain("Failures by run");
    expect(html).toContain("<details>");
    expect(html).toContain("Run #42 — 3/10 failed (7 passed)");

    // Bucket rows with action + count + example (method/path/status).
    expect(html).toContain("report_backend_bug");
    expect(html).toContain("×1");
    expect(html).toContain("<code>POST /v1/projects</code>");
    expect(html).toContain("<strong>500</strong>");
    expect(html).toContain("TypeError: cannot read &#39;slug&#39;");

    // Multiple examples → "(+N more)" hint.
    expect(html).toContain("fix_auth_config");
    expect(html).toContain("×4");
    expect(html).toContain("(+1 more)");

    // Concrete drill-down commands with run-id baked in.
    expect(html).toContain("zond db diagnose --run-id 42 --json");
    expect(html).toContain("zond report export 42");
  });

  test("AC: report_backend_bug listed before fix_auth_config (skill priority order)", async () => {
    const input = baseInput([
      { run: { id: 42, failed: 3, total: 10, passed: 7 }, diagnose: makeDiagnose() },
    ]);
    await writeAuditReport(outPath, input);
    const html = await readFile(outPath, "utf-8");
    const idxBackend = html.indexOf("report_backend_bug");
    const idxAuth = html.indexOf("fix_auth_config");
    expect(idxBackend).toBeGreaterThan(0);
    expect(idxAuth).toBeGreaterThan(idxBackend);
  });

  test("multiple failed runs → multiple <details> blocks", async () => {
    const input = baseInput([
      { run: { id: 10, failed: 1, total: 5, passed: 4 }, diagnose: makeDiagnose() },
      { run: { id: 11, failed: 2, total: 5, passed: 3 }, diagnose: makeDiagnose() },
    ]);
    await writeAuditReport(outPath, input);
    const html = await readFile(outPath, "utf-8");
    expect(html.match(/<details>/g)?.length).toBe(2);
    expect(html).toContain("Run #10");
    expect(html).toContain("Run #11");
    expect(html).toContain("--run-id 10");
    expect(html).toContain("--run-id 11");
  });
});
