import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { scanCoveredEndpoints, filterUncoveredEndpoints } from "../../src/core/generator/coverage-scanner.ts";
import type { EndpointInfo } from "../../src/core/generator/types.ts";
import { tmpdir } from "os";
import { join } from "path";
import { rm, mkdir } from "fs/promises";

const tmpDir = join(tmpdir(), `zond-coverage-${Date.now()}`);

beforeAll(async () => {
  await mkdir(tmpDir, { recursive: true });
});

afterAll(async () => {
  await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
});

describe("scanCoveredEndpoints", () => {
  test("extracts method+path from YAML test files", async () => {
    const yamlContent = `
name: Users CRUD
base_url: http://localhost:3000
tests:
  - name: Create user
    POST: /users
    expect:
      status: 201
  - name: Get user
    GET: /users/{{user_id}}
    expect:
      status: 200
  - name: Delete user
    DELETE: /users/{{user_id}}
    expect:
      status: 204
`;
    await Bun.write(join(tmpDir, "users.yaml"), yamlContent);

    const covered = await scanCoveredEndpoints(tmpDir);

    expect(covered).toHaveLength(3);
    expect(covered.find((c) => c.method === "POST")?.path).toBe("/users");
    expect(covered.find((c) => c.method === "GET")?.path).toBe("/users/{*}");
    expect(covered.find((c) => c.method === "DELETE")?.path).toBe("/users/{*}");
  });

  test("handles nested directories", async () => {
    const subDir = join(tmpDir, "nested");
    await mkdir(subDir, { recursive: true });
    await Bun.write(join(subDir, "health.yaml"), `
name: Health
tests:
  - name: Health check
    GET: /health
    expect:
      status: 200
`);

    const covered = await scanCoveredEndpoints(tmpDir);
    const healthEndpoint = covered.find((c) => c.path === "/health");
    expect(healthEndpoint).toBeDefined();
    expect(healthEndpoint?.method).toBe("GET");
  });

  test("returns empty array for empty directory", async () => {
    const emptyDir = join(tmpDir, "empty");
    await mkdir(emptyDir, { recursive: true });
    const covered = await scanCoveredEndpoints(emptyDir);
    expect(covered).toHaveLength(0);
  });
});

describe("filterUncoveredEndpoints", () => {
  const makeEndpoint = (method: string, path: string): EndpointInfo => ({
    method,
    path,
    tags: [],
    parameters: [],
    responseContentTypes: [],
    responses: [],
    security: [],
  });

  test("filters out covered endpoints", () => {
    const all = [
      makeEndpoint("GET", "/users"),
      makeEndpoint("POST", "/users"),
      makeEndpoint("GET", "/users/{id}"),
      makeEndpoint("DELETE", "/users/{id}"),
      makeEndpoint("GET", "/health"),
    ];

    const covered = [
      { method: "GET", path: "/users", file: "users.yaml" },
      { method: "POST", path: "/users", file: "users.yaml" },
      { method: "GET", path: "/users/{*}", file: "users.yaml" },
    ];

    const uncovered = filterUncoveredEndpoints(all, covered);

    expect(uncovered).toHaveLength(2);
    expect(uncovered[0]!.method).toBe("DELETE");
    expect(uncovered[0]!.path).toBe("/users/{id}");
    expect(uncovered[1]!.method).toBe("GET");
    expect(uncovered[1]!.path).toBe("/health");
  });

  test("returns all endpoints when nothing covered", () => {
    const all = [
      makeEndpoint("GET", "/users"),
      makeEndpoint("POST", "/users"),
    ];

    const uncovered = filterUncoveredEndpoints(all, []);
    expect(uncovered).toHaveLength(2);
  });

  test("returns empty when all covered", () => {
    const all = [
      makeEndpoint("GET", "/health"),
    ];
    const covered = [
      { method: "GET", path: "/health", file: "health.yaml" },
    ];

    const uncovered = filterUncoveredEndpoints(all, covered);
    expect(uncovered).toHaveLength(0);
  });
});
