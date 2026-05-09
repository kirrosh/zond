import { describe, it, expect } from "bun:test";
import { createSchemaValidator } from "../../../src/core/runner/schema-validator.ts";

const DOC = {
  openapi: "3.0.3",
  info: { title: "T", version: "1" },
  paths: {
    "/users": {
      get: {
        responses: {
          "200": { description: "ok", content: { "application/json": { schema: { type: "array" } } } },
        },
      },
    },
    "/users/{id}": {
      get: {
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: {
          "200": {
            description: "ok",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["id", "name"],
                  properties: { id: { type: "string" }, name: { type: "string" } },
                },
              },
            },
          },
          "404": { description: "no body" },
          default: { description: "fallback", content: { "application/json": { schema: { type: "object" } } } },
        },
      },
    },
  },
};

describe("SchemaValidator.inspect (TASK-142)", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const v = createSchemaValidator(DOC as any);

  it("matches literal path /users", () => {
    const i = v.inspect("GET", "/users", 200);
    expect(i.matchedEndpoint?.path).toBe("/users");
    expect(i.matchedResponseStatus).toBe("200");
    expect(i.hasJsonSchema).toBe(true);
  });

  it("matches templated path /users/{id} via regex", () => {
    const i = v.inspect("GET", "/users/123", 200);
    expect(i.matchedEndpoint?.path).toBe("/users/{id}");
    expect(i.hasJsonSchema).toBe(true);
  });

  it("returns no match for unknown path", () => {
    const i = v.inspect("GET", "/widgets/1", 200);
    expect(i.matchedEndpoint).toBeNull();
    expect(i.hasJsonSchema).toBe(false);
  });

  it("falls back to default branch when status not declared", () => {
    const i = v.inspect("GET", "/users/5", 418);
    expect(i.matchedResponseStatus).toBe("default");
    expect(i.hasJsonSchema).toBe(true);
  });

  it("hasJsonSchema=false when matched branch has no application/json content", () => {
    const i = v.inspect("GET", "/users/5", 404);
    expect(i.matchedEndpoint?.path).toBe("/users/{id}");
    expect(i.matchedResponseStatus).toBe("404");
    expect(i.hasJsonSchema).toBe(false);
  });

  it("validate() flags missing required fields against /users/{id} 200", () => {
    const errs = v.validate("GET", "/users/9", 200, { id: "x" });
    expect(errs.length).toBeGreaterThan(0);
    expect(errs[0]!.rule).toContain("schema.required");
  });

  it("validate() returns [] when body matches", () => {
    const errs = v.validate("GET", "/users/9", 200, { id: "x", name: "y" });
    expect(errs).toEqual([]);
  });
});
