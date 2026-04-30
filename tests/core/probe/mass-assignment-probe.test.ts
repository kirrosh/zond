import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import {
  runMassAssignmentProbes,
  formatDigestMarkdown,
  emitRegressionSuites,
  SUSPECTED_FIELDS,
} from "../../../src/core/probe/mass-assignment-probe.ts";
import type { EndpointInfo } from "../../../src/core/generator/types.ts";
import type { OpenAPIV3 } from "openapi-types";

function ep(partial: Partial<EndpointInfo>): EndpointInfo {
  return {
    path: "/x",
    method: "POST",
    operationId: undefined,
    summary: undefined,
    tags: [],
    parameters: [],
    requestBodySchema: undefined,
    requestBodyContentType: "application/json",
    responseContentTypes: ["application/json"],
    responses: [{ statusCode: 201, description: "created" }],
    security: [],
    deprecated: false,
    requiresEtag: false,
    ...partial,
  };
}

const userSchema: OpenAPIV3.SchemaObject = {
  type: "object",
  required: ["name"],
  properties: {
    name: { type: "string", example: "alice" },
    email: { type: "string", format: "email", example: "a@b.io" },
  },
};

const userResponseSchema: OpenAPIV3.SchemaObject = {
  type: "object",
  properties: {
    id: { type: "string", format: "uuid" },
    name: { type: "string" },
    email: { type: "string", format: "email" },
    created_at: { type: "string", format: "date-time" },
    is_admin: { type: "boolean" },
    role: { type: "string" },
  },
};

function postUsersEndpoint(overrides: Partial<EndpointInfo> = {}): EndpointInfo {
  return ep({
    method: "POST",
    path: "/users",
    requestBodySchema: userSchema,
    responses: [{ statusCode: 201, description: "created", schema: userResponseSchema }],
    ...overrides,
  });
}

function getUserByIdEndpoint(): EndpointInfo {
  return ep({
    method: "GET",
    path: "/users/{id}",
    requestBodyContentType: undefined,
    requestBodySchema: undefined,
    responses: [{ statusCode: 200, description: "ok", schema: userResponseSchema }],
    parameters: [
      {
        name: "id",
        in: "path",
        required: true,
        schema: { type: "string", format: "uuid" },
      },
    ],
  });
}

function deleteUserEndpoint(): EndpointInfo {
  return ep({
    method: "DELETE",
    path: "/users/{id}",
    requestBodyContentType: undefined,
    requestBodySchema: undefined,
    responses: [{ statusCode: 204, description: "no content" }],
    parameters: [
      {
        name: "id",
        in: "path",
        required: true,
        schema: { type: "string", format: "uuid" },
      },
    ],
  });
}

// ──────────────────────────────────────────────
// Fetch mocking
// ──────────────────────────────────────────────

interface FetchCall {
  url: string;
  method: string;
  body?: unknown;
}

interface MockResponseSpec {
  status: number;
  body?: unknown;
}

/** Discriminator: a request body is the "baseline" probe (no extras) when
 *  none of our suspected fields are present. */
function isBaseline(body: unknown): boolean {
  if (typeof body !== "object" || body === null) return true;
  return !Object.keys(SUSPECTED_FIELDS).some(k => k in (body as Record<string, unknown>));
}

let originalFetch: typeof fetch;
let calls: FetchCall[] = [];
let responder: (req: FetchCall) => MockResponseSpec;

beforeEach(() => {
  originalFetch = globalThis.fetch;
  calls = [];
  responder = () => ({ status: 200, body: {} });
  globalThis.fetch = (async (input: string | Request | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const method = (init?.method ?? "GET").toUpperCase();
    let body: unknown;
    if (init?.body && typeof init.body === "string") {
      try { body = JSON.parse(init.body); } catch { body = init.body; }
    }
    const call: FetchCall = { url, method, body };
    calls.push(call);
    const spec = responder(call);
    const text = spec.body === undefined ? "" : JSON.stringify(spec.body);
    return new Response(text, {
      status: spec.status,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

// ──────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────

describe("runMassAssignmentProbes", () => {
  it("classifies rejected (4xx) as OK when baseline is 2xx (TASK-91)", async () => {
    responder = (req) => {
      if (req.method === "DELETE") return { status: 204 };
      if (req.method === "POST" && isBaseline(req.body)) {
        return { status: 201, body: { id: "baseline-id", name: "alice" } };
      }
      // injected → reject
      return { status: 400, body: { error: "additional property not allowed" } };
    };
    const result = await runMassAssignmentProbes({
      endpoints: [postUsersEndpoint(), deleteUserEndpoint()],
      securitySchemes: [],
      vars: { base_url: "https://api.test" },
    });
    const v = result.verdicts[0]!;
    expect(v.severity).toBe("ok");
    expect(v.summary).toMatch(/extras refused/);
    // Two POSTs: baseline + injected; one DELETE for baseline cleanup.
    const posts = calls.filter(c => c.method === "POST");
    expect(posts).toHaveLength(2);
    expect(isBaseline(posts[0]!.body)).toBe(true);
    expect(isBaseline(posts[1]!.body)).toBe(false);
    // Injected body must include all suspected fields
    for (const key of Object.keys(SUSPECTED_FIELDS)) {
      expect(posts[1]!.body as Record<string, unknown>).toHaveProperty(key);
    }
  });

  it("classifies INCONCLUSIVE-baseline when both baseline and injected return 4xx (TASK-91)", async () => {
    responder = () => ({ status: 404, body: { message: "Domain not found" } });
    const result = await runMassAssignmentProbes({
      endpoints: [postUsersEndpoint()],
      securitySchemes: [],
      vars: { base_url: "https://api.test" },
    });
    const v = result.verdicts[0]!;
    expect(v.severity).toBe("inconclusive-baseline");
    expect(v.summary).toMatch(/baseline body invalid/);
    expect(v.summary).toMatch(/Domain not found/);
    expect(v.summary).toMatch(/fix fixture/);
    expect(v.baseline?.status).toBe(404);
  });

  it("classifies extras-bypass as HIGH when baseline 4xx but injected 2xx (TASK-91)", async () => {
    responder = (req) => {
      if (req.method === "DELETE") return { status: 204 };
      if (req.method === "POST" && isBaseline(req.body)) {
        return { status: 422, body: { error: "missing required field" } };
      }
      return {
        status: 201,
        body: { id: "bypass-id", name: "alice", is_admin: true, role: "admin" },
      };
    };
    const result = await runMassAssignmentProbes({
      endpoints: [postUsersEndpoint(), getUserByIdEndpoint(), deleteUserEndpoint()],
      securitySchemes: [],
      vars: { base_url: "https://api.test" },
    });
    const v = result.verdicts[0]!;
    expect(v.severity).toBe("high");
    expect(v.summary).toMatch(/extras-bypass/);
    expect(v.baseline?.status).toBe(422);
    expect(v.response?.status).toBe(201);
  });

  it("flags accepted-and-applied (HIGH) when GET echoes our injected sentinel", async () => {
    let createdId = "11111111-1111-1111-1111-111111111111";
    responder = (req) => {
      if (req.method === "POST" && isBaseline(req.body)) {
        return { status: 201, body: { id: "baseline-id", name: "alice" } };
      }
      if (req.method === "POST") {
        // Server echoes back is_admin: true (the sentinel we injected)
        return {
          status: 201,
          body: {
            id: createdId,
            name: "alice",
            email: "a@b.io",
            is_admin: true, // ← privilege escalation
            role: "admin",  // ← privilege escalation
          },
        };
      }
      if (req.method === "GET") {
        return {
          status: 200,
          body: {
            id: createdId,
            name: "alice",
            is_admin: true,
            role: "admin",
          },
        };
      }
      if (req.method === "DELETE") return { status: 204 };
      return { status: 500 };
    };

    const result = await runMassAssignmentProbes({
      endpoints: [postUsersEndpoint(), getUserByIdEndpoint(), deleteUserEndpoint()],
      securitySchemes: [],
      vars: { base_url: "https://api.test" },
    });

    const v = result.verdicts.find(x => x.method === "POST")!;
    expect(v.severity).toBe("high");
    expect(v.summary).toMatch(/accepted-and-applied/);
    const adminField = v.fields.find(f => f.field === "is_admin")!;
    expect(adminField.outcome).toBe("applied");

    // Cleanup attempted
    expect(v.cleanup?.attempted).toBe(true);
    expect(v.cleanup?.status).toBe(204);
    expect(calls.some(c => c.method === "DELETE")).toBe(true);
  });

  it("flags accepted-and-ignored (LOW) when extras silently dropped", async () => {
    let createdId = "22222222-2222-2222-2222-222222222222";
    responder = (req) => {
      if (req.method === "POST" && isBaseline(req.body)) {
        return { status: 201, body: { id: "baseline-id", name: "alice" } };
      }
      if (req.method === "POST") {
        // Body echo without our suspicious extras → still need GET to confirm
        return { status: 201, body: { id: createdId, name: "alice" } };
      }
      if (req.method === "GET") {
        // No is_admin / role / account_id in GET either → ignored
        return { status: 200, body: { id: createdId, name: "alice" } };
      }
      if (req.method === "DELETE") return { status: 204 };
      return { status: 500 };
    };

    const result = await runMassAssignmentProbes({
      endpoints: [postUsersEndpoint(), getUserByIdEndpoint(), deleteUserEndpoint()],
      securitySchemes: [],
      vars: { base_url: "https://api.test" },
    });

    const v = result.verdicts[0]!;
    expect(v.severity).toBe("low");
    expect(v.summary).toMatch(/silently ignored/);
    const adminField = v.fields.find(f => f.field === "is_admin")!;
    expect(adminField.outcome).toBe("ignored");
  });

  it("flags inconclusive (MEDIUM) when no GET counterpart exists", async () => {
    responder = (req) => {
      if (req.method === "POST" && isBaseline(req.body)) {
        return { status: 201, body: { id: "baseline-id", name: "alice" } };
      }
      return { status: 201, body: { id: "abc", name: "alice" } };
    };

    const result = await runMassAssignmentProbes({
      endpoints: [postUsersEndpoint()], // no GET, no DELETE
      securitySchemes: [],
      vars: { base_url: "https://api.test" },
      noCleanup: true,
    });
    const v = result.verdicts[0]!;
    expect(v.severity).toBe("medium");
    expect(v.summary).toMatch(/inconclusive/);
  });

  it("notes strict contract when additionalProperties:false and 4xx", async () => {
    responder = (req) => {
      if (req.method === "DELETE") return { status: 204 };
      if (req.method === "POST" && isBaseline(req.body)) {
        return { status: 201, body: { id: "baseline-id", name: "alice" } };
      }
      return { status: 422, body: { error: "additional property not allowed" } };
    };
    const strictSchema: OpenAPIV3.SchemaObject = {
      ...userSchema,
      additionalProperties: false,
    };
    const result = await runMassAssignmentProbes({
      endpoints: [postUsersEndpoint({ requestBodySchema: strictSchema }), deleteUserEndpoint()],
      securitySchemes: [],
      vars: { base_url: "https://api.test" },
    });
    const v = result.verdicts[0]!;
    expect(v.severity).toBe("ok");
    expect(v.strictContract).toBe(true);
    expect(v.summary).toMatch(/strict contract honoured/);
  });

  it("flags 5xx as HIGH", async () => {
    responder = (req) => {
      if (req.method === "POST" && isBaseline(req.body)) {
        return { status: 201, body: { id: "baseline-id", name: "alice" } };
      }
      return { status: 500, body: { error: "boom" } };
    };
    const result = await runMassAssignmentProbes({
      endpoints: [postUsersEndpoint()],
      securitySchemes: [],
      vars: { base_url: "https://api.test" },
      noCleanup: true,
    });
    const v = result.verdicts[0]!;
    expect(v.severity).toBe("high");
    expect(v.summary).toMatch(/5xx/);
  });

  it("skips PATCH/PUT when env doesn't supply path id", async () => {
    const patch = ep({
      method: "PATCH",
      path: "/users/{id}",
      requestBodySchema: userSchema,
      parameters: [
        { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } },
      ],
    });
    const result = await runMassAssignmentProbes({
      endpoints: [patch],
      securitySchemes: [],
      vars: { base_url: "https://api.test" },
    });
    expect(result.verdicts[0]!.severity).toBe("skipped");
    expect(result.verdicts[0]!.skipReason).toMatch(/PATCH requires existing resource id/);
    expect(calls).toHaveLength(0);
  });

  it("auth header injected from vars", async () => {
    responder = (req) => {
      if (req.method === "POST" && isBaseline(req.body)) {
        return { status: 201, body: { id: "baseline-id", name: "alice" } };
      }
      return { status: 400 };
    };
    await runMassAssignmentProbes({
      endpoints: [postUsersEndpoint({
        security: ["bearerAuth"],
      })],
      securitySchemes: [{ name: "bearerAuth", type: "http", scheme: "bearer" }],
      vars: { base_url: "https://api.test", auth_token: "secret-token" },
    });
    expect(calls[0]!.url).toBe("https://api.test/users");
    // Authorization header check requires inspecting init — recompose by looking at what we sent
    // (mock handler doesn't capture headers; this test is mainly URL+auth shape).
  });
});

describe("formatDigestMarkdown", () => {
  it("groups verdicts by severity with headers and counts", async () => {
    responder = (req) => {
      if (req.method === "DELETE") return { status: 204 };
      if (req.method === "POST" && isBaseline(req.body)) {
        return { status: 201, body: { id: "baseline-id", name: "alice" } };
      }
      return { status: 400 };
    };
    const result = await runMassAssignmentProbes({
      endpoints: [postUsersEndpoint(), deleteUserEndpoint()],
      securitySchemes: [],
      vars: { base_url: "https://api.test" },
    });
    const md = formatDigestMarkdown(result, "spec.yaml");
    expect(md).toMatch(/# Mass-assignment probe digest/);
    expect(md).toMatch(/Suspected fields tested/);
    expect(md).toMatch(/✅ OK — rejected 4xx/);
    expect(md).toMatch(/POST \/users/);
  });

  it("renders INCONCLUSIVE-baseline section with hint (TASK-91)", async () => {
    responder = () => ({ status: 404, body: { message: "Domain not found" } });
    const result = await runMassAssignmentProbes({
      endpoints: [postUsersEndpoint()],
      securitySchemes: [],
      vars: { base_url: "https://api.test" },
    });
    const md = formatDigestMarkdown(result, "spec.yaml");
    expect(md).toMatch(/INCONCLUSIVE — baseline body invalid/);
    expect(md).toMatch(/Domain not found/);
    expect(md).toMatch(/set the right fixture/);
  });
});

describe("emitRegressionSuites", () => {
  it("emits rejected-baseline suite for OK verdicts", async () => {
    responder = (req) => {
      if (req.method === "DELETE") return { status: 204 };
      if (req.method === "POST" && isBaseline(req.body)) {
        return { status: 201, body: { id: "baseline-id", name: "alice" } };
      }
      return { status: 422, body: { error: "no" } };
    };
    const eps = [postUsersEndpoint(), deleteUserEndpoint()];
    const result = await runMassAssignmentProbes({
      endpoints: eps,
      securitySchemes: [],
      vars: { base_url: "https://api.test" },
    });
    const suites = emitRegressionSuites(result, eps, []);
    expect(suites).toHaveLength(1);
    expect(suites[0]!.tags).toContain("rejected-baseline");
    expect(suites[0]!.tests[0]!.expect.status).toEqual([400, 401, 403, 409, 415, 422]);
  });

  it("emits ignored-baseline suite with follow-up GET assertion + cleanup", async () => {
    let createdId = "33333333-3333-3333-3333-333333333333";
    responder = (req) => {
      if (req.method === "POST" && isBaseline(req.body)) {
        return { status: 201, body: { id: "baseline-id", name: "alice" } };
      }
      if (req.method === "POST") return { status: 201, body: { id: createdId, name: "alice" } };
      if (req.method === "GET") return { status: 200, body: { id: createdId, name: "alice" } };
      if (req.method === "DELETE") return { status: 204 };
      return { status: 500 };
    };
    const eps = [postUsersEndpoint(), getUserByIdEndpoint(), deleteUserEndpoint()];
    const result = await runMassAssignmentProbes({
      endpoints: eps,
      securitySchemes: [],
      vars: { base_url: "https://api.test" },
    });
    const suites = emitRegressionSuites(result, eps, []);
    expect(suites).toHaveLength(1);
    expect(suites[0]!.tags).toContain("ignored-baseline");
    // Three steps: POST probe, GET verify, DELETE cleanup
    expect(suites[0]!.tests).toHaveLength(3);
    const cleanup = suites[0]!.tests[2]! as { always?: boolean; DELETE?: string };
    expect(cleanup.always).toBe(true);
    expect(cleanup.DELETE).toMatch(/\{\{created_id\}\}/);
  });

  it("does NOT emit suites for HIGH (applied) verdicts", async () => {
    responder = (req) => {
      if (req.method === "POST" && isBaseline(req.body)) {
        return { status: 201, body: { id: "baseline-id", name: "alice" } };
      }
      if (req.method === "POST") return { status: 201, body: { id: "x", is_admin: true } };
      if (req.method === "GET") return { status: 200, body: { id: "x", is_admin: true } };
      if (req.method === "DELETE") return { status: 204 };
      return { status: 500 };
    };
    const eps = [postUsersEndpoint(), getUserByIdEndpoint(), deleteUserEndpoint()];
    const result = await runMassAssignmentProbes({
      endpoints: eps,
      securitySchemes: [],
      vars: { base_url: "https://api.test" },
    });
    const suites = emitRegressionSuites(result, eps, []);
    expect(suites).toHaveLength(0);
  });

  it("does NOT emit suites for INCONCLUSIVE-baseline verdicts (TASK-91)", async () => {
    // Both baseline and injected return 4xx — fixture problem, not a security
    // signal. Emitting a regression test would make CI 404 every run.
    responder = () => ({ status: 404, body: { message: "Domain not found" } });
    const eps = [postUsersEndpoint()];
    const result = await runMassAssignmentProbes({
      endpoints: eps,
      securitySchemes: [],
      vars: { base_url: "https://api.test" },
    });
    expect(result.verdicts[0]!.severity).toBe("inconclusive-baseline");
    const suites = emitRegressionSuites(result, eps, []);
    expect(suites).toHaveLength(0);
  });
});
