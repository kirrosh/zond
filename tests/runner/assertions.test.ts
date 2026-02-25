import { describe, test, expect } from "bun:test";
import { checkAssertions, extractCaptures } from "../../src/core/runner/assertions.ts";
import type { HttpResponse } from "../../src/core/runner/types.ts";

function makeResponse(overrides: Partial<HttpResponse> = {}): HttpResponse {
  return {
    status: 200,
    headers: { "content-type": "application/json" },
    body: "{}",
    body_parsed: {},
    duration_ms: 100,
    ...overrides,
  };
}

describe("checkAssertions", () => {
  describe("status", () => {
    test("passes when status matches", () => {
      const results = checkAssertions({ status: 200 }, makeResponse({ status: 200 }));
      expect(results).toHaveLength(1);
      expect(results[0]!.passed).toBe(true);
      expect(results[0]!.field).toBe("status");
    });

    test("fails when status does not match", () => {
      const results = checkAssertions({ status: 201 }, makeResponse({ status: 200 }));
      expect(results[0]!.passed).toBe(false);
      expect(results[0]!.actual).toBe(200);
      expect(results[0]!.expected).toBe(201);
    });
  });

  describe("duration", () => {
    test("passes when duration is within limit", () => {
      const results = checkAssertions({ duration: 200 }, makeResponse({ duration_ms: 100 }));
      expect(results[0]!.passed).toBe(true);
    });

    test("fails when duration exceeds limit", () => {
      const results = checkAssertions({ duration: 50 }, makeResponse({ duration_ms: 100 }));
      expect(results[0]!.passed).toBe(false);
    });
  });

  describe("headers", () => {
    test("passes when header matches", () => {
      const results = checkAssertions(
        { headers: { "content-type": "application/json" } },
        makeResponse({ headers: { "content-type": "application/json" } }),
      );
      expect(results[0]!.passed).toBe(true);
    });

    test("fails when header does not match", () => {
      const results = checkAssertions(
        { headers: { "content-type": "text/plain" } },
        makeResponse({ headers: { "content-type": "application/json" } }),
      );
      expect(results[0]!.passed).toBe(false);
    });
  });

  describe("body type assertions", () => {
    test("string type", () => {
      const res = makeResponse({ body_parsed: { name: "John" } });
      const results = checkAssertions({ body: { name: { type: "string" } } }, res);
      expect(results[0]!.passed).toBe(true);
    });

    test("integer type", () => {
      const res = makeResponse({ body_parsed: { id: 42 } });
      const results = checkAssertions({ body: { id: { type: "integer" } } }, res);
      expect(results[0]!.passed).toBe(true);
    });

    test("integer type fails for float", () => {
      const res = makeResponse({ body_parsed: { val: 3.14 } });
      const results = checkAssertions({ body: { val: { type: "integer" } } }, res);
      expect(results[0]!.passed).toBe(false);
    });

    test("number type", () => {
      const res = makeResponse({ body_parsed: { val: 3.14 } });
      const results = checkAssertions({ body: { val: { type: "number" } } }, res);
      expect(results[0]!.passed).toBe(true);
    });

    test("boolean type", () => {
      const res = makeResponse({ body_parsed: { active: true } });
      const results = checkAssertions({ body: { active: { type: "boolean" } } }, res);
      expect(results[0]!.passed).toBe(true);
    });

    test("array type", () => {
      const res = makeResponse({ body_parsed: { items: [1, 2, 3] } });
      const results = checkAssertions({ body: { items: { type: "array" } } }, res);
      expect(results[0]!.passed).toBe(true);
    });

    test("object type", () => {
      const res = makeResponse({ body_parsed: { data: { nested: true } } });
      const results = checkAssertions({ body: { data: { type: "object" } } }, res);
      expect(results[0]!.passed).toBe(true);
    });

    test("object type fails for array", () => {
      const res = makeResponse({ body_parsed: { data: [1] } });
      const results = checkAssertions({ body: { data: { type: "object" } } }, res);
      expect(results[0]!.passed).toBe(false);
    });
  });

  describe("body equals", () => {
    test("exact primitive match", () => {
      const res = makeResponse({ body_parsed: { id: 1 } });
      const results = checkAssertions({ body: { id: { equals: 1 } } }, res);
      expect(results[0]!.passed).toBe(true);
    });

    test("string match", () => {
      const res = makeResponse({ body_parsed: { name: "John" } });
      const results = checkAssertions({ body: { name: { equals: "John" } } }, res);
      expect(results[0]!.passed).toBe(true);
    });

    test("loose numeric comparison", () => {
      const res = makeResponse({ body_parsed: { id: 123 } });
      const results = checkAssertions({ body: { id: { equals: "123" } } }, res);
      expect(results[0]!.passed).toBe(true);
    });

    test("fails on mismatch", () => {
      const res = makeResponse({ body_parsed: { id: 1 } });
      const results = checkAssertions({ body: { id: { equals: 2 } } }, res);
      expect(results[0]!.passed).toBe(false);
    });
  });

  describe("body contains", () => {
    test("passes when string contains substring", () => {
      const res = makeResponse({ body_parsed: { msg: "hello world" } });
      const results = checkAssertions({ body: { msg: { contains: "world" } } }, res);
      expect(results[0]!.passed).toBe(true);
    });

    test("fails when not a string", () => {
      const res = makeResponse({ body_parsed: { val: 42 } });
      const results = checkAssertions({ body: { val: { contains: "42" } } }, res);
      expect(results[0]!.passed).toBe(false);
    });
  });

  describe("body matches", () => {
    test("passes when regex matches", () => {
      const res = makeResponse({ body_parsed: { email: "test@example.com" } });
      const results = checkAssertions({ body: { email: { matches: ".+@.+" } } }, res);
      expect(results[0]!.passed).toBe(true);
    });

    test("fails when regex does not match", () => {
      const res = makeResponse({ body_parsed: { email: "invalid" } });
      const results = checkAssertions({ body: { email: { matches: ".+@.+" } } }, res);
      expect(results[0]!.passed).toBe(false);
    });
  });

  describe("body gt/lt", () => {
    test("gt passes when value is greater", () => {
      const res = makeResponse({ body_parsed: { count: 10 } });
      const results = checkAssertions({ body: { count: { gt: 5 } } }, res);
      expect(results[0]!.passed).toBe(true);
    });

    test("gt fails when value is not greater", () => {
      const res = makeResponse({ body_parsed: { count: 3 } });
      const results = checkAssertions({ body: { count: { gt: 5 } } }, res);
      expect(results[0]!.passed).toBe(false);
    });

    test("lt passes when value is less", () => {
      const res = makeResponse({ body_parsed: { count: 3 } });
      const results = checkAssertions({ body: { count: { lt: 5 } } }, res);
      expect(results[0]!.passed).toBe(true);
    });
  });

  describe("body exists", () => {
    test("exists: true passes when field exists", () => {
      const res = makeResponse({ body_parsed: { name: "John" } });
      const results = checkAssertions({ body: { name: { exists: true } } }, res);
      expect(results[0]!.passed).toBe(true);
    });

    test("exists: true fails when field is missing", () => {
      const res = makeResponse({ body_parsed: {} });
      const results = checkAssertions({ body: { name: { exists: true } } }, res);
      expect(results[0]!.passed).toBe(false);
    });

    test("exists: false passes when field is missing", () => {
      const res = makeResponse({ body_parsed: {} });
      const results = checkAssertions({ body: { name: { exists: false } } }, res);
      expect(results[0]!.passed).toBe(true);
    });
  });

  describe("nested paths", () => {
    test("accesses deeply nested field", () => {
      const res = makeResponse({ body_parsed: { data: { user: { name: "John" } } } });
      const results = checkAssertions({ body: { "data.user.name": { equals: "John" } } }, res);
      expect(results[0]!.passed).toBe(true);
    });
  });

  describe("multiple assertions on same field", () => {
    test("checks both type and capture", () => {
      const res = makeResponse({ body_parsed: { id: 42 } });
      const results = checkAssertions({ body: { id: { type: "integer", gt: 0 } } }, res);
      expect(results).toHaveLength(2);
      expect(results.every((r) => r.passed)).toBe(true);
    });
  });

  test("returns empty array when no assertions", () => {
    const results = checkAssertions({}, makeResponse());
    expect(results).toEqual([]);
  });
});

describe("extractCaptures", () => {
  test("extracts captures from response body", () => {
    const captures = extractCaptures(
      { id: { capture: "user_id" }, name: { type: "string" } },
      { id: 42, name: "John" },
    );
    expect(captures).toEqual({ user_id: 42 });
  });

  test("extracts nested captures", () => {
    const captures = extractCaptures(
      { "data.id": { capture: "item_id" } },
      { data: { id: 99 } },
    );
    expect(captures).toEqual({ item_id: 99 });
  });

  test("skips capture when field is undefined", () => {
    const captures = extractCaptures(
      { missing: { capture: "val" } },
      { other: 1 },
    );
    expect(captures).toEqual({});
  });

  test("returns empty when no body rules", () => {
    expect(extractCaptures(undefined, { id: 1 })).toEqual({});
  });

  test("returns empty when body is undefined", () => {
    expect(extractCaptures({ id: { capture: "x" } }, undefined)).toEqual({});
  });
});
