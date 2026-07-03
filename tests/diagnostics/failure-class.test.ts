import { describe, test, expect } from "bun:test";
import { classifyFailure } from "../../src/core/diagnostics/failure-class.ts";
import type { StepResult } from "../../src/core/runner/types.ts";

function baseResult(overrides: Partial<StepResult> = {}): StepResult {
  return {
    name: "step",
    status: "fail",
    duration_ms: 10,
    request: { method: "GET", url: "http://x/y", headers: {} },
    response: { status: 200, headers: {}, body: "{}", duration_ms: 10 },
    assertions: [],
    captures: {},
    ...overrides,
  };
}

describe("classifyFailure (FailureClassDescriptor, from failure-class)", () => {
  test("pass → null", () => {
    expect(classifyFailure(baseResult({ status: "pass" }))).toBeNull();
  });

  test("skip → null", () => {
    expect(classifyFailure(baseResult({ status: "skip" }))).toBeNull();
  });

  test("error → env_issue with reason from result.error", () => {
    const r = baseResult({ status: "error", error: "ECONNREFUSED" });
    const c = classifyFailure(r);
    expect(c?.failure_class).toBe("env_issue");
    expect(c?.failure_class_reason).toContain("ECONNREFUSED");
  });

  test("5xx response → definitely_bug", () => {
    const r = baseResult({
      response: { status: 503, headers: {}, body: "", duration_ms: 5 },
      assertions: [
        { field: "status", rule: "equals 200", passed: false, actual: 503, expected: 200 },
      ],
    });
    const c = classifyFailure(r);
    expect(c?.failure_class).toBe("definitely_bug");
    expect(c?.failure_class_reason).toContain("503");
  });

  test("schema validation failure → definitely_bug", () => {
    const r = baseResult({
      response: { status: 200, headers: {}, body: "{}", duration_ms: 5 },
      assertions: [
        { field: "body.id", rule: "schema.required", passed: false, actual: undefined, expected: "id" },
      ],
    });
    const c = classifyFailure(r);
    expect(c?.failure_class).toBe("definitely_bug");
    expect(c?.failure_class_reason).toContain("schema");
  });

  test("mass-assignment-probe + not_equals failure → definitely_bug", () => {
    const r = baseResult({
      response: { status: 200, headers: {}, body: "{}", duration_ms: 5 },
      provenance: { generator: "mass-assignment-probe", endpoint: "POST /x" },
      assertions: [
        { field: "is_admin", rule: "not_equals true", passed: false, actual: true, expected: true },
      ],
    });
    const c = classifyFailure(r);
    expect(c?.failure_class).toBe("definitely_bug");
    expect(c?.failure_class_reason).toContain("Mass-assignment");
  });

  test("negative-probe expected 4xx, got 2xx → likely_bug", () => {
    const r = baseResult({
      response: { status: 200, headers: {}, body: "{}", duration_ms: 5 },
      provenance: { generator: "negative-probe", endpoint: "POST /webhooks" },
      assertions: [
        { field: "status", rule: "one of [400, 422]", passed: false, actual: 200, expected: [400, 422] },
      ],
    });
    const c = classifyFailure(r);
    expect(c?.failure_class).toBe("likely_bug");
    expect(c?.failure_class_reason).toContain("got 200");
  });

  test("negative-probe expected 4xx, got different 4xx → quirk", () => {
    const r = baseResult({
      response: { status: 400, headers: {}, body: "{}", duration_ms: 5 },
      provenance: { generator: "negative-probe", endpoint: "POST /webhooks" },
      assertions: [
        { field: "status", rule: "equals 422", passed: false, actual: 400, expected: 422 },
      ],
    });
    const c = classifyFailure(r);
    expect(c?.failure_class).toBe("quirk");
    expect(c?.failure_class_reason).toContain("400");
  });

  test("ARV-236: 401 where test expected 200 → env_issue (token_scope)", () => {
    const r = baseResult({
      response: { status: 401, headers: {}, body: "{}", duration_ms: 5 },
      assertions: [
        { field: "status", rule: "equals 200", passed: false, actual: 401, expected: 200 },
      ],
    });
    const c = classifyFailure(r);
    expect(c?.failure_class).toBe("env_issue");
    expect(c?.failure_class_reason).toContain("token_scope");
    expect(c?.failure_class_reason).toContain("401");
  });

  test("ARV-236: 403 where test expected 200 → env_issue (token_scope)", () => {
    const r = baseResult({
      response: { status: 403, headers: {}, body: "{}", duration_ms: 5 },
      assertions: [
        { field: "status", rule: "equals 200", passed: false, actual: 403, expected: 200 },
      ],
    });
    const c = classifyFailure(r);
    expect(c?.failure_class).toBe("env_issue");
    expect(c?.failure_class_reason).toContain("token_scope");
  });

  test("ARV-236: 403 where test deliberately expected 403 → still classifies normally (no override)", () => {
    // A negative-probe expecting 403 shouldn't be touched by the
    // token_scope rule — only fires when expected was 2xx.
    const r = baseResult({
      response: { status: 403, headers: {}, body: "{}", duration_ms: 5 },
      provenance: { generator: "negative-probe", endpoint: "GET /admin" },
      assertions: [
        { field: "status", rule: "equals 401", passed: false, actual: 403, expected: 401 },
      ],
    });
    const c = classifyFailure(r);
    expect(c?.failure_class).toBe("quirk");
  });

  test("plain assertion failure without generator → null (unclassified)", () => {
    const r = baseResult({
      response: { status: 200, headers: {}, body: '{"name":"X"}', duration_ms: 5 },
      assertions: [
        { field: "body.name", rule: "equals Y", passed: false, actual: "X", expected: "Y" },
      ],
    });
    expect(classifyFailure(r)).toBeNull();
  });
});
