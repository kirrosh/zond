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

const POST_TOPICS = ep({
  method: "POST",
  path: "/topics",
  requestBodyContentType: "application/json",
  requestBodySchema: {
    type: "object",
    required: ["name"],
    properties: {
      name: { type: "string" },
    },
  },
  responses: [
    {
      statusCode: 201,
      description: "created",
      schema: { type: "object", properties: { id: { type: "string", format: "uuid" }, name: { type: "string" } } },
    },
  ],
});

const DELETE_TOPIC = ep({
  method: "DELETE",
  path: "/topics/{id}",
  parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } } as any],
});

describe("generateNegativeProbes — cleanup (TASK-79)", () => {
  it("emits cleanup-DELETE step for each mutating probe when DELETE counterpart exists", () => {
    const result = generateNegativeProbes({
      endpoints: [POST_TOPICS, DELETE_TOPIC],
      securitySchemes: [],
    });

    expect(result.warnings).toEqual([]);
    const suite = result.suites.find(s => s.name === "probe POST /topics")!;
    expect(suite).toBeDefined();
    const cleanups = suite.tests.filter(t => t.always === true);
    const probes = suite.tests.filter(t => t.always !== true);

    // One cleanup per mutating probe, all marked always: true.
    expect(cleanups.length).toBe(probes.length);
    expect(cleanups.length).toBeGreaterThan(0);

    for (const c of cleanups) {
      expect(c.DELETE).toMatch(/^\/topics\/\{\{leaked_id_\d+\}\}$/);
      expect(c.expect.status).toEqual([200, 202, 204, 404]);
      expect(c.name).toMatch(/^cleanup leaked resource from/);
    }

    // Every probe step gets an `id` capture rule wired to its paired cleanup.
    for (let i = 0; i < probes.length; i++) {
      const probe = probes[i]!;
      const idRule = (probe.expect.body as Record<string, Record<string, string>> | undefined)?.["id"];
      expect(idRule).toBeDefined();
      expect(idRule!.capture).toBe(`leaked_id_${i}`);
    }
  });

  it("no DELETE counterpart → emits warning, no cleanup steps", () => {
    const result = generateNegativeProbes({
      endpoints: [POST_TOPICS], // no DELETE
      securitySchemes: [],
    });

    const suite = result.suites[0]!;
    expect(suite.tests.some(t => t.always === true)).toBe(false);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain("POST /topics");
    expect(result.warnings[0]).toContain("no DELETE counterpart");
  });

  it("noCleanup option suppresses cleanup steps even when DELETE exists", () => {
    const result = generateNegativeProbes({
      endpoints: [POST_TOPICS, DELETE_TOPIC],
      securitySchemes: [],
      noCleanup: true,
    });

    const suite = result.suites[0]!;
    expect(suite.tests.some(t => t.always === true)).toBe(false);
    // No capture rule injected either — when cleanup is off, probes aren't
    // augmented with body capture wiring.
    for (const probe of suite.tests) {
      const idRule = (probe.expect.body as Record<string, Record<string, string>> | undefined)?.["id"];
      expect(idRule).toBeUndefined();
    }
  });

  it("GET probes never get cleanup (read-only, no leaks possible)", () => {
    const GET_TOPIC = ep({
      method: "GET",
      path: "/topics/{id}",
      parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } } as any],
    });
    const result = generateNegativeProbes({
      endpoints: [GET_TOPIC, DELETE_TOPIC],
      securitySchemes: [],
    });
    const suite = result.suites.find(s => /GET/.test(s.name))!;
    expect(suite.tests.some(t => t.always === true)).toBe(false);
    expect(result.warnings).toEqual([]);
  });
});
