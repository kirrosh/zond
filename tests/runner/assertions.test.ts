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

    test("passes when status is in allowed array", () => {
      const results = checkAssertions({ status: [200, 204] }, makeResponse({ status: 204 }));
      expect(results[0]!.passed).toBe(true);
      expect(results[0]!.rule).toBe("one of [200, 204]");
    });

    test("passes when status matches first element of array", () => {
      const results = checkAssertions({ status: [200, 201] }, makeResponse({ status: 200 }));
      expect(results[0]!.passed).toBe(true);
    });

    test("fails when status is not in allowed array", () => {
      const results = checkAssertions({ status: [200, 204] }, makeResponse({ status: 404 }));
      expect(results[0]!.passed).toBe(false);
      expect(results[0]!.actual).toBe(404);
    });

    test("single-element array uses equals rule format", () => {
      const results = checkAssertions({ status: [200] }, makeResponse({ status: 200 }));
      expect(results[0]!.passed).toBe(true);
      expect(results[0]!.rule).toBe("equals 200");
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

    // T43 — key-presence semantics: null is "present"
    test("exists: true passes when field is null (key present)", () => {
      const res = makeResponse({ body_parsed: { schema: null } });
      const results = checkAssertions({ body: { schema: { exists: true } } }, res);
      expect(results[0]!.passed).toBe(true);
    });

    test("exists: false fails when field is null (key still present)", () => {
      const res = makeResponse({ body_parsed: { schema: null } });
      const results = checkAssertions({ body: { schema: { exists: false } } }, res);
      expect(results[0]!.passed).toBe(false);
    });
  });

  // T43 — type: "null"
  describe("type: null assertion", () => {
    test("type: null passes on null value", () => {
      const res = makeResponse({ body_parsed: { schema: null } });
      const results = checkAssertions({ body: { schema: { type: "null" } } }, res);
      expect(results[0]!.passed).toBe(true);
    });

    test("type: null fails on non-null value", () => {
      const res = makeResponse({ body_parsed: { schema: {} } });
      const results = checkAssertions({ body: { schema: { type: "null" } } }, res);
      expect(results[0]!.passed).toBe(false);
    });

    test("type: null fails on missing key", () => {
      const res = makeResponse({ body_parsed: {} });
      const results = checkAssertions({ body: { schema: { type: "null" } } }, res);
      expect(results[0]!.passed).toBe(false);
    });

    test("type: object fails on null (regression check — null is not object)", () => {
      const res = makeResponse({ body_parsed: { schema: null } });
      const results = checkAssertions({ body: { schema: { type: "object" } } }, res);
      expect(results[0]!.passed).toBe(false);
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

describe("new assertion operators", () => {
  describe("not_equals", () => {
    test("passes when values differ", () => {
      const res = makeResponse({ body_parsed: { status: "active" } });
      const results = checkAssertions({ body: { status: { not_equals: "deleted" } } }, res);
      expect(results[0]!.passed).toBe(true);
    });

    test("fails when values are equal", () => {
      const res = makeResponse({ body_parsed: { status: "deleted" } });
      const results = checkAssertions({ body: { status: { not_equals: "deleted" } } }, res);
      expect(results[0]!.passed).toBe(false);
    });
  });

  describe("not_contains", () => {
    test("passes when string does not contain substring", () => {
      const res = makeResponse({ body_parsed: { msg: "all good" } });
      const results = checkAssertions({ body: { msg: { not_contains: "error" } } }, res);
      expect(results[0]!.passed).toBe(true);
    });

    test("fails when string contains substring", () => {
      const res = makeResponse({ body_parsed: { msg: "fatal error" } });
      const results = checkAssertions({ body: { msg: { not_contains: "error" } } }, res);
      expect(results[0]!.passed).toBe(false);
    });

    test("fails when not a string", () => {
      const res = makeResponse({ body_parsed: { val: 42 } });
      const results = checkAssertions({ body: { val: { not_contains: "42" } } }, res);
      expect(results[0]!.passed).toBe(false);
    });
  });

  describe("gte / lte", () => {
    test("gte passes when equal", () => {
      const res = makeResponse({ body_parsed: { count: 5 } });
      const results = checkAssertions({ body: { count: { gte: 5 } } }, res);
      expect(results[0]!.passed).toBe(true);
    });

    test("gte passes when greater", () => {
      const res = makeResponse({ body_parsed: { count: 10 } });
      const results = checkAssertions({ body: { count: { gte: 5 } } }, res);
      expect(results[0]!.passed).toBe(true);
    });

    test("gte fails when less", () => {
      const res = makeResponse({ body_parsed: { count: 3 } });
      const results = checkAssertions({ body: { count: { gte: 5 } } }, res);
      expect(results[0]!.passed).toBe(false);
    });

    test("lte passes when equal", () => {
      const res = makeResponse({ body_parsed: { count: 5 } });
      const results = checkAssertions({ body: { count: { lte: 5 } } }, res);
      expect(results[0]!.passed).toBe(true);
    });

    test("lte passes when less", () => {
      const res = makeResponse({ body_parsed: { count: 3 } });
      const results = checkAssertions({ body: { count: { lte: 5 } } }, res);
      expect(results[0]!.passed).toBe(true);
    });

    test("lte fails when greater", () => {
      const res = makeResponse({ body_parsed: { count: 10 } });
      const results = checkAssertions({ body: { count: { lte: 5 } } }, res);
      expect(results[0]!.passed).toBe(false);
    });
  });

  describe("length", () => {
    test("passes for array with exact length", () => {
      const res = makeResponse({ body_parsed: { items: [1, 2, 3] } });
      const results = checkAssertions({ body: { items: { length: 3 } } }, res);
      expect(results[0]!.passed).toBe(true);
    });

    test("passes for string with exact length", () => {
      const res = makeResponse({ body_parsed: { code: "abc" } });
      const results = checkAssertions({ body: { code: { length: 3 } } }, res);
      expect(results[0]!.passed).toBe(true);
    });

    test("fails for wrong length", () => {
      const res = makeResponse({ body_parsed: { items: [1, 2] } });
      const results = checkAssertions({ body: { items: { length: 3 } } }, res);
      expect(results[0]!.passed).toBe(false);
    });

    test("fails for non-array non-string", () => {
      const res = makeResponse({ body_parsed: { val: 42 } });
      const results = checkAssertions({ body: { val: { length: 2 } } }, res);
      expect(results[0]!.passed).toBe(false);
    });
  });

  describe("length_gt/gte/lt/lte", () => {
    test("length_gt passes", () => {
      const res = makeResponse({ body_parsed: { items: [1, 2, 3] } });
      const results = checkAssertions({ body: { items: { length_gt: 2 } } }, res);
      expect(results[0]!.passed).toBe(true);
    });

    test("length_gt fails at boundary", () => {
      const res = makeResponse({ body_parsed: { items: [1, 2] } });
      const results = checkAssertions({ body: { items: { length_gt: 2 } } }, res);
      expect(results[0]!.passed).toBe(false);
    });

    test("length_gte passes at boundary", () => {
      const res = makeResponse({ body_parsed: { items: [1, 2] } });
      const results = checkAssertions({ body: { items: { length_gte: 2 } } }, res);
      expect(results[0]!.passed).toBe(true);
    });

    test("length_lt passes", () => {
      const res = makeResponse({ body_parsed: { items: [1] } });
      const results = checkAssertions({ body: { items: { length_lt: 2 } } }, res);
      expect(results[0]!.passed).toBe(true);
    });

    test("length_lte passes at boundary", () => {
      const res = makeResponse({ body_parsed: { items: [1, 2] } });
      const results = checkAssertions({ body: { items: { length_lte: 2 } } }, res);
      expect(results[0]!.passed).toBe(true);
    });
  });

  describe("each", () => {
    test("passes when all items match", () => {
      const res = makeResponse({ body_parsed: { items: [{ id: 1, active: true }, { id: 2, active: true }] } });
      const results = checkAssertions({ body: { items: { each: { active: { equals: true } } } } }, res);
      expect(results.every(r => r.passed)).toBe(true);
    });

    test("fails when one item does not match", () => {
      const res = makeResponse({ body_parsed: { items: [{ id: 1, active: true }, { id: 2, active: false }] } });
      const results = checkAssertions({ body: { items: { each: { active: { equals: true } } } } }, res);
      expect(results.some(r => !r.passed)).toBe(true);
    });

    test("fails when value is not an array", () => {
      const res = makeResponse({ body_parsed: { items: "not_array" } });
      const results = checkAssertions({ body: { items: { each: { id: { exists: true } } } } }, res);
      expect(results[0]!.passed).toBe(false);
    });
  });

  describe("contains_item", () => {
    test("passes when at least one item matches", () => {
      const res = makeResponse({ body_parsed: { items: [{ name: "foo" }, { name: "test-bar" }] } });
      const results = checkAssertions({ body: { items: { contains_item: { name: { contains: "test" } } } } }, res);
      expect(results[0]!.passed).toBe(true);
    });

    test("fails when no item matches", () => {
      const res = makeResponse({ body_parsed: { items: [{ name: "foo" }, { name: "bar" }] } });
      const results = checkAssertions({ body: { items: { contains_item: { name: { contains: "test" } } } } }, res);
      expect(results[0]!.passed).toBe(false);
    });

    test("fails when value is not an array", () => {
      const res = makeResponse({ body_parsed: { items: 42 } });
      const results = checkAssertions({ body: { items: { contains_item: { id: { exists: true } } } } }, res);
      expect(results[0]!.passed).toBe(false);
    });
  });

  describe("set_equals", () => {
    test("passes for same elements in different order", () => {
      const res = makeResponse({ body_parsed: { ids: [3, 1, 2] } });
      const results = checkAssertions({ body: { ids: { set_equals: [1, 2, 3] } } }, res);
      expect(results[0]!.passed).toBe(true);
    });

    test("fails for different elements", () => {
      const res = makeResponse({ body_parsed: { ids: [1, 2, 4] } });
      const results = checkAssertions({ body: { ids: { set_equals: [1, 2, 3] } } }, res);
      expect(results[0]!.passed).toBe(false);
    });

    test("fails for different sizes", () => {
      const res = makeResponse({ body_parsed: { ids: [1, 2] } });
      const results = checkAssertions({ body: { ids: { set_equals: [1, 2, 3] } } }, res);
      expect(results[0]!.passed).toBe(false);
    });

    test("fails when actual is not an array", () => {
      const res = makeResponse({ body_parsed: { ids: "not_array" } });
      const results = checkAssertions({ body: { ids: { set_equals: [1, 2] } } }, res);
      expect(results[0]!.passed).toBe(false);
    });
  });
});
