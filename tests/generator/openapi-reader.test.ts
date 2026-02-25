import { describe, test, expect } from "bun:test";
import { readOpenApiSpec, extractEndpoints } from "../../src/core/generator/openapi-reader.ts";

const FIXTURE = "tests/fixtures/petstore.yaml";

describe("readOpenApiSpec", () => {
  test("parses and dereferences petstore spec", async () => {
    const doc = await readOpenApiSpec(FIXTURE);
    expect(doc.openapi).toBe("3.0.3");
    expect(doc.info.title).toBe("Petstore");
    expect(doc.paths).toBeDefined();
  });

  test("dereferences $ref schemas", async () => {
    const doc = await readOpenApiSpec(FIXTURE);
    // After dereference, the Post /pets requestBody should have resolved schema
    const postPets = doc.paths!["/pets"]!.post!;
    const rb = postPets.requestBody as any;
    const schema = rb.content["application/json"].schema;
    // Should be the actual schema, not a $ref
    expect(schema.type).toBe("object");
    expect(schema.properties).toBeDefined();
    expect(schema.properties.name).toBeDefined();
  });
});

describe("extractEndpoints", () => {
  test("extracts all endpoints", async () => {
    const doc = await readOpenApiSpec(FIXTURE);
    const endpoints = extractEndpoints(doc);

    expect(endpoints.length).toBe(6); // 2 on /pets, 3 on /pets/{petId}, 1 on /health

    const methods = endpoints.map((e) => `${e.method} ${e.path}`);
    expect(methods).toContain("GET /pets");
    expect(methods).toContain("POST /pets");
    expect(methods).toContain("GET /pets/{petId}");
    expect(methods).toContain("PUT /pets/{petId}");
    expect(methods).toContain("DELETE /pets/{petId}");
    expect(methods).toContain("GET /health");
  });

  test("extracts operationId and summary", async () => {
    const doc = await readOpenApiSpec(FIXTURE);
    const endpoints = extractEndpoints(doc);

    const listPets = endpoints.find((e) => e.operationId === "listPets")!;
    expect(listPets).toBeDefined();
    expect(listPets.summary).toBe("List all pets");
    expect(listPets.method).toBe("GET");
    expect(listPets.path).toBe("/pets");
  });

  test("extracts tags", async () => {
    const doc = await readOpenApiSpec(FIXTURE);
    const endpoints = extractEndpoints(doc);

    const getPet = endpoints.find((e) => e.operationId === "getPet")!;
    expect(getPet.tags).toEqual(["pets"]);

    const health = endpoints.find((e) => e.operationId === "healthCheck")!;
    expect(health.tags).toEqual([]);
  });

  test("extracts parameters", async () => {
    const doc = await readOpenApiSpec(FIXTURE);
    const endpoints = extractEndpoints(doc);

    const listPets = endpoints.find((e) => e.operationId === "listPets")!;
    expect(listPets.parameters.length).toBe(1);
    expect(listPets.parameters[0]!.name).toBe("limit");
    expect(listPets.parameters[0]!.in).toBe("query");

    const getPet = endpoints.find((e) => e.operationId === "getPet")!;
    expect(getPet.parameters.length).toBe(1);
    expect(getPet.parameters[0]!.name).toBe("petId");
    expect(getPet.parameters[0]!.in).toBe("path");
  });

  test("extracts request body schema", async () => {
    const doc = await readOpenApiSpec(FIXTURE);
    const endpoints = extractEndpoints(doc);

    const createPet = endpoints.find((e) => e.operationId === "createPet")!;
    expect(createPet.requestBodySchema).toBeDefined();
    expect(createPet.requestBodySchema!.type).toBe("object");
    expect(createPet.requestBodySchema!.properties).toHaveProperty("name");
  });

  test("extracts responses with schemas", async () => {
    const doc = await readOpenApiSpec(FIXTURE);
    const endpoints = extractEndpoints(doc);

    const getPet = endpoints.find((e) => e.operationId === "getPet")!;
    expect(getPet.responses.length).toBe(2);

    const ok = getPet.responses.find((r) => r.statusCode === 200)!;
    expect(ok.description).toBe("A pet");
    expect(ok.schema).toBeDefined();
    expect(ok.schema!.type).toBe("object");

    const notFound = getPet.responses.find((r) => r.statusCode === 404)!;
    expect(notFound.description).toBe("Pet not found");
    expect(notFound.schema).toBeUndefined();
  });
});
