import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { tmpdir } from "os";
import { join } from "path";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "fs";
import { reportExportHtmlCommand } from "../../src/cli/commands/report.ts";
import { renderHtmlReport } from "../../src/core/exporter/html-report/index.ts";
import { closeDb, getDb } from "../../src/db/schema.ts";
import { createRun, saveResults } from "../../src/db/queries.ts";
import type { TestRunResult } from "../../src/core/runner/types.ts";

const originalCwd = process.cwd();

function mkRun(dbPath: string, results: TestRunResult[]): number {
  process.chdir(originalCwd);
  closeDb();
  // Force getDb to use the fresh path
  getDb(dbPath);
  const id = createRun({
    started_at: results[0]?.started_at ?? new Date().toISOString(),
    environment: "staging",
    trigger: "manual",
    branch: "main",
    commit_sha: "abcdef1234567890",
  });
  saveResults(id, results);
  // finalize: set finished_at and counts via direct UPDATE
  const total = results.reduce((s, r) => s + r.total, 0);
  const passed = results.reduce((s, r) => s + r.passed, 0);
  const failed = results.reduce((s, r) => s + r.failed, 0);
  getDb(dbPath).prepare(
    "UPDATE runs SET finished_at = ?, total = ?, passed = ?, failed = ?, duration_ms = ? WHERE id = ?",
  ).run(new Date().toISOString(), total, passed, failed, 1234, id);
  return id;
}

function buildSampleResults(): TestRunResult[] {
  const now = new Date().toISOString();
  return [
    {
      suite_name: "Pets API",
      started_at: now,
      finished_at: now,
      total: 3,
      passed: 1,
      failed: 1,
      skipped: 0,
      steps: [
        {
          name: "GET /pets returns 200",
          status: "pass",
          duration_ms: 42,
          request: { method: "GET", url: "https://api.example.test/pets", headers: {}, body: null },
          response: { status: 200, headers: { "content-type": "application/json" }, body: '{"items":[]}' },
          assertions: [
            { field: "response.status", rule: "status_eq", passed: true, expected: 200, actual: 200 },
          ],
          captures: {},
        },
        {
          name: "POST /pets with bad input returns 5xx (BUG)",
          status: "fail",
          duration_ms: 88,
          request: {
            method: "POST",
            url: "https://api.example.test/pets",
            headers: { "content-type": "application/json" },
            body: '{"name":null}',
          },
          response: {
            status: 500,
            headers: { "content-type": "application/json" },
            body: '{"error":"NPE"}',
          },
          assertions: [
            { field: "response.status", rule: "status_in", passed: false, expected: [400, 422], actual: 500 },
          ],
          captures: {},
          provenance: {
            type: "probe-suite",
            generator: "probe-validation",
            endpoint: "POST /pets",
            response_branch: "400",
            spec: "/tmp/petstore.json",
          },
          failure_class: "definitely_bug",
          failure_class_reason: "API returned 500 — server-side error",
          spec_pointer: "#/paths/~1pets/post",
          spec_excerpt: '{"summary":"Create a pet","requestBody":{"required":true}}',
        },
        {
          name: "DELETE /pets/{id} network error",
          status: "error",
          duration_ms: 5000,
          request: { method: "DELETE", url: "https://api.example.test/pets/42", headers: {}, body: null },
          assertions: [],
          captures: {},
          error: "ECONNRESET",
          failure_class: "env_issue",
          failure_class_reason: "request failed before producing a response",
        },
      ],
    },
  ] as unknown as TestRunResult[];
}

describe("renderHtmlReport (TASK-107)", () => {
  test("emits a single-file HTML with hero, KPIs, failure card, curl, coverage", () => {
    const results = buildSampleResults();
    const html = renderHtmlReport({
      run: {
        id: 42,
        started_at: results[0]!.started_at,
        finished_at: results[0]!.finished_at,
        total: 3,
        passed: 1,
        failed: 1,
        skipped: 0,
        trigger: "manual",
        commit_sha: "abcdef1234567890",
        branch: "main",
        environment: "staging",
        duration_ms: 1234,
        collection_id: null,
      },
      // @ts-expect-error — partial StoredStepResult shape, OK for snapshot-style assertions
      results: results[0]!.steps.map((s, i) => ({
        id: i,
        run_id: 42,
        suite_name: "Pets API",
        test_name: s.name,
        status: s.status,
        duration_ms: s.duration_ms,
        request_method: s.request.method,
        request_url: s.request.url,
        request_body: s.request.body,
        response_status: s.response?.status ?? null,
        response_body: s.response?.body ?? null,
        response_headers: s.response?.headers ? JSON.stringify(s.response.headers) : null,
        error_message: s.error ?? null,
        assertions: s.assertions,
        captures: s.captures,
        suite_file: null,
        provenance: s.provenance ?? null,
        failure_class: s.failure_class ?? null,
        failure_class_reason: s.failure_class_reason ?? null,
        spec_pointer: s.spec_pointer ?? null,
        spec_excerpt: s.spec_excerpt ?? null,
      })),
      zondVersion: "0.0.0-test",
      generatedAt: new Date("2026-04-30T12:00:00Z"),
      collectionName: "Pets API",
    });

    expect(html.startsWith("<!doctype html>")).toBe(true);
    // No external assets — every script/link must be inline.
    expect(html).not.toMatch(/<link[^>]+href="http/);
    expect(html).not.toMatch(/<script[^>]+src="http/);
    // Hero
    expect(html).toContain("Pets API");
    expect(html).toContain("Run #42");
    // KPIs
    expect(html).toContain("Total");
    expect(html).toContain("Passed");
    // Failure card
    expect(html).toContain("POST /pets with bad input returns 5xx");
    expect(html).toContain("Definitely bug");
    expect(html).toContain("Env issue");
    // Curl + issue payloads
    expect(html).toContain("curl -X POST");
    expect(html).toContain("data-payload=\"curl\"");
    expect(html).toContain("data-payload=\"issue\"");
    // Spec snippet
    expect(html).toContain("#/paths/~1pets/post");
    // Coverage map
    expect(html).toContain("Coverage map");
    expect(html).toContain("/pets");
    // Footer
    expect(html).toContain("zond");
    expect(html).toContain("0.0.0-test");
  });

  test("escapes HTML in user-controlled fields (XSS guard)", () => {
    const html = renderHtmlReport({
      run: {
        id: 1,
        started_at: "2026-04-30T12:00:00Z",
        finished_at: null,
        total: 1, passed: 0, failed: 1, skipped: 0,
        trigger: "manual", commit_sha: null, branch: null, environment: null,
        duration_ms: null, collection_id: null,
      },
      results: [{
        id: 1, run_id: 1, suite_name: "x", test_name: "<script>alert('xss')</script>",
        status: "fail", duration_ms: 0, request_method: "GET",
        request_url: "https://e.test/<svg/onload=alert(1)>",
        request_body: null, response_status: 200, response_body: '{"x": "<b>"}',
        response_headers: null, error_message: null, assertions: [],
        captures: {}, suite_file: null, provenance: null, failure_class: null,
        failure_class_reason: null, spec_pointer: null, spec_excerpt: null,
      }],
      zondVersion: "v",
      generatedAt: new Date(),
    });
    expect(html).not.toContain("<script>alert('xss')</script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<svg/onload=");
  });

  test("renders pass-only run with empty-state failures section", () => {
    const html = renderHtmlReport({
      run: {
        id: 7, started_at: "2026-04-30T12:00:00Z", finished_at: "2026-04-30T12:00:01Z",
        total: 2, passed: 2, failed: 0, skipped: 0,
        trigger: "ci", commit_sha: null, branch: "main", environment: "prod",
        duration_ms: 1000, collection_id: null,
      },
      results: [
        { id: 1, run_id: 7, suite_name: "x", test_name: "ok1", status: "pass", duration_ms: 10,
          request_method: "GET", request_url: "https://e.test/a", request_body: null,
          response_status: 200, response_body: null, response_headers: null,
          error_message: null, assertions: [], captures: {}, suite_file: null,
          provenance: null, failure_class: null, failure_class_reason: null,
          spec_pointer: null, spec_excerpt: null },
      ],
      zondVersion: "v", generatedAt: new Date(),
    });
    expect(html).toContain("All 1 step");
    expect(html).toContain("nothing to investigate");
  });
});

describe("zond report export --html (TASK-107 CLI)", () => {
  let workDir: string;
  let dbPath: string;

  beforeEach(() => {
    workDir = mkdtempSync(join(tmpdir(), "zond-report-cli-"));
    dbPath = join(workDir, "test.db");
  });

  afterEach(() => {
    closeDb();
    process.chdir(originalCwd);
    rmSync(workDir, { recursive: true, force: true });
  });

  test("exports an existing run to a HTML file", async () => {
    const runId = mkRun(dbPath, buildSampleResults());
    const out = join(workDir, "report.html");

    const code = await reportExportHtmlCommand({
      runId: String(runId),
      output: out,
      dbPath,
    });

    expect(code).toBe(0);
    expect(existsSync(out)).toBe(true);
    const content = readFileSync(out, "utf8");
    expect(content.startsWith("<!doctype html>")).toBe(true);
    expect(content).toContain("POST /pets");
    // Reasonable size for 3 steps — a few KB, not megabytes.
    expect(content.length).toBeLessThan(2 * 1024 * 1024);
  });

  test("exits 1 with friendly message when run-id is unknown", async () => {
    const code = await reportExportHtmlCommand({
      runId: "999999",
      output: join(workDir, "x.html"),
      dbPath,
    });
    expect(code).toBe(1);
  });

  test("exits 2 on invalid run-id input", async () => {
    const code = await reportExportHtmlCommand({
      runId: "not-a-number",
      output: join(workDir, "x.html"),
      dbPath,
    });
    expect(code).toBe(2);
  });
});
