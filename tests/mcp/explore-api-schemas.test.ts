import { describe, test, expect, mock, afterAll } from "bun:test";

mock.module("../../src/core/generator/openapi-reader.ts", () => ({
  readOpenApiSpec: mock(() => Promise.resolve({
    info: { title: "Pet Store", version: "1.0.0" },
    servers: [{ url: "https://petstore.io/v1" }],
    paths: {},
  })),
  extractEndpoints: mock(() => [
    {
      method: "GET",
      path: "/pets",
      summary: "List pets",
      tags: ["pets"],
      parameters: [{ name: "limit", in: "query", required: false, schema: { type: "integer" } }],
      responses: [
        { statusCode: 200, description: "OK", schema: { type: "array", items: { type: "object", properties: { id: { type: "integer" }, name: { type: "string" } } } } },
      ],
      requestBodySchema: undefined,
      requestBodyContentType: undefined,
      security: [],
    },
    {
      method: "POST",
      path: "/pets",
      summary: "Create pet",
      tags: ["pets"],
      parameters: [],
      responses: [
        { statusCode: 201, description: "Created", schema: { type: "object", required: ["id"], properties: { id: { type: "integer" }, name: { type: "string" } } } },
        { statusCode: 400, description: "Validation error" },
      ],
      requestBodySchema: { type: "object", required: ["name"], properties: { name: { type: "string" }, species: { type: "string" } } },
      requestBodyContentType: "application/json",
      security: ["bearerAuth"],
    },
  ]),
  extractSecuritySchemes: mock(() => [
    { name: "bearerAuth", type: "http", scheme: "bearer" },
  ]),
}));

afterAll(() => { mock.restore(); });

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerExploreApiTool } from "../../src/mcp/tools/explore-api.ts";

describe("MCP explore_api with includeSchemas", () => {
  test("without includeSchemas — no schemas in output", async () => {
    const server = new McpServer({ name: "test", version: "0.0.1" });
    registerExploreApiTool(server);

    const tool = (server as any)._registeredTools["explore_api"];
    const result = await tool.handler({ specPath: "petstore.yaml" });
    const parsed = JSON.parse(result.content[0].text);

    const postEndpoint = parsed.endpoints.find((e: any) => e.method === "POST");
    expect(postEndpoint.hasRequestBody).toBe(true);
    expect(postEndpoint.requestBodySchema).toBeUndefined();
    expect(postEndpoint.responses[0].schema).toBeUndefined();
  });

  test("with includeSchemas=true — includes compressed schemas", async () => {
    const server = new McpServer({ name: "test", version: "0.0.1" });
    registerExploreApiTool(server);

    const tool = (server as any)._registeredTools["explore_api"];
    const result = await tool.handler({ specPath: "petstore.yaml", includeSchemas: true });
    const parsed = JSON.parse(result.content[0].text);

    const postEndpoint = parsed.endpoints.find((e: any) => e.method === "POST");

    // Should have request body schema
    expect(postEndpoint.requestBodySchema).toBe("{ name: string (req), species: string }");
    expect(postEndpoint.requestBodyContentType).toBe("application/json");

    // Should have response schemas
    expect(postEndpoint.responses[0].schema).toBe("{ id: integer (req), name: string }");
    // 400 has no schema
    expect(postEndpoint.responses[1].schema).toBeUndefined();

    // Should have security
    expect(postEndpoint.security).toEqual(["bearerAuth"]);
  });

  test("with includeSchemas=true — GET endpoint has response schema", async () => {
    const server = new McpServer({ name: "test", version: "0.0.1" });
    registerExploreApiTool(server);

    const tool = (server as any)._registeredTools["explore_api"];
    const result = await tool.handler({ specPath: "petstore.yaml", includeSchemas: true });
    const parsed = JSON.parse(result.content[0].text);

    const getEndpoint = parsed.endpoints.find((e: any) => e.method === "GET");

    // Should have response schema for 200
    expect(getEndpoint.responses[0].schema).toBe("[{ id: integer, name: string }]");

    // GET has no request body
    expect(getEndpoint.requestBodySchema).toBeUndefined();

    // Parameter should have type info
    expect(getEndpoint.parameters[0].type).toBeDefined();
  });
});
