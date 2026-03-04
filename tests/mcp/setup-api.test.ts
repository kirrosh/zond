import { describe, test, expect, mock, afterAll, beforeEach } from "bun:test";
import { existsSync, readFileSync, rmSync } from "fs";
import { join, resolve } from "path";
import { tmpdir } from "os";

// Mock the DB layer
const mockFindCollectionByNameOrId = mock(() => null);
const mockCreateCollection = mock(() => 42);
const mockNormalizePath = mock((p: string) => p.replace(/\\/g, "/"));

mock.module("../../src/db/queries.ts", () => ({
  findCollectionByNameOrId: mockFindCollectionByNameOrId,
  createCollection: mockCreateCollection,
  normalizePath: mockNormalizePath,
}));

mock.module("../../src/db/schema.ts", () => ({
  getDb: mock(() => ({})),
}));

mock.module("../../src/core/generator/index.ts", () => ({
  readOpenApiSpec: mock(() => Promise.resolve({
    servers: [{ url: "https://petstore.io/v2" }],
  })),
  extractEndpoints: mock(() => [
    { method: "GET", path: "/pets" },
    { method: "POST", path: "/pets" },
  ]),
}));


afterAll(() => { mock.restore(); });

import { setupApi } from "../../src/core/setup-api.ts";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

describe("setupApi", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = join(tmpdir(), `zond-test-${Date.now()}`);
    mockFindCollectionByNameOrId.mockImplementation(() => null);
    mockCreateCollection.mockImplementation(() => 42);
  });

  test("creates API with spec → collection created, dirs exist, env written", async () => {
    const dir = join(tempDir, "petstore");
    const result = await setupApi({
      name: "petstore",
      spec: "https://petstore.io/v2/swagger.json",
      dir,
    });

    expect(result.created).toBe(true);
    expect(result.collectionId).toBe(42);
    expect(result.baseUrl).toBe("https://petstore.io/v2");
    expect(result.specEndpoints).toBe(2);
    expect(result.baseDir).toBeTruthy();
    expect(existsSync(join(dir, "tests"))).toBe(true);
    expect(existsSync(join(dir, ".env.yaml"))).toBe(true);
    expect(existsSync(join(dir, ".gitignore"))).toBe(true);
    expect(readFileSync(join(dir, ".gitignore"), "utf-8")).toContain(".env*.yaml");

    // Cleanup
    rmSync(dir, { recursive: true, force: true });
  });

  test("duplicate name throws error", async () => {
    mockFindCollectionByNameOrId.mockImplementation(() => ({ id: 1, name: "petstore" }) as any);

    await expect(setupApi({
      name: "petstore",
      dir: join(tempDir, "dup"),
    })).rejects.toThrow("already exists");
  });

  test("without spec → collection created without openapi_spec", async () => {
    const dir = join(tempDir, "nospec");
    const result = await setupApi({
      name: "nospec-api",
      dir,
    });

    expect(result.created).toBe(true);
    expect(result.specEndpoints).toBe(0);
    expect(result.baseUrl).toBe("");

    rmSync(dir, { recursive: true, force: true });
  });

  test("custom envVars are written to .env.yaml", async () => {
    const dir = join(tempDir, "withenv");
    await setupApi({
      name: "myapi",
      dir,
      envVars: { token: "abc123" },
    });

    expect(existsSync(join(dir, ".env.yaml"))).toBe(true);
    expect(readFileSync(join(dir, ".env.yaml"), "utf-8")).toContain("token");

    rmSync(dir, { recursive: true, force: true });
  });
});

describe("setup_api MCP tool", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = join(tmpdir(), `zond-mcp-setup-${Date.now()}`);
    mockFindCollectionByNameOrId.mockImplementation(() => null);
    mockCreateCollection.mockImplementation(() => 99);
  });

  test("response includes nextSteps with .env.yaml path", async () => {
    const { registerSetupApiTool } = await import("../../src/mcp/tools/setup-api.ts");

    const server = new McpServer({ name: "test", version: "0.0.1" });
    registerSetupApiTool(server);

    const tool = (server as any)._registeredTools["setup_api"];
    const dir = join(tempDir, "myapi");
    const result = await tool.handler({ name: "myapi", dir });

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.created).toBe(true);
    expect(parsed.nextSteps).toBeDefined();
    expect(Array.isArray(parsed.nextSteps)).toBe(true);
    expect(parsed.nextSteps.length).toBeGreaterThan(0);
    expect(parsed.nextSteps[0]).toContain(".env.yaml");
    expect(parsed.nextSteps[1]).toContain("git-ignored");

    rmSync(dir, { recursive: true, force: true });
  });
});
