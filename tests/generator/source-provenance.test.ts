import { describe, test, expect } from "bun:test";
import {
  generateStep,
  generateSuites,
  buildStepSource,
  buildOpenApiSuiteSource,
} from "../../src/core/generator/suite-generator.ts";
import type { EndpointInfo, SecuritySchemeInfo } from "../../src/core/generator/types.ts";

function makeEndpoint(overrides: Partial<EndpointInfo> & { path: string; method: string }): EndpointInfo {
  return {
    tags: [],
    parameters: [],
    responseContentTypes: [],
    responses: [{ statusCode: 200, description: "OK" }],
    security: [],
    ...overrides,
  };
}

const noSecurity: SecuritySchemeInfo[] = [];

describe("buildStepSource", () => {
  test("builds endpoint + response_branch + schema_pointer", () => {
    const ep = makeEndpoint({ path: "/pets/{petId}", method: "GET" });
    const src = buildStepSource(ep);
    expect(src.endpoint).toBe("GET /pets/{petId}");
    expect(src.response_branch).toBe("200");
    expect(src.schema_pointer).toBe("#/paths/~1pets~1{petId}/get/responses/200");
  });

  test("escapes ~ and / per RFC 6901 in schema_pointer", () => {
    const ep = makeEndpoint({ path: "/foo~bar/baz", method: "POST" });
    const src = buildStepSource(ep);
    expect(src.schema_pointer).toContain("~1foo~0bar~1baz");
  });

  test("statusOverride wins over endpoint default", () => {
    const ep = makeEndpoint({ path: "/x", method: "GET" });
    const src = buildStepSource(ep, 404);
    expect(src.response_branch).toBe("404");
    expect(src.schema_pointer).toContain("/responses/404");
  });
});

describe("buildOpenApiSuiteSource", () => {
  test("returns undefined without specPath", () => {
    expect(buildOpenApiSuiteSource()).toBeUndefined();
  });

  test("emits type/spec/generator/generated_at", () => {
    const src = buildOpenApiSuiteSource("openapi.yaml")!;
    expect(src.type).toBe("openapi-generated");
    expect(src.spec).toBe("openapi.yaml");
    expect(src.generator).toBe("zond-generate");
    expect(typeof src.generated_at).toBe("string");
  });
});

describe("generateStep auto-attaches step.source", () => {
  test("includes provenance for openapi endpoint", () => {
    const ep = makeEndpoint({ path: "/pets", method: "GET", operationId: "listPets" });
    const step = generateStep(ep, noSecurity);
    expect(step.source).toBeDefined();
    expect(step.source!.endpoint).toBe("GET /pets");
    expect(step.source!.response_branch).toBe("200");
  });
});

describe("generateSuites stamps suite-level source when specPath provided", () => {
  test("each generated suite carries suite.source.spec", () => {
    const suites = generateSuites({
      endpoints: [
        makeEndpoint({ path: "/health", method: "GET", tags: ["health"], operationId: "health" }),
      ],
      securitySchemes: noSecurity,
      specPath: "specs/api.yaml",
    });
    expect(suites.length).toBeGreaterThan(0);
    for (const s of suites) {
      expect(s.source).toBeDefined();
      expect(s.source!.spec).toBe("specs/api.yaml");
      expect(s.source!.type).toBe("openapi-generated");
    }
  });

  test("without specPath suite.source is omitted", () => {
    const suites = generateSuites({
      endpoints: [
        makeEndpoint({ path: "/health", method: "GET", tags: ["health"] }),
      ],
      securitySchemes: noSecurity,
    });
    for (const s of suites) {
      expect(s.source).toBeUndefined();
    }
  });
});
