import { describe, test, expect } from "bun:test";
import { validateSuite, DEFAULT_CONFIG } from "../../src/core/parser/schema.ts";

describe("validateSuite", () => {
  test("parses minimal valid suite", () => {
    const suite = validateSuite({
      name: "Test",
      tests: [{ GET: "/health", name: "Health", expect: { status: 200 } }],
    });
    expect(suite.name).toBe("Test");
    expect(suite.tests).toHaveLength(1);
    expect(suite.tests[0]!.method).toBe("GET");
    expect(suite.tests[0]!.path).toBe("/health");
  });

  test("extracts method-as-key for all HTTP methods", () => {
    const methods = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;
    for (const method of methods) {
      const suite = validateSuite({
        name: "Test",
        tests: [{ [method]: "/path", name: `${method} test`, expect: {} }],
      });
      expect(suite.tests[0]!.method).toBe(method);
      expect(suite.tests[0]!.path).toBe("/path");
    }
  });

  test("applies default config when config is missing", () => {
    const suite = validateSuite({
      name: "Test",
      tests: [{ GET: "/health", name: "Health", expect: {} }],
    });
    expect(suite.config).toEqual(DEFAULT_CONFIG);
  });

  test("merges partial config with defaults", () => {
    const suite = validateSuite({
      name: "Test",
      config: { timeout: 5000 },
      tests: [{ GET: "/health", name: "Health", expect: {} }],
    });
    expect(suite.config.timeout).toBe(5000);
    expect(suite.config.retries).toBe(0);
    expect(suite.config.retry_delay).toBe(1000);
    expect(suite.config.follow_redirects).toBe(true);
  });

  test("parses all assertion rule fields", () => {
    const suite = validateSuite({
      name: "Test",
      tests: [{
        GET: "/users",
        name: "Test",
        expect: {
          status: 200,
          duration: 1000,
          headers: { "content-type": "application/json" },
          body: {
            id: { capture: "user_id", type: "integer", equals: 1 },
            name: { contains: "John", matches: "^J.*" },
            age: { gt: 18, lt: 100 },
            active: { exists: true },
          },
        },
      }],
    });
    const body = suite.tests[0]!.expect.body!;
    expect(body["id"]!.capture).toBe("user_id");
    expect(body["id"]!.type).toBe("integer");
    expect(body["name"]!.contains).toBe("John");
    expect(body["age"]!.gt).toBe(18);
    expect(body["active"]!.exists).toBe(true);
  });

  test("parses json, form, query, headers on step", () => {
    const suite = validateSuite({
      name: "Test",
      tests: [{
        POST: "/users",
        name: "Create",
        headers: { "X-Custom": "value" },
        json: { name: "John" },
        query: { page: "1" },
        expect: { status: 201 },
      }],
    });
    const step = suite.tests[0]!;
    expect(step.headers).toEqual({ "X-Custom": "value" });
    expect(step.json).toEqual({ name: "John" });
    expect(step.query).toEqual({ page: "1" });
  });

  test("throws on missing name", () => {
    expect(() => validateSuite({
      tests: [{ GET: "/health", name: "Health", expect: {} }],
    })).toThrow();
  });

  test("throws on missing method key in step", () => {
    expect(() => validateSuite({
      name: "Test",
      tests: [{ name: "Bad", path: "/health", expect: {} }],
    })).toThrow();
  });

  test("throws on ambiguous method keys", () => {
    expect(() => validateSuite({
      name: "Test",
      tests: [{ GET: "/a", POST: "/b", name: "Ambiguous", expect: {} }],
    })).toThrow(/Ambiguous/);
  });

  test("throws on empty tests array", () => {
    expect(() => validateSuite({ name: "Test", tests: [] })).toThrow();
  });

  test("throws on non-string method path", () => {
    expect(() => validateSuite({
      name: "Test",
      tests: [{ GET: 123, name: "Bad", expect: {} }],
    })).toThrow();
  });

  test("parses base_url and suite headers", () => {
    const suite = validateSuite({
      name: "Test",
      base_url: "http://localhost:3000",
      headers: { Authorization: "Bearer token" },
      tests: [{ GET: "/health", name: "Health", expect: {} }],
    });
    expect(suite.base_url).toBe("http://localhost:3000");
    expect(suite.headers).toEqual({ Authorization: "Bearer token" });
  });
});
