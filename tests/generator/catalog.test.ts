import { describe, test, expect } from "bun:test";
import { buildCatalog, serializeCatalog } from "../../src/core/generator/catalog-builder.ts";
import type { EndpointInfo, SecuritySchemeInfo } from "../../src/core/generator/types.ts";
import type { OpenAPIV3 } from "openapi-types";

// ── Helpers ──

function makeEndpoint(overrides: Partial<EndpointInfo> & { path: string; method: string }): EndpointInfo {
  return {
    tags: [],
    parameters: [],
    responseContentTypes: [],
    responses: [{ statusCode: 200, description: "OK" }],
    security: [],
    ...overrides,
  };
}

const noSecurity: SecuritySchemeInfo[] = [];

const bearerSecurity: SecuritySchemeInfo[] = [
  { name: "bearerAuth", type: "http", scheme: "bearer", bearerFormat: "JWT" },
];

const apiKeySecurity: SecuritySchemeInfo[] = [
  { name: "apiKey", type: "apiKey", in: "header", apiKeyName: "X-API-Key" },
];

// ── buildCatalog ──

describe("buildCatalog", () => {
  test("produces correct structure with basic endpoints", () => {
    const endpoints = [
      makeEndpoint({ path: "/pets", method: "GET", summary: "List pets", tags: ["pets"] }),
      makeEndpoint({ path: "/pets", method: "POST", tags: ["pets"] }),
    ];

    const catalog = buildCatalog({
      endpoints,
      securitySchemes: noSecurity,
      specSource: "./openapi.json",
      specHash: "abc123",
      apiName: "Petstore",
      apiVersion: "1.0.0",
      baseUrl: "http://localhost:3000",
    });

    expect(catalog.endpointCount).toBe(2);
    expect(catalog.apiName).toBe("Petstore");
    expect(catalog.apiVersion).toBe("1.0.0");
    expect(catalog.baseUrl).toBe("http://localhost:3000");
    expect(catalog.specSource).toBe("./openapi.json");
    expect(catalog.specHash).toBe("abc123");
    expect(catalog.auth).toEqual([]);
    expect(catalog.endpoints).toHaveLength(2);
    expect(catalog.endpoints[0]!.method).toBe("GET");
    expect(catalog.endpoints[0]!.path).toBe("/pets");
    expect(catalog.endpoints[0]!.summary).toBe("List pets");
    expect(catalog.endpoints[0]!.tags).toEqual(["pets"]);
    expect(catalog.endpoints[1]!.method).toBe("POST");
  });

  test("omits optional fields when not provided", () => {
    const catalog = buildCatalog({
      endpoints: [],
      securitySchemes: noSecurity,
      specSource: "./spec.json",
      specHash: "hash",
    });

    expect(catalog.apiName).toBeUndefined();
    expect(catalog.apiVersion).toBeUndefined();
    expect(catalog.baseUrl).toBeUndefined();
    expect(catalog.endpointCount).toBe(0);
    expect(catalog.endpoints).toEqual([]);
  });

  test("formats parameters with location", () => {
    const ep = makeEndpoint({
      path: "/pets/{petId}",
      method: "GET",
      parameters: [
        { name: "petId", in: "path", required: true, schema: { type: "integer" } } as OpenAPIV3.ParameterObject,
        { name: "limit", in: "query", required: false, schema: { type: "integer" } } as OpenAPIV3.ParameterObject,
        { name: "X-Request-Id", in: "header", required: false, schema: { type: "string" } } as OpenAPIV3.ParameterObject,
      ],
    });

    const catalog = buildCatalog({
      endpoints: [ep],
      securitySchemes: noSecurity,
      specSource: "./spec.json",
      specHash: "hash",
    });

    const params = catalog.endpoints[0]!.parameters!;
    expect(params).toHaveLength(3);
    expect(params[0]).toBe("petId: integer (path, req)");
    expect(params[1]).toBe("limit: integer (query)");
    expect(params[2]).toBe("X-Request-Id: string (header)");
  });

  test("compresses request body schema", () => {
    const ep = makeEndpoint({
      path: "/pets",
      method: "POST",
      requestBodySchema: {
        type: "object",
        required: ["name"],
        properties: {
          name: { type: "string" },
          age: { type: "integer" },
        },
      } as OpenAPIV3.SchemaObject,
    });

    const catalog = buildCatalog({
      endpoints: [ep],
      securitySchemes: noSecurity,
      specSource: "./spec.json",
      specHash: "hash",
    });

    expect(catalog.endpoints[0]!.requestBody).toBe("{ name: string (req), age: integer }");
  });

  test("compresses response schemas", () => {
    const ep = makeEndpoint({
      path: "/pets",
      method: "GET",
      responses: [
        {
          statusCode: 200,
          description: "OK",
          schema: {
            type: "array",
            items: {
              type: "object",
              properties: {
                id: { type: "integer" },
                name: { type: "string" },
              },
            },
          } as OpenAPIV3.SchemaObject,
        },
        { statusCode: 404, description: "Not found" },
      ],
    });

    const catalog = buildCatalog({
      endpoints: [ep],
      securitySchemes: noSecurity,
      specSource: "./spec.json",
      specHash: "hash",
    });

    const responses = catalog.endpoints[0]!.responses;
    expect(responses).toHaveLength(2);
    expect(responses[0]!.status).toBe(200);
    expect(responses[0]!.schema).toBe("[{ id: integer, name: string }]");
    expect(responses[1]!.status).toBe(404);
    expect(responses[1]!.schema).toBeUndefined();
  });

  test("includes security schemes in auth", () => {
    const catalog = buildCatalog({
      endpoints: [],
      securitySchemes: bearerSecurity,
      specSource: "./spec.json",
      specHash: "hash",
    });

    expect(catalog.auth).toEqual(["bearerAuth: http/bearer (JWT)"]);
  });

  test("formats apiKey security scheme", () => {
    const catalog = buildCatalog({
      endpoints: [],
      securitySchemes: apiKeySecurity,
      specSource: "./spec.json",
      specHash: "hash",
    });

    expect(catalog.auth).toEqual(["apiKey: apiKey (X-API-Key in header)"]);
  });

  test("marks deprecated endpoints", () => {
    const ep = makeEndpoint({ path: "/old", method: "GET", deprecated: true });
    const catalog = buildCatalog({
      endpoints: [ep],
      securitySchemes: noSecurity,
      specSource: "./spec.json",
      specHash: "hash",
    });

    expect(catalog.endpoints[0]!.deprecated).toBe(true);
  });

  test("does not include deprecated flag when false", () => {
    const ep = makeEndpoint({ path: "/new", method: "GET" });
    const catalog = buildCatalog({
      endpoints: [ep],
      securitySchemes: noSecurity,
      specSource: "./spec.json",
      specHash: "hash",
    });

    expect(catalog.endpoints[0]!.deprecated).toBeUndefined();
  });

  test("handles any-schema request body", () => {
    const ep = makeEndpoint({
      path: "/raw",
      method: "POST",
      requestBodySchema: {} as OpenAPIV3.SchemaObject,
    });

    const catalog = buildCatalog({
      endpoints: [ep],
      securitySchemes: noSecurity,
      specSource: "./spec.json",
      specHash: "hash",
    });

    expect(catalog.endpoints[0]!.requestBody).toBe("any");
  });

  test("omits parameters when empty", () => {
    const ep = makeEndpoint({ path: "/health", method: "GET" });
    const catalog = buildCatalog({
      endpoints: [ep],
      securitySchemes: noSecurity,
      specSource: "./spec.json",
      specHash: "hash",
    });

    expect(catalog.endpoints[0]!.parameters).toBeUndefined();
  });
});

// ── serializeCatalog ──

describe("serializeCatalog", () => {
  test("produces valid YAML that can be round-trip parsed", () => {
    const catalog = buildCatalog({
      endpoints: [
        makeEndpoint({
          path: "/pets",
          method: "GET",
          summary: "List pets",
          tags: ["pets"],
          parameters: [
            { name: "limit", in: "query", required: false, schema: { type: "integer" } } as OpenAPIV3.ParameterObject,
          ],
          responses: [
            {
              statusCode: 200,
              description: "OK",
              schema: { type: "object", properties: { id: { type: "integer" } } } as OpenAPIV3.SchemaObject,
            },
          ],
        }),
        makeEndpoint({
          path: "/pets",
          method: "POST",
          tags: ["pets"],
          requestBodySchema: {
            type: "object",
            required: ["name"],
            properties: { name: { type: "string" } },
          } as OpenAPIV3.SchemaObject,
        }),
      ],
      securitySchemes: bearerSecurity,
      specSource: "./openapi.json",
      specHash: "abc123def456",
      apiName: "Petstore",
      baseUrl: "http://localhost:3000",
    });

    const yaml = serializeCatalog(catalog);

    // Should be parseable as YAML
    const parsed = Bun.YAML.parse(yaml) as Record<string, unknown>;
    expect(parsed.specSource).toBe("./openapi.json");
    expect(parsed.specHash).toBe("abc123def456");
    expect(parsed.apiName).toBe("Petstore");
    expect(parsed.baseUrl).toBe("http://localhost:3000");
    expect(parsed.endpointCount).toBe(2);
    expect(parsed.auth).toEqual(["bearerAuth: http/bearer (JWT)"]);

    const endpoints = parsed.endpoints as Array<Record<string, unknown>>;
    expect(endpoints).toHaveLength(2);
    expect(endpoints[0]!.method).toBe("GET");
    expect(endpoints[0]!.path).toBe("/pets");
    expect(endpoints[0]!.summary).toBe("List pets");
  });

  test("serializes empty catalog", () => {
    const catalog = buildCatalog({
      endpoints: [],
      securitySchemes: [],
      specSource: "./spec.json",
      specHash: "empty",
    });

    const yaml = serializeCatalog(catalog);
    const parsed = Bun.YAML.parse(yaml) as Record<string, unknown>;

    expect(parsed.endpointCount).toBe(0);
    expect(parsed.auth).toEqual([]);
    expect(parsed.endpoints).toEqual([]);
  });

  test("contains auto-generated comment header", () => {
    const catalog = buildCatalog({
      endpoints: [],
      securitySchemes: [],
      specSource: "./spec.json",
      specHash: "hash",
    });

    const yaml = serializeCatalog(catalog);
    expect(yaml.startsWith("# Auto-generated by zond.")).toBe(true);
  });

  test("escapes special characters in values", () => {
    const catalog = buildCatalog({
      endpoints: [
        makeEndpoint({
          path: "/pets",
          method: "GET",
          summary: "List: all pets & animals",
          tags: ["pets"],
        }),
      ],
      securitySchemes: [],
      specSource: "./spec.json",
      specHash: "hash",
    });

    const yaml = serializeCatalog(catalog);
    const parsed = Bun.YAML.parse(yaml) as Record<string, unknown>;
    const endpoints = parsed.endpoints as Array<Record<string, unknown>>;
    expect(endpoints[0]!.summary).toBe("List: all pets & animals");
  });
});
