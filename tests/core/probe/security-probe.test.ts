import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import {
  detectFields,
  runSecurityProbes,
  formatSecurityDigest,
  emitSecurityRegressionSuites,
} from "../../../src/core/probe/security-probe.ts";
import type { EndpointInfo } from "../../../src/core/generator/types.ts";
import type { OpenAPIV3 } from "openapi-types";
import { postEp as ep } from "../../_helpers/endpoints";

const webhookSchema: OpenAPIV3.SchemaObject = {
  type: "object",
  required: ["url"],
  properties: {
    url: { type: "string", format: "uri" },
    secret: { type: "string" },
  },
};

const emailSchema: OpenAPIV3.SchemaObject = {
  type: "object",
  required: ["subject"],
  properties: {
    subject: { type: "string" },
    to: { type: "string", format: "email" },
  },
};

const redirectSchema: OpenAPIV3.SchemaObject = {
  type: "object",
  required: ["redirect"],
  properties: {
    redirect: { type: "string" },
  },
};

describe("detectFields", () => {
  it("detects SSRF fields by name and by uri format", () => {
    const hits = detectFields(
      ep({ requestBodySchema: webhookSchema }),
      ["ssrf"],
    );
    expect(hits).toEqual([{ field: "url", class: "ssrf" }]);
  });

  it("detects CRLF candidates by header-bearing field names", () => {
    const hits = detectFields(
      ep({ requestBodySchema: emailSchema }),
      ["crlf"],
    );
    const fields = hits.map(h => h.field);
    expect(fields).toContain("subject");
  });

  it("detects open-redirect by redirect-shaped field names", () => {
    const hits = detectFields(
      ep({ requestBodySchema: redirectSchema }),
      ["open-redirect"],
    );
    expect(hits).toEqual([{ field: "redirect", class: "open-redirect" }]);
  });

  it("ignores enum-bounded fields", () => {
    const enumSchema: OpenAPIV3.SchemaObject = {
      type: "object",
      properties: {
        url: { type: "string", enum: ["a", "b"] },
      },
    };
    const hits = detectFields(ep({ requestBodySchema: enumSchema }), ["ssrf"]);
    expect(hits).toEqual([]);
  });
});

// ──────────────────────────────────────────────
// Live runner with mocked fetch
// ──────────────────────────────────────────────

interface FetchCall {
  url: string;
  method: string;
  body?: unknown;
}

let originalFetch: typeof fetch;
let calls: FetchCall[] = [];
let responder: (req: FetchCall) => { status: number; body?: unknown };

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

describe("runSecurityProbes", () => {
  it("baseline 4xx → INCONCLUSIVE-BASELINE, no attacks sent", async () => {
    responder = () => ({ status: 404, body: { error: "not found" } });
    const result = await runSecurityProbes({
      endpoints: [ep({ method: "POST", path: "/webhooks", requestBodySchema: webhookSchema })],
      securitySchemes: [],
      vars: { base_url: "https://api.test" },
      classes: ["ssrf"],
    });
    const v = result.verdicts[0]!;
    expect(v.severity).toBe("inconclusive-baseline");
    expect(v.findings).toHaveLength(0);
    // Only baseline was sent.
    const posts = calls.filter(c => c.method === "POST");
    expect(posts).toHaveLength(1);
  });

  it("classifies HIGH when payload is echoed in 2xx response (stored injection)", async () => {
    responder = (req) => {
      if (req.method === "DELETE") return { status: 204 };
      // Echo whatever subject we receive — typical stored-CRLF surface.
      const body = req.body as Record<string, unknown> | undefined;
      const subject = body?.subject;
      return { status: 201, body: { id: "msg_1", subject } };
    };
    const result = await runSecurityProbes({
      endpoints: [ep({ method: "POST", path: "/messages", requestBodySchema: emailSchema })],
      securitySchemes: [],
      vars: { base_url: "https://api.test" },
      classes: ["crlf"],
    });
    const v = result.verdicts[0]!;
    expect(v.severity).toBe("high");
    const high = v.findings.filter(f => f.severity === "high");
    expect(high.length).toBeGreaterThan(0);
    expect(high[0]!.echoed).toBe(true);
  });

  it("classifies OK when API rejects payload with 4xx", async () => {
    // Mock policy: only the baseline-shaped URL (https://… not 127.* / not 169.* /
    // not a file: scheme) is accepted; every SSRF payload is rejected.
    responder = (req) => {
      if (req.method === "DELETE") return { status: 204 };
      const body = req.body as Record<string, unknown> | undefined;
      const url = typeof body?.url === "string" ? body.url : "";
      const isSsrfPayload =
        url.includes("127.0.0.1") ||
        url.includes("169.254") ||
        url.includes("[::1]") ||
        url.includes("localhost") ||
        url.startsWith("file:");
      if (isSsrfPayload) return { status: 422, body: { error: "url not allowed" } };
      return { status: 201, body: { id: "wh_1" } };
    };
    const result = await runSecurityProbes({
      endpoints: [ep({ method: "POST", path: "/webhooks", requestBodySchema: webhookSchema })],
      securitySchemes: [],
      vars: { base_url: "https://api.test" },
      classes: ["ssrf"],
    });
    const v = result.verdicts[0]!;
    expect(v.severity).toBe("ok");
    expect(v.findings.every(f => f.severity === "ok")).toBe(true);
  });

  it("dry-run lists detected fields without sending requests", async () => {
    const result = await runSecurityProbes({
      endpoints: [ep({ method: "POST", path: "/webhooks", requestBodySchema: webhookSchema })],
      securitySchemes: [],
      vars: { base_url: "https://api.test" },
      classes: ["ssrf"],
      dryRun: true,
    });
    expect(calls).toHaveLength(0);
    const v = result.verdicts[0]!;
    expect(v.severity).toBe("skipped");
    expect(v.detectedFields[0]!.field).toBe("url");
    expect(v.summary).toContain("dry-run");
  });

  it("skips endpoints with no detected fields", async () => {
    const noBodyEp = ep({
      method: "POST",
      path: "/anonymous",
      requestBodySchema: { type: "object", properties: { count: { type: "integer" } } },
    });
    const result = await runSecurityProbes({
      endpoints: [noBodyEp],
      securitySchemes: [],
      vars: { base_url: "https://api.test" },
      classes: ["ssrf", "crlf"],
    });
    expect(result.verdicts[0]!.severity).toBe("skipped");
    expect(calls).toHaveLength(0);
  });
});

describe("runSecurityProbes — TASK-151 snapshot+restore on PUT", () => {
  it("snapshots GET before baseline and restores after each 2xx attack", async () => {
    // Mock state machine: a single project resource whose `subjectPrefix`
    // can be read via GET, mutated via PUT. We assert the FINAL state
    // equals the original — proving probe-security restored after every
    // 2xx attack instead of leaving a payload in place.
    const original = { id: "p1", subjectPrefix: "[Prod] " };
    let current: Record<string, unknown> = { ...original };

    responder = (req) => {
      if (req.method === "GET") {
        return { status: 200, body: { ...current } };
      }
      if (req.method === "PUT") {
        const body = req.body as Record<string, unknown> | undefined;
        if (!body) return { status: 400 };
        current = { ...current, ...body };
        return { status: 200, body: { ...current } };
      }
      return { status: 405 };
    };

    const projectSchema: OpenAPIV3.SchemaObject = {
      type: "object",
      properties: {
        subjectPrefix: { type: "string" },
        platforms: { type: "array", items: { type: "string" } },
      },
    };
    const putEp = ep({
      method: "PUT",
      path: "/projects/{id}",
      requestBodySchema: projectSchema,
      responses: [{ statusCode: 200, description: "ok" }],
      parameters: [
        { name: "id", in: "path", required: true, schema: { type: "string" } } as any,
      ],
    });
    const getEp = ep({
      method: "GET",
      path: "/projects/{id}",
      requestBodySchema: undefined,
      requestBodyContentType: undefined,
      responses: [{ statusCode: 200, description: "ok", schema: projectSchema }],
      parameters: [
        { name: "id", in: "path", required: true, schema: { type: "string" } } as any,
      ],
    });

    const result = await runSecurityProbes({
      endpoints: [putEp, getEp],
      securitySchemes: [],
      vars: { base_url: "https://api.test", id: "p1" },
      classes: ["crlf"],
    });

    // The probe must have run — at least one CRLF attack on subjectPrefix.
    expect(result.verdicts[0]!.findings.length).toBeGreaterThan(0);
    // CRITICAL: live state is back to its original value, not an attack payload.
    expect(current.subjectPrefix).toBe("[Prod] ");
    expect(JSON.stringify(current)).not.toContain("X-Zond-Injected");

    // verdict.cleanup must indicate restore was attempted.
    expect(result.verdicts[0]!.cleanup?.attempted).toBe(true);
  });

  it("falls back to DELETE-cleanup on POST (no GET-counterpart on collection)", async () => {
    // POST has no per-id GET to snapshot (the GET is on the item path which
    // doesn't exist yet). So snapshotOriginal returns null and we keep the
    // existing DELETE-cleanup path.
    let createdIds: string[] = [];
    responder = (req) => {
      if (req.method === "POST") {
        const id = `wh_${createdIds.length + 1}`;
        createdIds.push(id);
        return { status: 201, body: { id } };
      }
      if (req.method === "DELETE") {
        // We can extract id from URL.
        const m = req.url.match(/\/webhooks\/([^/?]+)/);
        if (m) createdIds = createdIds.filter(x => x !== m[1]);
        return { status: 204 };
      }
      return { status: 200, body: {} };
    };
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
      endpoints: [postEp, delEp],
      securitySchemes: [],
      vars: { base_url: "https://api.test" },
      classes: ["ssrf"],
    });
    expect(result.verdicts[0]!.findings.length).toBeGreaterThan(0);
    // All created webhooks were deleted.
    expect(createdIds).toEqual([]);
  });

  it("--no-cleanup disables both snapshot+restore and DELETE", async () => {
    let getCount = 0;
    let deleteCount = 0;
    responder = (req) => {
      if (req.method === "GET") { getCount++; return { status: 200, body: { id: "p1" } }; }
      if (req.method === "DELETE") { deleteCount++; return { status: 204 }; }
      return { status: 200, body: { id: "p1" } };
    };
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
    const getEp = ep({
      method: "GET",
      path: "/projects/{id}",
      requestBodySchema: undefined,
      requestBodyContentType: undefined,
      parameters: [
        { name: "id", in: "path", required: true, schema: { type: "string" } } as any,
      ],
    });
    await runSecurityProbes({
      endpoints: [putEp, getEp],
      securitySchemes: [],
      vars: { base_url: "https://api.test", id: "p1" },
      classes: ["crlf"],
      noCleanup: true,
    });
    // No snapshot GET, no restore PUT, no DELETE — only baseline + attacks.
    expect(getCount).toBe(0);
    expect(deleteCount).toBe(0);
  });

  it("logs restore failure in verdict.cleanup.error", async () => {
    let phase: "open" | "broken" = "open";
    responder = (req) => {
      if (req.method === "GET") return { status: 200, body: { id: "p1", subjectPrefix: "ok" } };
      if (req.method === "PUT") {
        // Break PUT after first request — restore will fail.
        if (phase === "open") {
          phase = "broken";
          return { status: 200, body: { id: "p1", subjectPrefix: "x" } };
        }
        return { status: 500, body: { error: "broken" } };
      }
      return { status: 200 };
    };
    const putEp = ep({
      method: "PUT",
      path: "/projects/{id}",
      requestBodySchema: { type: "object", properties: { subjectPrefix: { type: "string" } } },
      parameters: [
        { name: "id", in: "path", required: true, schema: { type: "string" } } as any,
      ],
    });
    const getEp = ep({
      method: "GET",
      path: "/projects/{id}",
      requestBodySchema: undefined,
      requestBodyContentType: undefined,
      parameters: [
        { name: "id", in: "path", required: true, schema: { type: "string" } } as any,
      ],
    });
    const result = await runSecurityProbes({
      endpoints: [putEp, getEp],
      securitySchemes: [],
      vars: { base_url: "https://api.test", id: "p1" },
      classes: ["crlf"],
    });
    // Cleanup attempted; the post-baseline restore failed with 500.
    const v = result.verdicts[0]!;
    expect(v.cleanup?.attempted).toBe(true);
    expect(v.cleanup?.error).toMatch(/restore\.\w+ failed: 500|restore\.\w+ network error/);
  });
});

describe("runSecurityProbes — round-4 fixes", () => {
  it("restore on partial-PUT API uses single-key body and actually rolls state back", async () => {
    // Mirror Sentry behaviour: PUT 422s on multi-key body, accepts only
    // partial. Snapshot returned full body. Pre-fix, restoreOriginal
    // sent the full body and the API rejected it -> live state stayed
    // mutated. Post-fix, restore sends ONE field at a time.
    const original = { id: "p1", name: "PE Koshelev Kirill", subjectPrefix: "" };
    let current: Record<string, unknown> = { ...original };
    let multiKeyPutCount = 0;

    responder = (req) => {
      if (req.method === "GET") return { status: 200, body: { ...current } };
      if (req.method === "PUT") {
        const body = req.body as Record<string, unknown> | undefined;
        if (!body) return { status: 400 };
        // Reject any PUT with >1 mutable key.
        const keys = Object.keys(body);
        if (keys.length > 1) {
          multiKeyPutCount++;
          return { status: 422, body: { error: "use partial PUT" } };
        }
        current = { ...current, ...body };
        return { status: 200, body: { ...current } };
      }
      return { status: 200 };
    };

    const projectSchema: OpenAPIV3.SchemaObject = {
      type: "object",
      properties: {
        name: { type: "string" },
        subjectPrefix: { type: "string" },
      },
    };
    const putEp = ep({
      method: "PUT",
      path: "/projects/{id}",
      requestBodySchema: projectSchema,
      parameters: [
        { name: "id", in: "path", required: true, schema: { type: "string" } } as any,
      ],
    });
    const getEp = ep({
      method: "GET",
      path: "/projects/{id}",
      requestBodySchema: undefined,
      requestBodyContentType: undefined,
      parameters: [
        { name: "id", in: "path", required: true, schema: { type: "string" } } as any,
      ],
    });

    const result = await runSecurityProbes({
      endpoints: [putEp, getEp],
      securitySchemes: [],
      vars: { base_url: "https://api.test", id: "p1" },
      classes: ["crlf"],
    });

    // CRITICAL: live state matches the original — the per-field restore
    // path actually rolled back the rename'd values.
    expect(current.name).toBe("PE Koshelev Kirill");
    expect(current.subjectPrefix).toBe("");
    expect(JSON.stringify(current)).not.toContain("X-Zond-Injected");
    // Only the initial full-baseline probe sends multi-key (it's the
    // shape-discovery step). All subsequent traffic — partial baselines,
    // attacks, restores — must be single-key.
    expect(multiKeyPutCount).toBe(1);
    // Sanity: probe still ran.
    expect(result.verdicts[0]!.findings.length).toBeGreaterThan(0);
  });

  it("flags 'no DELETE counterpart' in cleanup error for POST without sibling DELETE", async () => {
    let createdCount = 0;
    responder = (req) => {
      if (req.method === "POST") {
        createdCount++;
        return { status: 201, body: { id: `wh_${createdCount}` } };
      }
      return { status: 200 };
    };
    // POST with NO DELETE counterpart in the spec — every 2xx leaks a row.
    const postEp = ep({
      method: "POST",
      path: "/webhooks",
      requestBodySchema: { type: "object", properties: { url: { type: "string", format: "uri" } } },
    });
    const result = await runSecurityProbes({
      endpoints: [postEp],
      securitySchemes: [],
      vars: { base_url: "https://api.test" },
      classes: ["ssrf"],
    });
    const v = result.verdicts[0]!;
    expect(v.cleanup?.error).toMatch(/no DELETE counterpart/);
  });

  it("findDeleteCounterpart matches across trailing-slash variants", async () => {
    // POST /keys/  +  DELETE /keys/{key_id}/  — both have trailing slashes,
    // exactly the Sentry shape that leaked DSN keys in round-4.
    let leftover: string[] = [];
    responder = (req) => {
      if (req.method === "POST" && req.url.endsWith("/keys/")) {
        const id = `k_${leftover.length + 1}`;
        leftover.push(id);
        return { status: 201, body: { id } };
      }
      if (req.method === "DELETE") {
        const m = req.url.match(/\/keys\/([^/?]+)/);
        if (m) leftover = leftover.filter(x => x !== m[1]);
        return { status: 204 };
      }
      return { status: 200 };
    };
    const postEp = ep({
      method: "POST",
      path: "/keys/",
      requestBodySchema: { type: "object", properties: { url: { type: "string", format: "uri" } } },
    });
    const delEp = ep({
      method: "DELETE",
      path: "/keys/{key_id}/",
      requestBodySchema: undefined,
      requestBodyContentType: undefined,
      parameters: [
        { name: "key_id", in: "path", required: true, schema: { type: "string" } } as any,
      ],
    });
    await runSecurityProbes({
      endpoints: [postEp, delEp],
      securitySchemes: [],
      vars: { base_url: "https://api.test" },
      classes: ["ssrf"],
    });
    // Every created key was successfully deleted.
    expect(leftover).toEqual([]);
  });

  it("DELETE cleanup retries on transient 404 (eventual consistency, round-5)", async () => {
    // Sentry / many SaaS APIs: POST writes to leader, immediate DELETE
    // hits a follower that hasn't replicated yet -> 404. The retry path
    // swallows that 404 and reports success.
    let leftover: string[] = [];
    let getCount = 0;
    responder = (req) => {
      if (req.method === "POST") {
        const id = `k_${leftover.length + 1}`;
        leftover.push(id);
        return { status: 201, body: { id } };
      }
      if (req.method === "DELETE") {
        getCount++;
        // First DELETE attempt returns 404 (replica lag); subsequent attempts succeed.
        if (getCount === 1) return { status: 404, body: { error: "not found" } };
        const m = req.url.match(/\/keys\/([^/?]+)/);
        if (m) leftover = leftover.filter(x => x !== m[1]);
        return { status: 204 };
      }
      return { status: 200 };
    };
    const postEp = ep({
      method: "POST",
      path: "/keys/",
      requestBodySchema: { type: "object", properties: { url: { type: "string", format: "uri" } } },
    });
    const delEp = ep({
      method: "DELETE",
      path: "/keys/{key_id}/",
      requestBodySchema: undefined,
      requestBodyContentType: undefined,
      parameters: [
        { name: "key_id", in: "path", required: true, schema: { type: "string" } } as any,
      ],
    });
    const result = await runSecurityProbes({
      endpoints: [postEp, delEp],
      securitySchemes: [],
      vars: { base_url: "https://api.test" },
      classes: ["ssrf"],
      cleanupRetryDelaysMs: [0, 0], // fast tests
    });
    // First attempt 404 swallowed; retry succeeded — no leak.
    expect(leftover).toEqual([]);
    // No cleanup error logged for the resolved-by-retry case.
    expect(result.verdicts[0]!.cleanup?.error).toBeUndefined();
  });

  it("DELETE cleanup reports leak when 404 persists across retries (round-5)", async () => {
    responder = (req) => {
      if (req.method === "POST") return { status: 201, body: { id: "k_persistent" } };
      if (req.method === "DELETE") return { status: 404, body: { error: "not found" } };
      return { status: 200 };
    };
    const postEp = ep({
      method: "POST",
      path: "/keys/",
      requestBodySchema: { type: "object", properties: { url: { type: "string", format: "uri" } } },
    });
    const delEp = ep({
      method: "DELETE",
      path: "/keys/{key_id}/",
      requestBodySchema: undefined,
      requestBodyContentType: undefined,
      parameters: [
        { name: "key_id", in: "path", required: true, schema: { type: "string" } } as any,
      ],
    });
    const result = await runSecurityProbes({
      endpoints: [postEp, delEp],
      securitySchemes: [],
      vars: { base_url: "https://api.test" },
      classes: ["ssrf"],
      cleanupRetryDelaysMs: [0, 0],
    });
    // Retried but 404 stuck — flagged as a real leak.
    expect(result.verdicts[0]!.cleanup?.error).toMatch(/persisted across retries/);
  });

  it("digest surfaces a Cleanup failures section when cleanup.error is set", () => {
    const md = formatSecurityDigest(
      {
        classes: ["ssrf"],
        totalEndpoints: 1,
        specProbed: 1,
        verdicts: [
          {
            method: "POST",
            path: "/keys",
            severity: "ok",
            summary: "fields=[url] · OK=3",
            detectedFields: [{ field: "url", class: "ssrf" }],
            findings: [],
            cleanup: {
              attempted: true,
              error: "no DELETE counterpart for POST /keys; possible leaked resource",
            },
          },
        ],
        warnings: [],
      },
      "spec.json",
    );
    expect(md).toContain("⚠️ Cleanup failures");
    expect(md).toContain("no DELETE counterpart");
    // Per-verdict tag also visible in OK section.
    expect(md).toContain("🧹 cleanup-failure");
  });
});

describe("runSecurityProbes — TASK-152 partial-body fallback on PUT", () => {
  it("rescues a proven HIGH when full-body baseline is rejected by partial-PUT API", async () => {
    // Sentry-shaped behaviour: PUT accepts only fields you actually want
    // to change. Sending the spec's full body with all properties returns
    // 422; sending a single field works.
    let lastPutBody: Record<string, unknown> | null = null;
    responder = (req) => {
      if (req.method === "GET") return { status: 200, body: { id: "p1", subjectPrefix: "[Prod] " } };
      if (req.method === "PUT") {
        const body = req.body as Record<string, unknown> | undefined;
        if (!body) return { status: 400 };
        // Reject if more than one user-mutable key is present in the body.
        const keys = Object.keys(body);
        if (keys.length > 1) return { status: 422, body: { error: "use partial PUT" } };
        lastPutBody = body;
        // Accept partial; echo whatever was sent so the classifier can detect echo.
        return { status: 200, body: { id: "p1", ...body } };
      }
      return { status: 200 };
    };
    const putEp = ep({
      method: "PUT",
      path: "/projects/{id}",
      requestBodySchema: {
        type: "object",
        // Multiple writable fields → spec generator builds a body with both.
        properties: {
          subjectPrefix: { type: "string" },
          platforms: { type: "array", items: { type: "string" } },
        },
      },
      parameters: [
        { name: "id", in: "path", required: true, schema: { type: "string" } } as any,
      ],
    });
    const getEp = ep({
      method: "GET",
      path: "/projects/{id}",
      requestBodySchema: undefined,
      requestBodyContentType: undefined,
      parameters: [
        { name: "id", in: "path", required: true, schema: { type: "string" } } as any,
      ],
    });

    const result = await runSecurityProbes({
      endpoints: [putEp, getEp],
      securitySchemes: [],
      vars: { base_url: "https://api.test", id: "p1" },
      classes: ["crlf"],
    });

    // CRITICAL: this used to land in INCONCLUSIVE-BASELINE; with partial-body
    // fallback it is now classified (HIGH because the mock echoes the payload).
    const v = result.verdicts[0]!;
    expect(v.severity).toBe("high");
    const high = v.findings.filter(f => f.severity === "high");
    expect(high.length).toBeGreaterThan(0);
    // Reason annotated with [partial-body] so emit-tests / case-studies know
    // which body shape to use.
    expect(high[0]!.reason).toContain("[partial-body]");
    // The PUT we sent during attack contains exactly one key — subjectPrefix.
    expect(lastPutBody).not.toBeNull();
    expect(Object.keys(lastPutBody!)).toHaveLength(1);
  });

  it("does not partial-fallback on POST (would break required fields)", async () => {
    responder = () => ({ status: 422, body: { error: "missing required" } });
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
      endpoints: [postEp],
      securitySchemes: [],
      vars: { base_url: "https://api.test" },
      classes: ["ssrf"],
    });
    expect(result.verdicts[0]!.severity).toBe("inconclusive-baseline");
    expect(result.verdicts[0]!.summary).not.toContain("partial-body");
  });

  it("INCONCLUSIVE-BASELINE when both full and partial baselines fail on PUT", async () => {
    responder = () => ({ status: 422, body: { error: "scope locked" } });
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
    // No GET-counterpart in the spec → snapshot returns null, no restore noise.
    const result = await runSecurityProbes({
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

describe("formatSecurityDigest", () => {
  it("renders sections per severity", () => {
    const md = formatSecurityDigest(
      {
        classes: ["ssrf"],
        totalEndpoints: 1,
        specProbed: 1,
        verdicts: [
          {
            method: "POST",
            path: "/webhooks",
            severity: "high",
            summary: "fields=[url] · HIGH=1 LOW=0",
            detectedFields: [{ field: "url", class: "ssrf" }],
            findings: [
              {
                field: "url",
                class: "ssrf",
                payload: "http://127.0.0.1",
                status: 500,
                echoed: false,
                severity: "high",
                reason: "5xx unhandled",
              },
            ],
          },
        ],
        warnings: [],
      },
      "spec.json",
    );
    expect(md).toContain("# zond probe-security digest");
    expect(md).toContain("HIGH");
    expect(md).toContain("POST /webhooks");
  });
});

describe("emitSecurityRegressionSuites", () => {
  it("emits suite with attack steps + cleanup for OK verdict", () => {
    const epPost = ep({ method: "POST", path: "/webhooks", requestBodySchema: webhookSchema });
    const epDel = ep({
      method: "DELETE",
      path: "/webhooks/{id}",
      requestBodySchema: undefined,
      requestBodyContentType: undefined,
    });
    const suites = emitSecurityRegressionSuites(
      {
        classes: ["ssrf"],
        totalEndpoints: 1,
        specProbed: 1,
        verdicts: [
          {
            method: "POST",
            path: "/webhooks",
            severity: "ok",
            summary: "fields=[url] · OK=1",
            detectedFields: [{ field: "url", class: "ssrf" }],
            findings: [
              {
                field: "url",
                class: "ssrf",
                payload: "http://127.0.0.1",
                status: 422,
                echoed: false,
                severity: "ok",
                reason: "rejected",
              },
            ],
          },
        ],
        warnings: [],
      },
      [epPost, epDel],
      [],
    );
    expect(suites).toHaveLength(1);
    expect(suites[0]!.tests.length).toBeGreaterThan(0);
    const lastTest = suites[0]!.tests[suites[0]!.tests.length - 1]! as any;
    expect(lastTest.always).toBe(true);
    expect(lastTest.DELETE).toContain("/webhooks/");
  });
});
