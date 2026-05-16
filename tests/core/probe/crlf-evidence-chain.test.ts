/**
 * CRLF evidence-chain regression (ARV-253, m-21 pivot).
 *
 * Locks the four-case severity matrix for the security probe's CRLF
 * class:
 *
 * - Payload reflected in any response header → HIGH (header injection /
 *   response splitting evidence_chain).
 * - Payload reflected in text/html response body → HIGH (XSS-adjacent
 *   evidence_chain).
 * - Payload echoed in JSON body only → LOW (storage signal, no exploit
 *   pathway proven).
 * - Payload accepted (2xx) but no echo anywhere → INFO (sanitization
 *   missing, but no impact evidence).
 */
import { describe, expect, it, afterAll } from "bun:test";
import { runSecurityProbes } from "../../../src/core/probe/security-probe.ts";
import { postEp } from "../../_helpers/endpoints";

const emailSchema = {
  type: "object" as const,
  required: ["subject"],
  properties: {
    subject: { type: "string" as const },
    to: { type: "string" as const, format: "email" },
  },
};

interface MockResp {
  status: number;
  body?: unknown;
  headers?: Record<string, string>;
}

let responder: (req: { method: string; url: string; body?: Record<string, unknown> }) => MockResp = () => ({ status: 500 });
const original = globalThis.fetch;
globalThis.fetch = (async (input, init) => {
  const url = String(input);
  const method = (init?.method ?? "GET").toUpperCase();
  let body: Record<string, unknown> | undefined;
  if (init?.body) {
    try { body = JSON.parse(String(init.body)); } catch { /* ignore */ }
  }
  const r = responder({ url, method, body });
  const headers = new Headers({ "content-type": "application/json", ...(r.headers ?? {}) });
  const text = r.body === undefined ? "" : typeof r.body === "string" ? r.body : JSON.stringify(r.body);
  return new Response(text, { status: r.status, headers });
}) as typeof fetch;

afterAll(() => { globalThis.fetch = original; });

const eps = () => [postEp({ method: "POST", path: "/messages", requestBodySchema: emailSchema })];
const baseVars = { base_url: "https://api.test" };

describe("CRLF evidence-chain severity (ARV-253)", () => {
  it("HIGH when payload reflects in a response header", async () => {
    responder = (req) => {
      if (req.method === "DELETE") return { status: 204 };
      const subject = String(req.body?.subject ?? "");
      // Smoking gun: server echoes the user-controlled subject back in
      // a custom header. This is response-splitting territory.
      return { status: 201, body: { id: "m1" }, headers: { "x-echo-subject": subject } };
    };
    const result = await runSecurityProbes({
      allowLeaks: true,
      endpoints: eps(),
      securitySchemes: [],
      vars: baseVars,
      classes: ["crlf"],
    });
    const v = result.verdicts[0]!;
    expect(v.severity).toBe("high");
    const high = v.findings.filter((f) => f.severity === "high");
    expect(high.length).toBeGreaterThan(0);
    expect(high[0]!.reason).toMatch(/response header/);
  });

  it("HIGH when payload reflects in text/html response body", async () => {
    responder = (req) => {
      if (req.method === "DELETE") return { status: 204 };
      const subject = String(req.body?.subject ?? "");
      return {
        status: 201,
        body: `<html><body>Subject: ${subject}</body></html>`,
        headers: { "content-type": "text/html; charset=utf-8" },
      };
    };
    const result = await runSecurityProbes({
      allowLeaks: true,
      endpoints: eps(),
      securitySchemes: [],
      vars: baseVars,
      classes: ["crlf"],
    });
    const v = result.verdicts[0]!;
    expect(v.severity).toBe("high");
    const high = v.findings.filter((f) => f.severity === "high");
    expect(high.length).toBeGreaterThan(0);
    expect(high[0]!.reason).toMatch(/text\/html/);
  });

  it("LOW when payload echoes in JSON body only (storage observed, no exploit pathway)", async () => {
    responder = (req) => {
      if (req.method === "DELETE") return { status: 204 };
      const subject = req.body?.subject;
      // JSON body echo only — no header, no HTML reflection.
      return { status: 201, body: { id: "m2", subject } };
    };
    const result = await runSecurityProbes({
      allowLeaks: true,
      endpoints: eps(),
      securitySchemes: [],
      vars: baseVars,
      classes: ["crlf"],
    });
    const v = result.verdicts[0]!;
    expect(v.severity).toBe("low");
    const low = v.findings.filter((f) => f.severity === "low");
    expect(low.length).toBeGreaterThan(0);
    expect(low[0]!.reason).toMatch(/JSON body/);
  });

  it("INFO when payload accepted (2xx) but no echo anywhere", async () => {
    responder = (req) => {
      if (req.method === "DELETE") return { status: 204 };
      // Server accepts but echoes nothing — sanitization may be missing
      // but no impact evidence. INFO under the m-21 matrix.
      return { status: 201, body: { id: "m3" } };
    };
    const result = await runSecurityProbes({
      allowLeaks: true,
      endpoints: eps(),
      securitySchemes: [],
      vars: baseVars,
      classes: ["crlf"],
    });
    const v = result.verdicts[0]!;
    expect(v.severity).toBe("info");
    const info = v.findings.filter((f) => f.severity === "info");
    expect(info.length).toBeGreaterThan(0);
    expect(info[0]!.reason).toMatch(/no reflection observed/);
  });
});
