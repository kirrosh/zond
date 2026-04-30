import { describe, it, expect } from "bun:test";
import { generateNegativeProbes } from "../../../src/core/probe/negative-probe.ts";
import { generateMethodProbes } from "../../../src/core/probe/method-probe.ts";
import type { EndpointInfo } from "../../../src/core/generator/types.ts";

function ep(partial: Partial<EndpointInfo>): EndpointInfo {
  return {
    path: "/x",
    method: "POST",
    operationId: undefined,
    summary: undefined,
    tags: [],
    parameters: [],
    requestBodySchema: undefined,
    requestBodyContentType: undefined,
    responseContentTypes: ["application/json"],
    responses: [{ statusCode: 200, description: "ok" }],
    security: [],
    deprecated: false,
    requiresEtag: false,
    ...partial,
  };
}

describe("probe provenance (TASK-100)", () => {
  it("negative-probe sets suite.source.generator and step.source.generator", () => {
    const result = generateNegativeProbes({
      endpoints: [
        ep({
          method: "GET",
          path: "/webhooks/{id}",
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } } as any,
          ],
        }),
      ],
      securitySchemes: [],
    });
    const suite = result.suites[0]!;
    expect(suite.source).toBeDefined();
    expect(suite.source!.generator).toBe("negative-probe");
    expect(suite.source!.type).toBe("probe-suite");
    expect(suite.tests[0]!.source).toBeDefined();
    expect(suite.tests[0]!.source!.generator).toBe("negative-probe");
    expect(suite.tests[0]!.source!.endpoint).toBe("GET /webhooks/{id}");
  });

  it("method-probe sets generator name on suite and step", () => {
    const result = generateMethodProbes({
      endpoints: [ep({ method: "GET", path: "/items" })],
      securitySchemes: [],
    });
    expect(result.suites.length).toBeGreaterThan(0);
    const suite = result.suites[0]!;
    expect(suite.source!.generator).toBe("method-probe");
    expect(suite.tests[0]!.source!.generator).toBe("method-probe");
  });
});
