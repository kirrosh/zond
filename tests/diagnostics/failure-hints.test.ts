import { describe, test, expect } from "bun:test";
import { statusHint, classifyFailure, recommendedAction, softDeleteHint } from "../../src/core/diagnostics/failure-hints.ts";

describe("statusHint", () => {
  test("returns hint for 401", () => {
    expect(statusHint(401)).toContain("Auth failure");
  });

  test("returns hint for 429 rate limit", () => {
    const hint = statusHint(429);
    expect(hint).not.toBeNull();
    expect(hint).toContain("Rate limited");
    expect(hint).toContain("too many requests");
  });

  test("returns hint for 500", () => {
    expect(statusHint(500)).toContain("Server-side error");
  });

  test("returns hint for 404", () => {
    expect(statusHint(404)).toContain("not found");
  });

  test("returns hint for 400", () => {
    expect(statusHint(400)).toContain("Validation error");
  });

  test("returns null for 200", () => {
    expect(statusHint(200)).toBeNull();
  });

  test("returns null for null status", () => {
    expect(statusHint(null)).toBeNull();
  });
});

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

describe("classifyFailure", () => {
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

describe("softDeleteHint", () => {
  test("returns null when status is not 200", () => {
    expect(softDeleteHint(404, "GET", {})).toBeNull();
    expect(softDeleteHint(204, "GET", { status: "cancelled" })).toBeNull();
  });

  test("returns null when method is not GET", () => {
    expect(softDeleteHint(200, "POST", { status: "cancelled" })).toBeNull();
    expect(softDeleteHint(200, null, { status: "deleted" })).toBeNull();
  });

  test("returns soft delete hint for GET 200 with status field", () => {
    const hint = softDeleteHint(200, "GET", { status: "cancelled" });
    expect(hint).not.toBeNull();
    expect(hint).toContain("soft delete");
  });

  test("returns soft delete hint for GET 200 with state field", () => {
    const hint = softDeleteHint(200, "GET", { id: 1, state: "archived" });
    expect(hint).not.toBeNull();
    expect(hint).toContain("soft delete");
  });

  test("returns soft delete hint for GET 200 with deleted field", () => {
    const hint = softDeleteHint(200, "GET", { deleted: true });
    expect(hint).not.toBeNull();
  });

  test("returns null for GET 200 with body but no status/state/deleted field", () => {
    const hint = softDeleteHint(200, "GET", { id: 1, name: "foo" });
    expect(hint).toBeNull();
  });
});
