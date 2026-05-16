import { describe, test, expect, mock, beforeEach, afterAll } from "bun:test";
import { captureOutput } from "../_helpers/output.ts";

mock.module("../../src/core/generator/openapi-reader.ts", () => ({
  readOpenApiSpec: mock(() => Promise.resolve({
    info: { title: "Test API", version: "1.0" },
    paths: {},
  })),
  extractEndpoints: mock(() => [
    { method: "GET", path: "/users", tags: [], parameters: [], responses: [], security: [] },
    { method: "POST", path: "/users", tags: [], parameters: [], responses: [], security: [] },
    { method: "GET", path: "/users/{id}", tags: [], parameters: [], responses: [], security: [] },
  ]),
  extractSecuritySchemes: mock(() => []),
}));

afterAll(() => { mock.restore(); });

import { coverageCommand } from "../../src/cli/commands/coverage.ts";
import { readOpenApiSpec, extractEndpoints } from "../../src/core/generator/openapi-reader.ts";

describe("coverageCommand (spec-only fallback)", () => {
  beforeEach(() => {
    (readOpenApiSpec as ReturnType<typeof mock>).mockClear();
    (extractEndpoints as ReturnType<typeof mock>).mockClear();
  });

  test("returns 1 with 0% when no API is registered (spec-only path)", async () => {
    const code = await coverageCommand({ spec: "spec.yaml" });
    expect(code).toBe(1);
    expect(readOpenApiSpec).toHaveBeenCalledWith("spec.yaml");
  });

  test("returns 2 on read error", async () => {
    (readOpenApiSpec as ReturnType<typeof mock>).mockRejectedValueOnce(new Error("File not found"));
    const code = await coverageCommand({ spec: "bad.yaml" });
    expect(code).toBe(2);
  });

  test("returns 1 when spec has no endpoints", async () => {
    (extractEndpoints as ReturnType<typeof mock>).mockReturnValueOnce([]);
    const code = await coverageCommand({ spec: "empty.yaml" });
    expect(code).toBe(1);
  });

  test("returns 2 when neither --api nor --spec provided", async () => {
    const code = await coverageCommand({});
    expect(code).toBe(2);
  });

  // TASK-250: regression — JSON envelope must always carry `runId`, even on
  // the spec-only path where there is no run yet (value is null but key is
  // present so jq '.data.runId' never throws "Cannot index … with string").
  test("JSON envelope includes runId key (spec-only fallback → null)", async () => {
    const cap = captureOutput({ console: true });
    try {
      const code = await coverageCommand({ spec: "spec.yaml", json: true });
      expect(code).toBe(1);
      const env = JSON.parse(cap.out.trim());
      expect(env.ok).toBe(true);
      expect(env.command).toBe("coverage");
      expect("runId" in env.data).toBe(true);
      expect(env.data.runId).toBeNull();
    } finally {
      cap.restore();
    }
  });
});
