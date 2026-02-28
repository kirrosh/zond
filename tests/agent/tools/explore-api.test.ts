import { describe, test, expect, mock, beforeEach, afterAll } from "bun:test";

mock.module("../../../src/core/generator/openapi-reader.ts", () => ({
  readOpenApiSpec: mock(() => Promise.resolve({
    info: { title: "Pet Store", version: "1.0.0" },
    servers: [{ url: "https://petstore.io" }],
    paths: {},
  })),
  extractEndpoints: mock(() => [
    { method: "GET", path: "/pets", summary: "List pets", tags: ["pets"], parameters: [], responses: [] },
    { method: "POST", path: "/pets", summary: "Create pet", tags: ["pets"], parameters: [], responses: [] },
    { method: "GET", path: "/users", summary: "List users", tags: ["users"], parameters: [], responses: [] },
  ]),
  extractSecuritySchemes: mock(() => [
    { name: "bearerAuth", type: "http", scheme: "bearer" },
  ]),
}));

afterAll(() => { mock.restore(); });

import { exploreApiTool } from "../../../src/core/agent/tools/explore-api.ts";
import { readOpenApiSpec } from "../../../src/core/generator/openapi-reader.ts";

const toolOpts = { toolCallId: "test", messages: [] as any[] };

describe("exploreApiTool", () => {
  beforeEach(() => {
    (readOpenApiSpec as ReturnType<typeof mock>).mockClear();
  });

  test("is an AI SDK v6 tool with inputSchema", () => {
    expect(exploreApiTool).toHaveProperty("inputSchema");
    expect(exploreApiTool).toHaveProperty("execute");
    expect(exploreApiTool).toHaveProperty("description");
  });

  test("returns compact spec info", async () => {
    const result = await exploreApiTool.execute!({ specPath: "petstore.yaml" }, toolOpts) as any;
    expect(result.title).toBe("Pet Store");
    expect(result.totalEndpoints).toBe(3);
    expect(result.endpoints).toHaveLength(3);
    // Compact: servers as string array, securitySchemes as name array
    expect(result.servers).toEqual(["https://petstore.io"]);
    expect(result.securitySchemes).toEqual(["bearerAuth"]);
  });

  test("filters by tag", async () => {
    const result = await exploreApiTool.execute!({ specPath: "petstore.yaml", tag: "pets" }, toolOpts) as any;
    expect(result.filteredByTag).toBe("pets");
    expect(result.matchingEndpoints).toBe(2);
    expect(result.endpoints).toHaveLength(2);
  });

  test("returns error on failure", async () => {
    (readOpenApiSpec as ReturnType<typeof mock>).mockRejectedValueOnce(new Error("spec not found"));
    const result = await exploreApiTool.execute!({ specPath: "bad.yaml" }, toolOpts) as any;
    expect(result.error).toBe("spec not found");
  });
});
