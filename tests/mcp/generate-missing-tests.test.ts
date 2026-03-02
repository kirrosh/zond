import { describe, test, expect, mock, afterAll } from "bun:test";

const mockEndpoints = [
  { method: "GET", path: "/pets", summary: "List pets", tags: ["pets"], parameters: [], responses: [{ statusCode: 200, description: "OK" }], security: [] },
  { method: "POST", path: "/pets", summary: "Create pet", tags: ["pets"], parameters: [], responses: [{ statusCode: 201, description: "Created" }], security: [] },
  { method: "GET", path: "/users", summary: "List users", tags: ["users"], parameters: [], responses: [{ statusCode: 200, description: "OK" }], security: [] },
];

mock.module("../../src/core/generator/openapi-reader.ts", () => ({
  readOpenApiSpec: mock(() => Promise.resolve({
    info: { title: "Pet Store", version: "1.0.0" },
    servers: [{ url: "https://petstore.io/v1" }],
    paths: {},
  })),
  extractEndpoints: mock(() => mockEndpoints),
  extractSecuritySchemes: mock(() => []),
}));

const mockScanCovered = mock(() => Promise.resolve([
  { method: "GET", path: "/pets", file: "tests/pets.yaml" },
]));

mock.module("../../src/core/generator/coverage-scanner.ts", () => ({
  scanCoveredEndpoints: mockScanCovered,
  filterUncoveredEndpoints: mock((all: any[], covered: any[]) => {
    const coveredSet = new Set(covered.map((c: any) => `${c.method} ${c.path}`));
    return all.filter((ep: any) => !coveredSet.has(`${ep.method} ${ep.path}`));
  }),
}));

afterAll(() => { mock.restore(); });

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerGenerateMissingTestsTool } from "../../src/mcp/tools/generate-missing-tests.ts";

describe("MCP generate_missing_tests", () => {
  test("partially covered → guide with only uncovered endpoints", async () => {
    const server = new McpServer({ name: "test", version: "0.0.1" });
    registerGenerateMissingTestsTool(server);

    const tool = (server as any)._registeredTools["generate_missing_tests"];
    const result = await tool.handler({ specPath: "petstore.yaml", testsDir: "./tests/" });

    expect(result.isError).toBeUndefined();
    const text = result.content[0].text;
    expect(text).toContain("Coverage: 1/3 endpoints covered (33%)");
    expect(text).toContain("2 uncovered endpoints");
    expect(text).toContain("POST /pets");
    expect(text).toContain("GET /users");
  });

  test("all covered → fullyCovered response", async () => {
    mockScanCovered.mockImplementationOnce(() => Promise.resolve([
      { method: "GET", path: "/pets", file: "a.yaml" },
      { method: "POST", path: "/pets", file: "a.yaml" },
      { method: "GET", path: "/users", file: "b.yaml" },
    ]));

    const server = new McpServer({ name: "test", version: "0.0.1" });
    registerGenerateMissingTestsTool(server);

    const tool = (server as any)._registeredTools["generate_missing_tests"];
    const result = await tool.handler({ specPath: "petstore.yaml", testsDir: "./tests/" });

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.fullyCovered).toBe(true);
    expect(parsed.percentage).toBe(100);
  });
});
