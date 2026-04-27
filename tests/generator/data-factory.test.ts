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

  test("number returns literal 29.99", () => {
    const result = generateFromSchema({ type: "number" } as OpenAPIV3.SchemaObject);
    expect(result).toBe(29.99);
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

  // Format-aware string generation
  test("string with uri format returns randomUrl placeholder", () => {
    const result = generateFromSchema({ type: "string", format: "uri" } as OpenAPIV3.SchemaObject);
    expect(result).toBe("{{$randomUrl}}");
  });

  test("string with url format returns randomUrl placeholder", () => {
    const result = generateFromSchema({ type: "string", format: "url" } as OpenAPIV3.SchemaObject);
    expect(result).toBe("{{$randomUrl}}");
  });

  test("string with hostname format returns randomFqdn placeholder", () => {
    const result = generateFromSchema({ type: "string", format: "hostname" } as OpenAPIV3.SchemaObject);
    expect(result).toBe("{{$randomFqdn}}");
  });

  test("string with ipv4 format returns randomIpv4 placeholder", () => {
    const result = generateFromSchema({ type: "string", format: "ipv4" } as OpenAPIV3.SchemaObject);
    expect(result).toBe("{{$randomIpv4}}");
  });

  test("string with password format", () => {
    const result = generateFromSchema({ type: "string", format: "password" } as OpenAPIV3.SchemaObject);
    expect(result).toBe("TestPass123!");
  });

  // Name-based heuristics for URL, password, phone
  test("string with url property name", () => {
    const result = generateFromSchema({ type: "string" } as OpenAPIV3.SchemaObject, "image_url");
    expect(result).toBe("{{$randomUrl}}");
  });

  test("string with website property name", () => {
    const result = generateFromSchema({ type: "string" } as OpenAPIV3.SchemaObject, "website");
    expect(result).toBe("{{$randomUrl}}");
  });

  test("string with password property name", () => {
    const result = generateFromSchema({ type: "string" } as OpenAPIV3.SchemaObject, "password");
    expect(result).toBe("TestPass123!");
  });

  test("string with phone property name", () => {
    const result = generateFromSchema({ type: "string" } as OpenAPIV3.SchemaObject, "phone");
    expect(result).toBe("+1234567890");
  });

  // Integer with minimum
  test("integer with minimum > 0 returns minimum", () => {
    const result = generateFromSchema({ type: "integer", minimum: 1 } as OpenAPIV3.SchemaObject);
    expect(result).toBe(1);
  });

  test("integer with minimum = 0 returns randomInt", () => {
    const result = generateFromSchema({ type: "integer", minimum: 0 } as OpenAPIV3.SchemaObject);
    expect(result).toBe("{{$randomInt}}");
  });

  // Object with number and uri fields
  test("object with price (number) and image (uri) fields", () => {
    const schema: OpenAPIV3.SchemaObject = {
      type: "object",
      properties: {
        price: { type: "number" } as OpenAPIV3.SchemaObject,
        image: { type: "string", format: "uri" } as OpenAPIV3.SchemaObject,
      },
    };
    const result = generateFromSchema(schema) as Record<string, unknown>;
    expect(result.price).toBe(29.99);
    expect(result.image).toBe("{{$randomUrl}}");
  });

  test("format: date returns randomDate placeholder", () => {
    const result = generateFromSchema({ type: "string", format: "date" } as OpenAPIV3.SchemaObject);
    expect(result).toBe("{{$randomDate}}");
  });

  test("format: date-time returns randomIsoDate placeholder", () => {
    const result = generateFromSchema({ type: "string", format: "date-time" } as OpenAPIV3.SchemaObject);
    expect(result).toBe("{{$randomIsoDate}}");
  });

  test("integer with format: uuid returns uuid placeholder", () => {
    const result = generateFromSchema({ type: "integer", format: "uuid" } as OpenAPIV3.SchemaObject);
    expect(result).toBe("{{$uuid}}");
  });

  // T33 — example > enum > format priority
  describe("T33 priority: example > enum > format > heuristic", () => {
    test("primitive schema.example wins over format/heuristic", () => {
      const result = generateFromSchema(
        { type: "string", format: "uuid", example: "user-id-from-spec" } as OpenAPIV3.SchemaObject,
        "id",
      );
      expect(result).toBe("user-id-from-spec");
    });

    test("primitive schema.example wins over enum", () => {
      const result = generateFromSchema(
        { type: "string", enum: ["a", "b"], example: "spec-example" } as OpenAPIV3.SchemaObject,
      );
      expect(result).toBe("spec-example");
    });

    test("object-level example is returned as-is for whole body", () => {
      const result = generateFromSchema({
        type: "object",
        example: { name: "Acme", domain: "acme.test", region: "us-east-1" },
        properties: {
          name: { type: "string" } as OpenAPIV3.SchemaObject,
          domain: { type: "string" } as OpenAPIV3.SchemaObject,
        },
      } as OpenAPIV3.SchemaObject);
      expect(result).toEqual({ name: "Acme", domain: "acme.test", region: "us-east-1" });
    });

    test("nested property example wins over its format", () => {
      const result = generateFromSchema({
        type: "object",
        properties: {
          endpoint: {
            type: "string",
            format: "uri",
            example: "https://hooks.example.com/abc",
          } as OpenAPIV3.SchemaObject,
        },
      } as OpenAPIV3.SchemaObject) as Record<string, unknown>;
      expect(result.endpoint).toBe("https://hooks.example.com/abc");
    });

    test("enum (no example) returns first value", () => {
      const result = generateFromSchema(
        { type: "string", enum: ["enforced", "opportunistic"] } as OpenAPIV3.SchemaObject,
      );
      expect(result).toBe("enforced");
    });

    test("format (no example, no enum) falls back to format placeholder", () => {
      const result = generateFromSchema(
        { type: "string", format: "uri" } as OpenAPIV3.SchemaObject,
      );
      expect(result).toBe("{{$randomUrl}}");
    });

    test("array example is returned as-is", () => {
      const result = generateFromSchema({
        type: "array",
        example: ["email.sent", "email.delivered"],
        items: { type: "string" } as OpenAPIV3.SchemaObject,
      } as OpenAPIV3.SchemaObject);
      expect(result).toEqual(["email.sent", "email.delivered"]);
    });

    test("integer example wins over min/max heuristic", () => {
      const result = generateFromSchema(
        { type: "integer", minimum: 1, maximum: 100, example: 42 } as OpenAPIV3.SchemaObject,
      );
      expect(result).toBe(42);
    });
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

import { generateMultipartFromSchema } from "../../src/core/generator/data-factory.ts";
import type { OpenAPIV3 as OA } from "openapi-types";

describe("guessIntPlaceholder constraints", () => {
  test("uses minimum when set and no maximum", () => {
    const result = generateFromSchema({ type: "integer", minimum: 5 } as OA.SchemaObject);
    expect(result).toBe(5);
  });

  test("returns randomInt placeholder when no constraints", () => {
    const result = generateFromSchema({ type: "integer" } as OA.SchemaObject);
    expect(result).toBe("{{$randomInt}}");
  });

  test("respects maximum — returns concrete value within range", () => {
    const result = generateFromSchema({ type: "integer", maximum: 100 } as OA.SchemaObject);
    expect(typeof result).toBe("number");
    expect(result as number).toBeLessThanOrEqual(100);
  });

  test("respects both minimum and maximum", () => {
    const result = generateFromSchema({ type: "integer", minimum: 1, maximum: 50 } as OA.SchemaObject);
    expect(typeof result).toBe("number");
    expect(result as number).toBeGreaterThanOrEqual(1);
    expect(result as number).toBeLessThanOrEqual(50);
  });

  test("maximum = 0 uses 0", () => {
    const result = generateFromSchema({ type: "integer", maximum: 0 } as OA.SchemaObject);
    expect(result).toBe(0);
  });
});

describe("generateMultipartFromSchema", () => {
  test("binary field becomes file upload object", () => {
    const schema: OA.SchemaObject = {
      type: "object",
      properties: {
        file: { type: "string", format: "binary" } as OA.SchemaObject,
        description: { type: "string" } as OA.SchemaObject,
      },
    };
    const result = generateMultipartFromSchema(schema);
    expect(result.file).toEqual({ file: "./fixtures/file.bin", content_type: "application/octet-stream" });
    expect(result.description).toBe("{{$randomString}}");
  });

  test("byte field becomes file upload object", () => {
    const schema: OA.SchemaObject = {
      type: "object",
      properties: {
        content: { type: "string", format: "byte" } as OA.SchemaObject,
      },
    };
    const result = generateMultipartFromSchema(schema);
    expect(result.content).toEqual({ file: "./fixtures/content.bin", content_type: "application/octet-stream" });
  });

  test("returns empty object for schema without properties", () => {
    const result = generateMultipartFromSchema({ type: "object" } as OA.SchemaObject);
    expect(result).toEqual({});
  });
});
