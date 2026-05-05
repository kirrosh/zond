import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import {
  detectFields,
  runSecurityProbes,
  formatSecurityDigest,
  emitSecurityRegressionSuites,
} from "../../../src/core/probe/security-probe.ts";
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
