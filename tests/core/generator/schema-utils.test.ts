import { describe, test, expect } from "bun:test";
import { compressSchema, formatParam } from "../../../src/core/generator/schema-utils.ts";
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
    expect(compressSchema({ type: "array" })).toBe("[]");
  });

  test("handles schema without type", () => {
    expect(compressSchema({})).toBe("any");
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
