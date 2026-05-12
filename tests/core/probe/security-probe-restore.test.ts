import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { runSecurityProbes } from "../../../src/core/probe/security-probe.ts";
import type { OpenAPIV3 } from "openapi-types";
import { postEp as ep } from "../../_helpers/endpoints";
import { fetchHarness, mockResource, projectPutGetPair } from "./_helpers/state-machine";

const harness = fetchHarness();
beforeEach(() => harness.install());
afterEach(() => harness.restore());

describe("runSecurityProbes — TASK-151 snapshot+restore on PUT", () => {
  it("snapshots GET before baseline and restores after each 2xx attack", async () => {
    const resource = mockResource({
      initial: { id: "p1", subjectPrefix: "[Prod] " },
    });
    harness.setResponder(resource.responder);

    const projectSchema: OpenAPIV3.SchemaObject = {
      type: "object",
      properties: {
        subjectPrefix: { type: "string" },
        platforms: { type: "array", items: { type: "string" } },
      },
    };
    const { put: putEp, get: getEp } = projectPutGetPair(projectSchema, { attachResponseSchema: true });

    const result = await runSecurityProbes({
      allowLeaks: true, // ARV-140: legacy attack-on-POST-without-DELETE expectations
      endpoints: [putEp, getEp],
      securitySchemes: [],
      vars: { base_url: "https://api.test", id: "p1" },
      classes: ["crlf"],
    });

    expect(result.verdicts[0]!.findings.length).toBeGreaterThan(0);
    expect(resource.current.subjectPrefix).toBe("[Prod] ");
    expect(JSON.stringify(resource.current)).not.toContain("X-Zond-Injected");
    expect(result.verdicts[0]!.cleanup?.attempted).toBe(true);
  });

  it("falls back to DELETE-cleanup on POST (no GET-counterpart on collection)", async () => {
    let createdIds: string[] = [];
    harness.setResponder((req) => {
      if (req.method === "POST") {
        const id = `wh_${createdIds.length + 1}`;
        createdIds.push(id);
        return { status: 201, body: { id } };
      }
      if (req.method === "DELETE") {
        const m = req.url.match(/\/webhooks\/([^/?]+)/);
        if (m) createdIds = createdIds.filter(x => x !== m[1]);
        return { status: 204 };
      }
      return { status: 200, body: {} };
    });
    const postEp = ep({
      method: "POST",
      path: "/webhooks",
      requestBodySchema: { type: "object", properties: { url: { type: "string", format: "uri" } } },
    });
    const delEp = ep({
      method: "DELETE",
      path: "/webhooks/{id}",
      requestBodySchema: undefined,
      requestBodyContentType: undefined,
      parameters: [
        { name: "id", in: "path", required: true, schema: { type: "string" } } as any,
      ],
    });
    const result = await runSecurityProbes({
      allowLeaks: true, // ARV-140: legacy attack-on-POST-without-DELETE expectations
      endpoints: [postEp, delEp],
      securitySchemes: [],
      vars: { base_url: "https://api.test" },
      classes: ["ssrf"],
    });
    expect(result.verdicts[0]!.findings.length).toBeGreaterThan(0);
    expect(createdIds).toEqual([]);
  });

  it("--no-cleanup disables both snapshot+restore and DELETE", async () => {
    const resource = mockResource({ initial: { id: "p1" } });
    harness.setResponder(resource.responder);

    const { put: putEp, get: getEp } = projectPutGetPair({
      type: "object",
      properties: { subjectPrefix: { type: "string" } },
    });
    await runSecurityProbes({
      allowLeaks: true, // ARV-140: legacy attack-on-POST-without-DELETE expectations
      endpoints: [putEp, getEp],
      securitySchemes: [],
      vars: { base_url: "https://api.test", id: "p1" },
      classes: ["crlf"],
      noCleanup: true,
    });
    expect(resource.getCount()).toBe(0);
    expect(resource.deleteCount()).toBe(0);
  });

  it("logs restore failure in verdict.cleanup.error", async () => {
    // mockResource with breakAfter:1 — first PUT (snapshot/baseline) succeeds,
    // any subsequent PUT (restore) returns 500.
    const resource = mockResource({
      initial: { id: "p1", subjectPrefix: "ok" },
      breakAfter: 1,
    });
    harness.setResponder(resource.responder);

    const { put: putEp, get: getEp } = projectPutGetPair({
      type: "object",
      properties: { subjectPrefix: { type: "string" } },
    });
    const result = await runSecurityProbes({
      allowLeaks: true, // ARV-140: legacy attack-on-POST-without-DELETE expectations
      endpoints: [putEp, getEp],
      securitySchemes: [],
      vars: { base_url: "https://api.test", id: "p1" },
      classes: ["crlf"],
    });
    const v = result.verdicts[0]!;
    expect(v.cleanup?.attempted).toBe(true);
    // Two distinct error shapes — split into per-shape assertions so a future
    // accidental swap (e.g. always emitting 'network error') can't pass.
    expect(v.cleanup?.error).toMatch(/restore\.\w+ failed: 500/);
  });

  it("logs restore failure as 'network error' when PUT throws (no HTTP response)", async () => {
    // First PUT returns 200 (snapshot/baseline ok); subsequent PUT throws so
    // restore hits the network-error branch instead of the HTTP-error branch.
    const prevFetch = globalThis.fetch;
    let putCount = 0;
    globalThis.fetch = (async (input: string | Request | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = (init?.method ?? "GET").toUpperCase();
      void url;
      if (method === "GET") {
        return new Response(JSON.stringify({ id: "p1", subjectPrefix: "ok" }), {
          status: 200, headers: { "content-type": "application/json" },
        });
      }
      if (method === "PUT") {
        putCount++;
        if (putCount > 1) throw new Error("ECONNRESET");
        return new Response(JSON.stringify({ id: "p1", subjectPrefix: "ok" }), {
          status: 200, headers: { "content-type": "application/json" },
        });
      }
      return new Response("", { status: 200 });
    }) as typeof fetch;

    try {
      const { put: putEp, get: getEp } = projectPutGetPair({
        type: "object",
        properties: { subjectPrefix: { type: "string" } },
      });
      const result = await runSecurityProbes({
      allowLeaks: true, // ARV-140: legacy attack-on-POST-without-DELETE expectations
        endpoints: [putEp, getEp],
        securitySchemes: [],
        vars: { base_url: "https://api.test", id: "p1" },
        classes: ["crlf"],
      });
      const v = result.verdicts[0]!;
      expect(v.cleanup?.attempted).toBe(true);
      expect(v.cleanup?.error).toMatch(/restore\.\w+ network error/);
    } finally {
      globalThis.fetch = prevFetch;
    }
  });
});

describe("runSecurityProbes — TASK-152 partial-body fallback on PUT", () => {
  it("rescues a proven HIGH when full-body baseline is rejected by partial-PUT API", async () => {
    let lastPutBody: Record<string, unknown> | null = null;
    harness.setResponder((req) => {
      if (req.method === "GET") return { status: 200, body: { id: "p1", subjectPrefix: "[Prod] " } };
      if (req.method === "PUT") {
        const body = req.body as Record<string, unknown> | undefined;
        if (!body) return { status: 400 };
        const keys = Object.keys(body);
        if (keys.length > 1) return { status: 422, body: { error: "use partial PUT" } };
        lastPutBody = body;
        return { status: 200, body: { id: "p1", ...body } };
      }
      return { status: 200 };
    });
    const { put: putEp, get: getEp } = projectPutGetPair({
      type: "object",
      properties: {
        subjectPrefix: { type: "string" },
        platforms: { type: "array", items: { type: "string" } },
      },
    });
    const result = await runSecurityProbes({
      allowLeaks: true, // ARV-140: legacy attack-on-POST-without-DELETE expectations
      endpoints: [putEp, getEp],
      securitySchemes: [],
      vars: { base_url: "https://api.test", id: "p1" },
      classes: ["crlf"],
    });
    const v = result.verdicts[0]!;
    expect(v.severity).toBe("high");
    const high = v.findings.filter(f => f.severity === "high");
    expect(high.length).toBeGreaterThan(0);
    expect(high[0]!.reason).toContain("[partial-body]");
    expect(lastPutBody).not.toBeNull();
    expect(Object.keys(lastPutBody!)).toHaveLength(1);
  });

  it("does not partial-fallback on POST (would break required fields)", async () => {
    harness.setResponder(() => ({ status: 422, body: { error: "missing required" } }));
    const postEp = ep({
      method: "POST",
      path: "/webhooks",
      requestBodySchema: {
        type: "object",
        required: ["url", "secret"],
        properties: {
          url: { type: "string", format: "uri" },
          secret: { type: "string" },
        },
      },
    });
    const result = await runSecurityProbes({
      allowLeaks: true, // ARV-140: legacy attack-on-POST-without-DELETE expectations
      endpoints: [postEp],
      securitySchemes: [],
      vars: { base_url: "https://api.test" },
      classes: ["ssrf"],
    });
    expect(result.verdicts[0]!.severity).toBe("inconclusive-baseline");
    expect(result.verdicts[0]!.summary).not.toContain("partial-body");
  });

  it("INCONCLUSIVE-BASELINE when both full and partial baselines fail on PUT", async () => {
    harness.setResponder(() => ({ status: 422, body: { error: "scope locked" } }));
    const putEp = ep({
      method: "PUT",
      path: "/projects/{id}",
      requestBodySchema: {
        type: "object",
        properties: { subjectPrefix: { type: "string" } },
      },
      parameters: [
        { name: "id", in: "path", required: true, schema: { type: "string" } } as any,
      ],
    });
    const result = await runSecurityProbes({
      allowLeaks: true, // ARV-140: legacy attack-on-POST-without-DELETE expectations
      endpoints: [putEp],
      securitySchemes: [],
      vars: { base_url: "https://api.test", id: "p1" },
      classes: ["crlf"],
    });
    const v = result.verdicts[0]!;
    expect(v.severity).toBe("inconclusive-baseline");
    expect(v.summary).toContain("partial-body");
  });
});
