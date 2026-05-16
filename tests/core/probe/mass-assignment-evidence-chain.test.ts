/**
 * Evidence-chain regression for mass-assignment (ARV-252, m-21 pivot).
 *
 * Locks the "no evidence → no finding" principle for the most common
 * mass-assignment cases:
 *
 * - Server applies `is_admin: true` and the follow-up GET reflects it →
 *   HIGH (evidence_chain proof).
 * - Server silently drops `is_admin` (2xx, follow-up GET clean) → INFO
 *   severity, but **never surfaces in the digest** (filter strips it
 *   even under --verbose). This is correct Rails-strong-params behaviour.
 * - Server returns 2xx but no GET counterpart exists → INFO with
 *   "absent" outcomes; surfaces only under --verbose.
 *
 * Mirrors the AC#6 contract: real mass-assignment caught at HIGH; a
 * silently-dropped mock produces zero displayed findings.
 */
import { describe, expect, it } from "bun:test";
import type { OpenAPIV3 } from "openapi-types";
import { runMassAssignmentProbes } from "../../../src/core/probe/mass-assignment-probe.ts";
import type { EndpointInfo } from "../../../src/core/generator/types.ts";

let responder: (req: { method: string; url: string; body?: Record<string, unknown> }) => { status: number; body?: unknown } = () => ({ status: 500 });
const originalFetch = globalThis.fetch;
globalThis.fetch = (async (input, init) => {
  const url = String(input);
  const method = (init?.method ?? "GET").toUpperCase();
  let body: Record<string, unknown> | undefined;
  if (init?.body) {
    try { body = JSON.parse(String(init.body)); } catch { /* ignore */ }
  }
  const r = responder({ url, method, body });
  return {
    status: r.status,
    headers: new Headers({ "content-type": "application/json" }),
    text: async () => JSON.stringify(r.body ?? null),
    json: async () => r.body,
  } as Response;
}) as typeof fetch;

afterAll(() => { globalThis.fetch = originalFetch; });

// Helpers ───────────────────────────────────────────────────────────────

function postUsersEndpoint(): EndpointInfo {
  return {
    path: "/users",
    method: "POST",
    operationId: "createUser",
    parameters: [],
    requestBody: {
      required: true,
      content: { "application/json": { schema: { type: "object", required: ["name"], properties: { name: { type: "string" } } } as OpenAPIV3.SchemaObject } },
    },
    requestBodySchema: { type: "object", required: ["name"], properties: { name: { type: "string" } } } as OpenAPIV3.SchemaObject,
    requestBodyContentType: "application/json",
    responses: [{ statusCode: 201, schema: { type: "object", properties: { id: { type: "string" }, name: { type: "string" }, is_admin: { type: "boolean" } } } as OpenAPIV3.SchemaObject }],
    security: [],
    tags: [],
    extensions: {},
  } as unknown as EndpointInfo;
}

function getUserEndpoint(): EndpointInfo {
  return {
    path: "/users/{id}",
    method: "GET",
    operationId: "getUser",
    parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
    requestBody: undefined,
    requestBodySchema: undefined,
    responses: [{ statusCode: 200, schema: { type: "object", properties: { id: { type: "string" }, name: { type: "string" }, is_admin: { type: "boolean" } } } as OpenAPIV3.SchemaObject }],
    security: [],
    tags: [],
    extensions: {},
  } as unknown as EndpointInfo;
}

function deleteUserEndpoint(): EndpointInfo {
  return {
    path: "/users/{id}",
    method: "DELETE",
    operationId: "deleteUser",
    parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
    requestBody: undefined,
    requestBodySchema: undefined,
    responses: [{ statusCode: 204, schema: undefined } as never],
    security: [],
    tags: [],
    extensions: {},
  } as unknown as EndpointInfo;
}

function isBaseline(body: Record<string, unknown> | undefined): boolean {
  return body != null && !("is_admin" in body) && !("role" in body) && !("account_id" in body)
    && !("owner_id" in body) && !("user_id" in body) && !("verified" in body) && !("is_system" in body);
}

const eps = () => [postUsersEndpoint(), getUserEndpoint(), deleteUserEndpoint()];
const baseVars = { base_url: "https://api.test" };

// ─────────────────────────────────────────────────────────────────────────

describe("mass-assignment evidence-chain (ARV-252)", () => {
  it("HIGH when server applies is_admin and follow-up GET reflects it", async () => {
    responder = (req) => {
      if (req.method === "POST" && isBaseline(req.body)) {
        return { status: 201, body: { id: "b1", name: "alice", is_admin: false } };
      }
      if (req.method === "POST") {
        return { status: 201, body: { id: "u1", name: "alice", is_admin: true } };
      }
      if (req.method === "GET") {
        // The smoking gun: GET reflects the injected privilege flag.
        return { status: 200, body: { id: "u1", name: "alice", is_admin: true } };
      }
      if (req.method === "DELETE") return { status: 204 };
      return { status: 500 };
    };

    const result = await runMassAssignmentProbes({
      endpoints: eps(),
      securitySchemes: [],
      vars: baseVars,
    });

    const v = result.verdicts[0]!;
    expect(v.severity).toBe("high");
    const adminField = v.fields.find((f) => f.field === "is_admin")!;
    expect(adminField.outcome).toBe("applied");
  });

  it("INFO + zero displayed findings when server silently drops is_admin", async () => {
    responder = (req) => {
      if (req.method === "POST" && isBaseline(req.body)) {
        return { status: 201, body: { id: "b1", name: "alice" } };
      }
      if (req.method === "POST") {
        // Strong-params-style: extras silently dropped from response.
        return { status: 201, body: { id: "u2", name: "alice" } };
      }
      if (req.method === "GET") {
        // GET is clean — no privilege escalation.
        return { status: 200, body: { id: "u2", name: "alice" } };
      }
      if (req.method === "DELETE") return { status: 204 };
      return { status: 500 };
    };

    const result = await runMassAssignmentProbes({
      endpoints: eps(),
      securitySchemes: [],
      vars: baseVars,
    });

    const v = result.verdicts[0]!;
    // Verdict carried in the JSON envelope at INFO (agents can opt in)
    // but the digest must not show it — silently-ignored = correct
    // framework behaviour, never finding-worthy.
    expect(v.severity).toBe("info");
    // No suspect-field gets "applied" — the whole point of strong-params:
    // server accepted the request but dropped the dangerous keys.
    const suspectFields = v.fields.filter((f) =>
      ["is_admin", "is_system", "verified", "role", "account_id", "owner_id", "user_id"].includes(f.field),
    );
    expect(suspectFields.length).toBeGreaterThan(0);
    expect(suspectFields.every((f) => f.outcome === "ignored")).toBe(true);
    expect(suspectFields.some((f) => f.outcome === "applied")).toBe(false);
  });

  it("INFO with absent outcomes when no GET counterpart exists (verbose-only display)", async () => {
    responder = (req) => {
      if (req.method === "POST" && isBaseline(req.body)) {
        return { status: 201, body: { id: "b1", name: "alice" } };
      }
      // No is_admin in response, no GET endpoint — can't verify either way.
      return { status: 201, body: { id: "u3", name: "alice" } };
    };

    const result = await runMassAssignmentProbes({
      endpoints: [postUsersEndpoint()], // POST only — no GET, no DELETE
      securitySchemes: [],
      vars: baseVars,
      noCleanup: true,
    });

    const v = result.verdicts[0]!;
    expect(v.severity).toBe("info");
    expect(v.summary).toMatch(/inconclusive/);
    expect(v.fields.some((f) => f.outcome === "absent")).toBe(true);
  });
});

describe("mass-assignment --suspect-field extension (ARV-252)", () => {
  it("custom suspect-field gets injected and detected when applied", async () => {
    responder = (req) => {
      if (req.method === "POST" && isBaseline(req.body)) {
        return { status: 201, body: { id: "b1", name: "alice" } };
      }
      if (req.method === "POST") {
        // Server accepts our custom 'plan' field with sentinel value.
        const planSent = (req.body as Record<string, unknown>)?.plan;
        return { status: 201, body: { id: "u4", name: "alice", plan: planSent } };
      }
      if (req.method === "GET") {
        return { status: 200, body: { id: "u4", name: "alice", plan: "enterprise" } };
      }
      if (req.method === "DELETE") return { status: 204 };
      return { status: 500 };
    };

    const result = await runMassAssignmentProbes({
      endpoints: eps(),
      securitySchemes: [],
      vars: baseVars,
      extraSuspectFields: { plan: "enterprise" },
    });

    const v = result.verdicts[0]!;
    expect(v.severity).toBe("high");
    const planField = v.fields.find((f) => f.field === "plan");
    expect(planField).toBeDefined();
    expect(planField!.outcome).toBe("applied");
  });
});

// afterAll is a Bun-only export
import { afterAll } from "bun:test";
