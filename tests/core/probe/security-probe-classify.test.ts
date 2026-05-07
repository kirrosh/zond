import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import {
  detectFields,
  runSecurityProbes,
  formatSecurityDigest,
  emitSecurityRegressionSuites,
} from "../../../src/core/probe/security-probe.ts";
import type { OpenAPIV3 } from "openapi-types";
import { postEp as ep } from "../../_helpers/endpoints";
import { fetchHarness } from "./_helpers/state-machine";

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
    const hits = detectFields(ep({ requestBodySchema: webhookSchema }), ["ssrf"]);
    expect(hits).toEqual([{ field: "url", class: "ssrf" }]);
  });

  it("detects CRLF candidates by header-bearing field names", () => {
    const hits = detectFields(ep({ requestBodySchema: emailSchema }), ["crlf"]);
    const fields = hits.map(h => h.field);
    expect(fields).toContain("subject");
  });

  it("detects open-redirect by redirect-shaped field names", () => {
    const hits = detectFields(ep({ requestBodySchema: redirectSchema }), ["open-redirect"]);
    expect(hits).toEqual([{ field: "redirect", class: "open-redirect" }]);
  });

  it("ignores enum-bounded fields", () => {
    const enumSchema: OpenAPIV3.SchemaObject = {
      type: "object",
      properties: { url: { type: "string", enum: ["a", "b"] } },
    };
    const hits = detectFields(ep({ requestBodySchema: enumSchema }), ["ssrf"]);
    expect(hits).toEqual([]);
  });
});

const harness = fetchHarness();
beforeEach(() => harness.install());
afterEach(() => harness.restore());

describe("runSecurityProbes — happy path", () => {
  it("baseline 4xx → INCONCLUSIVE-BASELINE, no attacks sent", async () => {
    harness.setResponder(() => ({ status: 404, body: { error: "not found" } }));
    const result = await runSecurityProbes({
      endpoints: [ep({ method: "POST", path: "/webhooks", requestBodySchema: webhookSchema })],
      securitySchemes: [],
      vars: { base_url: "https://api.test" },
      classes: ["ssrf"],
    });
    const v = result.verdicts[0]!;
    expect(v.severity).toBe("inconclusive-baseline");
    expect(v.findings).toHaveLength(0);
    const posts = harness.calls.filter(c => c.method === "POST");
    expect(posts).toHaveLength(1);
  });

  it("classifies HIGH when payload is echoed in 2xx response (stored injection)", async () => {
    harness.setResponder((req) => {
      if (req.method === "DELETE") return { status: 204 };
      const body = req.body as Record<string, unknown> | undefined;
      const subject = body?.subject;
      return { status: 201, body: { id: "msg_1", subject } };
    });
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
    harness.setResponder((req) => {
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
    });
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
    expect(harness.calls).toHaveLength(0);
    const v = result.verdicts[0]!;
    expect(v.severity).toBe("skipped");
    expect(v.detectedFields[0]!.field).toBe("url");
    expect(v.summary).toContain("dry-run");
  });

  it("open-redirect: end-to-end run classifies HIGH when redirect payload is echoed", async () => {
    harness.setResponder((req) => {
      if (req.method === "DELETE") return { status: 204 };
      const body = req.body as Record<string, unknown> | undefined;
      const redirect = body?.redirect;
      // Echo back — typical stored open-redirect surface.
      return { status: 201, body: { id: "r_1", redirect } };
    });
    const result = await runSecurityProbes({
      endpoints: [ep({ method: "POST", path: "/r", requestBodySchema: redirectSchema })],
      securitySchemes: [],
      vars: { base_url: "https://api.test" },
      classes: ["open-redirect"],
    });
    const v = result.verdicts[0]!;
    expect(v.severity).toBe("high");
    expect(v.detectedFields[0]!.class).toBe("open-redirect");
  });

  it("open-redirect: rejected payload (4xx) classifies as OK", async () => {
    harness.setResponder((req) => {
      if (req.method === "DELETE") return { status: 204 };
      const body = req.body as Record<string, unknown> | undefined;
      const r = typeof body?.redirect === "string" ? body.redirect : "";
      // Reject any external redirect target.
      const looksLikeAttack = /\/\/|^https?:|javascript:/i.test(r);
      if (looksLikeAttack && !r.startsWith("https://api.test")) {
        return { status: 422, body: { error: "redirect target not allowed" } };
      }
      return { status: 201, body: { id: "r_1", redirect: r } };
    });
    const result = await runSecurityProbes({
      endpoints: [ep({ method: "POST", path: "/r", requestBodySchema: redirectSchema })],
      securitySchemes: [],
      vars: { base_url: "https://api.test" },
      classes: ["open-redirect"],
    });
    expect(result.verdicts[0]!.severity).toBe("ok");
  });

  it("inconclusive-baseline rollup: severity bubbles up when baseline 4xx blocks every attack", async () => {
    harness.setResponder(() => ({ status: 422, body: { error: "baseline locked" } }));
    const result = await runSecurityProbes({
      endpoints: [
        ep({ method: "POST", path: "/a", requestBodySchema: webhookSchema }),
        ep({ method: "POST", path: "/b", requestBodySchema: redirectSchema }),
      ],
      securitySchemes: [],
      vars: { base_url: "https://api.test" },
      classes: ["ssrf", "open-redirect"],
    });
    expect(result.verdicts).toHaveLength(2);
    expect(result.verdicts.every(v => v.severity === "inconclusive-baseline")).toBe(true);
  });

  it("multi-class: runs ssrf + crlf in one invocation and produces classified verdicts", async () => {
    harness.setResponder((req) => {
      if (req.method === "DELETE") return { status: 204 };
      const body = req.body as Record<string, unknown> | undefined;
      const url = typeof body?.url === "string" ? body.url : "";
      const isSsrf = url.includes("127.0.0.1") || url.startsWith("file:") || url.includes("169.254");
      if (isSsrf) return { status: 422, body: { error: "url not allowed" } };
      return { status: 201, body: { id: "x", subject: body?.subject } };
    });
    const result = await runSecurityProbes({
      endpoints: [
        ep({ method: "POST", path: "/webhooks", requestBodySchema: webhookSchema }),
        ep({ method: "POST", path: "/messages", requestBodySchema: emailSchema }),
      ],
      securitySchemes: [],
      vars: { base_url: "https://api.test" },
      classes: ["ssrf", "crlf"],
    });
    expect(result.verdicts).toHaveLength(2);
    const hooks = result.verdicts.find(v => v.path === "/webhooks")!;
    const msgs = result.verdicts.find(v => v.path === "/messages")!;
    expect(hooks.severity).toBe("ok");
    // /messages echoes back subject → HIGH on CRLF.
    expect(msgs.severity).toBe("high");
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
    expect(harness.calls).toHaveLength(0);
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

describe("formatSecurityDigest — per-severity sections", () => {
  it("renders LOW + inconclusive + skipped sections together", () => {
    const md = formatSecurityDigest(
      {
        classes: ["ssrf", "crlf"],
        totalEndpoints: 3,
        specProbed: 3,
        verdicts: [
          {
            method: "POST",
            path: "/echo",
            severity: "low",
            summary: "fields=[url] · LOW=1",
            detectedFields: [{ field: "url", class: "ssrf" }],
            findings: [
              {
                field: "url",
                class: "ssrf",
                payload: "http://169.254.169.254/latest",
                status: 200,
                echoed: true,
                severity: "low",
                reason: "echoed-but-not-fetched",
              },
            ],
          },
          {
            method: "POST",
            path: "/locked",
            severity: "inconclusive-baseline",
            summary: "baseline failed",
            detectedFields: [{ field: "subject", class: "crlf" }],
            findings: [],
          },
          {
            method: "GET",
            path: "/healthz",
            severity: "skipped",
            summary: "no detected fields",
            detectedFields: [],
            findings: [],
          },
        ],
        warnings: [],
      },
      "spec.json",
    );
    expect(md).toContain("LOW");
    expect(md).toMatch(/INCONCLUSIVE/i);
    expect(md).toMatch(/SKIPPED|skipped/);
    // All three endpoint paths surface in the rendered digest.
    expect(md).toContain("/echo");
    expect(md).toContain("/locked");
    expect(md).toContain("/healthz");
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
