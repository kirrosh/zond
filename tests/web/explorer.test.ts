import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { createApp } from "../../src/web/server.ts";
import { getDb, closeDb } from "../../src/db/schema.ts";
import type { EndpointInfo } from "../../src/core/generator/types.ts";
import { unlinkSync } from "node:fs";

const TEST_DB = "test-web-explorer.db";

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
  },
];

describe("Explorer routes", () => {
  let appWithSpec: ReturnType<typeof createApp>;
  let appWithoutSpec: ReturnType<typeof createApp>;

  beforeAll(() => {
    try { unlinkSync(TEST_DB); } catch {}
    getDb(TEST_DB);
    appWithSpec = createApp({ endpoints: mockEndpoints, specPath: "petstore.yaml", servers: [{ url: "https://petstore3.swagger.io/api/v3", description: "Swagger Petstore" }] });
    appWithoutSpec = createApp({ endpoints: [], specPath: null, servers: [] });
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
    expect(html).toContain("petstore.yaml");
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
    expect(html).toContain("https://petstore3.swagger.io/api/v3");
  });

  it("HTMX explorer request returns fragment", async () => {
    const res = await appWithSpec.request("/explorer", { headers: { "HX-Request": "true" } });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("API Explorer");
    expect(html).not.toContain("<!DOCTYPE html>");
  });
});
