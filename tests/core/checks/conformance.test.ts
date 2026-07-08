/**
 * Fixture-based unit tests for the 7 conformance checks (m-15 ARV-2).
 * Each check ships at least 3 cases — ok / fail / edge — per AC #2.
 *
 * Tests construct a synthetic CheckContext directly so they don't go
 * over the network; integration coverage of the pipeline lives in
 * tests/cli/checks/pipeline.test.ts.
 */
import { describe, test, expect } from "bun:test";
import type { OpenAPIV3 } from "openapi-types";

import type { CheckContext, CheckCase, CheckResponse } from "../../../src/core/checks/types.ts";
import type { EndpointInfo } from "../../../src/core/generator/types.ts";
import { createSchemaValidator } from "../../../src/core/runner/schema-validator.ts";

import { notAServerError } from "../../../src/core/checks/checks/not_a_server_error.ts";
import { statusCodeConformance } from "../../../src/core/checks/checks/status_code_conformance.ts";
import { contentTypeConformance } from "../../../src/core/checks/checks/content_type_conformance.ts";
import { responseHeadersConformance } from "../../../src/core/checks/checks/response_headers_conformance.ts";
import { responseSchemaConformance } from "../../../src/core/checks/checks/response_schema_conformance.ts";
import { missingRequiredHeader } from "../../../src/core/checks/checks/missing_required_header.ts";
import { unsupportedMethod } from "../../../src/core/checks/checks/unsupported_method.ts";

function makeEndpoint(over: Partial<EndpointInfo> = {}): EndpointInfo {
  return {
    path: "/widgets",
    method: "GET",
    operationId: "listWidgets",
    summary: undefined,
    tags: [],
    parameters: [],
    requestBodySchema: undefined,
    requestBodyContentType: undefined,
    responseContentTypes: ["application/json"],
    responses: [{ statusCode: 200, description: "ok" }],
    security: [],
    ...over,
  };
}

function makeCase(over: Partial<CheckCase> & { kind?: CheckCase["kind"] } = {}): CheckCase {
  const op = over.operation ?? makeEndpoint();
  return {
    operation: op,
    request: { method: op.method, url: `http://x${op.path}`, headers: {}, body: undefined },
    mode: "positive",
    kind: over.kind ?? "positive",
    ...over,
  };
}

function makeResponse(over: Partial<CheckResponse> = {}): CheckResponse {
  return {
    status: 200,
    headers: { "content-type": "application/json" },
    body: {},
    duration_ms: 1,
    ...over,
  };
}

function ctx(c: CheckCase, r: CheckResponse, doc?: OpenAPIV3.Document): CheckContext {
  return { case: c, response: r, doc, schemaValidator: doc ? createSchemaValidator(doc) : undefined };
}

// ── not_a_server_error ──────────────────────────────────────────────

describe("not_a_server_error", () => {
  test("ok — 200 passes", () => {
    expect(notAServerError.run(ctx(makeCase(), makeResponse({ status: 200 }))).kind).toBe("pass");
  });
  test("fail — 503 fails", () => {
    const r = notAServerError.run(ctx(makeCase(), makeResponse({ status: 503 })));
    expect(r.kind).toBe("fail");
  });
  test("edge — 499 (just below 5xx) passes", () => {
    expect(notAServerError.run(ctx(makeCase(), makeResponse({ status: 499 }))).kind).toBe("pass");
  });
  // ARV-340: the check must be scoped to malformed-input cases too — a
  // 500 from a negative_data mutation is exactly the case that slipped
  // through when this defaulted to positive-only (live Stripe:
  // GET /v1/billing/alerts 500 on a bad query param, zero findings).
  // unsupported_method stays out (501/405 there is legitimate).
  test("ARV-340 — evaluates negative_data + missing_required_header, not unsupported_method", () => {
    expect(notAServerError.caseKinds).toContain("negative_data");
    expect(notAServerError.caseKinds).toContain("missing_required_header");
    expect(notAServerError.caseKinds).toContain("positive");
    expect(notAServerError.caseKinds).not.toContain("unsupported_method");
  });
});

// ── status_code_conformance ─────────────────────────────────────────

const docWith200Only: OpenAPIV3.Document = {
  openapi: "3.0.0",
  info: { title: "t", version: "1" },
  paths: {
    "/widgets": {
      get: { responses: { "200": { description: "ok" } } },
    },
  },
};

const docWithDefault: OpenAPIV3.Document = {
  openapi: "3.0.0",
  info: { title: "t", version: "1" },
  paths: {
    "/widgets": {
      get: { responses: { "200": { description: "ok" }, default: { description: "any" } } },
    },
  },
};

describe("status_code_conformance", () => {
  test("ok — declared 200 passes", () => {
    const r = statusCodeConformance.run(ctx(makeCase(), makeResponse({ status: 200 }), docWith200Only));
    expect(r.kind).toBe("pass");
  });
  test("fail — undeclared 418 fails", () => {
    const r = statusCodeConformance.run(ctx(makeCase(), makeResponse({ status: 418 }), docWith200Only));
    expect(r.kind).toBe("fail");
  });
  test("edge — `default` in spec makes any status pass (ARV-2 AC #6)", () => {
    const r = statusCodeConformance.run(ctx(makeCase(), makeResponse({ status: 599 }), docWithDefault));
    expect(r.kind).toBe("pass");
  });
  // ARV-224: finding message must echo the *request* method, not the
  // operation's declared method — unsupported_method probes fire POST
  // against a GET-only endpoint and the message used to mis-say "for GET".
  test("ARV-224: message uses request method (POST), not declared method (GET)", () => {
    const c = makeCase({
      kind: "unsupported_method",
      request: { method: "POST", url: "http://x/widgets", headers: {}, body: undefined },
    });
    const r = statusCodeConformance.run(ctx(c, makeResponse({ status: 418 }), docWith200Only));
    expect(r.kind).toBe("fail");
    if (r.kind === "fail") {
      expect(r.message).toContain("POST /widgets");
      expect(r.message).not.toContain("GET /widgets");
    }
  });
});

// ── content_type_conformance ────────────────────────────────────────

describe("content_type_conformance", () => {
  test("ok — declared application/json matches", () => {
    const r = contentTypeConformance.run(ctx(makeCase(), makeResponse({
      headers: { "content-type": "application/json; charset=utf-8" },
    })));
    expect(r.kind).toBe("pass");
  });
  test("fail — text/html not declared", () => {
    const r = contentTypeConformance.run(ctx(makeCase(), makeResponse({
      headers: { "content-type": "text/html" },
    })));
    expect(r.kind).toBe("fail");
  });
  test("edge — 204 no body skips content-type check", () => {
    const r = contentTypeConformance.run(ctx(makeCase(), makeResponse({ status: 204, headers: {} })));
    expect(r.kind).toBe("pass");
  });
});

// ── response_headers_conformance ────────────────────────────────────

const docWithHeaders: OpenAPIV3.Document = {
  openapi: "3.0.0",
  info: { title: "t", version: "1" },
  paths: {
    "/widgets": {
      get: {
        responses: {
          "200": {
            description: "ok",
            headers: {
              "X-Total-Count": { required: true, schema: { type: "integer" } },
            },
          },
        },
      },
    },
  },
};

describe("response_headers_conformance", () => {
  test("ok — required header present and integer-shaped", () => {
    const r = responseHeadersConformance.run(ctx(
      makeCase(), makeResponse({ headers: { "x-total-count": "42" } }), docWithHeaders,
    ));
    expect(r.kind).toBe("pass");
  });
  test("fail — required header missing", () => {
    const r = responseHeadersConformance.run(ctx(
      makeCase(), makeResponse({ headers: {} }), docWithHeaders,
    ));
    expect(r.kind).toBe("fail");
  });
  test("edge — endpoint with no declared headers skips", () => {
    const r = responseHeadersConformance.run(ctx(makeCase(), makeResponse(), docWith200Only));
    expect(r.kind).toBe("skip");
  });
});

// ── response_schema_conformance ─────────────────────────────────────

const docWithBodySchema: OpenAPIV3.Document = {
  openapi: "3.0.0",
  info: { title: "t", version: "1" },
  paths: {
    "/widgets": {
      get: {
        responses: {
          "200": {
            description: "ok",
            content: {
              "application/json": {
                schema: { type: "object", required: ["id"], properties: { id: { type: "integer" } } },
              },
            },
          },
        },
      },
    },
  },
};

describe("response_schema_conformance", () => {
  test("ok — body matches schema", () => {
    const r = responseSchemaConformance.run(ctx(
      makeCase(), makeResponse({ body: { id: 7 } }), docWithBodySchema,
    ));
    expect(r.kind).toBe("pass");
  });
  test("fail — required field missing", () => {
    const r = responseSchemaConformance.run(ctx(
      makeCase(), makeResponse({ body: {} }), docWithBodySchema,
    ));
    expect(r.kind).toBe("fail");
  });
  test("edge — branch without schema skips", () => {
    const r = responseSchemaConformance.run(ctx(makeCase(), makeResponse(), docWith200Only));
    expect(r.kind).toBe("skip");
  });
});

// ── missing_required_header ─────────────────────────────────────────

describe("missing_required_header", () => {
  const op = makeEndpoint({
    parameters: [
      { name: "X-API-Key", in: "header", required: true, schema: { type: "string" } } as OpenAPIV3.ParameterObject,
    ],
  });
  test("ok — server rejected with 401", () => {
    const r = missingRequiredHeader.run(ctx(
      makeCase({ operation: op, kind: "missing_required_header", meta: { dropped_header: "X-API-Key" }, mode: "negative" }),
      makeResponse({ status: 401 }),
    ));
    expect(r.kind).toBe("pass");
  });
  test("fail — server accepted with 200", () => {
    const r = missingRequiredHeader.run(ctx(
      makeCase({ operation: op, kind: "missing_required_header", meta: { dropped_header: "X-API-Key" }, mode: "negative" }),
      makeResponse({ status: 200 }),
    ));
    expect(r.kind).toBe("fail");
  });
  test("edge — server 5xx'd is also a finding", () => {
    const r = missingRequiredHeader.run(ctx(
      makeCase({ operation: op, kind: "missing_required_header", meta: { dropped_header: "X-API-Key" }, mode: "negative" }),
      makeResponse({ status: 502 }),
    ));
    expect(r.kind).toBe("fail");
  });
  test("applies — only when op declares a required header", () => {
    expect(missingRequiredHeader.applies(op)).toBe(true);
    expect(missingRequiredHeader.applies(makeEndpoint())).toBe(false);
  });
});

// ── unsupported_method ──────────────────────────────────────────────

describe("unsupported_method", () => {
  test("ok — 405 is acceptable", () => {
    const r = unsupportedMethod.run(ctx(
      makeCase({ kind: "unsupported_method", meta: { undeclared_method: "PATCH" }, mode: "negative" }),
      makeResponse({ status: 405 }),
    ));
    expect(r.kind).toBe("pass");
  });
  test("fail — 200 (silent acceptance) is a finding", () => {
    const r = unsupportedMethod.run(ctx(
      makeCase({ kind: "unsupported_method", meta: { undeclared_method: "PATCH" }, mode: "negative" }),
      makeResponse({ status: 200 }),
    ));
    expect(r.kind).toBe("fail");
  });
  test("edge — 5xx is a finding (unhandled)", () => {
    const r = unsupportedMethod.run(ctx(
      makeCase({ kind: "unsupported_method", meta: { undeclared_method: "PATCH" }, mode: "negative" }),
      makeResponse({ status: 503 }),
    ));
    expect(r.kind).toBe("fail");
  });

  // ARV-179: OPTIONS 2xx is legitimate CORS preflight — must pass even
  // though OPTIONS is itself an "undeclared method" for paths that
  // don't list it. The check ignores OPTIONS-success.
  test("ARV-179 — OPTIONS 200 passes (CORS preflight)", () => {
    const r = unsupportedMethod.run(ctx(
      makeCase({ kind: "unsupported_method", meta: { undeclared_method: "OPTIONS" }, mode: "negative" }),
      makeResponse({ status: 200 }),
    ));
    expect(r.kind).toBe("pass");
  });
  test("ARV-179 — OPTIONS 204 passes (no-body CORS preflight)", () => {
    const r = unsupportedMethod.run(ctx(
      makeCase({ kind: "unsupported_method", meta: { undeclared_method: "OPTIONS" }, mode: "negative" }),
      makeResponse({ status: 204 }),
    ));
    expect(r.kind).toBe("pass");
  });

  // ARV-179 strict-405 mode mirrors schemathesis V4 default policy.
  test("ARV-179 strict-405 — 404 fails (was pass under pragmatic policy)", () => {
    const r = unsupportedMethod.run({
      case: makeCase({ kind: "unsupported_method", meta: { undeclared_method: "PATCH" }, mode: "negative" }),
      response: makeResponse({ status: 404 }),
      options: { strict405: true },
    });
    expect(r.kind).toBe("fail");
  });
  test("ARV-179 strict-405 — 405 still passes", () => {
    const r = unsupportedMethod.run({
      case: makeCase({ kind: "unsupported_method", meta: { undeclared_method: "PATCH" }, mode: "negative" }),
      response: makeResponse({ status: 405 }),
      options: { strict405: true },
    });
    expect(r.kind).toBe("pass");
  });
  test("ARV-179 strict-405 — OPTIONS 200 still passes (anti-FP wins over strictness)", () => {
    const r = unsupportedMethod.run({
      case: makeCase({ kind: "unsupported_method", meta: { undeclared_method: "OPTIONS" }, mode: "negative" }),
      response: makeResponse({ status: 200 }),
      options: { strict405: true },
    });
    expect(r.kind).toBe("pass");
  });
});
