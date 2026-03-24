import { describe, test, expect } from "bun:test";
import { statusHint, classifyFailure } from "../../src/core/diagnostics/failure-hints.ts";

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
