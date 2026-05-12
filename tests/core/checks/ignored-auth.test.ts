/**
 * Table-driven unit tests for `ignored_auth` (m-15 ARV-3 AC #3).
 * Drives the check directly with a stubbed harness so each row exercises
 * a [scheme, baseline, no_auth, bogus, expected] tuple deterministically.
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
  flags: { bootstrapCleanupFailed?: boolean } = {},
): StatefulHarness {
  let call = 0;
  return {
    baseUrl: "http://test",
    doc: { openapi: "3.0.0", info: { title: "t", version: "1" }, paths: {} } as OpenAPIV3.Document,
    authHeaders,
    bootstrapCleanupFailed: flags.bootstrapCleanupFailed ?? false,
    async send(_req: HttpRequest): Promise<HttpResponse> {
      const seq = ["baseline", "no_auth", "bogus"] as const;
      const which = seq[call++]!;
      const status = responses[which];
      return { status, headers: {}, body: "", duration_ms: 1 };
    },
  };
}

describe("ignored_auth — table-driven (ARV-3 AC #3)", () => {
  type Row = {
    label: string;
    scheme: "bearer" | "apiKey" | "basic";
    headers: Record<string, string>;
    responses: StubResponses;
    expected: "pass" | "fail" | "skip";
    failVariant?: "no_auth" | "bogus_auth";
  };

  const rows: Row[] = [
    {
      label: "Bearer scheme — server enforces auth correctly",
      scheme: "bearer",
      headers: { Authorization: "Bearer real" },
      responses: { baseline: 200, no_auth: 401, bogus: 401 },
      expected: "pass",
    },
    {
      label: "Bearer scheme — server lets no-auth through (200)",
      scheme: "bearer",
      headers: { Authorization: "Bearer real" },
      responses: { baseline: 200, no_auth: 200, bogus: 401 },
      expected: "fail",
      failVariant: "no_auth",
    },
    {
      label: "Bearer scheme — server accepts bogus token",
      scheme: "bearer",
      headers: { Authorization: "Bearer real" },
      responses: { baseline: 200, no_auth: 401, bogus: 200 },
      expected: "fail",
      failVariant: "bogus_auth",
    },
    {
      label: "apiKey header — server lets bogus through",
      scheme: "apiKey",
      headers: { "X-API-Key": "real-key" },
      responses: { baseline: 201, no_auth: 401, bogus: 201 },
      expected: "fail",
      failVariant: "bogus_auth",
    },
    {
      label: "broken-baseline guard — baseline 401 → skip",
      scheme: "bearer",
      headers: { Authorization: "Bearer real" },
      responses: { baseline: 401, no_auth: 200, bogus: 200 },
      expected: "skip",
    },
    {
      label: "broken-baseline guard — baseline 503 → skip",
      scheme: "bearer",
      headers: { Authorization: "Bearer real" },
      responses: { baseline: 503, no_auth: 200, bogus: 200 },
      expected: "skip",
    },
    {
      label: "Basic scheme — proper enforcement passes",
      scheme: "basic",
      headers: { Authorization: "Basic dXNlcjpwYXNz" },
      responses: { baseline: 200, no_auth: 401, bogus: 401 },
      expected: "pass",
    },
  ];

  for (const row of rows) {
    test(row.label, async () => {
      const op = makeOp();
      const h = stubHarness(row.headers, row.responses);
      const outcome = await ignoredAuth.run(op, h);
      expect(outcome.kind).toBe(row.expected);
      if (row.expected === "fail" && row.failVariant && outcome.kind === "fail") {
        expect(outcome.evidence?.variant).toBe(row.failVariant);
      }
    });
  }

  test("applies — security:[] override means skip the op (AC #1)", () => {
    const op = makeOp({ security: [] });
    expect(ignoredAuth.applies(op)).toBe(false);
  });

  test("applies — security required means run the check", () => {
    const op = makeOp({ security: ["bearer"] });
    expect(ignoredAuth.applies(op)).toBe(true);
  });

  test("bootstrap-cleanup-failed flag triggers skip with warning (AC #6)", async () => {
    const h = stubHarness({ Authorization: "Bearer real" }, { baseline: 200, no_auth: 401, bogus: 401 }, {
      bootstrapCleanupFailed: true,
    });
    const outcome = await ignoredAuth.run(makeOp(), h);
    expect(outcome.kind).toBe("skip");
    if (outcome.kind === "skip") expect(outcome.reason).toMatch(/bootstrap-cleanup/);
  });

  test("no auth headers in harness → skip (caller didn't pass --auth-header)", async () => {
    const h = stubHarness({}, { baseline: 200, no_auth: 401, bogus: 401 });
    const outcome = await ignoredAuth.run(makeOp(), h);
    expect(outcome.kind).toBe("skip");
  });
});
