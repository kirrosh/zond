import { describe, test, expect } from "bun:test";
import { classifyFailure, recommendedAction, recommendedActionForGenerated, isGeneratedTest } from "../../src/core/diagnostics/failure-hints.ts";

describe("recommendedAction", () => {
  test("api_error always returns report_backend_bug", () => {
    expect(recommendedAction("api_error", 500)).toBe("report_backend_bug");
    expect(recommendedAction("api_error", 503)).toBe("report_backend_bug");
  });

  test("assertion_failed with 401/403 returns fix_auth_config", () => {
    expect(recommendedAction("assertion_failed", 401)).toBe("fix_auth_config");
    expect(recommendedAction("assertion_failed", 403)).toBe("fix_auth_config");
  });

  test("assertion_failed with other status returns fix_test_logic", () => {
    expect(recommendedAction("assertion_failed", 404)).toBe("fix_test_logic");
    expect(recommendedAction("assertion_failed", 200)).toBe("fix_test_logic");
  });

  test("network_error with null status returns fix_network_config", () => {
    expect(recommendedAction("network_error", null)).toBe("fix_network_config");
  });

  test("network_error with 401/403 returns fix_auth_config", () => {
    expect(recommendedAction("network_error", 401)).toBe("fix_auth_config");
    expect(recommendedAction("network_error", 403)).toBe("fix_auth_config");
  });
});

// ARV-42
describe("recommendedActionForGenerated", () => {
  test("non-generated test: behaviour matches plain recommendedAction", () => {
    expect(recommendedActionForGenerated("assertion_failed", 422, false)).toBe("fix_test_logic");
    expect(recommendedActionForGenerated("assertion_failed", 404, false)).toBe("fix_test_logic");
    expect(recommendedActionForGenerated("api_error", 500, false)).toBe("report_backend_bug");
  });

  test("generated test 422/400: routes to regenerate_suite (editing YAML gets clobbered)", () => {
    expect(recommendedActionForGenerated("assertion_failed", 422, true)).toBe("regenerate_suite");
    expect(recommendedActionForGenerated("assertion_failed", 400, true)).toBe("regenerate_suite");
  });

  test("generated test 404: routes to fix_fixture (path-param needs seeding)", () => {
    expect(recommendedActionForGenerated("assertion_failed", 404, true)).toBe("fix_fixture");
  });

  test("generated test 401/403: still fix_auth_config (auth config not generator's fault)", () => {
    expect(recommendedActionForGenerated("assertion_failed", 401, true)).toBe("fix_auth_config");
    expect(recommendedActionForGenerated("assertion_failed", 403, true)).toBe("fix_auth_config");
  });

  test("generated test 5xx: still report_backend_bug", () => {
    expect(recommendedActionForGenerated("api_error", 500, true)).toBe("report_backend_bug");
  });
});

describe("isGeneratedTest", () => {
  test("provenance.type = openapi-generated → true", () => {
    expect(isGeneratedTest({ type: "openapi-generated" }, null)).toBe(true);
  });

  test("provenance.generator mentioning zond → true", () => {
    expect(isGeneratedTest({ generator: "zond-generate" }, null)).toBe(true);
  });

  test("suite_file under apis/<api>/tests/ → true", () => {
    expect(isGeneratedTest(null, "apis/resend/tests/smoke-emails-positive.yaml")).toBe(true);
    expect(isGeneratedTest(null, "/abs/repo/apis/resend/tests/crud-domains.yaml")).toBe(true);
  });

  test("manual suite_file outside apis/<api>/tests/ → false", () => {
    expect(isGeneratedTest(null, "manual/login.yaml")).toBe(false);
    expect(isGeneratedTest(null, "apis/resend/probes/static/POST_emails-validation.yaml")).toBe(false);
    expect(isGeneratedTest(null, null)).toBe(false);
  });
});

describe("classifyFailure (string label, from failure-hints)", () => {
  test("network_error when status is error and no response", () => {
    expect(classifyFailure("error", null)).toBe("network_error");
  });

  test("api_error for 500+", () => {
    expect(classifyFailure("fail", 500)).toBe("api_error");
    expect(classifyFailure("fail", 502)).toBe("api_error");
  });

  test("assertion_failed for 4xx", () => {
    expect(classifyFailure("fail", 401)).toBe("assertion_failed");
    expect(classifyFailure("fail", 429)).toBe("assertion_failed");
  });
});
