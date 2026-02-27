import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { readOpenApiSpec, extractEndpoints, extractSecuritySchemes } from "../../src/core/generator/openapi-reader.ts";
import { generateSuites, writeSuites } from "../../src/core/generator/skeleton.ts";
import { parseFile } from "../../src/core/parser/yaml-parser.ts";
import { runSuite } from "../../src/core/runner/executor.ts";
import { tmpdir } from "os";
import { join } from "path";
import { rm, writeFile, mkdir } from "fs/promises";

// Save real fetch before any mocks
const realFetch = globalThis.fetch;

// ── Inline mini-server ──────────────────────────

function createPetServer() {
  const app = new OpenAPIHono();
  const pets: { id: number; name: string }[] = [];
  let nextId = 1;

  // Security scheme
  const bearerAuth = app.openAPIRegistry.registerComponent("securitySchemes", "bearerAuth", {
    type: "http",
    scheme: "bearer",
  });

  // POST /auth/login — no security
  const loginRoute = createRoute({
    method: "post",
    path: "/auth/login",
    tags: ["Auth"],
    summary: "Login",
    request: {
      body: {
        content: {
          "application/json": {
            schema: z.object({
              username: z.string(),
              password: z.string(),
            }),
          },
        },
      },
    },
    responses: {
      200: {
        content: {
          "application/json": {
            schema: z.object({ token: z.string() }),
          },
        },
        description: "Token",
      },
    },
  });

  app.openapi(loginRoute, (c) => {
    return c.json({ token: "test-token-123" }, 200);
  });

  // GET /pets — secured
  const listPetsRoute = createRoute({
    method: "get",
    path: "/pets",
    tags: ["Pets"],
    summary: "List all pets",
    security: [{ bearerAuth: [] }],
    responses: {
      200: {
        content: {
          "application/json": {
            schema: z.array(z.object({ id: z.number(), name: z.string() })),
          },
        },
        description: "Pet list",
      },
    },
  });

  app.openapi(listPetsRoute, (c) => {
    return c.json(pets, 200);
  });

  // POST /pets — secured
  const createPetRoute = createRoute({
    method: "post",
    path: "/pets",
    tags: ["Pets"],
    summary: "Create a pet",
    security: [{ bearerAuth: [] }],
    request: {
      body: {
        content: {
          "application/json": {
            schema: z.object({ name: z.string() }),
          },
        },
      },
    },
    responses: {
      201: {
        content: {
          "application/json": {
            schema: z.object({ id: z.number(), name: z.string() }),
          },
        },
        description: "Pet created",
      },
    },
  });

  app.openapi(createPetRoute, (c) => {
    const { name } = c.req.valid("json");
    const pet = { id: nextId++, name };
    pets.push(pet);
    return c.json(pet, 201);
  });

  // OpenAPI spec endpoint
  app.doc("/doc", {
    openapi: "3.0.0",
    info: { title: "Pet API", version: "1.0.0" },
  });

  return app;
}

// ── Tests ───────────────────────────────────────

describe("Auth flow integration", () => {
  let server: ReturnType<typeof Bun.serve>;
  let TEST_BASE: string;
  const tmpDir = join(tmpdir(), `apitool-auth-integration-${Date.now()}`);

  beforeAll(async () => {
    globalThis.fetch = realFetch;
    await mkdir(tmpDir, { recursive: true });

    const app = createPetServer();
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

  test("fetch OpenAPI spec from inline server", async () => {
    const res = await fetch(`${TEST_BASE}/doc`);
    expect(res.ok).toBe(true);
    const spec = await res.json() as any;
    expect(spec.openapi).toBe("3.0.0");
    expect(spec.components.securitySchemes.bearerAuth).toBeDefined();
  });

  test("generate auth-aware tests from live spec, then run them", async () => {
    // Fetch and save spec
    const res = await fetch(`${TEST_BASE}/doc`);
    const spec = await res.json();
    const specPath = join(tmpDir, "spec.json");
    await writeFile(specPath, JSON.stringify(spec));

    // Generate skeleton
    const doc = await readOpenApiSpec(specPath);
    const endpoints = extractEndpoints(doc);
    const securitySchemes = extractSecuritySchemes(doc);
    const suites = generateSuites(endpoints, TEST_BASE, securitySchemes);

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

    // Login step should be generated first
    expect(suite.tests[0]!.name).toBe("Auth: Login");

    // Suite headers should include Bearer auth
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

    expect(result.passed).toBeGreaterThanOrEqual(3);
  }, 30000);
});
