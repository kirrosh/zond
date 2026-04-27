import { describe, test, expect } from "bun:test";
import { readOpenApiSpec, extractEndpoints, extractSecuritySchemes } from "../../src/core/generator/openapi-reader.ts";

const FIXTURE = "tests/fixtures/petstore-auth.json";

describe("readOpenApiSpec", () => {
  test("parses and dereferences petstore-auth spec", async () => {
    const doc = await readOpenApiSpec(FIXTURE);
    expect(doc.openapi).toBe("3.0.0");
    expect(doc.info.title).toBe("Test Petstore");
    expect(doc.paths).toBeDefined();
  });

  test("contains securitySchemes component", async () => {
    const doc = await readOpenApiSpec(FIXTURE);
    const schemes = doc.components?.securitySchemes;
    expect(schemes).toBeDefined();
    expect(schemes!.bearerAuth).toBeDefined();
  });
});

describe("extractSecuritySchemes", () => {
  test("extracts bearer auth scheme", async () => {
    const doc = await readOpenApiSpec(FIXTURE);
    const schemes = extractSecuritySchemes(doc);

    expect(schemes.length).toBe(1);
    expect(schemes[0]!.name).toBe("bearerAuth");
    expect(schemes[0]!.type).toBe("http");
    expect(schemes[0]!.scheme).toBe("bearer");
    expect(schemes[0]!.bearerFormat).toBe("JWT");
  });
});

describe("extractEndpoints", () => {
  test("extracts all endpoints", async () => {
    const doc = await readOpenApiSpec(FIXTURE);
    const endpoints = extractEndpoints(doc);

    expect(endpoints.length).toBe(7); // login + 5 pet routes + health

    const methods = endpoints.map((e) => `${e.method} ${e.path}`);
    expect(methods).toContain("POST /auth/login");
    expect(methods).toContain("GET /pets");
    expect(methods).toContain("POST /pets");
    expect(methods).toContain("GET /pets/{id}");
    expect(methods).toContain("PUT /pets/{id}");
    expect(methods).toContain("DELETE /pets/{id}");
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

    const getPet = endpoints.find((e) => e.operationId === "getPet")!;
    expect(getPet.parameters.length).toBe(1);
    expect(getPet.parameters[0]!.name).toBe("id");
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
  });

  test("populates security field for protected endpoints", async () => {
    const doc = await readOpenApiSpec(FIXTURE);
    const endpoints = extractEndpoints(doc);

    const listPets = endpoints.find((e) => e.operationId === "listPets")!;
    expect(listPets.security).toEqual(["bearerAuth"]);

    const createPet = endpoints.find((e) => e.operationId === "createPet")!;
    expect(createPet.security).toEqual(["bearerAuth"]);
  });

  test("endpoints without security have empty security array", async () => {
    const doc = await readOpenApiSpec(FIXTURE);
    const endpoints = extractEndpoints(doc);

    const login = endpoints.find((e) => e.operationId === "login")!;
    expect(login.security).toEqual([]);

    const health = endpoints.find((e) => e.operationId === "healthCheck")!;
    expect(health.security).toEqual([]);
  });
});

// T33 — media-level example/examples lifted to schema.example
describe("extractEndpoints — media-level example lifting (T33)", () => {
  function makeSpec(extra: object): unknown {
    return {
      openapi: "3.0.0",
      info: { title: "T", version: "1" },
      paths: {
        "/things": {
          post: {
            operationId: "createThing",
            requestBody: {
              required: true,
              content: {
                "application/json": {
                  schema: { type: "object", properties: { name: { type: "string" } } },
                  ...extra,
                },
              },
            },
            responses: { "201": { description: "ok" } },
          },
        },
      },
    };
  }

  test("media-level example is lifted onto requestBodySchema.example", async () => {
    const doc = makeSpec({ example: { name: "Acme", region: "us-east-1" } }) as Awaited<ReturnType<typeof readOpenApiSpec>>;
    const endpoints = extractEndpoints(doc);
    const ep = endpoints[0]!;
    expect(ep.requestBodySchema?.example).toEqual({ name: "Acme", region: "us-east-1" });
  });

  test("first named entry of media.examples is lifted", async () => {
    const doc = makeSpec({
      examples: {
        primary: { value: { name: "Primary", region: "eu-west-1" } },
        alt: { value: { name: "Alt" } },
      },
    }) as Awaited<ReturnType<typeof readOpenApiSpec>>;
    const endpoints = extractEndpoints(doc);
    const ep = endpoints[0]!;
    expect(ep.requestBodySchema?.example).toEqual({ name: "Primary", region: "eu-west-1" });
  });

  test("schema.example takes precedence over media.example", async () => {
    const doc = {
      openapi: "3.0.0",
      info: { title: "T", version: "1" },
      paths: {
        "/things": {
          post: {
            operationId: "createThing",
            requestBody: {
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    example: { name: "schema-wins" },
                    properties: { name: { type: "string" } },
                  },
                  example: { name: "media-loses" },
                },
              },
            },
            responses: { "201": { description: "ok" } },
          },
        },
      },
    } as Awaited<ReturnType<typeof readOpenApiSpec>>;
    const endpoints = extractEndpoints(doc);
    const ep = endpoints[0]!;
    expect(ep.requestBodySchema?.example).toEqual({ name: "schema-wins" });
  });
});
