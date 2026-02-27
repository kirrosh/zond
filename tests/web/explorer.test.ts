import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { createApp } from "../../src/web/server.ts";
import { getDb, closeDb } from "../../src/db/schema.ts";
import type { EndpointInfo } from "../../src/core/generator/types.ts";
import { unlinkSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const TEST_DB = join(tmpdir(), `apitool-web-explorer-${Date.now()}.db`);

const mockEndpoints: EndpointInfo[] = [
  {
    path: "/pets",
    method: "GET",
    operationId: "listPets",
    summary: "List all pets",
    tags: ["pets"],
    parameters: [
      { name: "limit", in: "query", required: false, schema: { type: "integer" } } as any,
    ],
    requestBodySchema: undefined,
    requestBodyContentType: undefined,
    responseContentTypes: ["application/json"],
    responses: [{ statusCode: 200, description: "A list of pets" }],
    security: [],
  },
  {
    path: "/pets/{petId}",
    method: "GET",
    operationId: "getPet",
    summary: "Get a pet by ID",
    tags: ["pets"],
    parameters: [
      { name: "petId", in: "path", required: true, schema: { type: "integer" } } as any,
    ],
    requestBodySchema: undefined,
    requestBodyContentType: undefined,
    responseContentTypes: ["application/json"],
    responses: [
      { statusCode: 200, description: "A pet" },
      { statusCode: 404, description: "Pet not found" },
    ],
    security: [],
  },
  {
    path: "/pets",
    method: "POST",
    operationId: "createPet",
    summary: "Create a pet",
    tags: ["pets"],
    parameters: [],
    requestBodySchema: { type: "object", properties: { name: { type: "string" } } } as any,
    requestBodyContentType: "application/json",
    responseContentTypes: ["application/json"],
    responses: [{ statusCode: 201, description: "Pet created" }],
    security: [],
  },
  {
    path: "/users",
    method: "GET",
    operationId: "listUsers",
    summary: "List all users",
    tags: ["users"],
    parameters: [],
    requestBodySchema: undefined,
    requestBodyContentType: undefined,
    responseContentTypes: ["application/json"],
    responses: [{ statusCode: 200, description: "A list of users" }],
    security: [],
  },
];

describe("Explorer routes", () => {
  let appWithSpec: ReturnType<typeof createApp>;
  let appWithoutSpec: ReturnType<typeof createApp>;

  let appNoAuth: ReturnType<typeof createApp>;
  let appMultiScheme: ReturnType<typeof createApp>;
  let appBearerNoLogin: ReturnType<typeof createApp>;

  beforeAll(() => {
    try { unlinkSync(TEST_DB); } catch {}
    getDb(TEST_DB);
    appWithSpec = createApp({
      endpoints: mockEndpoints,
      specPath: "petstore-auth.json",
      servers: [{ url: "http://localhost:3000", description: "Test Petstore" }],
      securitySchemes: [{ name: "bearerAuth", type: "http", scheme: "bearer" }],
      loginPath: "/auth/login",
    });
    appWithoutSpec = createApp({ endpoints: [], specPath: null, servers: [], securitySchemes: [], loginPath: null });
    appNoAuth = createApp({
      endpoints: mockEndpoints,
      specPath: "petstore.json",
      servers: [{ url: "http://localhost:3000" }],
      securitySchemes: [],
      loginPath: null,
    });
    appMultiScheme = createApp({
      endpoints: mockEndpoints,
      specPath: "petstore-multi.json",
      servers: [{ url: "http://localhost:3000" }],
      securitySchemes: [
        { name: "bearerAuth", type: "http", scheme: "bearer" },
        { name: "apiKeyAuth", type: "apiKey", in: "header", apiKeyName: "X-API-Key" },
        { name: "basicAuth", type: "http", scheme: "basic" },
        { name: "oauthScheme", type: "oauth2" },
      ],
      loginPath: "/auth/login",
    });
    appBearerNoLogin = createApp({
      endpoints: mockEndpoints,
      specPath: "petstore-bearer.json",
      servers: [{ url: "http://localhost:3000" }],
      securitySchemes: [{ name: "bearerAuth", type: "http", scheme: "bearer" }],
      loginPath: null,
    });
  });

  afterAll(() => {
    closeDb();
    try { unlinkSync(TEST_DB); } catch {}
  });

  it("GET /explorer without spec shows upload message", async () => {
    const res = await appWithoutSpec.request("/explorer");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("No OpenAPI spec loaded");
    expect(html).toContain("--openapi");
  });

  it("GET /explorer with spec shows endpoints", async () => {
    const res = await appWithSpec.request("/explorer");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("petstore-auth.json");
    expect(html).toContain("4 endpoints");
    expect(html).toContain("/pets");
    expect(html).toContain("/users");
    expect(html).toContain("List all pets");
    expect(html).toContain("GET");
    expect(html).toContain("POST");
  });

  it("endpoints are grouped by tag", async () => {
    const res = await appWithSpec.request("/explorer");
    const html = await res.text();
    expect(html).toContain("pets");
    expect(html).toContain("users");
  });

  it("endpoint details contain parameters", async () => {
    const res = await appWithSpec.request("/explorer");
    const html = await res.text();
    expect(html).toContain("limit");
    expect(html).toContain("petId");
  });

  it("endpoint with request body shows schema", async () => {
    const res = await appWithSpec.request("/explorer");
    const html = await res.text();
    expect(html).toContain("Request Body");
    expect(html).toContain("application/json");
  });

  it("try-it form is rendered with pre-filled server URL", async () => {
    const res = await appWithSpec.request("/explorer");
    const html = await res.text();
    expect(html).toContain("Try it");
    expect(html).toContain("/api/try");
    expect(html).toContain("http://localhost:3000");
  });

  it("HTMX explorer request returns fragment", async () => {
    const res = await appWithSpec.request("/explorer", { headers: { "HX-Request": "true" } });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("API Explorer");
    expect(html).not.toContain("<!DOCTYPE html>");
  });

  it("authorize panel rendered when bearer scheme present", async () => {
    const res = await appWithSpec.request("/explorer");
    const html = await res.text();
    expect(html).toContain("authorize-panel");
    expect(html).toContain("Authorize");
    expect(html).toContain("auth-user-bearerAuth");
    expect(html).toContain("auth-pass-bearerAuth");
    expect(html).toContain("/auth/login");
    expect(html).toContain("auth-token-bearerAuth");
    expect(html).toContain("Apply token");
  });

  it("authorize panel not rendered when no security schemes", async () => {
    const res = await appNoAuth.request("/explorer");
    const html = await res.text();
    expect(html).not.toContain("authorize-panel");
    expect(html).not.toContain("auth-scheme-section");
  });

  it("API Key scheme renders with apiKeyName and location badge", async () => {
    const res = await appMultiScheme.request("/explorer");
    const html = await res.text();
    expect(html).toContain('data-scheme="apiKeyAuth"');
    expect(html).toContain("X-API-Key");
    expect(html).toContain("in header as X-API-Key");
    expect(html).toContain("auth-apikey-apiKeyAuth");
  });

  it("Basic scheme renders with username and password fields", async () => {
    const res = await appMultiScheme.request("/explorer");
    const html = await res.text();
    expect(html).toContain('data-scheme="basicAuth"');
    expect(html).toContain("auth-basic-user-basicAuth");
    expect(html).toContain("auth-basic-pass-basicAuth");
  });

  it("multi-scheme renders all sections", async () => {
    const res = await appMultiScheme.request("/explorer");
    const html = await res.text();
    expect(html).toContain('data-scheme="bearerAuth"');
    expect(html).toContain('data-scheme="apiKeyAuth"');
    expect(html).toContain('data-scheme="basicAuth"');
    expect(html).toContain('data-scheme="oauthScheme"');
  });

  it("oauth2 scheme shows not yet supported", async () => {
    const res = await appMultiScheme.request("/explorer");
    const html = await res.text();
    expect(html).toContain('data-scheme="oauthScheme"');
    expect(html).toContain("Not yet supported");
  });

  it("bearer without loginPath shows only direct token input", async () => {
    const res = await appBearerNoLogin.request("/explorer");
    const html = await res.text();
    expect(html).toContain("auth-token-bearerAuth");
    expect(html).toContain("Apply token");
    expect(html).not.toContain("auth-user-bearerAuth");
    expect(html).not.toContain("auth-pass-bearerAuth");
    // No login button rendered (doLoginProxy function exists in script but no button calls it)
    expect(html).not.toContain(">Login<");
  });
});
