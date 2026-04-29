import { describe, test, expect } from "bun:test";
import { createSchemaValidator } from "../../src/core/runner/schema-validator.ts";
import type { OpenAPIV3 } from "openapi-types";

function spec(paths: OpenAPIV3.PathsObject, version = "3.0.0"): OpenAPIV3.Document {
  return {
    openapi: version,
    info: { title: "t", version: "1" },
    paths,
  };
}

const emailListSchema: OpenAPIV3.SchemaObject = {
  type: "object",
  required: ["data", "has_more"],
  properties: {
    data: {
      type: "array",
      items: {
        type: "object",
        required: ["id", "email"],
        properties: {
          id: { type: "string", format: "uuid" },
          email: { type: "string", format: "email" },
          status: { type: "string", enum: ["sent", "queued", "failed"] },
        },
      },
    },
    has_more: { type: "boolean" },
  },
};

function buildValidator(schema: OpenAPIV3.SchemaObject) {
  return createSchemaValidator(spec({
    "/emails": {
      get: {
        responses: {
          "200": {
            description: "ok",
            content: { "application/json": { schema } },
          },
        },
      },
    },
  }));
}

describe("schema-validator", () => {
  test("returns no failures when body matches schema", () => {
    const v = buildValidator(emailListSchema);
    const fails = v.validate("GET", "/emails", 200, {
      data: [{ id: "11111111-1111-1111-1111-111111111111", email: "a@b.co", status: "sent" }],
      has_more: false,
    });
    expect(fails).toHaveLength(0);
  });

  test("flags missing required field (B11 regression)", () => {
    const v = buildValidator(emailListSchema);
    const fails = v.validate("GET", "/emails", 200, {
      data: [],
      // has_more deliberately omitted
    });
    expect(fails).toHaveLength(1);
    expect(fails[0]!.rule).toBe("schema.required");
    expect(String(fails[0]!.expected)).toContain("has_more");
  });

  test("flags type mismatch", () => {
    const v = buildValidator(emailListSchema);
    const fails = v.validate("GET", "/emails", 200, {
      data: [],
      has_more: "yes",
    });
    expect(fails.some(f => f.rule === "schema.type" && f.field.includes("has_more"))).toBe(true);
  });

  test("flags enum mismatch", () => {
    const v = buildValidator(emailListSchema);
    const fails = v.validate("GET", "/emails", 200, {
      data: [{ id: "11111111-1111-1111-1111-111111111111", email: "a@b.co", status: "bogus" }],
      has_more: false,
    });
    expect(fails.some(f => f.rule === "schema.enum")).toBe(true);
  });

  test("flags format mismatch (email)", () => {
    const v = buildValidator(emailListSchema);
    const fails = v.validate("GET", "/emails", 200, {
      data: [{ id: "11111111-1111-1111-1111-111111111111", email: "not-an-email" }],
      has_more: false,
    });
    expect(fails.some(f => f.rule === "schema.format" && f.field.includes("email"))).toBe(true);
  });

  test("returns empty when endpoint has no schema", () => {
    const v = createSchemaValidator(spec({
      "/health": { get: { responses: { "200": { description: "ok" } } } },
    }));
    expect(v.validate("GET", "/health", 200, { ok: true })).toHaveLength(0);
  });

  test("returns empty when status not declared (no fallback)", () => {
    const v = buildValidator(emailListSchema);
    expect(v.validate("GET", "/emails", 500, { error: "boom" })).toHaveLength(0);
  });

  test("falls back to default response for 4xx/5xx", () => {
    const v = createSchemaValidator(spec({
      "/emails": {
        get: {
          responses: {
            "200": { description: "ok", content: { "application/json": { schema: { type: "object" } } } },
            default: {
              description: "err",
              content: { "application/json": { schema: { type: "object", required: ["error"], properties: { error: { type: "string" } } } } },
            },
          },
        },
      },
    }));
    const fails = v.validate("GET", "/emails", 422, { wrong: "shape" });
    expect(fails.some(f => f.rule === "schema.required")).toBe(true);
  });

  test("matches templated paths against concrete request paths", () => {
    const v = createSchemaValidator(spec({
      "/users/{id}": {
        get: {
          responses: {
            "200": {
              description: "ok",
              content: { "application/json": { schema: { type: "object", required: ["id"], properties: { id: { type: "string" } } } } },
            },
          },
        },
      },
    }));
    expect(v.validate("GET", "/users/abc", 200, { id: "abc" })).toHaveLength(0);
    expect(v.validate("GET", "/users/abc", 200, {})).toHaveLength(1);
  });

  test("accepts OpenAPI 3.0 nullable", () => {
    const v = buildValidator({
      type: "object",
      required: ["name"],
      properties: { name: { type: "string", nullable: true } as OpenAPIV3.SchemaObject },
    });
    expect(v.validate("GET", "/emails", 200, { name: null })).toHaveLength(0);
    expect(v.validate("GET", "/emails", 200, { name: 5 })).toHaveLength(1);
  });

  test("OpenAPI 3.1 type array (string|null)", () => {
    const v = createSchemaValidator(spec({
      "/x": {
        get: {
          responses: {
            "200": {
              description: "ok",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    required: ["name"],
                    properties: { name: { type: ["string", "null"] } as unknown as OpenAPIV3.SchemaObject },
                  },
                },
              },
            },
          },
        },
      },
    }, "3.1.0"));
    expect(v.validate("GET", "/x", 200, { name: null })).toHaveLength(0);
    expect(v.validate("GET", "/x", 200, { name: 5 })).toHaveLength(1);
  });
});
