import { describe, expect, test } from "bun:test";
import { renderCaseStudy } from "../../../src/core/exporter/case-study/index.ts";
import { buildCurl } from "../../../src/core/exporter/curl.ts";

const baseStep = {
  id: 1,
  run_id: 1,
  suite_name: "s",
  test_name: "t",
  status: "fail",
  duration_ms: 12,
  request_method: "POST",
  request_url: "https://us.sentry.io/api/0/projects/sentry/foo/keys/",
  request_body: JSON.stringify({ name: "demo" }),
  response_status: 200,
  response_body: "{}",
  response_headers: null,
  error_message: null,
  assertions: [],
  captures: {},
  suite_file: null,
  provenance: null,
  failure_class: null,
  failure_class_reason: null,
  spec_pointer: null,
  spec_excerpt: null,
} as any;

const baseRun = { id: 1, started_at: new Date().toISOString() } as any;

describe("buildCurl Authorization (ARV-106)", () => {
  test("emits redacted Authorization header for remote https URL", () => {
    const cmd = buildCurl(baseStep);
    expect(cmd).toInclude("Authorization: Bearer <REDACTED");
  });

  test("omits Authorization for localhost", () => {
    const cmd = buildCurl({ ...baseStep, request_url: "http://localhost:3000/api/x" });
    expect(cmd).not.toInclude("Authorization");
  });

  test("respects authHeader: 'omit' opt-out", () => {
    const cmd = buildCurl(baseStep, { authHeader: "omit" });
    expect(cmd).not.toInclude("Authorization");
  });
});

describe("renderCaseStudy repro & API line (ARV-106/107)", () => {
  test("curl block contains Authorization placeholder", () => {
    const md = renderCaseStudy({
      result: baseStep,
      run: baseRun,
      zondVersion: "test",
    });
    expect(md).toInclude("Authorization: Bearer <REDACTED");
  });

  test("emits `zond request` alternative when apiName is set", () => {
    const md = renderCaseStudy({
      result: baseStep,
      run: baseRun,
      apiName: "sentry",
      zondVersion: "test",
    });
    expect(md).toInclude("zond request --api sentry POST /api/0/projects/sentry/foo/keys/");
    expect(md).toInclude("--json '{\"name\":\"demo\"}'");
  });

  test("API line falls back to apiName when specTitle is null", () => {
    const md = renderCaseStudy({
      result: baseStep,
      run: baseRun,
      apiName: "sentry",
      zondVersion: "test",
    });
    expect(md).toInclude("**API:** sentry");
    expect(md).not.toInclude("<TODO: API name>");
  });

  test("specSnippet auto-extracts operation block from specDoc", () => {
    const specDoc = {
      paths: {
        "/api/0/projects/{org}/{proj}/keys/": {
          post: {
            summary: "Create a key",
            responses: { "201": { description: "ok" } },
          },
        },
      },
    };
    const md = renderCaseStudy({
      result: baseStep,
      run: baseRun,
      apiName: "sentry",
      specDoc,
      zondVersion: "test",
    });
    expect(md).not.toInclude("<TODO: paste the relevant slice");
    expect(md).toInclude("Create a key");
    expect(md).toInclude("JSON pointer:");
  });

  test("falls back to TODO when specDoc has no matching operation", () => {
    const specDoc = { paths: { "/unrelated": { get: { summary: "x" } } } };
    const md = renderCaseStudy({
      result: baseStep,
      run: baseRun,
      specDoc,
      zondVersion: "test",
    });
    expect(md).toInclude("<TODO: paste the relevant slice");
  });
});
