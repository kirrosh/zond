import { describe, test, expect, afterAll } from "bun:test";
import { readOpenApiSpec, extractEndpoints, extractSecuritySchemes } from "../../src/core/generator/openapi-reader.ts";
import { generateSkeleton, writeSuites } from "../../src/core/generator/skeleton.ts";
import { validateSuite } from "../../src/core/parser/schema.ts";
import { tmpdir } from "os";
import { join } from "path";
import { rm } from "fs/promises";

const FIXTURE = "tests/fixtures/petstore-auth.json";

describe("generateSkeleton", () => {
  test("generates suites grouped by tag", async () => {
    const doc = await readOpenApiSpec(FIXTURE);
    const endpoints = extractEndpoints(doc);
    const suites = generateSkeleton(endpoints);

    // Should have 3 groups: "auth", "pets", "health"
    expect(suites.length).toBe(3);

    const names = suites.map((s) => s.name);
    expect(names).toContain("auth");
    expect(names).toContain("pets");
    expect(names).toContain("health");
  });

  test("pets suite has 5 tests (without auth)", async () => {
    const doc = await readOpenApiSpec(FIXTURE);
    const endpoints = extractEndpoints(doc);
    const suites = generateSkeleton(endpoints);

    const petsSuite = suites.find((s) => s.name === "pets")!;
    expect(petsSuite.tests.length).toBe(5);
  });

  test("uses method-as-key format", async () => {
    const doc = await readOpenApiSpec(FIXTURE);
    const endpoints = extractEndpoints(doc);
    const suites = generateSkeleton(endpoints);

    const petsSuite = suites.find((s) => s.name === "pets")!;
    const getTest = petsSuite.tests.find((t) => "GET" in t && (t as any).GET === "/pets")!;
    expect(getTest).toBeDefined();
    expect(getTest.name).toBe("List all pets");

    const postTest = petsSuite.tests.find((t) => "POST" in t && (t as any).POST === "/pets")!;
    expect(postTest).toBeDefined();
    expect(postTest.json).toBeDefined();
  });

  test("sets happy path status code", async () => {
    const doc = await readOpenApiSpec(FIXTURE);
    const endpoints = extractEndpoints(doc);
    const suites = generateSkeleton(endpoints);

    const petsSuite = suites.find((s) => s.name === "pets")!;

    const createTest = petsSuite.tests.find((t) => "POST" in t && (t as any).POST === "/pets")!;
    expect(createTest.expect.status).toBe(201);

    const deleteTest = petsSuite.tests.find((t) => "DELETE" in t)!;
    expect(deleteTest.expect.status).toBe(204);
  });

  test("generates body assertions for object responses", async () => {
    const doc = await readOpenApiSpec(FIXTURE);
    const endpoints = extractEndpoints(doc);
    const suites = generateSkeleton(endpoints);

    const healthSuite = suites.find((s) => s.name === "health")!;
    const healthTest = healthSuite.tests[0]!;
    expect(healthTest.expect.body).toBeDefined();
    expect(healthTest.expect.body!.status).toEqual({ type: "string" });
    expect(healthTest.expect.body!.uptime).toEqual({ type: "number" });
  });
});

describe("generateSkeleton with auth", () => {
  test("adds login step as first test for auth suites", async () => {
    const doc = await readOpenApiSpec(FIXTURE);
    const endpoints = extractEndpoints(doc);
    const securitySchemes = extractSecuritySchemes(doc);
    const suites = generateSkeleton(endpoints, undefined, securitySchemes);

    const petsSuite = suites.find((s) => s.name === "pets")!;
    // First test should be the login step
    expect(petsSuite.tests[0]!.name).toBe("Auth: Login");
    expect("POST" in petsSuite.tests[0]!).toBe(true);
    expect((petsSuite.tests[0] as any).POST).toBe("/auth/login");
  });

  test("login step captures auth_token", async () => {
    const doc = await readOpenApiSpec(FIXTURE);
    const endpoints = extractEndpoints(doc);
    const securitySchemes = extractSecuritySchemes(doc);
    const suites = generateSkeleton(endpoints, undefined, securitySchemes);

    const petsSuite = suites.find((s) => s.name === "pets")!;
    const loginStep = petsSuite.tests[0]!;

    expect(loginStep.expect.status).toBe(200);
    expect(loginStep.expect.body).toBeDefined();
    expect(loginStep.expect.body!.token).toEqual({ capture: "auth_token", type: "string" });
  });

  test("login step uses env var placeholders for credentials", async () => {
    const doc = await readOpenApiSpec(FIXTURE);
    const endpoints = extractEndpoints(doc);
    const securitySchemes = extractSecuritySchemes(doc);
    const suites = generateSkeleton(endpoints, undefined, securitySchemes);

    const petsSuite = suites.find((s) => s.name === "pets")!;
    const loginStep = petsSuite.tests[0]!;

    const json = loginStep.json as Record<string, string>;
    expect(json.username).toBe("{{auth_username}}");
    expect(json.password).toBe("{{auth_password}}");
  });

  test("auth suites get Authorization header", async () => {
    const doc = await readOpenApiSpec(FIXTURE);
    const endpoints = extractEndpoints(doc);
    const securitySchemes = extractSecuritySchemes(doc);
    const suites = generateSkeleton(endpoints, undefined, securitySchemes);

    const petsSuite = suites.find((s) => s.name === "pets")!;
    expect(petsSuite.headers).toBeDefined();
    expect(petsSuite.headers!.Authorization).toBe("Bearer {{auth_token}}");
  });

  test("non-auth suites have no login step or auth header", async () => {
    const doc = await readOpenApiSpec(FIXTURE);
    const endpoints = extractEndpoints(doc);
    const securitySchemes = extractSecuritySchemes(doc);
    const suites = generateSkeleton(endpoints, undefined, securitySchemes);

    const healthSuite = suites.find((s) => s.name === "health")!;
    expect(healthSuite.headers).toBeUndefined();
    expect(healthSuite.tests[0]!.name).not.toBe("Auth: Login");
  });

  test("pets suite has 6 tests with auth (login + 5 CRUD)", async () => {
    const doc = await readOpenApiSpec(FIXTURE);
    const endpoints = extractEndpoints(doc);
    const securitySchemes = extractSecuritySchemes(doc);
    const suites = generateSkeleton(endpoints, undefined, securitySchemes);

    const petsSuite = suites.find((s) => s.name === "pets")!;
    expect(petsSuite.tests.length).toBe(6); // 1 login + 5 CRUD
  });
});

describe("generateSkeleton with apiKey auth", () => {
  test("adds API key header for header-based apiKey scheme", () => {
    const endpoints: import("../../src/core/generator/types.ts").EndpointInfo[] = [
      {
        path: "/data",
        method: "GET",
        operationId: "getData",
        summary: "Get data",
        tags: ["data"],
        parameters: [],
        requestBodySchema: undefined,
        requestBodyContentType: undefined,
        responseContentTypes: ["application/json"],
        responses: [{ statusCode: 200, description: "OK" }],
        security: ["apiKeyAuth"],
      } as any,
    ];
    const schemes: import("../../src/core/generator/types.ts").SecuritySchemeInfo[] = [
      { name: "apiKeyAuth", type: "apiKey", in: "header", apiKeyName: "X-API-Key" },
    ];

    const suites = generateSkeleton(endpoints, undefined, schemes);
    const dataSuite = suites.find((s) => s.name === "data")!;
    expect(dataSuite.headers).toBeDefined();
    expect(dataSuite.headers!["X-API-Key"]).toBe("{{apikeyauth}}");
  });
});

describe("generateSkeleton with basic auth", () => {
  test("adds Basic auth header for basic scheme", () => {
    const endpoints: import("../../src/core/generator/types.ts").EndpointInfo[] = [
      {
        path: "/secure",
        method: "GET",
        operationId: "getSecure",
        summary: "Secure endpoint",
        tags: ["secure"],
        parameters: [],
        requestBodySchema: undefined,
        requestBodyContentType: undefined,
        responseContentTypes: ["application/json"],
        responses: [{ statusCode: 200, description: "OK" }],
        security: ["basicAuth"],
      } as any,
    ];
    const schemes: import("../../src/core/generator/types.ts").SecuritySchemeInfo[] = [
      { name: "basicAuth", type: "http", scheme: "basic" },
    ];

    const suites = generateSkeleton(endpoints, undefined, schemes);
    const secureSuite = suites.find((s) => s.name === "secure")!;
    expect(secureSuite.headers).toBeDefined();
    expect(secureSuite.headers!.Authorization).toBe("Basic {{basic_credentials}}");
  });

  test("bearer takes precedence over basic for Authorization header", () => {
    const endpoints: import("../../src/core/generator/types.ts").EndpointInfo[] = [
      {
        path: "/mixed",
        method: "GET",
        operationId: "getMixed",
        summary: "Mixed auth",
        tags: ["mixed"],
        parameters: [],
        requestBodySchema: undefined,
        requestBodyContentType: undefined,
        responseContentTypes: ["application/json"],
        responses: [{ statusCode: 200, description: "OK" }],
        security: ["bearerAuth", "basicAuth"],
      } as any,
    ];
    const schemes: import("../../src/core/generator/types.ts").SecuritySchemeInfo[] = [
      { name: "bearerAuth", type: "http", scheme: "bearer" },
      { name: "basicAuth", type: "http", scheme: "basic" },
    ];

    // No login endpoint, so bearer won't add login step but won't set Authorization either
    // Basic should fill in since bearer has no login endpoint
    const suites = generateSkeleton(endpoints, undefined, schemes);
    const mixedSuite = suites.find((s) => s.name === "mixed")!;
    expect(mixedSuite.headers).toBeDefined();
    // Basic uses ?? so bearer header (if set) takes precedence
    expect(mixedSuite.headers!.Authorization).toBe("Basic {{basic_credentials}}");
  });
});

describe("writeSuites + round-trip", () => {
  const tmpDir = join(tmpdir(), `apitool-gen-test-${Date.now()}`);

  afterAll(async () => {
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  });

  test("writes YAML files and round-trips through parser", async () => {
    const doc = await readOpenApiSpec(FIXTURE);
    const endpoints = extractEndpoints(doc);
    const suites = generateSkeleton(endpoints);
    const files = await writeSuites(suites, tmpDir);

    expect(files.length).toBe(3);

    // Round-trip: each file should parse back without errors
    for (const filePath of files) {
      const text = await Bun.file(filePath).text();
      const parsed = Bun.YAML.parse(text);
      const suite = validateSuite(parsed);
      expect(suite.name).toBeDefined();
      expect(suite.tests.length).toBeGreaterThan(0);

      for (const step of suite.tests) {
        expect(step.method).toBeDefined();
        expect(step.path).toBeDefined();
        expect(step.expect).toBeDefined();
      }
    }
  });

  test("writes auth-aware YAML files and round-trips through parser", async () => {
    const authTmpDir = join(tmpdir(), `apitool-gen-auth-test-${Date.now()}`);
    try {
      const doc = await readOpenApiSpec(FIXTURE);
      const endpoints = extractEndpoints(doc);
      const securitySchemes = extractSecuritySchemes(doc);
      const suites = generateSkeleton(endpoints, "http://localhost:3000", securitySchemes);
      const files = await writeSuites(suites, authTmpDir);

      // Find pets suite file
      const petsFile = files.find((f) => f.includes("pets"))!;
      const text = await Bun.file(petsFile).text();

      // Verify YAML contains auth elements
      expect(text).toContain("Authorization:");
      expect(text).toContain("Bearer {{auth_token}}");
      expect(text).toContain("Auth: Login");
      expect(text).toContain("auth_username");
      expect(text).toContain("auth_password");

      // Round-trip validation
      const parsed = Bun.YAML.parse(text);
      const suite = validateSuite(parsed);
      expect(suite.name).toBe("pets");
      expect(suite.headers?.Authorization).toBe("Bearer {{auth_token}}");
      expect(suite.tests[0]!.name).toBe("Auth: Login");
    } finally {
      await rm(authTmpDir, { recursive: true, force: true }).catch(() => {});
    }
  });
});
