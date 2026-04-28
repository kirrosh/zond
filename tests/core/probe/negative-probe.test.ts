import { describe, it, expect } from "bun:test";
import { generateNegativeProbes } from "../../../src/core/probe/negative-probe.ts";
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

describe("generateNegativeProbes", () => {
  it("produces no suite for endpoints with no probable surface", () => {
    const result = generateNegativeProbes({
      endpoints: [ep({ method: "GET", path: "/health" })],
      securitySchemes: [],
    });
    expect(result.probedEndpoints).toBe(0);
    expect(result.skippedEndpoints).toBe(1);
    expect(result.suites).toHaveLength(0);
  });

  it("emits invalid-uuid path probes for GET with UUID id param", () => {
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
    expect(result.probedEndpoints).toBe(1);
    const suite = result.suites[0]!;
    // 1 path-param × 4 invalid sentinels
    expect(suite.tests.length).toBeGreaterThanOrEqual(4);
    expect(suite.tests.every(t => Array.isArray(t.expect.status))).toBe(true);
    // None of acceptable statuses include 500
    expect((suite.tests[0]!.expect.status as number[]).includes(500)).toBe(false);
    // GET path is rendered with the literal bad value
    const m = suite.tests[0]!.GET as string;
    expect(m).toMatch(/\/webhooks\/(?:not-a-uuid|12345|00000000|\.\.)/);
  });

  it("emits enum-array probe for webhooks-style events field", () => {
    const result = generateNegativeProbes({
      endpoints: [
        ep({
          method: "POST",
          path: "/webhooks",
          requestBodyContentType: "application/json",
          requestBodySchema: {
            type: "object",
            required: ["endpoint", "events"],
            properties: {
              endpoint: { type: "string", format: "uri" },
              events: { type: "array", items: { type: "string" } },
            },
          },
        }),
      ],
      securitySchemes: [],
    });
    expect(result.probedEndpoints).toBe(1);
    const suite = result.suites[0]!;
    const enumProbe = suite.tests.find(t => /unknown value/.test(t.name));
    expect(enumProbe).toBeDefined();
    expect((enumProbe as any).json).toEqual({
      endpoint: expect.anything(),
      events: ["zond.nonexistent.event"],
    });
  });

  it("emits empty-body, missing-required, type-confusion and format probes", () => {
    const result = generateNegativeProbes({
      endpoints: [
        ep({
          method: "POST",
          path: "/audiences",
          requestBodyContentType: "application/json",
          requestBodySchema: {
            type: "object",
            required: ["name", "owner_email"],
            properties: {
              name: { type: "string" },
              owner_email: { type: "string", format: "email" },
              count: { type: "integer" },
            },
          },
        }),
      ],
      securitySchemes: [],
    });
    const suite = result.suites[0]!;
    const names = suite.tests.map(t => t.name);
    expect(names.some(n => /empty body/.test(n))).toBe(true);
    expect(names.some(n => /missing required field "name"/.test(n))).toBe(true);
    expect(names.some(n => /missing required field "owner_email"/.test(n))).toBe(true);
    expect(names.some(n => /wrong type/.test(n))).toBe(true);
    expect(names.some(n => /invalid email/.test(n))).toBe(true);
    expect(names.some(n => /unicode\/emoji\/RTL/.test(n))).toBe(true);
  });

  it("respects maxProbesPerEndpoint cap", () => {
    const result = generateNegativeProbes({
      endpoints: [
        ep({
          method: "POST",
          path: "/x",
          requestBodyContentType: "application/json",
          requestBodySchema: {
            type: "object",
            required: ["a", "b", "c", "d", "e"],
            properties: {
              a: { type: "string" }, b: { type: "string" }, c: { type: "string" },
              d: { type: "string" }, e: { type: "string" },
            },
          },
        }),
      ],
      securitySchemes: [],
      maxProbesPerEndpoint: 5,
    });
    expect(result.suites[0]!.tests.length).toBe(5);
  });

  it("skips deprecated endpoints", () => {
    const result = generateNegativeProbes({
      endpoints: [ep({ method: "GET", path: "/old/{id}", deprecated: true,
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } } as any] })],
      securitySchemes: [],
    });
    expect(result.probedEndpoints).toBe(0);
  });

  it("attaches Bearer auth header when endpoint has bearer security", () => {
    const result = generateNegativeProbes({
      endpoints: [ep({
        method: "GET", path: "/x/{id}", security: ["BearerAuth"],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } } as any],
      })],
      securitySchemes: [{ name: "BearerAuth", type: "http", scheme: "bearer" }],
    });
    const t = result.suites[0]!.tests[0]!;
    expect(t.headers).toEqual({ Authorization: "Bearer {{auth_token}}" });
  });
});
