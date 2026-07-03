import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { runSecurityProbes } from "../../../src/core/probe/security-probe.ts";
import { postEp as ep } from "../../_helpers/endpoints";
import type { OpenAPIV3 } from "openapi-types";

// ARV-161 (round-08 F18): security probe must walk form-encoded request
// bodies the same way mass-assignment does (ARV-150). Stripe v1 declares
// user-controlled URL fields (return_url, webhook url) only on
// application/x-www-form-urlencoded — the previous JSON-only gate hid 78+
// POSTs from SSRF/CRLF/open-redirect probing.

const bodyWithUrl: OpenAPIV3.SchemaObject = {
  type: "object",
  required: ["return_url"],
  properties: {
    return_url: { type: "string", format: "uri", example: "https://example.com" },
    description: { type: "string", example: "alice" },
  },
};

const calls: { url: string; method: string; ct: string; body: string }[] = [];
let originalFetch: typeof fetch;

beforeEach(() => {
  calls.length = 0;
  originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | Request | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const method = (init?.method ?? "GET").toUpperCase();
    const ct = ((init?.headers as Record<string, string> | undefined)?.["content-type"]
      ?? (init?.headers as Record<string, string> | undefined)?.["Content-Type"]
      ?? "");
    const body = typeof init?.body === "string" ? init.body : "";
    calls.push({ url, method, ct, body });
    return new Response(JSON.stringify({ id: "x" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("ARV-161: security probe + form-encoded body", () => {
  it("probes form-urlencoded POSTs (not 'no JSON request body')", async () => {
    const formEp = ep({
      method: "POST",
      path: "/v1/payment_links/{id}/capture",
      requestBodyContentType: "application/x-www-form-urlencoded",
      requestBodySchema: bodyWithUrl,
      responses: [{ statusCode: 200, description: "ok" }],
    });
    const result = await runSecurityProbes({
      endpoints: [formEp],
      securitySchemes: [],
      vars: { base_url: "https://api.test", id: "pl_1" },
      classes: ["ssrf"],
      noCleanup: true,
    });
    const v = result.verdicts[0]!;
    expect(v.skipReason ?? "").not.toMatch(/no JSON/);
    // At least one outbound request must have x-www-form-urlencoded CT.
    const formCalls = calls.filter(c => c.method === "POST" && c.ct.includes("x-www-form-urlencoded"));
    expect(formCalls.length).toBeGreaterThan(0);
    // The attack body should carry the `return_url` field with an SSRF
    // payload in URL-encoded form (the key appears verbatim in form bodies).
    const haveReturnUrl = formCalls.some(c => c.body.includes("return_url="));
    expect(haveReturnUrl).toBe(true);
  });

  // ARV-313: the dry-run PLANNER (not just the live orchestrator) must also
  // accept form-encoded bodies. It used hasJsonBody → planned 0/291 on Stripe
  // while mass-assignment planned 290/291.
  it("dry-run plans form-urlencoded POSTs (not skip_reason 'no-body')", async () => {
    const { SecurityProbe } = await import("../../../src/core/probe/security-probe-class.ts");
    const formEp = ep({
      method: "POST",
      path: "/v1/payment_links/{id}/capture",
      requestBodyContentType: "application/x-www-form-urlencoded",
      requestBodySchema: bodyWithUrl,
      responses: [{ statusCode: 200, description: "ok" }],
    });
    const plan = await new SecurityProbe().dryRun({
      specPath: "",
      endpoints: [formEp],
      securitySchemes: [],
      vars: { base_url: "https://api.test", id: "pl_1" },
      classes: ["ssrf"],
      options: {},
    } as never);
    const p = plan.find((e) => e.path === "/v1/payment_links/{id}/capture")!;
    expect(p.skip_reason).not.toBe("no-body");
    expect(p.planned).toBe(true);
  });
});
