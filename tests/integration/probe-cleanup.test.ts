import { describe, test, expect, mock, afterEach } from "bun:test";
import { generateNegativeProbes } from "../../src/core/probe/negative-probe.ts";
import { runSuite } from "../../src/core/runner/executor.ts";
import { validateSuite } from "../../src/core/parser/schema.ts";
import { serializeSuite } from "../../src/core/generator/serializer.ts";
import { parse as parseYaml } from "yaml";
import type { EndpointInfo } from "../../src/core/generator/types.ts";

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

function ep(partial: Partial<EndpointInfo>): EndpointInfo {
  return {
    path: "/x", method: "POST",
    operationId: undefined, summary: undefined, tags: [],
    parameters: [], requestBodySchema: undefined, requestBodyContentType: undefined,
    responseContentTypes: ["application/json"],
    responses: [{ statusCode: 200, description: "ok" }],
    security: [], deprecated: false, requiresEtag: false,
    ...partial,
  };
}

describe("probe-validation cleanup integration (TASK-79 AC#4)", () => {
  test("leaky POST: probe creates resource → cleanup-DELETE removes it; net count == 0", async () => {
    // Generate probes for POST /topics + DELETE /topics/{id}.
    const probes = generateNegativeProbes({
      endpoints: [
        ep({
          method: "POST",
          path: "/topics",
          requestBodyContentType: "application/json",
          requestBodySchema: {
            type: "object",
            required: ["name"],
            properties: { name: { type: "string" } },
          },
          responses: [{
            statusCode: 201,
            description: "created",
            schema: { type: "object", properties: { id: { type: "string" }, name: { type: "string" } } },
          }],
        }),
        ep({
          method: "DELETE", path: "/topics/{id}",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } } as any],
        }),
      ],
      securitySchemes: [],
    });

    const probeSuite = probes.suites.find(s => s.name === "probe POST /topics")!;
    expect(probeSuite).toBeDefined();
    // Round-trip through the YAML serializer + parser to validate the
    // generator's output is a valid suite the runner can consume.
    const yaml = serializeSuite(probeSuite);
    const suite = validateSuite(parseYaml(yaml));
    suite.base_url = "http://api.example";

    // Mock API: a buggy server that ALWAYS returns 201 + new id (leak) for
    // POST regardless of input. DELETE removes from the registry.
    const registry = new Set<string>();
    let leakCounter = 0;
    globalThis.fetch = mock(async (input: Request | string | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const method = (init?.method ?? (input instanceof Request ? input.method : "GET")) as string;

      if (url.startsWith("http://api.example/topics") && method === "POST") {
        const id = `leaked-${++leakCounter}`;
        registry.add(id);
        return new Response(JSON.stringify({ id, name: "anything" }), {
          status: 201,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url.match(/^http:\/\/api\.example\/topics\/[^/]+$/) && method === "DELETE") {
        const id = url.split("/").pop()!;
        const removed = registry.delete(id);
        return new Response(null, { status: removed ? 204 : 404 });
      }
      return new Response("unexpected", { status: 500 });
    }) as unknown as typeof fetch;

    await runSuite(suite, {});

    // Every leak created during the run must have been cleaned up.
    expect(leakCounter).toBeGreaterThan(0);
    expect(registry.size).toBe(0);
  });

  test("non-leaky API (probes correctly rejected with 4xx) → cleanup steps skip silently", async () => {
    const probes = generateNegativeProbes({
      endpoints: [
        ep({
          method: "POST",
          path: "/topics",
          requestBodyContentType: "application/json",
          requestBodySchema: {
            type: "object", required: ["name"],
            properties: { name: { type: "string" } },
          },
        }),
        ep({
          method: "DELETE", path: "/topics/{id}",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } } as any],
        }),
      ],
      securitySchemes: [],
    });

    const probeSuite = probes.suites.find(s => s.name === "probe POST /topics")!;
    const suite = validateSuite(parseYaml(serializeSuite(probeSuite)));
    suite.base_url = "http://api.example";

    let deleteCalls = 0;
    globalThis.fetch = mock(async (input: Request | string | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const method = (init?.method ?? (input instanceof Request ? input.method : "GET")) as string;
      if (method === "DELETE") deleteCalls++;
      // Correctly reject every probe with 422 — no resource created.
      return new Response(JSON.stringify({ error: "validation failed" }), {
        status: 422,
        headers: { "Content-Type": "application/json" },
      });
    }) as unknown as typeof fetch;

    const result = await runSuite(suite, {});

    // No leaks → cleanup steps skip without ever firing a DELETE.
    expect(deleteCalls).toBe(0);
    // Cleanup steps appear in the result as skipped (missing capture).
    const cleanupResults = result.steps.filter(s => /^cleanup leaked/.test(s.name));
    expect(cleanupResults.length).toBeGreaterThan(0);
    expect(cleanupResults.every(s => s.status === "skip")).toBe(true);
  });
});
