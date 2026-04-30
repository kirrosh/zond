import { describe, test, expect } from "bun:test";
import { buildSpecPointer } from "../../src/core/diagnostics/spec-pointer.ts";

const sampleDoc = {
  paths: {
    "/webhooks": {
      post: {
        responses: {
          "201": {
            description: "Created",
            content: {
              "application/json": { schema: { type: "object", properties: { id: { type: "string" } } } },
            },
          },
          "422": {
            description: "Validation error",
            content: {
              "application/json": { schema: { type: "object", properties: { error: { type: "string" } } } },
            },
          },
        },
      },
    },
    "/users/{id}": {
      get: {
        responses: {
          "200": { description: "OK" },
        },
      },
    },
  },
};

describe("buildSpecPointer", () => {
  test("openapi-generated step → pointer + JSON-schema excerpt", () => {
    const result = buildSpecPointer(
      { type: "openapi-generated", endpoint: "POST /webhooks", response_branch: "201" },
      sampleDoc,
    );
    expect(result?.pointer).toBe("#/paths/~1webhooks/post/responses/201/content/application~1json/schema");
    expect(result?.excerpt).toContain('"type": "object"');
    expect(result?.excerpt).toContain('"id"');
  });

  test("probe-step with response_branch=422 → points at 422 response", () => {
    const result = buildSpecPointer(
      { generator: "negative-probe", endpoint: "POST /webhooks", response_branch: "422" },
      sampleDoc,
    );
    expect(result?.pointer).toContain("/responses/422/");
    expect(result?.excerpt).toContain('"error"');
  });

  test("multi-status response_branch (e.g. '422|400') uses first numeric token", () => {
    const result = buildSpecPointer(
      { generator: "negative-probe", endpoint: "POST /webhooks", response_branch: "422|400" },
      sampleDoc,
    );
    expect(result?.pointer).toContain("/responses/422/");
  });

  test("no content/application/json → pointer at /responses/<status>", () => {
    const result = buildSpecPointer(
      { generator: "openapi-generated", endpoint: "GET /users/{id}", response_branch: "200" },
      sampleDoc,
    );
    expect(result?.pointer).toBe("#/paths/~1users~1{id}/get/responses/200");
    expect(result?.excerpt).toContain('"OK"');
  });

  test("returns null for manual YAML (no provenance)", () => {
    expect(buildSpecPointer(null, sampleDoc)).toBeNull();
    expect(buildSpecPointer(undefined, sampleDoc)).toBeNull();
  });

  test("returns null when endpoint not in spec", () => {
    const result = buildSpecPointer(
      { endpoint: "GET /unknown", response_branch: "200" },
      sampleDoc,
    );
    expect(result).toBeNull();
  });

  test("returns null when response_branch not in spec", () => {
    const result = buildSpecPointer(
      { endpoint: "POST /webhooks", response_branch: "999" },
      sampleDoc,
    );
    expect(result).toBeNull();
  });

  test("escapes ~ and / per RFC 6901", () => {
    const docWithTilde = { paths: { "/foo~bar/baz": { get: { responses: { "200": { description: "ok" } } } } } };
    const result = buildSpecPointer(
      { endpoint: "GET /foo~bar/baz", response_branch: "200" },
      docWithTilde,
    );
    expect(result?.pointer).toContain("~1foo~0bar~1baz");
  });

  test("excerpt is truncated for huge schemas", () => {
    const huge = { paths: { "/x": { get: { responses: { "200": { description: "x".repeat(10000) } } } } } };
    const result = buildSpecPointer(
      { endpoint: "GET /x", response_branch: "200" },
      huge,
    );
    expect(result?.excerpt.length).toBeLessThan(600);
    expect(result?.excerpt).toContain("truncated");
  });

  test("returns null when openApiDoc is missing", () => {
    expect(buildSpecPointer({ endpoint: "GET /x", response_branch: "200" }, null)).toBeNull();
    expect(buildSpecPointer({ endpoint: "GET /x", response_branch: "200" }, undefined)).toBeNull();
  });
});
