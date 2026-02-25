import { describe, test, expect, afterAll } from "bun:test";
import { readOpenApiSpec, extractEndpoints } from "../../src/core/generator/openapi-reader.ts";
import { generateSkeleton, writeSuites } from "../../src/core/generator/skeleton.ts";
import { validateSuite } from "../../src/core/parser/schema.ts";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rm } from "node:fs/promises";

const FIXTURE = "tests/fixtures/petstore.yaml";

describe("generateSkeleton", () => {
  test("generates suites grouped by tag", async () => {
    const doc = await readOpenApiSpec(FIXTURE);
    const endpoints = extractEndpoints(doc);
    const suites = generateSkeleton(endpoints);

    // Should have 2 groups: "pets" and "health"
    expect(suites.length).toBe(2);

    const names = suites.map((s) => s.name);
    expect(names).toContain("pets");
    expect(names).toContain("health");
  });

  test("pets suite has 5 tests", async () => {
    const doc = await readOpenApiSpec(FIXTURE);
    const endpoints = extractEndpoints(doc);
    const suites = generateSkeleton(endpoints);

    const petsSuite = suites.find((s) => s.name === "pets")!;
    expect(petsSuite.tests.length).toBe(5);
  });

  test("uses method-as-key format", async () => {
    const doc = await readOpenApiSpec(FIXTURE);
    const endpoints = extractEndpoints(doc);
    const suites = generateSkeleton(endpoints);

    const petsSuite = suites.find((s) => s.name === "pets")!;

    // Each test should have a method key (GET, POST, etc.) not method/path fields
    const getTest = petsSuite.tests.find((t) => "GET" in t && (t as any).GET === "/pets")!;
    expect(getTest).toBeDefined();
    expect(getTest.name).toBe("List all pets");

    const postTest = petsSuite.tests.find((t) => "POST" in t)!;
    expect(postTest).toBeDefined();
    expect(postTest.json).toBeDefined();
  });

  test("substitutes path params with placeholders", async () => {
    const doc = await readOpenApiSpec(FIXTURE);
    const endpoints = extractEndpoints(doc);
    const suites = generateSkeleton(endpoints);

    const petsSuite = suites.find((s) => s.name === "pets")!;
    const getById = petsSuite.tests.find((t) => t.name === "Get a pet by ID")!;
    expect(getById).toBeDefined();
    // petId is integer, so should get {{$randomInt}}
    expect((getById as any).GET).toBe("/pets/{{$randomInt}}");
  });

  test("sets happy path status code", async () => {
    const doc = await readOpenApiSpec(FIXTURE);
    const endpoints = extractEndpoints(doc);
    const suites = generateSkeleton(endpoints);

    const petsSuite = suites.find((s) => s.name === "pets")!;

    const createTest = petsSuite.tests.find((t) => "POST" in t)!;
    expect(createTest.expect.status).toBe(201);

    const deleteTest = petsSuite.tests.find((t) => "DELETE" in t)!;
    expect(deleteTest.expect.status).toBe(204);
  });

  test("generates body assertions for object responses", async () => {
    const doc = await readOpenApiSpec(FIXTURE);
    const endpoints = extractEndpoints(doc);
    const suites = generateSkeleton(endpoints);

    const healthSuite = suites.find((s) => s.name === "health")!;
    const healthTest = healthSuite.tests[0]!;
    expect(healthTest.expect.body).toBeDefined();
    expect(healthTest.expect.body!.status).toEqual({ type: "string" });
    expect(healthTest.expect.body!.uptime).toEqual({ type: "number" });
  });
});

describe("writeSuites + round-trip", () => {
  const tmpDir = join(tmpdir(), `apitool-gen-test-${Date.now()}`);

  afterAll(async () => {
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  });

  test("writes YAML files and round-trips through parser", async () => {
    const doc = await readOpenApiSpec(FIXTURE);
    const endpoints = extractEndpoints(doc);
    const suites = generateSkeleton(endpoints);
    const files = await writeSuites(suites, tmpDir);

    expect(files.length).toBe(2);

    // Round-trip: each file should parse back without errors
    for (const filePath of files) {
      const text = await Bun.file(filePath).text();
      const parsed = Bun.YAML.parse(text);
      // validateSuite should succeed (uses extractMethodAndPath preprocessing)
      const suite = validateSuite(parsed);
      expect(suite.name).toBeDefined();
      expect(suite.tests.length).toBeGreaterThan(0);

      for (const step of suite.tests) {
        expect(step.method).toBeDefined();
        expect(step.path).toBeDefined();
        expect(step.expect).toBeDefined();
      }
    }
  });
});
