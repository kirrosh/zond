import { describe, test, expect, mock, afterAll, beforeEach } from "bun:test";
import { mkdirSync, existsSync, readFileSync, rmSync } from "fs";
import { join, resolve } from "path";
import { tmpdir } from "os";

// Mock the DB layer
const mockFindCollectionByNameOrId = mock(() => null);
const mockCreateCollection = mock(() => 42);
const mockUpsertEnvironment = mock(() => {});
const mockNormalizePath = mock((p: string) => p.replace(/\\/g, "/"));

mock.module("../../src/db/queries.ts", () => ({
  findCollectionByNameOrId: mockFindCollectionByNameOrId,
  createCollection: mockCreateCollection,
  upsertEnvironment: mockUpsertEnvironment,
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

mock.module("../../src/cli/commands/envs.ts", () => ({
  toYaml: mock((vars: Record<string, string>) =>
    Object.entries(vars).map(([k, v]) => `${k}: ${v}`).join("\n")
  ),
}));

afterAll(() => { mock.restore(); });

import { setupApi } from "../../src/core/setup-api.ts";

describe("setupApi", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = join(tmpdir(), `apitool-test-${Date.now()}`);
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
    expect(existsSync(join(dir, "tests"))).toBe(true);
    expect(existsSync(join(dir, ".env.yaml"))).toBe(true);

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

  test("custom envVars are passed through", async () => {
    const dir = join(tempDir, "withenv");
    await setupApi({
      name: "myapi",
      dir,
      envVars: { token: "abc123" },
    });

    expect(mockUpsertEnvironment).toHaveBeenCalled();

    rmSync(dir, { recursive: true, force: true });
  });
});
