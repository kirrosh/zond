import { describe, test, expect } from "bun:test";
import { generateFromSchema, formatToPlaceholder } from "../../src/core/generator/data-factory.ts";
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

  // TASK-252: pattern-aware slug generation
  test("string with slug-style pattern returns randomSlug placeholder", () => {
    const result = generateFromSchema(
      { type: "string", pattern: "^(?![0-9]+$)[a-z0-9_\\-]+$" } as OpenAPIV3.SchemaObject,
    );
    expect(result).toBe("{{$randomSlug}}");
  });

  test("string with slug property name returns randomSlug placeholder", () => {
    const result = generateFromSchema({ type: "string" } as OpenAPIV3.SchemaObject, "slug");
    expect(result).toBe("{{$randomSlug}}");
  });

  test("string with _slug suffix returns randomSlug placeholder", () => {
    const result = generateFromSchema({ type: "string" } as OpenAPIV3.SchemaObject, "team_slug");
    expect(result).toBe("{{$randomSlug}}");
  });

  test("mixed-case pattern is not treated as slug", () => {
    const result = generateFromSchema(
      { type: "string", pattern: "^[a-zA-Z0-9]+$" } as OpenAPIV3.SchemaObject,
    );
    expect(result).toBe("{{$randomString}}");
  });

  // TASK-253: closed-vocabulary heuristics
  test("platform field defaults to python", () => {
    const result = generateFromSchema({ type: "string" } as OpenAPIV3.SchemaObject, "platform");
    expect(result).toBe("python");
  });

  test("language field defaults to en", () => {
    const result = generateFromSchema({ type: "string" } as OpenAPIV3.SchemaObject, "language");
    expect(result).toBe("en");
  });

  test("country field defaults to US", () => {
    const result = generateFromSchema({ type: "string" } as OpenAPIV3.SchemaObject, "country");
    expect(result).toBe("US");
  });

  test("timezone field defaults to UTC", () => {
    const result = generateFromSchema({ type: "string" } as OpenAPIV3.SchemaObject, "timezone");
    expect(result).toBe("UTC");
  });

  test("explicit enum still wins over name heuristic for platform", () => {
    const result = generateFromSchema(
      { type: "string", enum: ["javascript", "ruby"] } as OpenAPIV3.SchemaObject,
      "platform",
    );
    expect(result).toBe("javascript");
  });

  test("explicit example still wins over name heuristic for platform", () => {
    const result = generateFromSchema(
      { type: "string", example: "go" } as OpenAPIV3.SchemaObject,
      "platform",
    );
    expect(result).toBe("go");
  });

  test("allOf merges schemas", () => {
    const schema: OpenAPIV3.SchemaObject = {
      allOf: [
        { type: "object", properties: { id: { type: "integer" } as OpenAPIV3.SchemaObject } } as OpenAPIV3.SchemaObject,
        { type: "object", properties: { name: { type: "string" } as OpenAPIV3.SchemaObject } } as OpenAPIV3.SchemaObject,
      ],
    };
    // forRequest:false to keep server-assigned `id` in the merged shape
    const result = generateFromSchema(schema, undefined, { forRequest: false }) as Record<string, unknown>;
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

describe("TASK-86 regression — format honoured even when type is missing or array", () => {
  test("format: email with no type still produces $randomEmail (not $randomString)", () => {
    expect(generateFromSchema({ format: "email" } as OpenAPIV3.SchemaObject)).toBe("{{$randomEmail}}");
  });

  test("OpenAPI 3.1 nullable: type=['string','null'] + format=email", () => {
    expect(generateFromSchema({ type: ["string", "null"], format: "email" } as unknown as OpenAPIV3.SchemaObject)).toBe("{{$randomEmail}}");
  });

  test("OpenAPI 3.1 nullable string with no format falls back to randomString", () => {
    expect(generateFromSchema({ type: ["string", "null"] } as unknown as OpenAPIV3.SchemaObject)).toBe("{{$randomString}}");
  });

  test("full format coverage from TASK-26 still maps correctly without explicit type", () => {
    expect(generateFromSchema({ format: "uuid" } as OpenAPIV3.SchemaObject)).toBe("{{$uuid}}");
    expect(generateFromSchema({ format: "uri" } as OpenAPIV3.SchemaObject)).toBe("{{$randomUrl}}");
    expect(generateFromSchema({ format: "url" } as OpenAPIV3.SchemaObject)).toBe("{{$randomUrl}}");
    expect(generateFromSchema({ format: "hostname" } as OpenAPIV3.SchemaObject)).toBe("{{$randomFqdn}}");
    expect(generateFromSchema({ format: "ipv4" } as OpenAPIV3.SchemaObject)).toBe("{{$randomIpv4}}");
    expect(generateFromSchema({ format: "date" } as OpenAPIV3.SchemaObject)).toBe("{{$randomDate}}");
    expect(generateFromSchema({ format: "date-time" } as OpenAPIV3.SchemaObject)).toBe("{{$randomIsoDate}}");
  });

  test("formatToPlaceholder helper exposes the mapping for reuse", () => {
    expect(formatToPlaceholder("email")).toBe("{{$randomEmail}}");
    expect(formatToPlaceholder(undefined)).toBeUndefined();
    expect(formatToPlaceholder("not-a-format")).toBeUndefined();
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

describe("TASK-220 / F12 — email-context name heuristics", () => {
  test.each([
    ["from", "{{$randomEmail}}"],
    ["to", "{{$randomEmail}}"],
    ["cc", "{{$randomEmail}}"],
    ["bcc", "{{$randomEmail}}"],
    ["reply_to", "{{$randomEmail}}"],
    ["replyTo", "{{$randomEmail}}"],
    ["sender", "{{$randomEmail}}"],
    ["recipient", "{{$randomEmail}}"],
  ])("string field named '%s' (no format) -> %s", (name, expected) => {
    expect(generateFromSchema({ type: "string" } as OA.SchemaObject, name)).toBe(expected);
  });
});

describe("TASK-221 / F13 — null example is ignored", () => {
  test("schema.example: null falls through to type default (object)", () => {
    const result = generateFromSchema({ type: "object", example: null } as unknown as OA.SchemaObject);
    expect(result).toEqual({});
  });

  test("schema.example: null on string field falls back to randomString", () => {
    const result = generateFromSchema({ type: "string", example: null } as unknown as OA.SchemaObject);
    expect(result).toBe("{{$randomString}}");
  });

  test("nested object property with example: null serializes as empty object, not null", () => {
    const result = generateFromSchema({
      type: "object",
      properties: {
        config: { type: "object", example: null } as unknown as OA.SchemaObject,
      },
    } as OA.SchemaObject) as Record<string, unknown>;
    expect(result.config).toEqual({});
  });
});

describe("TASK-222 / F14 — oneOf/anyOf prefer object variant in array context", () => {
  test("array<oneOf<string|object>> uses object variant", () => {
    const schema: OA.SchemaObject = {
      type: "array",
      items: {
        oneOf: [
          { type: "string" } as OA.SchemaObject,
          { type: "object", properties: { id: { type: "string", format: "uuid" } as OA.SchemaObject } } as OA.SchemaObject,
        ],
      } as unknown as OA.SchemaObject,
    };
    // forRequest:false — array element `id` is part of the data shape under test,
    // not a server-assigned identifier we want stripped.
    const result = generateFromSchema(schema, undefined, { forRequest: false }) as unknown[];
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ id: "{{$uuid}}" });
  });

  test("oneOf with only primitives still picks first non-null", () => {
    const schema: OA.SchemaObject = {
      oneOf: [
        { type: "null" } as unknown as OA.SchemaObject,
        { type: "string" } as OA.SchemaObject,
        { type: "integer" } as OA.SchemaObject,
      ],
    } as unknown as OA.SchemaObject;
    expect(generateFromSchema(schema)).toBe("{{$randomString}}");
  });
});

describe("TASK-223 / F15 — UUID-shaped FK example replaced with placeholder", () => {
  test("field name ending in _id with UUID example -> {{$uuid}}", () => {
    const result = generateFromSchema(
      { type: "string", example: "78261eea-8f8b-4381-83c6-79fa7120f1cf" } as OA.SchemaObject,
      "audience_id",
    );
    expect(result).toBe("{{$uuid}}");
  });

  test("format: uuid with UUID example -> {{$uuid}}", () => {
    const result = generateFromSchema(
      { type: "string", format: "uuid", example: "78261eea-8f8b-4381-83c6-79fa7120f1cf" } as OA.SchemaObject,
    );
    expect(result).toBe("{{$uuid}}");
  });

  test("non-FK field with UUID-shaped example is still honored", () => {
    const result = generateFromSchema(
      { type: "string", example: "78261eea-8f8b-4381-83c6-79fa7120f1cf" } as OA.SchemaObject,
      "tracking_token",
    );
    expect(result).toBe("78261eea-8f8b-4381-83c6-79fa7120f1cf");
  });

  test("FK field with non-UUID example is honored (e.g. slug)", () => {
    const result = generateFromSchema(
      { type: "string", example: "newsletter-2026" } as OA.SchemaObject,
      "audience_id",
    );
    expect(result).toBe("newsletter-2026");
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
