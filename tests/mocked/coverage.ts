import { describe, test, expect, mock, beforeEach, afterAll } from "bun:test";

// Mock the generator modules
mock.module("../../src/core/generator/openapi-reader.ts", () => ({
  readOpenApiSpec: mock(() => Promise.resolve({
    info: { title: "Test API", version: "1.0" },
    paths: {},
  })),
  extractEndpoints: mock(() => [
    { method: "GET", path: "/users", tags: [], parameters: [], responses: [] },
    { method: "POST", path: "/users", tags: [], parameters: [], responses: [] },
    { method: "GET", path: "/users/{id}", tags: [], parameters: [], responses: [] },
  ]),
  extractSecuritySchemes: mock(() => []),
}));

mock.module("../../src/core/generator/coverage-scanner.ts", () => ({
  scanCoveredEndpoints: mock(() => Promise.resolve([
    { method: "GET", path: "/users", file: "tests/users.yaml" },
  ])),
  filterUncoveredEndpoints: mock((all: any[], covered: any[]) => {
    // Simulate 2 uncovered
    return all.slice(1);
  }),
}));

afterAll(() => { mock.restore(); });

import { coverageCommand } from "../../src/cli/commands/coverage.ts";
import { readOpenApiSpec, extractEndpoints } from "../../src/core/generator/openapi-reader.ts";
import { scanCoveredEndpoints } from "../../src/core/generator/coverage-scanner.ts";

describe("coverageCommand", () => {
  beforeEach(() => {
    (readOpenApiSpec as ReturnType<typeof mock>).mockClear();
    (extractEndpoints as ReturnType<typeof mock>).mockClear();
    (scanCoveredEndpoints as ReturnType<typeof mock>).mockClear();
  });

  test("returns 1 when there are uncovered endpoints", async () => {
    const code = await coverageCommand({ spec: "spec.yaml", tests: "./tests" });
    expect(code).toBe(1);
    expect(readOpenApiSpec).toHaveBeenCalledWith("spec.yaml");
    expect(scanCoveredEndpoints).toHaveBeenCalledWith("./tests");
  });

  test("returns 2 on error", async () => {
    (readOpenApiSpec as ReturnType<typeof mock>).mockRejectedValueOnce(new Error("File not found"));
    const code = await coverageCommand({ spec: "bad.yaml", tests: "./tests" });
    expect(code).toBe(2);
  });

  test("returns 1 when no endpoints in spec", async () => {
    (extractEndpoints as ReturnType<typeof mock>).mockReturnValueOnce([]);
    const code = await coverageCommand({ spec: "empty.yaml", tests: "./tests" });
    expect(code).toBe(1);
  });
});
