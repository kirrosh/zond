/**
 * ARV-284: per-finding severity matrix for negative_data_rejection.
 *
 * Locks the proof-cap baseline:
 *   - concrete schema breach → MEDIUM (maxLength+1, pattern, format)
 *   - additionalProperties   → LOW (vendor by-design forward-compat)
 *   - wrong-type query on GET → LOW (vendor "invalid id → empty list")
 *   - drop-required-query    → MEDIUM (declared-required silently optional)
 */
import { describe, expect, it } from "bun:test";
import { negativeDataRejection } from "../../../src/core/checks/checks/negative_data_rejection.ts";
import type { CheckCase, CheckResponse } from "../../../src/core/checks/types.ts";
import type { EndpointInfo } from "../../../src/core/generator/types.ts";

const POST_OP: EndpointInfo = {
  path: "/v1/things",
  method: "POST",
  operationId: "CreateThing",
  parameters: [],
  requestBodySchema: { type: "object" } as never,
  tags: [],
  responseContentTypes: [],
  responses: [],
  security: [],
};

const GET_OP: EndpointInfo = {
  path: "/v1/things",
  method: "GET",
  operationId: "ListThings",
  parameters: [],
  tags: [],
  responseContentTypes: [],
  responses: [],
  security: [],
};

function buildCase(op: EndpointInfo, meta: Record<string, unknown>): CheckCase {
  return {
    operation: op,
    request: { method: op.method, url: "http://x", headers: {} },
    mode: "negative",
    kind: "negative_data",
    meta,
  };
}

function buildResp(status: number): CheckResponse {
  return { status, headers: {}, body: {}, duration_ms: 10 };
}

describe("negative_data_rejection — severity matrix", () => {
  it("declared severity is LOW (proof-cap baseline)", () => {
    expect(negativeDataRejection.severity).toBe("low");
  });

  it("5xx response is not_a_server_error territory — passes here", () => {
    // Avoids double-counting: not_a_server_error owns the 5xx signal,
    // negative_data_rejection treats 5xx as non-silent accept (pass).
    const outcome = negativeDataRejection.run({
      case: buildCase(POST_OP, { mutation: "boundary", boundary: "maxLength+1" }),
      response: buildResp(500),
    } as never);
    expect(outcome.kind).toBe("pass");
  });

  it("additionalProperties-violation → LOW (vendor by-design)", () => {
    const outcome = negativeDataRejection.run({
      case: buildCase(POST_OP, {
        mutation: "boundary",
        boundary: "additionalProperties-violation",
      }),
      response: buildResp(200),
    } as never);
    if (outcome.kind !== "fail") throw new Error("expected fail");
    expect(outcome.severity).toBe("low");
  });

  it("maxLength+1 accepted → MEDIUM (concrete schema breach)", () => {
    const outcome = negativeDataRejection.run({
      case: buildCase(POST_OP, { mutation: "boundary", boundary: "maxLength+1" }),
      response: buildResp(200),
    } as never);
    if (outcome.kind !== "fail") throw new Error("expected fail");
    expect(outcome.severity).toBe("medium");
  });

  it("pattern-violation accepted → MEDIUM", () => {
    const outcome = negativeDataRejection.run({
      case: buildCase(POST_OP, {
        mutation: "boundary",
        boundary: "pattern-violation",
      }),
      response: buildResp(200),
    } as never);
    if (outcome.kind !== "fail") throw new Error("expected fail");
    expect(outcome.severity).toBe("medium");
  });

  it("uuid-invalid accepted → MEDIUM (format breach)", () => {
    const outcome = negativeDataRejection.run({
      case: buildCase(POST_OP, { mutation: "boundary", boundary: "uuid-invalid" }),
      response: buildResp(200),
    } as never);
    if (outcome.kind !== "fail") throw new Error("expected fail");
    expect(outcome.severity).toBe("medium");
  });

  it("drop-required:field accepted → MEDIUM (declared-required silently optional)", () => {
    const outcome = negativeDataRejection.run({
      case: buildCase(POST_OP, {
        mutation: "boundary",
        boundary: "drop-required:name",
      }),
      response: buildResp(200),
    } as never);
    if (outcome.kind !== "fail") throw new Error("expected fail");
    expect(outcome.severity).toBe("medium");
  });

  it("wrong-type query on GET → SKIP (ARV-345: documented leniency, not a gap)", () => {
    const outcome = negativeDataRejection.run({
      case: buildCase(GET_OP, {
        mutation: "param-boundary",
        param_scenario: "wrong-type",
        param_location: "query",
      }),
      response: buildResp(200),
    } as never);
    // Was a LOW finding; now scoped off — an unknown/wrong-type query param a
    // GET tolerates (2xx) is vendor "invalid id → empty list" leniency.
    expect(outcome.kind).toBe("skip");
  });

  it("wrong-type query on POST → MEDIUM (no vendor empty-list convention)", () => {
    const outcome = negativeDataRejection.run({
      case: buildCase(POST_OP, {
        mutation: "param-boundary",
        param_scenario: "wrong-type",
        param_location: "query",
      }),
      response: buildResp(200),
    } as never);
    if (outcome.kind !== "fail") throw new Error("expected fail");
    expect(outcome.severity).toBe("medium");
  });

  it("ARV-345: body-boundary mutation on GET → SKIP (no request-body semantics)", () => {
    const outcome = negativeDataRejection.run({
      case: buildCase(GET_OP, { mutation: "boundary", boundary: "maxLength+1" }),
      response: buildResp(200),
    } as never);
    expect(outcome.kind).toBe("skip");
  });

  it("drop-required-query on GET stays in scope → MEDIUM (contract gap, not skipped)", () => {
    const outcome = negativeDataRejection.run({
      case: buildCase(GET_OP, {
        mutation: "param-boundary",
        param_scenario: "drop-required-query",
        param_location: "query",
      }),
      response: buildResp(200),
    } as never);
    if (outcome.kind !== "fail") throw new Error("expected fail");
    expect(outcome.severity).toBe("medium");
  });

  it("drop-required-query accepted → MEDIUM (contract gap)", () => {
    const outcome = negativeDataRejection.run({
      case: buildCase(GET_OP, {
        mutation: "param-boundary",
        param_scenario: "drop-required-query",
        param_location: "query",
      }),
      response: buildResp(200),
    } as never);
    if (outcome.kind !== "fail") throw new Error("expected fail");
    expect(outcome.severity).toBe("medium");
  });

  it("unknown mutation kind → LOW fallback", () => {
    const outcome = negativeDataRejection.run({
      case: buildCase(POST_OP, { mutation: "some-future-mutation" }),
      response: buildResp(200),
    } as never);
    if (outcome.kind !== "fail") throw new Error("expected fail");
    expect(outcome.severity).toBe("low");
  });
});
