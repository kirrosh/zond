import { describe, test, expect } from "bun:test";
import {
  generateStep,
  detectCrudGroups,
  generateCrudSuite,
  generateSuites,
} from "../../src/core/generator/suite-generator.ts";
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
  { name: "bearerAuth", type: "http", scheme: "bearer" },
];

// ── generateStep ──

describe("generateStep", () => {
  test("basic GET endpoint", () => {
    const ep = makeEndpoint({ path: "/pets", method: "GET", operationId: "listPets" });
    const step = generateStep(ep, noSecurity);

    expect(step.name).toBe("listPets");
    expect(step.GET).toBe("/pets");
    expect(step.expect.status).toBe(200);
  });

  test("converts path params to {{param}}", () => {
    const ep = makeEndpoint({ path: "/pets/{petId}", method: "GET" });
    const step = generateStep(ep, noSecurity);

    expect(step.GET).toBe("/pets/{{petId}}");
  });

  test("uses operationId as name, falls back to summary, then method+path", () => {
    const ep1 = makeEndpoint({ path: "/pets", method: "GET", operationId: "listPets" });
    expect(generateStep(ep1, noSecurity).name).toBe("listPets");

    const ep2 = makeEndpoint({ path: "/pets", method: "GET", summary: "List all pets" });
    expect(generateStep(ep2, noSecurity).name).toBe("List all pets");

    const ep3 = makeEndpoint({ path: "/pets", method: "GET" });
    expect(generateStep(ep3, noSecurity).name).toBe("GET /pets");
  });

  test("uses first 2xx status from responses", () => {
    const ep = makeEndpoint({
      path: "/pets",
      method: "POST",
      responses: [
        { statusCode: 201, description: "Created" },
        { statusCode: 400, description: "Bad request" },
      ],
    });
    const step = generateStep(ep, noSecurity);
    expect(step.expect.status).toBe(201);
  });

  test("falls back to first response status if no 2xx", () => {
    const ep = makeEndpoint({
      path: "/pets",
      method: "GET",
      responses: [{ statusCode: 302, description: "Redirect" }],
    });
    const step = generateStep(ep, noSecurity);
    expect(step.expect.status).toBe(302);
  });

  test("defaults to 200 if no responses", () => {
    const ep = makeEndpoint({ path: "/pets", method: "GET", responses: [] });
    const step = generateStep(ep, noSecurity);
    expect(step.expect.status).toBe(200);
  });

  test("generates json body for POST with requestBodySchema", () => {
    const ep = makeEndpoint({
      path: "/pets",
      method: "POST",
      requestBodySchema: {
        type: "object",
        properties: {
          name: { type: "string" } as OpenAPIV3.SchemaObject,
        },
      } as OpenAPIV3.SchemaObject,
    });
    const step = generateStep(ep, noSecurity);
    expect(step.json).toEqual({ name: "{{$randomName}}" });
  });

  test("adds auth header for bearer security", () => {
    const ep = makeEndpoint({
      path: "/pets",
      method: "GET",
      security: ["bearerAuth"],
    });
    const step = generateStep(ep, bearerSecurity);
    expect((step.headers as Record<string, string>)?.Authorization).toBe("Bearer {{auth_token}}");
  });

  test("adds required query params", () => {
    const ep = makeEndpoint({
      path: "/pets",
      method: "GET",
      parameters: [
        { name: "limit", in: "query", required: true, schema: { type: "integer" } as OpenAPIV3.SchemaObject },
        { name: "offset", in: "query", required: false, schema: { type: "integer" } as OpenAPIV3.SchemaObject },
      ] as OpenAPIV3.ParameterObject[],
    });
    const step = generateStep(ep, noSecurity);
    expect(step.query).toEqual({ limit: "{{$randomInt}}" });
  });

  test("generates body assertions from response schema properties (max 5)", () => {
    const ep = makeEndpoint({
      path: "/pets",
      method: "GET",
      responses: [{
        statusCode: 200,
        description: "OK",
        schema: {
          type: "object",
          properties: {
            id: { type: "integer" } as OpenAPIV3.SchemaObject,
            name: { type: "string" } as OpenAPIV3.SchemaObject,
            status: { type: "string" } as OpenAPIV3.SchemaObject,
            tag: { type: "string" } as OpenAPIV3.SchemaObject,
            owner: { type: "string" } as OpenAPIV3.SchemaObject,
            extra: { type: "string" } as OpenAPIV3.SchemaObject,
          },
        } as OpenAPIV3.SchemaObject,
      }],
    });
    const step = generateStep(ep, noSecurity);
    expect(step.expect.body).toBeDefined();
    expect(Object.keys(step.expect.body!)).toHaveLength(5);
    expect(step.expect.body!.id).toEqual({ exists: "true" });
  });

  test("generates _body array assertion for array response", () => {
    const ep = makeEndpoint({
      path: "/pets",
      method: "GET",
      responses: [{
        statusCode: 200,
        description: "OK",
        schema: { type: "array", items: { type: "object" } } as OpenAPIV3.SchemaObject,
      }],
    });
    const step = generateStep(ep, noSecurity);
    expect(step.expect.body).toEqual({ _body: { type: "array" } });
  });
});

// ── detectCrudGroups ──

describe("detectCrudGroups", () => {
  test("detects basic CRUD group (POST + GET/{id})", () => {
    const endpoints = [
      makeEndpoint({ path: "/pets", method: "POST" }),
      makeEndpoint({ path: "/pets/{petId}", method: "GET" }),
    ];
    const groups = detectCrudGroups(endpoints);

    expect(groups).toHaveLength(1);
    expect(groups[0]!.resource).toBe("pets");
    expect(groups[0]!.basePath).toBe("/pets");
    expect(groups[0]!.itemPath).toBe("/pets/{petId}");
    expect(groups[0]!.idParam).toBe("petId");
    expect(groups[0]!.create).toBeDefined();
    expect(groups[0]!.read).toBeDefined();
    expect(groups[0]!.update).toBeUndefined();
    expect(groups[0]!.delete).toBeUndefined();
  });

  test("detects full CRUD group", () => {
    const endpoints = [
      makeEndpoint({ path: "/pets", method: "GET" }),
      makeEndpoint({ path: "/pets", method: "POST" }),
      makeEndpoint({ path: "/pets/{petId}", method: "GET" }),
      makeEndpoint({ path: "/pets/{petId}", method: "PUT" }),
      makeEndpoint({ path: "/pets/{petId}", method: "DELETE" }),
    ];
    const groups = detectCrudGroups(endpoints);

    expect(groups).toHaveLength(1);
    expect(groups[0]!.list).toBeDefined();
    expect(groups[0]!.create).toBeDefined();
    expect(groups[0]!.read).toBeDefined();
    expect(groups[0]!.update).toBeDefined();
    expect(groups[0]!.delete).toBeDefined();
  });

  test("skips deprecated endpoints", () => {
    const endpoints = [
      makeEndpoint({ path: "/pets", method: "POST", deprecated: true }),
      makeEndpoint({ path: "/pets/{petId}", method: "GET" }),
    ];
    const groups = detectCrudGroups(endpoints);
    expect(groups).toHaveLength(0);
  });

  test("requires GET on item path (POST alone not enough)", () => {
    const endpoints = [
      makeEndpoint({ path: "/pets", method: "POST" }),
      makeEndpoint({ path: "/pets/{petId}", method: "DELETE" }),
    ];
    const groups = detectCrudGroups(endpoints);
    expect(groups).toHaveLength(0);
  });

  test("does not match nested paths", () => {
    const endpoints = [
      makeEndpoint({ path: "/users", method: "POST" }),
      makeEndpoint({ path: "/users/{userId}/pets/{petId}", method: "GET" }),
    ];
    const groups = detectCrudGroups(endpoints);
    expect(groups).toHaveLength(0);
  });
});

// ── generateCrudSuite ──

describe("generateCrudSuite", () => {
  test("generates CRUD chain with capture and verify", () => {
    const endpoints = [
      makeEndpoint({
        path: "/pets",
        method: "POST",
        operationId: "createPet",
        responses: [{
          statusCode: 201,
          description: "Created",
          schema: {
            type: "object",
            properties: { id: { type: "integer" } as OpenAPIV3.SchemaObject },
          } as OpenAPIV3.SchemaObject,
        }],
        requestBodySchema: {
          type: "object",
          properties: { name: { type: "string" } as OpenAPIV3.SchemaObject },
        } as OpenAPIV3.SchemaObject,
      }),
      makeEndpoint({ path: "/pets/{petId}", method: "GET", operationId: "getPet" }),
      makeEndpoint({
        path: "/pets/{petId}",
        method: "PUT",
        operationId: "updatePet",
        requestBodySchema: {
          type: "object",
          properties: { name: { type: "string" } as OpenAPIV3.SchemaObject },
        } as OpenAPIV3.SchemaObject,
      }),
      makeEndpoint({
        path: "/pets/{petId}",
        method: "DELETE",
        operationId: "deletePet",
        responses: [{ statusCode: 204, description: "Deleted" }],
      }),
    ];

    const groups = detectCrudGroups(endpoints);
    expect(groups).toHaveLength(1);

    const suite = generateCrudSuite(groups[0]!, noSecurity);

    expect(suite.name).toBe("pets-crud");
    expect(suite.tags).toEqual(["crud"]);
    expect(suite.base_url).toBe("{{base_url}}");
    expect(suite.tests).toHaveLength(5); // create, read, update, delete, verify

    // Create step has capture
    const createStep = suite.tests[0]!;
    expect(createStep.expect.body?.id).toEqual({ capture: "pet_id" });

    // Read uses captured var
    const readStep = suite.tests[1]!;
    expect(readStep.GET).toBe("/pets/{{pet_id}}");

    // Delete step
    const deleteStep = suite.tests[3]!;
    expect(deleteStep.DELETE).toBe("/pets/{{pet_id}}");
    expect(deleteStep.expect.status).toBe(204);

    // Verify deleted
    const verifyStep = suite.tests[4]!;
    expect(verifyStep.GET).toBe("/pets/{{pet_id}}");
    expect(verifyStep.expect.status).toBe(404);
  });

  test("minimal CRUD (POST + GET only) — no verify step", () => {
    const endpoints = [
      makeEndpoint({ path: "/items", method: "POST" }),
      makeEndpoint({ path: "/items/{itemId}", method: "GET" }),
    ];
    const groups = detectCrudGroups(endpoints);
    const suite = generateCrudSuite(groups[0]!, noSecurity);

    expect(suite.tests).toHaveLength(2); // create, read
  });
});

// ── generateSuites ──

describe("generateSuites", () => {
  test("separates GET and non-GET into smoke and smoke-unsafe", () => {
    const endpoints = [
      makeEndpoint({ path: "/pets", method: "GET", tags: ["pets"] }),
      makeEndpoint({ path: "/pets", method: "POST", tags: ["pets"] }),
      makeEndpoint({ path: "/users", method: "GET", tags: ["users"] }),
    ];
    const suites = generateSuites({ endpoints, securitySchemes: noSecurity });

    const smokeNames = suites.filter(s => s.tags?.includes("smoke") && !s.tags?.includes("unsafe")).map(s => s.name);
    const unsafeNames = suites.filter(s => s.tags?.includes("unsafe")).map(s => s.name);

    expect(smokeNames).toContain("pets-smoke");
    expect(smokeNames).toContain("users-smoke");
    expect(unsafeNames).toContain("pets-smoke-unsafe");
  });

  test("CRUD endpoints are excluded from smoke suites", () => {
    const endpoints = [
      makeEndpoint({ path: "/pets", method: "GET", tags: ["pets"] }),
      makeEndpoint({ path: "/pets", method: "POST", tags: ["pets"] }),
      makeEndpoint({ path: "/pets/{petId}", method: "GET", tags: ["pets"] }),
      makeEndpoint({ path: "/pets/{petId}", method: "DELETE", tags: ["pets"] }),
      makeEndpoint({ path: "/health", method: "GET", tags: ["system"] }),
    ];
    const suites = generateSuites({ endpoints, securitySchemes: noSecurity });

    const crudSuites = suites.filter(s => s.tags?.includes("crud"));
    expect(crudSuites).toHaveLength(1);
    expect(crudSuites[0]!.name).toBe("pets-crud");

    // /health should be in smoke, not CRUD
    const systemSmoke = suites.find(s => s.name === "system-smoke");
    expect(systemSmoke).toBeDefined();
    expect(systemSmoke!.tests).toHaveLength(1);
  });

  test("skips deprecated endpoints", () => {
    const endpoints = [
      makeEndpoint({ path: "/pets", method: "GET", deprecated: true, tags: ["pets"] }),
      makeEndpoint({ path: "/users", method: "GET", tags: ["users"] }),
    ];
    const suites = generateSuites({ endpoints, securitySchemes: noSecurity });

    const petsSuite = suites.find(s => s.name === "pets-smoke");
    expect(petsSuite).toBeUndefined();

    const usersSuite = suites.find(s => s.name === "users-smoke");
    expect(usersSuite).toBeDefined();
  });

  test("untagged endpoints go to 'untagged' slug", () => {
    const endpoints = [
      makeEndpoint({ path: "/ping", method: "GET" }),
    ];
    const suites = generateSuites({ endpoints, securitySchemes: noSecurity });

    expect(suites).toHaveLength(1);
    expect(suites[0]!.name).toBe("untagged-smoke");
  });

  test("suite-level auth when all endpoints share same security", () => {
    const endpoints = [
      makeEndpoint({ path: "/pets", method: "GET", tags: ["pets"], security: ["bearerAuth"] }),
      makeEndpoint({ path: "/pets/{id}", method: "GET", tags: ["pets"], security: ["bearerAuth"] }),
    ];
    const suites = generateSuites({ endpoints, securitySchemes: bearerSecurity });

    const smoke = suites.find(s => s.name === "pets-smoke");
    expect(smoke?.headers?.Authorization).toBe("Bearer {{auth_token}}");
    // Individual steps should NOT have headers
    for (const t of smoke!.tests) {
      expect(t.headers).toBeUndefined();
    }
  });

  test("returns empty array for empty endpoints", () => {
    const suites = generateSuites({ endpoints: [], securitySchemes: noSecurity });
    expect(suites).toHaveLength(0);
  });
});
