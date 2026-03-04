import { describe, test, expect } from "bun:test";
import { compressSchema, formatParam, decycleSchema } from "../../../src/core/generator/schema-utils.ts";
import type { OpenAPIV3 } from "openapi-types";

describe("compressSchema", () => {
  test("compresses simple object with required fields", () => {
    const schema: OpenAPIV3.SchemaObject = {
      type: "object",
      required: ["name", "email"],
      properties: {
        name: { type: "string" },
        email: { type: "string", format: "email" },
        age: { type: "integer" },
      },
    };
    const result = compressSchema(schema);
    expect(result).toBe("{ name: string (req), email: string (req, email), age: integer }");
  });

  test("compresses array of objects", () => {
    const schema: OpenAPIV3.SchemaObject = {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "integer" },
          name: { type: "string" },
        },
      },
    };
    const result = compressSchema(schema);
    expect(result).toBe("[{ id: integer, name: string }]");
  });

  test("compresses enum fields", () => {
    const schema: OpenAPIV3.SchemaObject = {
      type: "object",
      properties: {
        status: { type: "string", enum: ["active", "inactive", "pending"] },
      },
    };
    const result = compressSchema(schema);
    expect(result).toBe("{ status: string (enum: active|inactive|pending) }");
  });

  test("returns {…} at max depth", () => {
    // compressSchema at depth 0 renders the outer object
    // depth 1 renders inner properties, depth 2 renders deeper, depth > 2 returns {...}
    const schema: OpenAPIV3.SchemaObject = {
      type: "array",
      items: {
        type: "array",
        items: {
          type: "array",
          items: {
            type: "object",
            properties: { id: { type: "integer" } },
          },
        },
      },
    };
    // depth 0: [...], depth 1: [...], depth 2: [...], depth 3: {...}
    const result = compressSchema(schema);
    expect(result).toContain("{...}");
  });

  test("handles simple type without properties", () => {
    expect(compressSchema({ type: "string" })).toBe("string");
    expect(compressSchema({ type: "integer" })).toBe("integer");
  });

  test("handles array without items", () => {
    expect(compressSchema({ type: "array" } as any)).toBe("[]");
  });

  test("handles schema without type", () => {
    expect(compressSchema({})).toBe("any");
  });
});

describe("decycleSchema", () => {
  test("returns primitives unchanged", () => {
    expect(decycleSchema(42)).toBe(42);
    expect(decycleSchema("hello")).toBe("hello");
    expect(decycleSchema(null)).toBe(null);
    expect(decycleSchema(true)).toBe(true);
  });

  test("deep-clones plain objects", () => {
    const obj = { a: 1, b: { c: 2 } };
    const result = decycleSchema(obj) as any;
    expect(result).toEqual({ a: 1, b: { c: 2 } });
    expect(result).not.toBe(obj);
    expect(result.b).not.toBe(obj.b);
  });

  test("replaces circular references with $ref marker", () => {
    const node: any = { name: "root" };
    node.self = node;
    const result = decycleSchema(node) as any;
    expect(result.name).toBe("root");
    expect(result.self).toEqual({ $ref: "[Circular]" });
  });

  test("handles deeply nested circular references", () => {
    const parent: any = { name: "parent" };
    const child: any = { name: "child", parent };
    parent.children = [child];
    const result = decycleSchema(parent) as any;
    expect(result.children[0].name).toBe("child");
    expect(result.children[0].parent).toEqual({ $ref: "[Circular]" });
  });

  test("handles arrays with circular refs", () => {
    const arr: any[] = [1, 2];
    const obj: any = { arr };
    arr.push(obj);
    const result = decycleSchema(obj) as any;
    expect(result.arr[0]).toBe(1);
    expect(result.arr[1]).toBe(2);
    expect(result.arr[2]).toEqual({ $ref: "[Circular]" });
  });
});

describe("formatParam", () => {
  test("formats required parameter", () => {
    const param: OpenAPIV3.ParameterObject = {
      name: "id",
      in: "path",
      required: true,
      schema: { type: "integer" },
    };
    expect(formatParam(param)).toBe("id: integer (req)");
  });

  test("formats optional parameter", () => {
    const param: OpenAPIV3.ParameterObject = {
      name: "limit",
      in: "query",
      schema: { type: "integer" },
    };
    expect(formatParam(param)).toBe("limit: integer");
  });

  test("defaults to string type when no schema", () => {
    const param: OpenAPIV3.ParameterObject = {
      name: "q",
      in: "query",
    };
    expect(formatParam(param)).toBe("q: string");
  });
});
