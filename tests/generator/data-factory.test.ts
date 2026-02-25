import { describe, test, expect } from "bun:test";
import { generateFromSchema } from "../../src/core/generator/data-factory.ts";
import type { OpenAPIV3 } from "openapi-types";

describe("generateFromSchema", () => {
  test("string returns placeholder", () => {
    const result = generateFromSchema({ type: "string" } as OpenAPIV3.SchemaObject);
    expect(result).toBe("{{$randomString}}");
  });

  test("string with email format", () => {
    const result = generateFromSchema({ type: "string", format: "email" } as OpenAPIV3.SchemaObject);
    expect(result).toBe("{{$randomEmail}}");
  });

  test("string with uuid format", () => {
    const result = generateFromSchema({ type: "string", format: "uuid" } as OpenAPIV3.SchemaObject);
    expect(result).toBe("{{$uuid}}");
  });

  test("string with name property hint", () => {
    const result = generateFromSchema({ type: "string" } as OpenAPIV3.SchemaObject, "name");
    expect(result).toBe("{{$randomName}}");
  });

  test("string with email property hint", () => {
    const result = generateFromSchema({ type: "string" } as OpenAPIV3.SchemaObject, "email");
    expect(result).toBe("{{$randomEmail}}");
  });

  test("string with id property hint", () => {
    const result = generateFromSchema({ type: "string" } as OpenAPIV3.SchemaObject, "userId");
    expect(result).toBe("{{$uuid}}");
  });

  test("integer returns randomInt", () => {
    const result = generateFromSchema({ type: "integer" } as OpenAPIV3.SchemaObject);
    expect(result).toBe("{{$randomInt}}");
  });

  test("number returns randomInt", () => {
    const result = generateFromSchema({ type: "number" } as OpenAPIV3.SchemaObject);
    expect(result).toBe("{{$randomInt}}");
  });

  test("boolean returns true", () => {
    const result = generateFromSchema({ type: "boolean" } as OpenAPIV3.SchemaObject);
    expect(result).toBe(true);
  });

  test("enum returns first value", () => {
    const result = generateFromSchema({
      type: "string",
      enum: ["available", "pending", "sold"],
    } as OpenAPIV3.SchemaObject);
    expect(result).toBe("available");
  });

  test("object with properties", () => {
    const schema: OpenAPIV3.SchemaObject = {
      type: "object",
      properties: {
        name: { type: "string" } as OpenAPIV3.SchemaObject,
        age: { type: "integer" } as OpenAPIV3.SchemaObject,
      },
    };
    const result = generateFromSchema(schema) as Record<string, unknown>;
    expect(result.name).toBe("{{$randomName}}");
    expect(result.age).toBe("{{$randomInt}}");
  });

  test("array with items", () => {
    const schema: OpenAPIV3.SchemaObject = {
      type: "array",
      items: { type: "string" } as OpenAPIV3.SchemaObject,
    };
    const result = generateFromSchema(schema) as unknown[];
    expect(result).toHaveLength(1);
    expect(result[0]).toBe("{{$randomString}}");
  });

  test("allOf merges schemas", () => {
    const schema: OpenAPIV3.SchemaObject = {
      allOf: [
        { type: "object", properties: { id: { type: "integer" } as OpenAPIV3.SchemaObject } } as OpenAPIV3.SchemaObject,
        { type: "object", properties: { name: { type: "string" } as OpenAPIV3.SchemaObject } } as OpenAPIV3.SchemaObject,
      ],
    };
    const result = generateFromSchema(schema) as Record<string, unknown>;
    expect(result.id).toBe("{{$randomInt}}");
    expect(result.name).toBe("{{$randomName}}");
  });

  test("oneOf picks first variant", () => {
    const schema: OpenAPIV3.SchemaObject = {
      oneOf: [
        { type: "string" } as OpenAPIV3.SchemaObject,
        { type: "integer" } as OpenAPIV3.SchemaObject,
      ],
    };
    const result = generateFromSchema(schema);
    expect(result).toBe("{{$randomString}}");
  });

  test("anyOf picks first variant", () => {
    const schema: OpenAPIV3.SchemaObject = {
      anyOf: [
        { type: "integer" } as OpenAPIV3.SchemaObject,
        { type: "string" } as OpenAPIV3.SchemaObject,
      ],
    };
    const result = generateFromSchema(schema);
    expect(result).toBe("{{$randomInt}}");
  });

  test("nested object", () => {
    const schema: OpenAPIV3.SchemaObject = {
      type: "object",
      properties: {
        owner: {
          type: "object",
          properties: {
            name: { type: "string" } as OpenAPIV3.SchemaObject,
            email: { type: "string", format: "email" } as OpenAPIV3.SchemaObject,
          },
        } as OpenAPIV3.SchemaObject,
      },
    };
    const result = generateFromSchema(schema) as Record<string, any>;
    expect(result.owner.name).toBe("{{$randomName}}");
    expect(result.owner.email).toBe("{{$randomEmail}}");
  });
});
