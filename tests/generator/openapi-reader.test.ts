import { afterEach, describe, test, expect } from "bun:test";
import { rootCertificates } from "node:tls";
import { writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readOpenApiSpec, extractEndpoints, extractSecuritySchemes, resolveSpecFetchTls, reconcilePathParamNames } from "../../src/core/generator/openapi-reader.ts";
import type { OpenAPIV3 } from "openapi-types";

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

    // TASK-208 AC#3: assert by content (sorted set), not by length — adding
    // a route to the fixture shouldn't break this test, only "missing
    // expected route" should.
    const methods = endpoints.map((e) => `${e.method} ${e.path}`).sort();
    expect(methods).toEqual([
      "DELETE /pets/{id}",
      "GET /health",
      "GET /pets",
      "GET /pets/{id}",
      "POST /auth/login",
      "POST /pets",
      "PUT /pets/{id}",
    ]);
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

// TASK-96 — non-numeric response keys (e.g. "default") must be skipped so
// that downstream code never sees a NaN status.
describe("extractEndpoints — non-numeric response keys (TASK-96)", () => {
  test("'default' response key is dropped from responses[]", () => {
    const doc = {
      openapi: "3.0.0",
      info: { title: "T", version: "1" },
      paths: {
        "/things": {
          post: {
            operationId: "createThing",
            responses: { default: { description: "any" } },
          },
        },
      },
    } as Awaited<ReturnType<typeof readOpenApiSpec>>;
    const endpoints = extractEndpoints(doc);
    const ep = endpoints[0]!;
    expect(ep.responses.length).toBe(0);
    expect(ep.responses.every((r) => Number.isFinite(r.statusCode))).toBe(true);
  });
});

describe("extractEndpoints — x-circular param stubs (ARV-200/F1)", () => {
  test("filters out parameter stubs without .name/.in (decycleSchema sentinels)", () => {
    const doc = {
      openapi: "3.0.0",
      info: { title: "T", version: "1" },
      paths: {
        "/widgets": {
          parameters: [{ "x-circular": true } as any],
          get: {
            operationId: "listWidgets",
            parameters: [
              { name: "limit", in: "query", schema: { type: "integer" } },
              { "x-circular": true } as any,
              null as any,
            ],
            responses: { 200: { description: "ok" } },
          },
        },
      },
    } as Awaited<ReturnType<typeof readOpenApiSpec>>;
    const endpoints = extractEndpoints(doc);
    expect(endpoints.length).toBe(1);
    const ep = endpoints[0]!;
    expect(ep.parameters.length).toBe(1);
    expect(ep.parameters[0]!.name).toBe("limit");
    expect(ep.parameters.every((p) => typeof p.name === "string" && typeof p.in === "string")).toBe(true);
  });
});

describe("resolveSpecFetchTls (MF1 / ARV-367)", () => {
  const saved = process.env.NODE_EXTRA_CA_CERTS;
  afterEach(() => {
    if (saved === undefined) delete process.env.NODE_EXTRA_CA_CERTS;
    else process.env.NODE_EXTRA_CA_CERTS = saved;
  });

  const PEM = "-----BEGIN CERTIFICATE-----\nMIIBfoo\n-----END CERTIFICATE-----\n";

  test("no options → undefined (default trust store)", () => {
    delete process.env.NODE_EXTRA_CA_CERTS;
    expect(resolveSpecFetchTls()).toBeUndefined();
    expect(resolveSpecFetchTls({})).toBeUndefined();
  });

  test("insecure → verification off", () => {
    delete process.env.NODE_EXTRA_CA_CERTS;
    expect(resolveSpecFetchTls({ insecure: true })).toEqual({ rejectUnauthorized: false });
  });

  test("caPath APPENDS to public roots (never replaces them)", () => {
    delete process.env.NODE_EXTRA_CA_CERTS;
    const p = join(tmpdir(), `zond-ca-${process.pid}.pem`);
    writeFileSync(p, PEM);
    try {
      const tls = resolveSpecFetchTls({ caPath: p }) as { ca: string[] };
      expect(tls.ca[0]).toContain("BEGIN CERTIFICATE");
      expect(tls.ca.length).toBe(1 + rootCertificates.length);
    } finally {
      rmSync(p);
    }
  });

  test("NODE_EXTRA_CA_CERTS honored when caPath absent", () => {
    const p = join(tmpdir(), `zond-ca-env-${process.pid}.pem`);
    writeFileSync(p, PEM);
    process.env.NODE_EXTRA_CA_CERTS = p;
    try {
      const tls = resolveSpecFetchTls() as { ca: string[] };
      expect(tls.ca.length).toBe(1 + rootCertificates.length);
    } finally {
      rmSync(p);
    }
  });

  test("insecure overrides caPath", () => {
    expect(resolveSpecFetchTls({ insecure: true, caPath: "/nonexistent" })).toEqual({ rejectUnauthorized: false });
  });

  test("unreadable CA path throws (surfaces misconfig, no silent fallthrough)", () => {
    delete process.env.NODE_EXTRA_CA_CERTS;
    expect(() => resolveSpecFetchTls({ caPath: "/nonexistent/zond-ca.pem" })).toThrow(/CA bundle not readable/);
  });
});

describe("reconcilePathParamNames (ARV-376)", () => {
  const mk = (name: string): OpenAPIV3.ParameterObject => ({ name, in: "path", required: true });

  test("renames a param whose name diverges from the path template segment", () => {
    // docgen quirk: path template says {id}, param declared as byid_id.
    const params = [mk("byid_id")];
    reconcilePathParamNames("/api/business-segment20/byid/{id}", params);
    expect(params[0]!.name).toBe("id");
  });

  test("no-op when names already agree", () => {
    const params = [mk("id")];
    reconcilePathParamNames("/api/things/{id}", params);
    expect(params[0]!.name).toBe("id");
  });

  test("leaves it untouched when counts differ (can't guess mapping)", () => {
    const params = [mk("a"), mk("b")];
    reconcilePathParamNames("/x/{id}", params); // 1 unmatched template, 2 unmatched params
    expect(params.map((p) => p.name)).toEqual(["a", "b"]);
  });
});
