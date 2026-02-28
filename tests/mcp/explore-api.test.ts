import { describe, test, expect, mock, beforeEach } from "bun:test";

mock.module("../../src/core/generator/openapi-reader.ts", () => ({
  readOpenApiSpec: mock(() => Promise.resolve({
    info: { title: "Pet Store", version: "1.0.0" },
    servers: [{ url: "https://petstore.io/v1" }],
    paths: {},
  })),
  extractEndpoints: mock(() => [
    { method: "GET", path: "/pets", summary: "List pets", tags: ["pets"], parameters: [{ name: "limit", in: "query", required: false }], responses: [{ statusCode: 200, description: "OK" }], requestBodySchema: undefined },
    { method: "POST", path: "/pets", summary: "Create pet", tags: ["pets"], parameters: [], responses: [{ statusCode: 201, description: "Created" }], requestBodySchema: { type: "object" } },
    { method: "GET", path: "/users", summary: "List users", tags: ["users"], parameters: [], responses: [{ statusCode: 200, description: "OK" }], requestBodySchema: undefined },
  ]),
  extractSecuritySchemes: mock(() => [
    { name: "bearerAuth", type: "http", scheme: "bearer" },
  ]),
}));

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerExploreApiTool } from "../../src/mcp/tools/explore-api.ts";

describe("MCP explore_api", () => {
  test("returns spec info and endpoints", async () => {
    const server = new McpServer({ name: "test", version: "0.0.1" });
    registerExploreApiTool(server);

    const tool = (server as any)._registeredTools["explore_api"];
    const result = await tool.handler({ specPath: "petstore.yaml" });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.title).toBe("Pet Store");
    expect(parsed.totalEndpoints).toBe(3);
    expect(parsed.endpoints).toHaveLength(3);
    expect(parsed.securitySchemes).toHaveLength(1);
  });

  test("filters by tag", async () => {
    const server = new McpServer({ name: "test", version: "0.0.1" });
    registerExploreApiTool(server);

    const tool = (server as any)._registeredTools["explore_api"];
    const result = await tool.handler({ specPath: "petstore.yaml", tag: "pets" });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.filteredByTag).toBe("pets");
    expect(parsed.matchingEndpoints).toBe(2);
    expect(parsed.endpoints).toHaveLength(2);
  });
});
