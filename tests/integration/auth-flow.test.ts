import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { readOpenApiSpec, extractEndpoints, extractSecuritySchemes } from "../../src/core/generator/openapi-reader.ts";
import { generateSkeleton, writeSuites } from "../../src/core/generator/skeleton.ts";
import { parseFile } from "../../src/core/parser/yaml-parser.ts";
import { runSuite } from "../../src/core/runner/executor.ts";
import { tmpdir } from "os";
import { join } from "path";
import { rm, writeFile, mkdir } from "fs/promises";

// Save real fetch before any mocks
const realFetch = globalThis.fetch;

describe("Auth flow integration", () => {
  let server: ReturnType<typeof Bun.serve>;
  let TEST_BASE: string;
  const tmpDir = join(tmpdir(), `apitool-auth-integration-${Date.now()}`);

  beforeAll(async () => {
    // Restore real fetch in case CLI tests mocked it
    globalThis.fetch = realFetch;

    // Import the test-server app directly
    const { app } = await import("../../test-server/src/index.ts");

    // Start on port 0 to get a random available port
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

  test("fetch OpenAPI spec from running server", async () => {
    const res = await fetch(`${TEST_BASE}/doc`);
    expect(res.ok).toBe(true);
    const spec = await res.json();
    expect(spec.openapi).toBe("3.0.0");
    expect(spec.components.securitySchemes.bearerAuth).toBeDefined();
  });

  test("generate auth-aware tests from live spec, then run them", async () => {
    // Fetch and save spec
    const res = await fetch(`${TEST_BASE}/doc`);
    const spec = await res.json();
    await mkdir(tmpDir, { recursive: true });
    const specPath = join(tmpDir, "spec.json");
    await writeFile(specPath, JSON.stringify(spec));

    // Generate skeleton
    const doc = await readOpenApiSpec(specPath);
    const endpoints = extractEndpoints(doc);
    const securitySchemes = extractSecuritySchemes(doc);
    const suites = generateSkeleton(endpoints, TEST_BASE, securitySchemes);

    const outputDir = join(tmpDir, "generated");
    const files = await writeSuites(suites, outputDir);

    // Find the pets suite (has auth + CRUD)
    const petsFile = files.find((f) => f.includes("pets"))!;
    expect(petsFile).toBeDefined();

    // Write env file with auth credentials
    const envPath = join(outputDir, ".env.yaml");
    await writeFile(envPath, "auth_username: admin\nauth_password: admin\n");

    // Parse and run the generated tests
    const suite = await parseFile(petsFile);
    expect(suite.name).toBe("pets");
    expect(suite.tests[0]!.name).toBe("Auth: Login");
    expect(suite.headers?.Authorization).toBe("Bearer {{auth_token}}");

    // Load env vars
    const envText = await Bun.file(envPath).text();
    const env = Bun.YAML.parse(envText) as Record<string, string>;

    const result = await runSuite(suite, env);

    // Login should pass and capture token
    const loginResult = result.steps[0]!;
    expect(loginResult.status).toBe("pass");
    expect(loginResult.captures.auth_token).toBeDefined();
    expect(typeof loginResult.captures.auth_token).toBe("string");

    // Create pet should pass (uses captured token)
    const createResult = result.steps.find((s) => s.name === "Create a pet");
    expect(createResult?.status).toBe("pass");
    expect(createResult?.response?.status).toBe(201);

    // List pets should pass
    const listResult = result.steps.find((s) => s.name === "List all pets");
    expect(listResult?.status).toBe("pass");
    expect(listResult?.response?.status).toBe(200);

    // Get/Update/Delete may fail since they use random IDs
    // that don't correspond to existing pets. That's expected for skeleton tests.
    // We only verify the core auth flow works: login → create → list
    expect(result.passed).toBeGreaterThanOrEqual(3); // at least login + create + list
  }, 30000);
});
