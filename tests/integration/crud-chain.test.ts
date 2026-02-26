import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { readOpenApiSpec, extractEndpoints, extractSecuritySchemes } from "../../src/core/generator/openapi-reader.ts";
import { generateSuites, writeSuites } from "../../src/core/generator/skeleton.ts";
import { detectCrudGroups } from "../../src/core/generator/crud.ts";
import { parseFile } from "../../src/core/parser/yaml-parser.ts";
import { runSuite } from "../../src/core/runner/executor.ts";
import { tmpdir } from "os";
import { join } from "path";
import { rm, writeFile, mkdir } from "fs/promises";

const realFetch = globalThis.fetch;

describe("CRUD chain integration", () => {
  let server: ReturnType<typeof Bun.serve>;
  let TEST_BASE: string;
  const tmpDir = join(tmpdir(), `apitool-crud-chain-${Date.now()}`);

  beforeAll(async () => {
    globalThis.fetch = realFetch;
    const { app } = await import("../../test-server/src/index.ts");
    server = Bun.serve({
      fetch: app.fetch,
      port: 0,
    });
    TEST_BASE = `http://localhost:${server.port}`;
  });

  afterAll(async () => {
    server?.stop();
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  });

  test("detectCrudGroups finds pets CRUD group from spec", async () => {
    const doc = await readOpenApiSpec("tests/fixtures/petstore-auth.json");
    const endpoints = extractEndpoints(doc);
    const groups = detectCrudGroups(endpoints);

    expect(groups).toHaveLength(1);
    expect(groups[0]!.resource).toBe("pets");
    expect(groups[0]!.basePath).toBe("/pets");
    expect(groups[0]!.itemPath).toBe("/pets/{id}");
    expect(groups[0]!.idParam).toBe("id");
    expect(groups[0]!.create).toBeDefined();
    expect(groups[0]!.list).toBeDefined();
    expect(groups[0]!.read).toBeDefined();
    expect(groups[0]!.update).toBeDefined();
    expect(groups[0]!.delete).toBeDefined();
  });

  test("generateSuites produces CRUD chain + skeleton suites", async () => {
    const doc = await readOpenApiSpec("tests/fixtures/petstore-auth.json");
    const endpoints = extractEndpoints(doc);
    const securitySchemes = extractSecuritySchemes(doc);
    const suites = generateSuites(endpoints, TEST_BASE, securitySchemes);

    // Should have: pets CRUD, auth (skeleton), health (skeleton)
    expect(suites.length).toBe(3);

    const crudSuite = suites.find(s => s.name === "pets CRUD");
    expect(crudSuite).toBeDefined();
    expect(crudSuite!.tests.length).toBeGreaterThanOrEqual(5); // login + create + read + update + delete + verify

    const authSuite = suites.find(s => s.name === "auth");
    expect(authSuite).toBeDefined();

    const healthSuite = suites.find(s => s.name === "health");
    expect(healthSuite).toBeDefined();
  });

  test("CRUD chain runs successfully against live server", async () => {
    // Fetch live spec from server
    const res = await fetch(`${TEST_BASE}/doc`);
    const spec = await res.json();
    await mkdir(tmpDir, { recursive: true });
    const specPath = join(tmpDir, "spec.json");
    await writeFile(specPath, JSON.stringify(spec));

    // Generate suites
    const doc = await readOpenApiSpec(specPath);
    const endpoints = extractEndpoints(doc);
    const securitySchemes = extractSecuritySchemes(doc);
    const suites = generateSuites(endpoints, TEST_BASE, securitySchemes);

    const outputDir = join(tmpDir, "generated");
    const files = await writeSuites(suites, outputDir);

    // Find CRUD suite file
    const crudFile = files.find(f => f.includes("crud"))!;
    expect(crudFile).toBeDefined();

    // Parse
    const suite = await parseFile(crudFile);
    expect(suite.name).toBe("pets CRUD");

    // Run with auth credentials
    const env = { auth_username: "admin", auth_password: "admin" };
    const result = await runSuite(suite, env);

    // Login should pass
    const loginStep = result.steps.find(s => s.name === "Auth: Login")!;
    expect(loginStep.status).toBe("pass");
    expect(loginStep.captures.auth_token).toBeDefined();

    // Create should pass and capture pet_id
    const createStep = result.steps.find(s => s.name.startsWith("Create"))!;
    expect(createStep.status).toBe("pass");
    expect(createStep.captures.pet_id).toBeDefined();
    expect(typeof createStep.captures.pet_id).toBe("number");

    // Get should pass (uses captured pet_id)
    const getStep = result.steps.find(s => s.name.startsWith("Get created"))!;
    expect(getStep.status).toBe("pass");
    expect(getStep.response?.status).toBe(200);

    // Update should pass
    const updateStep = result.steps.find(s => s.name.startsWith("Update"))!;
    expect(updateStep.status).toBe("pass");
    expect(updateStep.response?.status).toBe(200);

    // Delete should pass
    const deleteStep = result.steps.find(s => s.name.startsWith("Delete"))!;
    expect(deleteStep.status).toBe("pass");
    expect(deleteStep.response?.status).toBe(204);

    // Verify deleted should pass (GET → 404)
    const verifyStep = result.steps.find(s => s.name.startsWith("Verify"))!;
    expect(verifyStep.status).toBe("pass");
    expect(verifyStep.response?.status).toBe(404);

    // All steps should pass
    expect(result.failed).toBe(0);
    expect(result.skipped).toBe(0);
    expect(result.passed).toBe(result.total);
  }, 30000);
});
