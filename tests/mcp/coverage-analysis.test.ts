import { describe, test, expect, mock, beforeEach } from "bun:test";

mock.module("../../src/core/generator/openapi-reader.ts", () => ({
  readOpenApiSpec: mock(() => Promise.resolve({ info: { title: "API" }, paths: {} })),
  extractEndpoints: mock(() => [
    { method: "GET", path: "/users", summary: "List users", tags: ["users"], parameters: [], responses: [] },
    { method: "POST", path: "/users", summary: "Create user", tags: ["users"], parameters: [], responses: [] },
  ]),
  extractSecuritySchemes: mock(() => []),
}));

mock.module("../../src/core/generator/coverage-scanner.ts", () => ({
  scanCoveredEndpoints: mock(() => Promise.resolve([
    { method: "GET", path: "/users", file: "tests/users.yaml" },
  ])),
  filterUncoveredEndpoints: mock((all: any[], _covered: any[]) => all.slice(1)),
}));

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerCoverageAnalysisTool } from "../../src/mcp/tools/coverage-analysis.ts";
import { readOpenApiSpec, extractEndpoints } from "../../src/core/generator/openapi-reader.ts";

describe("MCP coverage_analysis", () => {
  beforeEach(() => {
    (readOpenApiSpec as ReturnType<typeof mock>).mockClear();
    (extractEndpoints as ReturnType<typeof mock>).mockClear();
  });

  test("returns coverage analysis", async () => {
    const server = new McpServer({ name: "test", version: "0.0.1" });
    registerCoverageAnalysisTool(server);
    const tool = (server as any)._registeredTools["coverage_analysis"];

    const result = await tool.handler({ specPath: "spec.yaml", testsDir: "./tests" });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.totalEndpoints).toBe(2);
    expect(parsed.covered).toBe(1);
    expect(parsed.uncovered).toBe(1);
    expect(parsed.percentage).toBe(50);
    expect(parsed.uncoveredEndpoints).toHaveLength(1);
  });

  test("returns error when spec has no endpoints", async () => {
    (extractEndpoints as ReturnType<typeof mock>).mockReturnValueOnce([]);
    const server = new McpServer({ name: "test", version: "0.0.1" });
    registerCoverageAnalysisTool(server);
    const tool = (server as any)._registeredTools["coverage_analysis"];

    const result = await tool.handler({ specPath: "empty.yaml", testsDir: "./tests" });
    expect(result.isError).toBe(true);
  });

  test("returns error on spec read failure", async () => {
    (readOpenApiSpec as ReturnType<typeof mock>).mockRejectedValueOnce(new Error("File not found"));
    const server = new McpServer({ name: "test", version: "0.0.1" });
    registerCoverageAnalysisTool(server);
    const tool = (server as any)._registeredTools["coverage_analysis"];

    const result = await tool.handler({ specPath: "bad.yaml", testsDir: "./tests" });
    expect(result.isError).toBe(true);
  });
});
