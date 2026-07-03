/**
 * Small-team value-add checks regression (ARV-256, m-21 pivot).
 *
 * Locks the three new checks that occupy zond's niche — low-config
 * baselines small teams need but Burp only finds after manual setup:
 *
 * - `open_cors_on_sensitive`: detects the dangerous combo of
 *   Allow-Origin: * OR reflected attacker Origin + Allow-Credentials:
 *   true on authenticated endpoints.
 * - `rate_limit_headers_absent`: flags mutating endpoints whose 2xx
 *   responses ship no rate-limit-* / Retry-After headers.
 * - `ignored_auth` (existing): missing-auth-mismatch contract — spec
 *   declares security, server returns 2xx without a token → HIGH.
 *   Already covered in tests/core/checks/ignored-auth*.test.ts;
 *   this file just re-verifies it stays registered in the same
 *   small-team package.
 */
import { describe, expect, it } from "bun:test";
// Side-effect import: trigger built-in check registration.
import "../../../src/core/checks/checks/index.ts";
import { openCorsOnSensitive } from "../../../src/core/checks/checks/open_cors_on_sensitive.ts";
import { rateLimitHeadersAbsent } from "../../../src/core/checks/checks/rate_limit_headers_absent.ts";
import { listChecks } from "../../../src/core/checks/registry.ts";
import { listStatefulChecks } from "../../../src/core/checks/stateful.ts";
import { categoryFor } from "../../../src/core/severity/category.ts";

describe("open_cors_on_sensitive (ARV-256)", () => {
  const fakeHarness = (response: { status: number; headers: Record<string, string>; body?: string }) => ({
    baseUrl: "https://api.test",
    authHeaders: { Authorization: "Bearer real-token" },
    pathVars: {},
    bootstrapCleanupFailed: false,
    send: async () => ({
      status: response.status,
      headers: response.headers,
      body: response.body ?? "",
      body_parsed: undefined,
      duration_ms: 1,
      network_retry_count: 0,
    }),
    options: undefined,
  });

  const ep = () => ({
    path: "/private/me",
    method: "GET",
    operationId: "getMe",
    parameters: [],
    security: [{ bearerAuth: [] }],
    tags: [],
    responses: [{ statusCode: 200, schema: undefined }],
    extensions: {},
  } as unknown as Parameters<typeof openCorsOnSensitive.run>[0]);

  // ARV-316: HIGH also requires an ambient (cookie) credential — the
  // Set-Cookie here supplies it. Without one, bearer/token auth caps at LOW.
  it("HIGH on Allow-Origin: * + Allow-Credentials: true (cookie auth)", async () => {
    const h = fakeHarness({
      status: 200,
      headers: {
        "access-control-allow-origin": "*",
        "access-control-allow-credentials": "true",
        "set-cookie": "session=abc; HttpOnly",
      },
    });
    const outcome = await openCorsOnSensitive.run(ep(), h as never);
    expect(outcome.kind).toBe("fail");
    if (outcome.kind === "fail") {
      expect(outcome.severity).toBe("high");
      expect(outcome.message).toMatch(/wildcard|cross-origin/i);
      expect(outcome.evidence?.variant).toBe("wildcard+credentials");
    }
  });

  it("HIGH when server reflects attacker Origin + Allow-Credentials: true (cookie auth)", async () => {
    const h = fakeHarness({
      status: 200,
      headers: {
        "access-control-allow-origin": "https://evil.zond.test",
        "access-control-allow-credentials": "true",
        "set-cookie": "session=abc; HttpOnly",
      },
    });
    const outcome = await openCorsOnSensitive.run(ep(), h as never);
    expect(outcome.kind).toBe("fail");
    if (outcome.kind === "fail") {
      expect(outcome.severity).toBe("high");
      expect(outcome.evidence?.variant).toBe("reflected+credentials");
    }
  });

  it("ARV-316: LOW (not HIGH) on bearer/token auth 2xx — no ambient cookie", async () => {
    const h = fakeHarness({
      status: 200,
      headers: {
        "access-control-allow-origin": "https://evil.zond.test",
        "access-control-allow-credentials": "true",
        // no Set-Cookie → bearer/header auth, reflection not exploitable
      },
    });
    const outcome = await openCorsOnSensitive.run(ep(), h as never);
    expect(outcome.kind).toBe("fail");
    if (outcome.kind === "fail") {
      expect(outcome.severity).toBe("low");
      expect(outcome.evidence?.ambient_credential).toBe(false);
      expect(outcome.message).toMatch(/exploitable|ambient/);
    }
  });

  it("PASS when Allow-Origin pinned to a specific safe origin", async () => {
    const h = fakeHarness({
      status: 200,
      headers: {
        "access-control-allow-origin": "https://app.example.com",
        "access-control-allow-credentials": "true",
      },
    });
    const outcome = await openCorsOnSensitive.run(ep(), h as never);
    expect(outcome.kind).toBe("pass");
  });

  it("SKIP when server emits no CORS headers (not cross-origin enabled)", async () => {
    const h = fakeHarness({
      status: 200,
      headers: {},
    });
    const outcome = await openCorsOnSensitive.run(ep(), h as never);
    expect(outcome.kind).toBe("skip");
  });

  it("does NOT apply to public endpoints (security: [])", () => {
    const publicOp = { ...ep(), security: [] };
    expect(openCorsOnSensitive.applies(publicOp)).toBe(false);
  });

  // ARV-312: HIGH requires a 2xx response (authed data actually exposed).
  // On the Stripe live scan every finding fired on a 401-gated response
  // that still reflected the Origin — 261 phantom HIGHs. Cap those at LOW
  // and record the real status so `response_summary.status` isn't a
  // phantom 0.
  it("HIGH carries the real 2xx status via responseStatus", async () => {
    const h = fakeHarness({
      status: 200,
      headers: {
        "access-control-allow-origin": "https://evil.zond.test",
        "access-control-allow-credentials": "true",
        "set-cookie": "session=abc; HttpOnly",
      },
    });
    const outcome = await openCorsOnSensitive.run(ep(), h as never);
    expect(outcome.kind).toBe("fail");
    if (outcome.kind === "fail") {
      expect(outcome.severity).toBe("high");
      expect(outcome.responseStatus).toBe(200);
      expect(outcome.evidence?.response_status).toBe(200);
    }
  });

  it("ARV-312: LOW (not HIGH) when reflection is on a 401 — no authed data exposed", async () => {
    const h = fakeHarness({
      status: 401,
      headers: {
        "access-control-allow-origin": "https://evil.zond.test",
        "access-control-allow-credentials": "true",
      },
    });
    const outcome = await openCorsOnSensitive.run(ep(), h as never);
    expect(outcome.kind).toBe("fail");
    if (outcome.kind === "fail") {
      expect(outcome.severity).toBe("low");
      expect(outcome.responseStatus).toBe(401);
      expect(outcome.message).toMatch(/unproven/);
    }
  });

  it("ARV-312: wildcard+credentials on 500 also caps at LOW", async () => {
    const h = fakeHarness({
      status: 500,
      headers: {
        "access-control-allow-origin": "*",
        "access-control-allow-credentials": "true",
      },
    });
    const outcome = await openCorsOnSensitive.run(ep(), h as never);
    expect(outcome.kind).toBe("fail");
    if (outcome.kind === "fail") {
      expect(outcome.severity).toBe("low");
      expect(outcome.evidence?.variant).toBe("wildcard+credentials");
    }
  });
});

describe("rate_limit_headers_absent (ARV-256)", () => {
  const ep = (method: string, security: unknown[] = [{ bearerAuth: [] }]) => ({
    path: "/widgets",
    method,
    operationId: "createWidget",
    parameters: [],
    security,
    tags: [],
    responses: [],
    extensions: {},
  } as unknown as Parameters<typeof rateLimitHeadersAbsent.run>[0]["case"]["operation"]);

  const ctx = (op: ReturnType<typeof ep>, response: { status: number; headers: Record<string, string> }) => ({
    case: { operation: op, body: {}, requestHeaders: {} },
    response: { ...response, body: "", body_parsed: undefined },
    doc: undefined,
  } as unknown as Parameters<typeof rateLimitHeadersAbsent.run>[0]);

  it("applies to POST/PUT/PATCH/DELETE on authenticated endpoints", () => {
    expect(rateLimitHeadersAbsent.applies(ep("POST") as never)).toBe(true);
    expect(rateLimitHeadersAbsent.applies(ep("PUT") as never)).toBe(true);
    expect(rateLimitHeadersAbsent.applies(ep("PATCH") as never)).toBe(true);
    expect(rateLimitHeadersAbsent.applies(ep("DELETE") as never)).toBe(true);
  });

  it("does NOT apply to GET / read-only endpoints", () => {
    expect(rateLimitHeadersAbsent.applies(ep("GET") as never)).toBe(false);
    expect(rateLimitHeadersAbsent.applies(ep("HEAD") as never)).toBe(false);
  });

  it("does NOT apply to public endpoints (security: [])", () => {
    expect(rateLimitHeadersAbsent.applies(ep("POST", []) as never)).toBe(false);
  });

  it("FAIL when 2xx response carries no rate-limit-* / Retry-After header", () => {
    const out = rateLimitHeadersAbsent.run(ctx(ep("POST") as never, { status: 201, headers: {} }));
    expect(out.kind).toBe("fail");
  });

  it("PASS when response advertises X-RateLimit-Remaining", () => {
    const out = rateLimitHeadersAbsent.run(
      ctx(ep("POST") as never, { status: 201, headers: { "x-ratelimit-remaining": "99" } }),
    );
    expect(out.kind).toBe("pass");
  });

  it("PASS when response advertises RateLimit-* (RFC 9239)", () => {
    const out = rateLimitHeadersAbsent.run(
      ctx(ep("POST") as never, { status: 201, headers: { "ratelimit-limit": "100" } }),
    );
    expect(out.kind).toBe("pass");
  });

  it("PASS when response advertises Retry-After", () => {
    const out = rateLimitHeadersAbsent.run(
      ctx(ep("POST") as never, { status: 201, headers: { "retry-after": "60" } }),
    );
    expect(out.kind).toBe("pass");
  });

  it("SKIP on non-2xx — rate-limit metadata is meaningful only on success", () => {
    const out = rateLimitHeadersAbsent.run(ctx(ep("POST") as never, { status: 422, headers: {} }));
    expect(out.kind).toBe("skip");
  });
});

describe("small-team checks: registration + categorization (ARV-256)", () => {
  it("both new checks are registered in the global check registry", () => {
    const ids = new Set([...listChecks(), ...listStatefulChecks()].map((c) => c.id));
    expect(ids.has("open_cors_on_sensitive")).toBe(true);
    expect(ids.has("rate_limit_headers_absent")).toBe(true);
  });

  it("ignored_auth is still registered (AC#3 reuse — missing-auth-mismatch already covered)", () => {
    const ids = new Set([...listChecks(), ...listStatefulChecks()].map((c) => c.id));
    expect(ids.has("ignored_auth")).toBe(true);
  });

  it("open_cors_on_sensitive → security category", () => {
    expect(categoryFor("open_cors_on_sensitive")).toBe("security");
  });

  it("rate_limit_headers_absent → reliability category", () => {
    expect(categoryFor("rate_limit_headers_absent")).toBe("reliability");
  });
});
