import { describe, test, expect } from "bun:test";
import { flattenBodyAssertions } from "../../../src/core/parser/schema.ts";
import { validateSuite } from "../../../src/core/parser/schema.ts";

describe("flattenBodyAssertions", () => {
  test("direct dot-notation passes through unchanged", () => {
    const input = { "a.b": { equals: 1 } };
    expect(flattenBodyAssertions(input)).toEqual({ "a.b": { equals: 1 } });
  });

  test("nested YAML flattens to dot-notation", () => {
    const input = { a: { b: { equals: 1 } } };
    expect(flattenBodyAssertions(input)).toEqual({ "a.b": { equals: 1 } });
  });

  test("deep nesting flattens correctly", () => {
    const input = { a: { b: { c: { type: "string" } } } };
    expect(flattenBodyAssertions(input)).toEqual({ "a.b.c": { type: "string" } });
  });

  test("mixed: assertion-level stays, nested flattens", () => {
    const input = {
      id: { capture: "x" },
      meta: { status: { equals: "ok" } },
    };
    expect(flattenBodyAssertions(input)).toEqual({
      id: { capture: "x" },
      "meta.status": { equals: "ok" },
    });
  });

  test("array index via dot-notation passes through", () => {
    const input = { "items.0.name": { equals: "x" } };
    expect(flattenBodyAssertions(input)).toEqual({ "items.0.name": { equals: "x" } });
  });

  test("_body key is not flattened", () => {
    const input = { _body: { type: "array" } };
    expect(flattenBodyAssertions(input)).toEqual({ _body: { type: "array" } });
  });

  test("_body.length key is not flattened", () => {
    const input = { "_body.length": { gt: 0 } };
    expect(flattenBodyAssertions(input)).toEqual({ "_body.length": { gt: 0 } });
  });

  test("multiple nested paths at same level", () => {
    const input = {
      category: { name: { equals: "Dogs" }, id: { type: "integer" } },
    };
    expect(flattenBodyAssertions(input)).toEqual({
      "category.name": { equals: "Dogs" },
      "category.id": { type: "integer" },
    });
  });
});

describe("nested assertions through full parser", () => {
  test("validates suite with nested body assertions", () => {
    const raw = {
      name: "Nested test",
      tests: [{
        name: "Check nested",
        GET: "/pets/1",
        expect: {
          status: 200,
          body: {
            category: { name: { equals: "Dogs" } },
            id: { type: "integer" },
          },
        },
      }],
    };
    const suite = validateSuite(raw);
    expect(suite.tests[0]!.expect.body).toEqual({
      "category.name": { equals: "Dogs" },
      id: { type: "integer" },
    });
  });
});
