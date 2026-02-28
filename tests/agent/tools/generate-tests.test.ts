import { describe, test, expect, mock, beforeEach } from "bun:test";

const mockReadSpec = mock(() => Promise.resolve({ openapi: "3.0.0", info: { title: "Pet API" }, paths: {} }));
const mockExtractEndpoints = mock(() => [{ method: "GET", path: "/pets" }]);
const mockExtractSecuritySchemes = mock(() => []);
const mockGenerateSuites = mock(() => [{ name: "Pet API", tests: [] }]);
const mockWriteSuites = mock(() => Promise.resolve({ written: ["generated/pet-api.yaml"], skipped: [] }));

mock.module("../../../src/core/generator/openapi-reader.ts", () => ({
  readOpenApiSpec: mockReadSpec,
  extractEndpoints: mockExtractEndpoints,
  extractSecuritySchemes: mockExtractSecuritySchemes,
}));

mock.module("../../../src/core/generator/skeleton.ts", () => ({
  generateSuites: mockGenerateSuites,
  writeSuites: mockWriteSuites,
}));

import { generateTestsTool } from "../../../src/core/agent/tools/generate-tests.ts";

const toolOpts = { toolCallId: "test", messages: [] as any[] };

describe("generateTestsTool", () => {
  beforeEach(() => {
    mockReadSpec.mockClear();
    mockExtractEndpoints.mockClear();
    mockGenerateSuites.mockClear();
    mockWriteSuites.mockClear();
  });

  test("is an AI SDK v6 tool with inputSchema", () => {
    expect(generateTestsTool).toHaveProperty("inputSchema");
    expect(generateTestsTool).toHaveProperty("execute");
  });

  test("generates tests from spec and returns result", async () => {
    const result = await generateTestsTool.execute!({ specPath: "petstore.json" }, toolOpts);
    expect(result).toEqual({
      suitesGenerated: 1,
      written: ["generated/pet-api.yaml"],
      skipped: [],
      outputDir: "./generated/",
    });
    expect(mockReadSpec).toHaveBeenCalledWith("petstore.json");
  });

  test("uses custom outputDir", async () => {
    await generateTestsTool.execute!({ specPath: "spec.json", outputDir: "./custom/" }, toolOpts);
    expect(mockWriteSuites).toHaveBeenCalledWith(expect.any(Array), "./custom/");
  });

  test("returns structured error on failure", async () => {
    mockReadSpec.mockRejectedValueOnce(new Error("File not found"));
    const result = await generateTestsTool.execute!({ specPath: "missing.json" }, toolOpts);
    expect(result).toEqual({ error: "File not found" });
  });
});
