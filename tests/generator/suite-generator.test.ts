import { describe, test, expect } from "bun:test";
import {
  generateStep,
  detectCrudGroups,
  generateCrudSuite,
  generateSuites,
  generateAuthSuite,
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
    expect(suite.tags).toEqual(["crud", "ephemeral"]);
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

  test("includes list step when GET /collection exists", () => {
    const endpoints = [
      makeEndpoint({ path: "/pets", method: "GET", operationId: "listPets" }),
      makeEndpoint({ path: "/pets", method: "POST", operationId: "createPet" }),
      makeEndpoint({ path: "/pets/{petId}", method: "GET", operationId: "getPet" }),
    ];
    const groups = detectCrudGroups(endpoints);
    const suite = generateCrudSuite(groups[0]!, noSecurity);

    expect(suite.tests).toHaveLength(3); // list, create, read
    expect(suite.tests[0]!.GET).toBe("/pets");
    expect(suite.tests[0]!.name).toBe("listPets");
    expect(suite.tests[1]!.POST).toBe("/pets");
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

  // T28 — ephemeral vs persistent-write classification
  test("CRUD suite WITH delete is tagged ephemeral", () => {
    const endpoints = [
      makeEndpoint({ path: "/orders", method: "POST" }),
      makeEndpoint({ path: "/orders/{orderId}", method: "GET" }),
      makeEndpoint({ path: "/orders/{orderId}", method: "DELETE" }),
    ];
    const groups = detectCrudGroups(endpoints);
    const suite = generateCrudSuite(groups[0]!, noSecurity);
    expect(suite.tags).toEqual(["crud", "ephemeral"]);
  });

  test("DELETE step in CRUD is marked always: true (T44)", () => {
    const endpoints = [
      makeEndpoint({ path: "/orders", method: "POST" }),
      makeEndpoint({ path: "/orders/{orderId}", method: "GET" }),
      makeEndpoint({ path: "/orders/{orderId}", method: "DELETE" }),
    ];
    const groups = detectCrudGroups(endpoints);
    const suite = generateCrudSuite(groups[0]!, noSecurity);
    const deleteStep = suite.tests.find(t => t["DELETE"] !== undefined)!;
    expect((deleteStep as any).always).toBe(true);
    const verifyStep = suite.tests.find(t => /verify.*deleted/i.test(t.name))!;
    expect((verifyStep as any).always).toBe(true);
  });

  test("CRUD suite WITHOUT delete is tagged persistent-write", () => {
    const endpoints = [
      makeEndpoint({ path: "/orders", method: "POST" }),
      makeEndpoint({ path: "/orders/{orderId}", method: "GET" }),
    ];
    const groups = detectCrudGroups(endpoints);
    const suite = generateCrudSuite(groups[0]!, noSecurity);
    expect(suite.tags).toEqual(["crud", "persistent-write"]);
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

    // /ping matches healthcheck pattern → sanity suite is also generated
    const smokeSuite = suites.find(s => s.name === "untagged-smoke");
    expect(smokeSuite).toBeDefined();
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

  test("auth endpoints go into auth suite", () => {
    const endpoints = [
      makeEndpoint({ path: "/auth/login", method: "POST", tags: ["auth"] }),
      makeEndpoint({ path: "/pets", method: "GET", tags: ["pets"] }),
    ];
    const suites = generateSuites({ endpoints, securitySchemes: noSecurity });
    const authSuite = suites.find(s => s.tags?.includes("auth"));
    expect(authSuite).toBeDefined();
    expect(authSuite!.name).toBe("auth");
  });
});

// ── generateAuthSuite ──

describe("generateAuthSuite", () => {
  test("register+login pair uses consistent credentials", () => {
    const registerEp = makeEndpoint({
      path: "/auth/register",
      method: "POST",
      operationId: "register",
      requestBodySchema: {
        type: "object",
        properties: {
          email: { type: "string", format: "email" } as OpenAPIV3.SchemaObject,
          password: { type: "string" } as OpenAPIV3.SchemaObject,
          name: { type: "string" } as OpenAPIV3.SchemaObject,
        },
      } as OpenAPIV3.SchemaObject,
    });
    const loginEp = makeEndpoint({
      path: "/auth/login",
      method: "POST",
      operationId: "login",
      requestBodySchema: {
        type: "object",
        properties: {
          email: { type: "string", format: "email" } as OpenAPIV3.SchemaObject,
          password: { type: "string" } as OpenAPIV3.SchemaObject,
        },
      } as OpenAPIV3.SchemaObject,
      responses: [{
        statusCode: 200,
        description: "OK",
        schema: {
          type: "object",
          properties: {
            access_token: { type: "string" } as OpenAPIV3.SchemaObject,
          },
        } as OpenAPIV3.SchemaObject,
      }],
    });

    const suite = generateAuthSuite([registerEp, loginEp], noSecurity);

    expect(suite.name).toBe("auth");
    expect(suite.tags).toEqual(["auth"]);
    // Should have: set credentials, register, login = 3 steps
    expect(suite.tests.length).toBe(3);

    // First step sets shared credentials
    const setStep = suite.tests[0]!;
    expect(setStep.name).toBe("Set test credentials");
    expect((setStep as any).set.test_email).toBeDefined();
    expect((setStep as any).set.test_password).toBe("TestPass123!");

    // Register uses shared vars
    const registerStep = suite.tests[1]!;
    const regJson = registerStep.json as Record<string, unknown>;
    expect(regJson.email).toBe("{{test_email}}");
    expect(regJson.password).toBe("{{test_password}}");

    // Login uses same shared vars
    const loginStep = suite.tests[2]!;
    const loginJson = loginStep.json as Record<string, unknown>;
    expect(loginJson.email).toBe("{{test_email}}");
    expect(loginJson.password).toBe("{{test_password}}");

    // Login captures auth_token
    expect(loginStep.expect.body?.access_token).toEqual({ capture: "auth_token" });
  });

  test("username-based auth uses test_username", () => {
    const registerEp = makeEndpoint({
      path: "/auth/signup",
      method: "POST",
      requestBodySchema: {
        type: "object",
        properties: {
          username: { type: "string" } as OpenAPIV3.SchemaObject,
          password: { type: "string" } as OpenAPIV3.SchemaObject,
        },
      } as OpenAPIV3.SchemaObject,
    });
    const loginEp = makeEndpoint({
      path: "/auth/signin",
      method: "POST",
      requestBodySchema: {
        type: "object",
        properties: {
          username: { type: "string" } as OpenAPIV3.SchemaObject,
          password: { type: "string" } as OpenAPIV3.SchemaObject,
        },
      } as OpenAPIV3.SchemaObject,
    });

    const suite = generateAuthSuite([registerEp, loginEp], noSecurity);

    const setStep = suite.tests[0]!;
    expect((setStep as any).set.test_username).toBeDefined();
    expect((setStep as any).set.test_password).toBe("TestPass123!");

    const regJson = suite.tests[1]!.json as Record<string, unknown>;
    expect(regJson.username).toBe("{{test_username}}");
  });

  test("fallback to plain suite when no register+login pair", () => {
    const loginEp = makeEndpoint({
      path: "/auth/login",
      method: "POST",
      operationId: "login",
      requestBodySchema: {
        type: "object",
        properties: {
          email: { type: "string" } as OpenAPIV3.SchemaObject,
          password: { type: "string" } as OpenAPIV3.SchemaObject,
        },
      } as OpenAPIV3.SchemaObject,
    });

    const suite = generateAuthSuite([loginEp], noSecurity);
    // No set step — just the login step
    expect(suite.tests.length).toBe(1);
    expect(suite.tests[0]!.name).toBe("login");
  });

  test("includes other auth endpoints after register+login", () => {
    const registerEp = makeEndpoint({
      path: "/auth/register",
      method: "POST",
      requestBodySchema: {
        type: "object",
        properties: {
          email: { type: "string", format: "email" } as OpenAPIV3.SchemaObject,
          password: { type: "string" } as OpenAPIV3.SchemaObject,
        },
      } as OpenAPIV3.SchemaObject,
    });
    const loginEp = makeEndpoint({
      path: "/auth/login",
      method: "POST",
      requestBodySchema: {
        type: "object",
        properties: {
          email: { type: "string", format: "email" } as OpenAPIV3.SchemaObject,
          password: { type: "string" } as OpenAPIV3.SchemaObject,
        },
      } as OpenAPIV3.SchemaObject,
    });
    const logoutEp = makeEndpoint({
      path: "/auth/logout",
      method: "POST",
      operationId: "logout",
    });

    const suite = generateAuthSuite([registerEp, loginEp, logoutEp], noSecurity);
    // set + register + login = 3 steps; logout is filtered from setup suites
    // (logout in setup would invalidate the token before other suites use it)
    expect(suite.tests.length).toBe(3);
    const stepNames = suite.tests.map(t => t.name);
    expect(stepNames).not.toContain("logout");
  });
});

// ── reset tag detection ──

describe("generateSuites reset tag", () => {
  test("reset endpoint gets [system, reset] tags, not [smoke, unsafe]", () => {
    const endpoints = [
      makeEndpoint({ path: "/admin/reset", method: "POST", tags: ["admin"] }),
      makeEndpoint({ path: "/admin/users", method: "POST", tags: ["admin"] }),
    ];
    const suites = generateSuites({ endpoints, securitySchemes: noSecurity });

    const systemSuite = suites.find(s => s.tags?.includes("reset"));
    expect(systemSuite).toBeDefined();
    expect(systemSuite!.tags).toEqual(["system", "reset"]);
    expect(systemSuite!.tests).toHaveLength(1);
    // POST /admin/users should be in unsafe, not in reset
    const unsafeSuite = suites.find(s => s.tags?.includes("unsafe"));
    expect(unsafeSuite).toBeDefined();
    expect(unsafeSuite!.tests[0]!["POST"]).toBe("/admin/users");
  });

  test("reset suite name uses 'system-' prefix", () => {
    const endpoints = [
      makeEndpoint({ path: "/api/purge", method: "DELETE", tags: ["api"] }),
    ];
    const suites = generateSuites({ endpoints, securitySchemes: noSecurity });
    const systemSuite = suites.find(s => s.tags?.includes("reset"));
    expect(systemSuite).toBeDefined();
    expect(systemSuite!.name).toBe("api-system");
  });
});

// ── smoke path seeds ──

describe("smoke suite path seeds (T27 — positive variant)", () => {
  test("GET endpoint with path param uses variable placeholder in positive smoke suite", () => {
    const endpoints = [
      makeEndpoint({
        path: "/orders/{orderId}",
        method: "GET",
        tags: ["orders"],
        parameters: [{ name: "orderId", in: "path", schema: { type: "integer" } } as any],
      }),
    ];
    const suites = generateSuites({ endpoints, securitySchemes: noSecurity });
    const positiveSuite = suites.find(s => s.name === "orders-smoke-positive");
    expect(positiveSuite).toBeDefined();
    expect(positiveSuite!.tags).toEqual(["smoke", "positive", "needs-id"]);
    expect(positiveSuite!.tests[0]!["GET"]).toBe("/orders/{{orderId}}");
    expect((positiveSuite!.tests[0] as any).skip_if).toBe("{{orderId}} ==");
  });

  test("GET endpoint with path param also produces negative smoke with bad ID and 4xx range", () => {
    const endpoints = [
      makeEndpoint({
        path: "/orders/{orderId}",
        method: "GET",
        tags: ["orders"],
        parameters: [{ name: "orderId", in: "path", schema: { type: "integer" } } as any],
      }),
    ];
    const suites = generateSuites({ endpoints, securitySchemes: noSecurity });
    const negativeSuite = suites.find(s => s.name === "orders-smoke-negative");
    expect(negativeSuite).toBeDefined();
    expect(negativeSuite!.tags).toEqual(["smoke", "negative"]);
    expect(negativeSuite!.tests[0]!["GET"]).toBe("/orders/999999999");
    expect(negativeSuite!.tests[0]!.expect.status).toEqual([400, 404, 422]);
  });

  test("UUID path param uses zero-UUID in negative smoke", () => {
    const endpoints = [
      makeEndpoint({
        path: "/users/{id}",
        method: "GET",
        tags: ["users"],
        parameters: [{ name: "id", in: "path", schema: { type: "string", format: "uuid" } } as any],
      }),
    ];
    const suites = generateSuites({ endpoints, securitySchemes: noSecurity });
    const negativeSuite = suites.find(s => s.name === "users-smoke-negative");
    expect(negativeSuite).toBeDefined();
    expect(negativeSuite!.tests[0]!["GET"]).toBe("/users/00000000-0000-0000-0000-000000000000");
  });

  test("GET endpoint without path params stays in regular smoke (no positive/negative split)", () => {
    const endpoints = [
      makeEndpoint({
        path: "/items",
        method: "GET",
        tags: ["items"],
      }),
    ];
    const suites = generateSuites({ endpoints, securitySchemes: noSecurity });
    expect(suites.find(s => s.name === "items-smoke")).toBeDefined();
    expect(suites.find(s => s.name === "items-smoke-positive")).toBeUndefined();
    expect(suites.find(s => s.name === "items-smoke-negative")).toBeUndefined();
  });

  test("paramless and path-param GETs in same tag produce 3 suites (smoke + negative + positive)", () => {
    const endpoints = [
      makeEndpoint({ path: "/items", method: "GET", tags: ["items"] }),
      makeEndpoint({
        path: "/items/{sku}",
        method: "GET",
        tags: ["items"],
        parameters: [{ name: "sku", in: "path", schema: { type: "string" } } as any],
      }),
    ];
    const suites = generateSuites({ endpoints, securitySchemes: noSecurity });
    expect(suites.find(s => s.name === "items-smoke")).toBeDefined();
    expect(suites.find(s => s.name === "items-smoke-negative")).toBeDefined();
    expect(suites.find(s => s.name === "items-smoke-positive")).toBeDefined();
  });
});

// ── ETag detection ──

describe("generateCrudSuite ETag", () => {
  test("adds ETag capture step before update when requiresEtag", () => {
    const readEp = makeEndpoint({ path: "/items/{id}", method: "GET" });
    const createEp = makeEndpoint({
      path: "/items",
      method: "POST",
      requestBodySchema: { type: "object", properties: { name: { type: "string" } } } as any,
      responses: [{ statusCode: 201, description: "Created", schema: { type: "object", properties: { id: { type: "integer" } } } as any }],
    });
    const updateEp = makeEndpoint({
      path: "/items/{id}",
      method: "PUT",
      requiresEtag: true,
      requestBodySchema: { type: "object", properties: { name: { type: "string" } } } as any,
    });

    const group = {
      resource: "items",
      basePath: "/items",
      itemPath: "/items/{id}",
      idParam: "id",
      create: createEp,
      read: readEp,
      update: updateEp,
    };

    const suite = generateCrudSuite(group, noSecurity);
    const stepNames = suite.tests.map(t => t.name);
    const etagStepIdx = stepNames.findIndex(n => /get etag/i.test(n));
    expect(etagStepIdx).toBeGreaterThanOrEqual(0);

    // ETag step comes before the actual update step (which has If-Match)
    const updateIdx = suite.tests.findIndex(t => (t as any)["PUT"] !== undefined);
    expect(etagStepIdx).toBeLessThan(updateIdx);

    // Update step has If-Match header
    const updateStep = suite.tests[updateIdx]!;
    expect((updateStep as any).headers?.["If-Match"]).toBeDefined();
  });
});
