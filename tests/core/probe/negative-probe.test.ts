import { describe, it, expect } from "bun:test";
import { generateNegativeProbes, INVALID_UUID_SENTINELS } from "../../../src/core/probe/negative-probe.ts";
import { ep } from "../../_helpers/endpoints";

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

  it("TASK-67: probes numeric query params (float, negative, non-numeric, etc.)", () => {
    const result = generateNegativeProbes({
      endpoints: [
        ep({
          method: "GET",
          path: "/emails",
          parameters: [
            { name: "limit", in: "query", required: false, schema: { type: "integer" } } as any,
          ],
        }),
      ],
      securitySchemes: [],
    });
    expect(result.probedEndpoints).toBe(1);
    const suite = result.suites[0]!;
    const queryProbes = suite.tests.filter(t => t.name.startsWith("query limit="));
    // 7 bad-value variants (float, neg, zero, non-numeric, empty, null literal, MAX_SAFE_INTEGER+1)
    expect(queryProbes.length).toBe(7);
    // Catches the documented Resend bug: GET /emails?limit=1.5 → 500
    const floatProbe = queryProbes.find(t => /1\.5/.test(t.name));
    expect(floatProbe).toBeDefined();
    expect(floatProbe!.GET).toContain("limit=1.5");
    // No probe expects 500 in the acceptable status set
    expect((floatProbe!.expect.status as number[]).includes(500)).toBe(false);
    // Suite carries the new query-coercion tag
    expect(suite.tags).toContain("query-coercion");
  });

  it("TASK-67: probes numeric path params for non-UUID integer ids", () => {
    const result = generateNegativeProbes({
      endpoints: [
        ep({
          method: "GET",
          path: "/items/{itemId}",
          parameters: [
            { name: "itemId", in: "path", required: true, schema: { type: "integer" } } as any,
          ],
        }),
      ],
      securitySchemes: [],
    });
    const suite = result.suites[0]!;
    const pathProbes = suite.tests.filter(t => t.name.startsWith("path param itemId="));
    // 7 - 1 (skip empty value for path) = 6
    expect(pathProbes.length).toBe(6);
    expect(pathProbes.some(t => /1\.5/.test(t.name))).toBe(true);
    expect(suite.tags).toContain("query-coercion");
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

  it("attaches Bearer auth header at suite level when endpoint has bearer security", () => {
    const result = generateNegativeProbes({
      endpoints: [ep({
        method: "GET", path: "/x/{id}", security: ["BearerAuth"],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } } as any],
      })],
      securitySchemes: [{ name: "BearerAuth", type: "http", scheme: "bearer" }],
    });
    const suite = result.suites[0]!;
    expect(suite.headers).toEqual({ Authorization: "Bearer {{auth_token}}" });
    // And per-step headers are dropped (they would duplicate the suite-level ones).
    expect(suite.tests[0]!.headers).toBeUndefined();
  });

  it("TASK-135: emits {{parent}} placeholder for non-attacked path params so .env.yaml resolves them at run time", () => {
    // Mirrors Sentry shape: org slug is the parent, repo slug is the leaf
    // probe target. Old behaviour baked `nonexistent-zzzzz` into both, so
    // every probe 404'd on the parent before the leaf validator fired.
    const result = generateNegativeProbes({
      endpoints: [
        ep({
          method: "GET",
          path: "/orgs/{organization_id_or_slug}/repos/{repo_id}/commits",
          parameters: [
            { name: "organization_id_or_slug", in: "path", required: true, schema: { type: "string" } } as any,
            { name: "repo_id", in: "path", required: true, schema: { type: "string", format: "uuid" } } as any,
          ],
        }),
      ],
      securitySchemes: [],
    });
    const suite = result.suites[0]!;
    const pathProbes = suite.tests.filter(t => t.name.startsWith("path param repo_id="));
    expect(pathProbes.length).toBeGreaterThan(0);
    for (const probe of pathProbes) {
      const url = probe.GET as string;
      // parent stays as a runtime placeholder
      expect(url).toContain("/orgs/{{organization_id_or_slug}}/repos/");
      // leaf gets the synthetic bad value
      expect(url).not.toContain("{{repo_id}}");
      expect(url).toMatch(/\/repos\/(?:not-a-uuid|12345|00000000|\.\.)/);
    }
  });

  it("TASK-135: body probes keep all path params as {{name}} placeholders by default", () => {
    const result = generateNegativeProbes({
      endpoints: [
        ep({
          method: "POST",
          path: "/orgs/{org}/teams/{team}/members",
          parameters: [
            { name: "org", in: "path", required: true, schema: { type: "string" } } as any,
            { name: "team", in: "path", required: true, schema: { type: "string" } } as any,
          ],
          requestBodyContentType: "application/json",
          requestBodySchema: {
            type: "object",
            required: ["email"],
            properties: { email: { type: "string", format: "email" } },
          },
        }),
      ],
      securitySchemes: [],
    });
    const bodyProbe = result.suites[0]!.tests.find(t => /empty body/.test(t.name));
    expect(bodyProbe).toBeDefined();
    expect(bodyProbe!.POST as string).toBe("/orgs/{{org}}/teams/{{team}}/members");
  });

  it("TASK-135: --no-real-parents preserves legacy synthetic-by-type rendering", () => {
    const result = generateNegativeProbes({
      endpoints: [
        ep({
          method: "GET",
          path: "/orgs/{org}/repos/{repo_id}",
          parameters: [
            { name: "org", in: "path", required: true, schema: { type: "string" } } as any,
            { name: "repo_id", in: "path", required: true, schema: { type: "string", format: "uuid" } } as any,
          ],
        }),
      ],
      securitySchemes: [],
      useRealParents: false,
    });
    const probe = result.suites[0]!.tests[0]!;
    const url = probe.GET as string;
    expect(url).not.toContain("{{");
    expect(url).toContain("/orgs/nonexistent-zzzzz/repos/");
  });

  it("emits suite-level base_url so generated YAML is runnable as-is", () => {
    const result = generateNegativeProbes({
      endpoints: [ep({
        method: "GET", path: "/x/{id}",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } } as any],
      })],
      securitySchemes: [],
    });
    expect(result.suites[0]!.base_url).toBe("{{base_url}}");
  });

  // ───────────────────────────── TASK-207: missed-branch coverage

  it("emits exactly one path-probe step per INVALID_UUID_SENTINELS entry", () => {
    const result = generateNegativeProbes({
      endpoints: [ep({
        method: "GET",
        path: "/items/{id}",
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } } as any,
        ],
      })],
      securitySchemes: [],
    });
    const suite = result.suites[0]!;
    const pathProbes = suite.tests.filter(t => t.name.startsWith("path param id="));
    // One step per sentinel — proves we don't duplicate or skip values.
    expect(pathProbes).toHaveLength(INVALID_UUID_SENTINELS.length);
    expect(INVALID_UUID_SENTINELS.length).toBe(4);
  });

  it("does NOT emit invalid-uuid probes for params declared in:'header'", () => {
    const result = generateNegativeProbes({
      endpoints: [ep({
        method: "GET",
        path: "/items",
        parameters: [
          { name: "X-Trace", in: "header", required: true, schema: { type: "string", format: "uuid" } } as any,
        ],
      })],
      securitySchemes: [],
    });
    expect(result.skippedEndpoints).toBe(1);
    expect(result.suites).toHaveLength(0);
  });

  it("does NOT emit invalid-uuid probes for params declared in:'cookie'", () => {
    const result = generateNegativeProbes({
      endpoints: [ep({
        method: "GET",
        path: "/items",
        parameters: [
          { name: "session", in: "cookie", required: true, schema: { type: "string", format: "uuid" } } as any,
        ],
      })],
      securitySchemes: [],
    });
    expect(result.skippedEndpoints).toBe(1);
    expect(result.suites).toHaveLength(0);
  });

  it("does NOT attach Bearer auth headers for non-bearer security schemes (apiKey)", () => {
    const result = generateNegativeProbes({
      endpoints: [ep({
        method: "GET",
        path: "/x/{id}",
        security: ["apiKey"],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } } as any],
      })],
      securitySchemes: [{ name: "apiKey", type: "apiKey", in: "header", paramName: "X-API-Key" } as any],
    });
    const suite = result.suites[0]!;
    // No Bearer header — only the auth_token Bearer path uses that shape.
    const auth = suite.headers?.Authorization;
    expect(auth).not.toBe("Bearer {{auth_token}}");
  });
});
