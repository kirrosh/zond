import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { tmpdir } from "os";
import { join } from "path";
import { mkdtempSync, rmSync, readFileSync, existsSync, writeFileSync } from "fs";
import { reportCaseStudyCommand } from "../../src/cli/commands/report.ts";
import { renderCaseStudy } from "../../src/core/exporter/case-study/index.ts";
import { closeDb, getDb } from "../../src/db/schema.ts";
import { createRun, saveResults, createCollection } from "../../src/db/queries.ts";
import type { TestRunResult } from "../../src/core/runner/types.ts";

const originalCwd = process.cwd();

function buildSampleResults(): TestRunResult[] {
  const now = new Date().toISOString();
  return [{
    suite_name: "Pets API · validation probes",
    started_at: now,
    finished_at: now,
    total: 1, passed: 0, failed: 1, skipped: 0,
    steps: [{
      name: "POST /pets with name=null returns 5xx (BUG)",
      status: "fail",
      duration_ms: 88,
      request: {
        method: "POST",
        url: "https://api.example.test/v1/pets",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: null }),
      },
      response: {
        status: 500,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ error: "NullPointerException at PetService.create:42" }),
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
      spec_excerpt: JSON.stringify({ summary: "Create a pet", requestBody: { required: true } }),
    }],
  }] as unknown as TestRunResult[];
}

describe("renderCaseStudy (TASK-110)", () => {
  test("fills the template with provenance + classification + spec snippet + curl", () => {
    const results = buildSampleResults();
    const step = results[0]!.steps[0]!;
    const md = renderCaseStudy({
      result: {
        id: 7, run_id: 42, suite_name: results[0]!.suite_name,
        test_name: step.name, status: step.status, duration_ms: step.duration_ms,
        request_method: step.request.method, request_url: step.request.url,
        request_body: step.request.body,
        response_status: step.response?.status ?? null,
        response_body: step.response?.body ?? null,
        response_headers: JSON.stringify(step.response!.headers),
        error_message: null, assertions: step.assertions, captures: {},
        suite_file: null,
        provenance: step.provenance ?? null,
        failure_class: step.failure_class ?? null,
        failure_class_reason: step.failure_class_reason ?? null,
        spec_pointer: step.spec_pointer ?? null,
        spec_excerpt: step.spec_excerpt ?? null,
      },
      run: {
        id: 42, started_at: results[0]!.started_at, finished_at: results[0]!.finished_at,
        total: 1, passed: 0, failed: 1, skipped: 0,
        trigger: "manual", commit_sha: "abcdef12", branch: "main",
        environment: "staging", duration_ms: 1234, collection_id: 1, session_id: null,
      },
      specTitle: "Pets API",
      specVersion: "v1.0.0",
      zondVersion: "0.0.0-test",
    });

    // Headline: method + path + short reason
    expect(md).toMatch(/^# POST \/v1\/pets — /);
    // Classification
    expect(md).toContain("definitely_bug");
    expect(md).toContain("Backend bug");
    // Spec snippet
    expect(md).toContain("#/paths/~1pets/post");
    expect(md).toContain("Create a pet");
    // Spec title from OpenAPI info
    expect(md).toContain("Pets API");
    expect(md).toContain("v1.0.0");
    // Curl in repro
    expect(md).toContain("curl -X POST");
    expect(md).toContain("api.example.test/v1/pets");
    // Response section
    expect(md).toContain("**Status:** 500");
    expect(md).toContain("NullPointerException");
    // How zond found it
    expect(md).toContain("probe-validation");
    expect(md).toContain("Asserted response branch: `400`");
    // Failed assertion echoed in "why it matters"
    expect(md).toContain("`status_in`");
    // Footer
    expect(md).toContain("zond 0.0.0-test");
    expect(md).toContain("run #42");
    expect(md).toContain("result #7");
  });

  test("uses TODO placeholders when spec snippet / classification missing", () => {
    const md = renderCaseStudy({
      result: {
        id: 1, run_id: 1, suite_name: "x", test_name: "thing",
        status: "fail", duration_ms: 0,
        request_method: "GET", request_url: "https://a.b/c",
        request_body: null, response_status: 418, response_body: null,
        response_headers: null, error_message: null,
        assertions: [], captures: {}, suite_file: null,
        provenance: null, failure_class: null, failure_class_reason: null,
        spec_pointer: null, spec_excerpt: null,
      },
      run: {
        id: 1, started_at: "2026-04-30T12:00:00Z", finished_at: null,
        total: 1, passed: 0, failed: 1, skipped: 0,
        trigger: "manual", commit_sha: null, branch: null, environment: null,
        duration_ms: null, collection_id: null, session_id: null,
      },
      zondVersion: "v",
    });
    expect(md).toContain("<TODO:");
    // Should still emit a working curl
    expect(md).toContain("curl 'https://a.b/c'");
  });

  test("env_issue gets a different TL;DR phrasing than definitely_bug", () => {
    const base = (fc: "env_issue" | "definitely_bug") => renderCaseStudy({
      result: {
        id: 1, run_id: 1, suite_name: "x", test_name: "n",
        status: "error", duration_ms: 0,
        request_method: "GET", request_url: "https://a/x",
        request_body: null, response_status: null, response_body: null,
        response_headers: null, error_message: "ECONNRESET",
        assertions: [], captures: {}, suite_file: null,
        provenance: null, failure_class: fc,
        failure_class_reason: "request failed before producing a response",
        spec_pointer: null, spec_excerpt: null,
      },
      run: {
        id: 1, started_at: "2026-04-30T12:00:00Z", finished_at: null,
        total: 1, passed: 0, failed: 1, skipped: 0,
        trigger: "manual", commit_sha: null, branch: null,
        environment: null, duration_ms: null, collection_id: null, session_id: null,
      },
      zondVersion: "v",
    });
    const env = base("env_issue");
    const bug = base("definitely_bug");
    expect(env).toContain("Environment / fixture issue");
    expect(bug).toContain("Backend bug");
    expect(env).not.toBe(bug);
  });
});

describe("zond report case-study CLI (TASK-110)", () => {
  let workDir: string;
  let dbPath: string;

  function seed(): { runId: number; resultId: number } {
    closeDb();
    getDb(dbPath);
    const collectionId = createCollection({
      name: "Pets API",
      test_path: workDir,
      // No spec file — should still succeed, just leave TODO for title.
    });
    const id = createRun({
      started_at: new Date().toISOString(),
      environment: "staging", trigger: "manual",
      branch: "main", commit_sha: "abcdef12",
      collection_id: collectionId,
    });
    saveResults(id, buildSampleResults());
    const row = getDb(dbPath).query("SELECT id FROM results WHERE run_id = ? ORDER BY id LIMIT 1").get(id) as { id: number };
    return { runId: id, resultId: row.id };
  }

  beforeEach(() => {
    workDir = mkdtempSync(join(tmpdir(), "zond-cs-"));
    dbPath = join(workDir, "test.db");
  });

  afterEach(() => {
    closeDb();
    process.chdir(originalCwd);
    rmSync(workDir, { recursive: true, force: true });
  });

  test("writes a markdown draft when -o is given", async () => {
    const { resultId } = seed();
    const out = join(workDir, "draft.md");
    const code = await reportCaseStudyCommand({
      failureId: String(resultId),
      output: out,
      dbPath,
    });
    expect(code).toBe(0);
    expect(existsSync(out)).toBe(true);
    const md = readFileSync(out, "utf8");
    expect(md).toContain("POST /v1/pets");
    expect(md).toContain("definitely_bug");
  });

  test("loads spec title/version from collection.openapi_spec when present", async () => {
    closeDb();
    getDb(dbPath);
    const specPath = join(workDir, "spec.json");
    writeFileSync(specPath, JSON.stringify({
      openapi: "3.0.0",
      info: { title: "Petstore", version: "2.1.0" },
      paths: {},
    }));
    const collectionId = createCollection({
      name: "Petstore", test_path: workDir, openapi_spec: specPath,
    });
    const runId = createRun({
      started_at: new Date().toISOString(),
      collection_id: collectionId,
    });
    saveResults(runId, buildSampleResults());
    const row = getDb(dbPath).query("SELECT id FROM results WHERE run_id = ?").get(runId) as { id: number };
    const out = join(workDir, "draft.md");
    const code = await reportCaseStudyCommand({
      failureId: String(row.id), output: out, dbPath,
    });
    expect(code).toBe(0);
    const md = readFileSync(out, "utf8");
    expect(md).toContain("Petstore");
    expect(md).toContain("2.1.0");
  });

  test("exits 1 with a friendly message for unknown failure-id", async () => {
    const code = await reportCaseStudyCommand({
      failureId: "999999",
      dbPath,
      stdout: true,
    });
    expect(code).toBe(1);
  });

  test("exits 2 on invalid failure-id input", async () => {
    const code = await reportCaseStudyCommand({
      failureId: "nope",
      dbPath,
      stdout: true,
    });
    expect(code).toBe(2);
  });
});
