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

  test("parses status as array", () => {
    const suite = validateSuite({
      name: "Test",
      tests: [{ DELETE: "/items/1", name: "Delete", expect: { status: [200, 204] } }],
    });
    expect(suite.tests[0]!.expect.status).toEqual([200, 204]);
  });

  test("parses status as single integer", () => {
    const suite = validateSuite({
      name: "Test",
      tests: [{ GET: "/health", name: "Health", expect: { status: 200 } }],
    });
    expect(suite.tests[0]!.expect.status).toBe(200);
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

  test("parses skip_if on step", () => {
    const suite = validateSuite({
      name: "Test",
      tests: [{ GET: "/health", name: "Conditional", skip_if: "{{flag}} == true", expect: {} }],
    });
    expect(suite.tests[0]!.skip_if).toBe("{{flag}} == true");
  });

  test("parses retry_until on step", () => {
    const suite = validateSuite({
      name: "Test",
      tests: [{
        GET: "/job/1",
        name: "Retry",
        retry_until: { condition: "{{status}} == done", max_attempts: 5, delay_ms: 1000 },
        expect: {},
      }],
    });
    expect(suite.tests[0]!.retry_until).toEqual({ condition: "{{status}} == done", max_attempts: 5, delay_ms: 1000 });
  });

  test("parses for_each on step", () => {
    const suite = validateSuite({
      name: "Test",
      tests: [{
        DELETE: "/items/{{id}}",
        name: "Delete",
        for_each: { var: "id", in: [1, 2, 3] },
        expect: { status: 204 },
      }],
    });
    expect(suite.tests[0]!.for_each).toEqual({ var: "id", in: [1, 2, 3] });
  });

  test("parses set-only step without HTTP method", () => {
    const suite = validateSuite({
      name: "Test",
      tests: [
        { name: "Set vars", set: { greeting: "hello" } },
        { GET: "/test", name: "Use", expect: { status: 200 } },
      ],
    });
    expect(suite.tests[0]!.set).toEqual({ greeting: "hello" });
    expect(suite.tests[0]!.path).toBe("");
  });

  test("parses new assertion operators", () => {
    const suite = validateSuite({
      name: "Test",
      tests: [{
        GET: "/data",
        name: "Assertions",
        expect: {
          status: 200,
          body: {
            status: { not_equals: "deleted" },
            msg: { not_contains: "error" },
            count: { gte: 1, lte: 100 },
            items: { length: 5, length_gt: 0 },
            tags: { set_equals: ["a", "b"] },
          },
        },
      }],
    });
    const body = suite.tests[0]!.expect.body!;
    expect(body["status"]!.not_equals).toBe("deleted");
    expect(body["msg"]!.not_contains).toBe("error");
    expect(body["count"]!.gte).toBe(1);
    expect(body["count"]!.lte).toBe(100);
    expect(body["items"]!.length).toBe(5);
    expect(body["items"]!.length_gt).toBe(0);
    expect(body["tags"]!.set_equals).toEqual(["a", "b"]);
  });

  test("parses each and contains_item assertions", () => {
    const suite = validateSuite({
      name: "Test",
      tests: [{
        GET: "/data",
        name: "Array assertions",
        expect: {
          status: 200,
          body: {
            items: { each: { id: { type: "integer" } } },
            results: { contains_item: { name: { contains: "test" } } },
          },
        },
      }],
    });
    const body = suite.tests[0]!.expect.body!;
    expect(body["items"]!.each).toBeDefined();
    expect(body["items"]!.each!["id"]!.type).toBe("integer");
    expect(body["results"]!.contains_item).toBeDefined();
    expect(body["results"]!.contains_item!["name"]!.contains).toBe("test");
  });

  test("parses setup: true flag", () => {
    const suite = validateSuite({
      name: "auth",
      setup: true,
      tests: [{ POST: "/auth/login", name: "login", expect: { status: 200 } }],
    });
    expect(suite.setup).toBe(true);
  });

  test("setup defaults to undefined when not set", () => {
    const suite = validateSuite({
      name: "regular",
      tests: [{ GET: "/health", name: "health", expect: { status: 200 } }],
    });
    expect(suite.setup).toBeUndefined();
  });
});
