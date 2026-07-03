/**
 * ARV-286: per-finding severity matrix for `ignored_auth`.
 *
 * Locks the proof-cap baseline (ARV-250) and per-variant dispatch:
 *   - declared severity is 'low' (proof-cap baseline)
 *   - no_auth/bogus_auth bypass (baseline 2xx, stripped 2xx) → HIGH
 *   - *_differential (broken-baseline, lower bucket)           → HIGH
 *   - *_strict (--strict-401 mismatch, no actual bypass)       → MEDIUM
 *
 * Mock harness pattern mirrors tests/core/checks/ignored-auth.test.ts.
 * Follow-up to ARV-284 (negative_data_rejection severity matrix).
 */
import { describe, test, expect } from "bun:test";
import type { OpenAPIV3 } from "openapi-types";

import { ignoredAuth } from "../../../src/core/checks/checks/ignored_auth.ts";
import type { StatefulHarness } from "../../../src/core/checks/stateful.ts";
import type { EndpointInfo } from "../../../src/core/generator/types.ts";
import type { HttpRequest, HttpResponse } from "../../../src/core/runner/types.ts";

function makeOp(over: Partial<EndpointInfo> = {}): EndpointInfo {
  return {
    path: "/secure",
    method: "GET",
    operationId: "secure",
    summary: undefined,
    tags: [],
    parameters: [],
    requestBodySchema: undefined,
    requestBodyContentType: undefined,
    responseContentTypes: ["application/json"],
    responses: [{ statusCode: 200, description: "ok" }],
    security: ["bearer"],
    ...over,
  };
}

interface StubResponses {
  baseline: number;
  no_auth: number;
  bogus: number;
}

function stubHarness(
  authHeaders: Record<string, string>,
  responses: StubResponses,
  flags: { strict401?: boolean } = {},
): StatefulHarness {
  let call = 0;
  return {
    baseUrl: "http://test",
    doc: { openapi: "3.0.0", info: { title: "t", version: "1" }, paths: {} } as OpenAPIV3.Document,
    authHeaders,
    bootstrapCleanupFailed: false,
    options: flags.strict401 ? { strict401: true } : undefined,
    async send(_req: HttpRequest): Promise<HttpResponse> {
      const seq = ["baseline", "no_auth", "bogus"] as const;
      const which = seq[call++]!;
      const status = responses[which];
      return { status, headers: {}, body: "", duration_ms: 1 };
    },
  };
}

const AUTH = { Authorization: "Bearer real" };

describe("ignored_auth — per-finding severity matrix (ARV-286)", () => {
  test("1. declared severity is 'low' (proof-cap baseline, ARV-250)", () => {
    expect(ignoredAuth.severity).toBe("low");
  });

  test("2. baseline 200, no_auth 200 → fail HIGH (no_auth bypass)", async () => {
    const h = stubHarness(AUTH, { baseline: 200, no_auth: 200, bogus: 401 });
    const outcome = await ignoredAuth.run(makeOp(), h);
    expect(outcome.kind).toBe("fail");
    if (outcome.kind === "fail") {
      expect(outcome.evidence?.variant).toBe("no_auth");
      expect(outcome.severity).toBe("high");
    }
  });

  test("3. baseline 200, bogus 200 → fail HIGH (bogus_auth bypass)", async () => {
    const h = stubHarness(AUTH, { baseline: 200, no_auth: 401, bogus: 200 });
    const outcome = await ignoredAuth.run(makeOp(), h);
    expect(outcome.kind).toBe("fail");
    if (outcome.kind === "fail") {
      expect(outcome.evidence?.variant).toBe("bogus_auth");
      expect(outcome.severity).toBe("high");
    }
  });

  test("4. baseline 403, no_auth 200 → fail HIGH (no_auth_differential — smoking gun bypass)", async () => {
    const h = stubHarness(AUTH, { baseline: 403, no_auth: 200, bogus: 403 });
    const outcome = await ignoredAuth.run(makeOp(), h);
    expect(outcome.kind).toBe("fail");
    if (outcome.kind === "fail") {
      expect(outcome.evidence?.variant).toBe("no_auth_differential");
      expect(outcome.severity).toBe("high");
    }
  });

  test("5. baseline 403, bogus 200 → fail HIGH (bogus_auth_differential)", async () => {
    const h = stubHarness(AUTH, { baseline: 403, no_auth: 403, bogus: 200 });
    const outcome = await ignoredAuth.run(makeOp(), h);
    expect(outcome.kind).toBe("fail");
    if (outcome.kind === "fail") {
      expect(outcome.evidence?.variant).toBe("bogus_auth_differential");
      expect(outcome.severity).toBe("high");
    }
  });

  test("6. baseline 200, no_auth 403, strict401=true → fail MEDIUM (no_auth_strict — conformance, not bypass)", async () => {
    const h = stubHarness(AUTH, { baseline: 200, no_auth: 403, bogus: 401 }, { strict401: true });
    const outcome = await ignoredAuth.run(makeOp(), h);
    expect(outcome.kind).toBe("fail");
    if (outcome.kind === "fail") {
      expect(outcome.evidence?.variant).toBe("no_auth_strict");
      expect(outcome.evidence?.strict_401).toBe(true);
      expect(outcome.severity).toBe("medium");
    }
  });

  test("7. baseline 200, bogus 403, strict401=true → fail MEDIUM (bogus_auth_strict — conformance, not bypass)", async () => {
    const h = stubHarness(AUTH, { baseline: 200, no_auth: 401, bogus: 403 }, { strict401: true });
    const outcome = await ignoredAuth.run(makeOp(), h);
    expect(outcome.kind).toBe("fail");
    if (outcome.kind === "fail") {
      expect(outcome.evidence?.variant).toBe("bogus_auth_strict");
      expect(outcome.evidence?.strict_401).toBe(true);
      expect(outcome.severity).toBe("medium");
    }
  });

  test("8. baseline 200, no_auth 403, no strict → pass (auth enforced, any 4xx ok)", async () => {
    const h = stubHarness(AUTH, { baseline: 200, no_auth: 403, bogus: 401 });
    const outcome = await ignoredAuth.run(makeOp(), h);
    expect(outcome.kind).toBe("pass");
  });

  test("9. baseline 403, no_auth 403, bogus 403 → pass (differential: same bucket, auth consistently enforced)", async () => {
    const h = stubHarness(AUTH, { baseline: 403, no_auth: 403, bogus: 403 });
    const outcome = await ignoredAuth.run(makeOp(), h);
    expect(outcome.kind).toBe("pass");
  });

  test("10. baseline 403, no_auth 403, strict401=true → fail MEDIUM (no_auth_strict in differential path)", async () => {
    const h = stubHarness(AUTH, { baseline: 403, no_auth: 403, bogus: 401 }, { strict401: true });
    const outcome = await ignoredAuth.run(makeOp(), h);
    expect(outcome.kind).toBe("fail");
    if (outcome.kind === "fail") {
      expect(outcome.evidence?.variant).toBe("no_auth_strict");
      expect(outcome.severity).toBe("medium");
    }
  });
});
