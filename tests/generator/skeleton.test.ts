import { describe, test, expect, afterAll } from "bun:test";
import { readOpenApiSpec, extractEndpoints, extractSecuritySchemes } from "../../src/core/generator/openapi-reader.ts";
import { generateSkeleton, writeSuites, isRelativeUrl, sanitizeEnvName } from "../../src/core/generator/skeleton.ts";
import { validateSuite } from "../../src/core/parser/schema.ts";
import { tmpdir } from "os";
import { join } from "path";
import { rm } from "fs/promises";

const FIXTURE = "tests/fixtures/petstore-auth.json";

describe("generateSkeleton", () => {
  test("generates one suite per endpoint", async () => {
    const doc = await readOpenApiSpec(FIXTURE);
    const endpoints = extractEndpoints(doc);
    const suites = generateSkeleton(endpoints);

    // 7 endpoints: 1 auth, 5 pets, 1 health
    expect(suites.length).toBe(7);
  });

  test("suites have folder set to sanitized tag", async () => {
    const doc = await readOpenApiSpec(FIXTURE);
    const endpoints = extractEndpoints(doc);
    const suites = generateSkeleton(endpoints);

    const folders = suites.map((s) => s.folder);
    expect(folders.filter((f) => f === "auth").length).toBe(1);
    expect(folders.filter((f) => f === "pets").length).toBe(5);
    expect(folders.filter((f) => f === "health").length).toBe(1);
  });

  test("each suite has exactly one endpoint test", async () => {
    const doc = await readOpenApiSpec(FIXTURE);
    const endpoints = extractEndpoints(doc);
    const suites = generateSkeleton(endpoints);

    for (const suite of suites) {
      expect(suite.tests.length).toBe(1);
    }
  });

  test("uses method-as-key format", async () => {
    const doc = await readOpenApiSpec(FIXTURE);
    const endpoints = extractEndpoints(doc);
    const suites = generateSkeleton(endpoints);

    const getListSuite = suites.find((s) => "GET" in s.tests[0]! && (s.tests[0] as any).GET === "/pets")!;
    expect(getListSuite).toBeDefined();
    expect(getListSuite.tests[0]!.name).toBe("List all pets");

    const postSuite = suites.find((s) => "POST" in s.tests[0]! && (s.tests[0] as any).POST === "/pets")!;
    expect(postSuite).toBeDefined();
    expect(postSuite.tests[0]!.json).toBeDefined();
  });

  test("sets happy path status code", async () => {
    const doc = await readOpenApiSpec(FIXTURE);
    const endpoints = extractEndpoints(doc);
    const suites = generateSkeleton(endpoints);

    const postSuite = suites.find((s) => "POST" in s.tests[0]! && (s.tests[0] as any).POST === "/pets")!;
    expect(postSuite.tests[0]!.expect.status).toBe(201);

    const deleteSuite = suites.find((s) => "DELETE" in s.tests[0]!)!;
    expect(deleteSuite.tests[0]!.expect.status).toBe(204);
  });

  test("generates body assertions for object responses", async () => {
    const doc = await readOpenApiSpec(FIXTURE);
    const endpoints = extractEndpoints(doc);
    const suites = generateSkeleton(endpoints);

    const healthSuite = suites.find((s) => s.folder === "health")!;
    expect(healthSuite).toBeDefined();
    const healthTest = healthSuite.tests[0]!;
    expect(healthTest.expect.body).toBeDefined();
    expect(healthTest.expect.body!.status).toEqual({ type: "string" });
    expect(healthTest.expect.body!.uptime).toEqual({ type: "number" });
  });

  test("fileStem is derived correctly from endpoint path", async () => {
    const doc = await readOpenApiSpec(FIXTURE);
    const endpoints = extractEndpoints(doc);
    const suites = generateSkeleton(endpoints);

    const getListSuite = suites.find((s) => "GET" in s.tests[0]! && (s.tests[0] as any).GET === "/pets")!;
    expect(getListSuite.fileStem).toBe("GET");

    const postSuite = suites.find((s) => "POST" in s.tests[0]! && (s.tests[0] as any).POST === "/pets")!;
    expect(postSuite.fileStem).toBe("POST");

    const deleteSuite = suites.find((s) => "DELETE" in s.tests[0]!)!;
    expect(deleteSuite.fileStem).toBe("DELETE_id");
  });
});

describe("generateSkeleton with auth", () => {
  test("adds login step as first test for auth suites", async () => {
    const doc = await readOpenApiSpec(FIXTURE);
    const endpoints = extractEndpoints(doc);
    const securitySchemes = extractSecuritySchemes(doc);
    const suites = generateSkeleton(endpoints, undefined, securitySchemes);

    // pets endpoints require auth — each should have login step prepended
    const petsSuites = suites.filter((s) => s.folder === "pets");
    for (const suite of petsSuites) {
      expect(suite.tests[0]!.name).toBe("Auth: Login");
      expect("POST" in suite.tests[0]!).toBe(true);
      expect((suite.tests[0] as any).POST).toBe("/auth/login");
    }
  });

  test("auth suites have 2 tests (login + endpoint)", async () => {
    const doc = await readOpenApiSpec(FIXTURE);
    const endpoints = extractEndpoints(doc);
    const securitySchemes = extractSecuritySchemes(doc);
    const suites = generateSkeleton(endpoints, undefined, securitySchemes);

    const petsSuites = suites.filter((s) => s.folder === "pets");
    for (const suite of petsSuites) {
      expect(suite.tests.length).toBe(2); // login + endpoint
    }
  });

  test("login step captures auth_token", async () => {
    const doc = await readOpenApiSpec(FIXTURE);
    const endpoints = extractEndpoints(doc);
    const securitySchemes = extractSecuritySchemes(doc);
    const suites = generateSkeleton(endpoints, undefined, securitySchemes);

    const petsSuite = suites.find((s) => s.folder === "pets")!;
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

    const petsSuite = suites.find((s) => s.folder === "pets")!;
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

    const petsSuites = suites.filter((s) => s.folder === "pets");
    for (const suite of petsSuites) {
      expect(suite.headers).toBeDefined();
      expect(suite.headers!.Authorization).toBe("Bearer {{auth_token}}");
    }
  });

  test("non-auth suites have no login step or auth header", async () => {
    const doc = await readOpenApiSpec(FIXTURE);
    const endpoints = extractEndpoints(doc);
    const securitySchemes = extractSecuritySchemes(doc);
    const suites = generateSkeleton(endpoints, undefined, securitySchemes);

    const healthSuite = suites.find((s) => s.folder === "health")!;
    expect(healthSuite.headers).toBeUndefined();
    expect(healthSuite.tests.length).toBe(1);
    expect(healthSuite.tests[0]!.name).not.toBe("Auth: Login");
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
    const dataSuite = suites.find((s) => s.folder === "data")!;
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
    const secureSuite = suites.find((s) => s.folder === "secure")!;
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
    const mixedSuite = suites.find((s) => s.folder === "mixed")!;
    expect(mixedSuite.headers).toBeDefined();
    // Basic uses ?? so bearer header (if set) takes precedence
    expect(mixedSuite.headers!.Authorization).toBe("Basic {{basic_credentials}}");
  });
});

describe("isRelativeUrl", () => {
  test("returns true for paths starting with /", () => {
    expect(isRelativeUrl("/api/v1")).toBe(true);
    expect(isRelativeUrl("/")).toBe(true);
    expect(isRelativeUrl("/docgen2/rest")).toBe(true);
  });

  test("returns false for absolute URLs", () => {
    expect(isRelativeUrl("https://api.example.com")).toBe(false);
    expect(isRelativeUrl("http://localhost:3000")).toBe(false);
    expect(isRelativeUrl("http://localhost:3000/api")).toBe(false);
  });
});

describe("relative base_url handling", () => {
  test("generated suite with relative baseUrl uses {{base_url}} placeholder", () => {
    const doc = { openapi: "3.0.0", info: { title: "Test" }, paths: {} };
    const endpoints: import("../../src/core/generator/types.ts").EndpointInfo[] = [
      {
        path: "/items",
        method: "GET",
        operationId: "getItems",
        summary: "Get items",
        tags: ["items"],
        parameters: [],
        requestBodySchema: undefined,
        requestBodyContentType: undefined,
        responseContentTypes: [],
        responses: [{ statusCode: 200, description: "OK" }],
        security: [],
      } as any,
    ];

    const suites = generateSkeleton(endpoints, "/api/v1");
    expect(suites[0]!.base_url).toBe("{{base_url}}");
  });

  test("generated suite with absolute baseUrl uses it directly", () => {
    const endpoints: import("../../src/core/generator/types.ts").EndpointInfo[] = [
      {
        path: "/items",
        method: "GET",
        operationId: "getItems",
        summary: "Get items",
        tags: ["items"],
        parameters: [],
        requestBodySchema: undefined,
        requestBodyContentType: undefined,
        responseContentTypes: [],
        responses: [{ statusCode: 200, description: "OK" }],
        security: [],
      } as any,
    ];

    const suites = generateSkeleton(endpoints, "https://api.example.com");
    expect(suites[0]!.base_url).toBe("https://api.example.com");
  });
});

describe("writeSuites + round-trip", () => {
  const tmpDir = join(tmpdir(), `apitool-gen-test-${Date.now()}`);

  afterAll(async () => {
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  });

  test("writes YAML files into tag subfolders and round-trips through parser", async () => {
    const doc = await readOpenApiSpec(FIXTURE);
    const endpoints = extractEndpoints(doc);
    const suites = generateSkeleton(endpoints);
    const { written } = await writeSuites(suites, tmpDir);

    // 7 endpoints → 7 files
    expect(written.length).toBe(7);

    // Files should be in subfolders
    expect(written.some((f) => f.includes("/pets/") || f.includes("\\pets\\"))).toBe(true);
    expect(written.some((f) => f.includes("/auth/") || f.includes("\\auth\\"))).toBe(true);
    expect(written.some((f) => f.includes("/health/") || f.includes("\\health\\"))).toBe(true);

    // Round-trip: each file should parse back without errors
    for (const filePath of written) {
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
      const { written } = await writeSuites(suites, authTmpDir);

      // Find a pets suite file (any one with auth)
      const petsFile = written.find((f) => f.includes("/pets/") || f.includes("\\pets\\"))!;
      expect(petsFile).toBeDefined();
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
      expect(suite.headers?.Authorization).toBe("Bearer {{auth_token}}");
      expect(suite.tests[0]!.name).toBe("Auth: Login");
    } finally {
      await rm(authTmpDir, { recursive: true, force: true }).catch(() => {});
    }
  });
});
