/**
 * ARV-285: per-finding severity matrix for status_code_conformance.
 *
 * Locks the proof-cap baseline:
 *   - 5xx undeclared (no wildcard/default) → HIGH
 *   - 4xx undeclared + other 4xx declared → MEDIUM (partial contract)
 *   - 4xx undeclared + no declared 4xx    → LOW (minimal spec)
 *   - 2xx/3xx undeclared on negative kinds → LOW (secondary signal)
 *   - 2xx/3xx undeclared on positive       → MEDIUM (spec gap)
 */
import { describe, expect, it } from "bun:test";
import type { OpenAPIV3 } from "openapi-types";
import { statusCodeConformance } from "../../../src/core/checks/checks/status_code_conformance.ts";
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

function buildCase(kind: CheckCase["kind"], op: EndpointInfo = POST_OP): CheckCase {
  return {
    operation: op,
    request: { method: op.method, url: "http://x", headers: {} },
    mode: kind === "positive" ? "positive" : "negative",
    kind,
  };
}

function buildResp(status: number): CheckResponse {
  return { status, headers: {}, body: {}, duration_ms: 10 };
}

function makeDoc(responses: Record<string, OpenAPIV3.ResponseObject>): OpenAPIV3.Document {
  return {
    openapi: "3.0.0",
    info: { title: "t", version: "1" },
    paths: {
      "/v1/things": {
        post: { responses },
      },
    },
  };
}

describe("status_code_conformance — severity matrix", () => {
  // Case 1: declared severity baseline
  it("declared severity is 'low' (proof-cap baseline)", () => {
    expect(statusCodeConformance.severity).toBe("low");
  });

  // Case 2: 500 undeclared (no 5xx wildcard, no default) → HIGH
  it("status 500 undeclared (no 5xx wildcard) → HIGH", () => {
    const doc = makeDoc({ "200": { description: "ok" } });
    const outcome = statusCodeConformance.run({
      case: buildCase("positive"),
      response: buildResp(500),
      doc,
    } as never);
    if (outcome.kind !== "fail") throw new Error("expected fail");
    expect(outcome.severity).toBe("high");
  });

  // Case 3: 422 undeclared + 400 declared → MEDIUM (partial contract)
  it("status 422 undeclared + 400 declared → MEDIUM (partial contract)", () => {
    const doc = makeDoc({
      "200": { description: "ok" },
      "400": { description: "bad request" },
    });
    const outcome = statusCodeConformance.run({
      case: buildCase("positive"),
      response: buildResp(422),
      doc,
    } as never);
    if (outcome.kind !== "fail") throw new Error("expected fail");
    expect(outcome.severity).toBe("medium");
  });

  // Case 4: 422 undeclared + only 200 declared → LOW (minimal spec)
  it("status 422 undeclared + only 200 declared → LOW (minimal spec, no 4xx baseline)", () => {
    const doc = makeDoc({ "200": { description: "ok" } });
    const outcome = statusCodeConformance.run({
      case: buildCase("positive"),
      response: buildResp(422),
      doc,
    } as never);
    if (outcome.kind !== "fail") throw new Error("expected fail");
    expect(outcome.severity).toBe("low");
  });

  // Case 5: 201 undeclared on negative_data → LOW
  it("status 201 undeclared on case.kind='negative_data' → LOW", () => {
    const doc = makeDoc({ "200": { description: "ok" } });
    const outcome = statusCodeConformance.run({
      case: buildCase("negative_data"),
      response: buildResp(201),
      doc,
    } as never);
    if (outcome.kind !== "fail") throw new Error("expected fail");
    expect(outcome.severity).toBe("low");
  });

  // Case 6: 201 undeclared on positive → MEDIUM
  it("status 201 undeclared on case.kind='positive' → MEDIUM", () => {
    const doc = makeDoc({ "200": { description: "ok" } });
    const outcome = statusCodeConformance.run({
      case: buildCase("positive"),
      response: buildResp(201),
      doc,
    } as never);
    if (outcome.kind !== "fail") throw new Error("expected fail");
    expect(outcome.severity).toBe("medium");
  });

  // Case 7: status declared → pass (no severity needed)
  it("declared status 200 → pass", () => {
    const doc = makeDoc({ "200": { description: "ok" } });
    const outcome = statusCodeConformance.run({
      case: buildCase("positive"),
      response: buildResp(200),
      doc,
    } as never);
    expect(outcome.kind).toBe("pass");
  });

  // Case 8: default declared → pass (any status conforming)
  it("default declared in spec → any status passes", () => {
    const doc = makeDoc({
      "200": { description: "ok" },
      default: { description: "any" },
    });
    const outcome = statusCodeConformance.run({
      case: buildCase("positive"),
      response: buildResp(503),
      doc,
    } as never);
    expect(outcome.kind).toBe("pass");
  });

  // Case 9: 4XX wildcard declared, 422 received → pass
  it("4XX wildcard declared, 422 received → pass", () => {
    const doc = makeDoc({
      "200": { description: "ok" },
      "4XX": { description: "client errors" },
    });
    const outcome = statusCodeConformance.run({
      case: buildCase("positive"),
      response: buildResp(422),
      doc,
    } as never);
    expect(outcome.kind).toBe("pass");
  });

  // Bonus: 2xx undeclared on missing_required_header → LOW
  it("status 201 undeclared on case.kind='missing_required_header' → LOW", () => {
    const doc = makeDoc({ "200": { description: "ok" } });
    const outcome = statusCodeConformance.run({
      case: buildCase("missing_required_header"),
      response: buildResp(201),
      doc,
    } as never);
    if (outcome.kind !== "fail") throw new Error("expected fail");
    expect(outcome.severity).toBe("low");
  });

  // Bonus: 2xx undeclared on unsupported_method → LOW
  it("status 200 undeclared on case.kind='unsupported_method' → LOW", () => {
    const doc = makeDoc({ "204": { description: "no content" } });
    const outcome = statusCodeConformance.run({
      case: buildCase("unsupported_method"),
      response: buildResp(200),
      doc,
    } as never);
    if (outcome.kind !== "fail") throw new Error("expected fail");
    expect(outcome.severity).toBe("low");
  });
});
