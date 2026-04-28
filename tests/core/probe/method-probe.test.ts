import { describe, it, expect } from "bun:test";
import { generateMethodProbes } from "../../../src/core/probe/method-probe.ts";
import type { EndpointInfo } from "../../../src/core/generator/types.ts";

function ep(partial: Partial<EndpointInfo>): EndpointInfo {
  return {
    path: "/x",
    method: "GET",
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

describe("generateMethodProbes", () => {
  it("emits one suite per path with only the missing methods", () => {
    // Path /audiences declares GET and POST → missing PUT, PATCH, DELETE.
    const result = generateMethodProbes({
      endpoints: [
        ep({ method: "GET", path: "/audiences" }),
        ep({ method: "POST", path: "/audiences" }),
      ],
      securitySchemes: [],
    });
    expect(result.probedPaths).toBe(1);
    expect(result.skippedPaths).toBe(0);
    expect(result.suites).toHaveLength(1);

    const suite = result.suites[0]!;
    expect(suite.tests).toHaveLength(3);

    const methodsUsed = suite.tests.map((t) => {
      // RawStep has the HTTP method as a key whose value is the URL string.
      const keys = Object.keys(t).filter(
        (k) => ["GET", "POST", "PUT", "PATCH", "DELETE"].includes(k),
      );
      return keys[0];
    });
    expect(new Set(methodsUsed)).toEqual(new Set(["PUT", "PATCH", "DELETE"]));

    // Acceptable statuses must include 405/404 but never 5xx or 2xx.
    for (const t of suite.tests) {
      const statuses = t.expect.status as number[];
      expect(statuses).toContain(405);
      expect(statuses.some((s) => s >= 500)).toBe(false);
      expect(statuses.some((s) => s >= 200 && s < 300)).toBe(false);
    }
  });

  it("skips paths that already declare every common method", () => {
    const result = generateMethodProbes({
      endpoints: [
        ep({ method: "GET", path: "/full" }),
        ep({ method: "POST", path: "/full" }),
        ep({ method: "PUT", path: "/full" }),
        ep({ method: "PATCH", path: "/full" }),
        ep({ method: "DELETE", path: "/full" }),
      ],
      securitySchemes: [],
    });
    expect(result.probedPaths).toBe(0);
    expect(result.skippedPaths).toBe(1);
    expect(result.suites).toHaveLength(0);
  });

  it("substitutes path placeholders so the request reaches the router", () => {
    const result = generateMethodProbes({
      endpoints: [
        ep({
          method: "GET",
          path: "/webhooks/{id}",
          parameters: [
            {
              name: "id",
              in: "path",
              required: true,
              schema: { type: "string", format: "uuid" },
            } as any,
          ],
        }),
      ],
      securitySchemes: [],
    });
    expect(result.probedPaths).toBe(1);
    const suite = result.suites[0]!;
    // Pick the POST step (one of the missing methods) and check that its URL
    // has the placeholder substituted with a valid-shape UUID.
    const post = suite.tests.find((t) => "POST" in t)!;
    const url = (post as any).POST as string;
    expect(url).toBe("/webhooks/00000000-0000-0000-0000-000000000000");
  });

  it("attaches auth headers at suite level when the endpoint declares security", () => {
    const result = generateMethodProbes({
      endpoints: [ep({ method: "GET", path: "/secret", security: ["bearer"] })],
      securitySchemes: [
        { name: "bearer", type: "http", scheme: "bearer" } as any,
      ],
    });
    const suite = result.suites[0]!;
    expect(suite.headers).toEqual({
      Authorization: "Bearer {{auth_token}}",
    });
    expect(suite.tests[0]!.headers).toBeUndefined();
  });

  it("emits suite-level base_url so generated YAML is runnable as-is", () => {
    const result = generateMethodProbes({
      endpoints: [ep({ method: "GET", path: "/items" })],
      securitySchemes: [],
    });
    expect(result.suites[0]!.base_url).toBe("{{base_url}}");
  });

  it("emits a `smoke` and `negative-method` tagged suite with json body for body-bearing methods", () => {
    const result = generateMethodProbes({
      endpoints: [ep({ method: "GET", path: "/items" })],
      securitySchemes: [],
    });
    const suite = result.suites[0]!;
    expect(suite.tags).toContain("smoke");
    expect(suite.tags).toContain("negative-method");
    expect(suite.tags).toContain("no-5xx");

    const post = suite.tests.find((t) => "POST" in t)!;
    expect((post as any).json).toEqual({});
    const del = suite.tests.find((t) => "DELETE" in t)!;
    expect((del as any).json).toBeUndefined();
  });

  it("skips deprecated endpoints when computing declared methods", () => {
    // POST is deprecated → method probe should still treat it as missing.
    const result = generateMethodProbes({
      endpoints: [
        ep({ method: "GET", path: "/deprec" }),
        ep({ method: "POST", path: "/deprec", deprecated: true }),
      ],
      securitySchemes: [],
    });
    const suite = result.suites[0]!;
    const methods = suite.tests.map(
      (t) =>
        Object.keys(t).find((k) =>
          ["GET", "POST", "PUT", "PATCH", "DELETE"].includes(k),
        )!,
    );
    expect(methods).toContain("POST");
  });
});
