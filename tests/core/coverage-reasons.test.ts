import { describe, it, expect } from "bun:test";
import { buildCoverageMatrix, type BuildMatrixInput } from "../../src/core/coverage/reasons.ts";
import type { EndpointInfo } from "../../src/core/generator/types.ts";
import type { StoredStepResult } from "../../src/db/queries.ts";

function ep(over: Partial<EndpointInfo> & Pick<EndpointInfo, "method" | "path">): EndpointInfo {
  return {
    tags: [],
    parameters: [],
    responseContentTypes: [],
    responses: [{ statusCode: 200, description: "ok" }],
    security: [],
    ...over,
  } as EndpointInfo;
}

function step(over: Partial<StoredStepResult>): StoredStepResult {
  return {
    id: 1, run_id: 10, suite_name: "s", test_name: "t",
    status: "pass", duration_ms: 5,
    request_method: "GET", request_url: "http://x/pets", request_body: null,
    response_status: 200, response_body: null, response_headers: null,
    error_message: null, assertions: [], captures: {}, suite_file: null,
    provenance: null, failure_class: null, failure_class_reason: null,
    spec_pointer: null, spec_excerpt: null,
    ...over,
  } as StoredStepResult;
}

function emptyInput(): BuildMatrixInput {
  return {
    endpoints: [],
    results: [],
    fixturesAffected: new Map(),
    envVars: new Set(),
    ephemeralEndpoints: new Set(),
    tagFilter: [],
    profile: "full",
  };
}

describe("buildCoverageMatrix", () => {
  it("marks 2xx covered when a passing step matches via provenance.endpoint", () => {
    const input = emptyInput();
    input.endpoints = [ep({ method: "get", path: "/pets" })];
    input.results = [step({
      provenance: { endpoint: "GET /pets", type: "openapi-generated" },
      response_status: 200, status: "pass",
    })];
    const m = buildCoverageMatrix(input);
    expect(m.rows[0]!.cells["2xx"].status).toBe("covered");
    expect(m.rows[0]!.cells["2xx"].reasons).toContain("covered");
    expect(m.rows[0]!.cells["4xx"].status).toBe("uncovered");
  });

  it("matches via path regex when provenance is missing", () => {
    const input = emptyInput();
    input.endpoints = [ep({ method: "get", path: "/pets/{id}", responses: [{ statusCode: 200, description: "" }] })];
    input.results = [step({
      request_method: "GET", request_url: "http://x/pets/42",
      provenance: null, response_status: 200, status: "pass",
    })];
    const m = buildCoverageMatrix(input);
    expect(m.rows[0]!.cells["2xx"].status).toBe("covered");
  });

  it("flags partial when only failing steps hit the cell", () => {
    const input = emptyInput();
    input.endpoints = [ep({ method: "post", path: "/pets" })];
    input.results = [step({
      provenance: { endpoint: "POST /pets" },
      response_status: 500, status: "fail", request_method: "POST",
    })];
    const m = buildCoverageMatrix(input);
    expect(m.rows[0]!.cells["5xx"].status).toBe("partial");
    expect(m.rows[0]!.cells["5xx"].reasons).toContain("partial-failed");
  });

  it("emits no-spec when status_class is not in spec.responses", () => {
    const input = emptyInput();
    input.endpoints = [ep({ method: "get", path: "/p", responses: [{ statusCode: 200, description: "" }] })];
    const m = buildCoverageMatrix(input);
    expect(m.rows[0]!.cells["4xx"].reasons).toContain("no-spec");
    expect(m.rows[0]!.cells["5xx"].reasons).toContain("no-spec");
    expect(m.rows[0]!.cells["2xx"].reasons).not.toContain("no-spec");
  });

  it("emits no-fixtures when path-param env var is missing", () => {
    const input = emptyInput();
    input.endpoints = [ep({
      method: "get", path: "/users/{user_id}",
      responses: [{ statusCode: 200, description: "" }, { statusCode: 404, description: "" }],
    })];
    // No envVars at all → user_id missing.
    const m = buildCoverageMatrix(input);
    expect(m.rows[0]!.cells["2xx"].reasons).toContain("no-fixtures");
  });

  it("does not emit no-fixtures when env has the path-param var", () => {
    const input = emptyInput();
    input.envVars = new Set(["user_id"]);
    input.endpoints = [ep({ method: "get", path: "/users/{user_id}" })];
    const m = buildCoverageMatrix(input);
    expect(m.rows[0]!.cells["2xx"].reasons).not.toContain("no-fixtures");
  });

  it("emits auth-scope-mismatch when security scheme has no env token", () => {
    const input = emptyInput();
    input.endpoints = [ep({ method: "get", path: "/me", security: ["bearerAuth"] })];
    const m = buildCoverageMatrix(input);
    expect(m.rows[0]!.cells["2xx"].reasons).toContain("auth-scope-mismatch");
  });

  it("respects bearerAuth_token convention for env var match", () => {
    const input = emptyInput();
    input.envVars = new Set(["bearerAuth_token"]);
    input.endpoints = [ep({ method: "get", path: "/me", security: ["bearerAuth"] })];
    const m = buildCoverageMatrix(input);
    expect(m.rows[0]!.cells["2xx"].reasons).not.toContain("auth-scope-mismatch");
  });

  it("emits ephemeral-only only when profile=safe", () => {
    const input = emptyInput();
    input.endpoints = [ep({ method: "delete", path: "/pets/{id}" })];
    input.envVars = new Set(["id"]);
    input.ephemeralEndpoints = new Set(["DELETE /pets/{id}"]);
    input.profile = "full";
    let m = buildCoverageMatrix(input);
    expect(m.rows[0]!.cells["2xx"].reasons).not.toContain("ephemeral-only");
    input.profile = "safe";
    m = buildCoverageMatrix(input);
    expect(m.rows[0]!.cells["2xx"].reasons).toContain("ephemeral-only");
  });

  it("emits tag-filtered when endpoint tags don't match the filter", () => {
    const input = emptyInput();
    input.endpoints = [ep({ method: "get", path: "/admin", tags: ["admin"] })];
    input.tagFilter = ["public"];
    input.envVars = new Set();
    const m = buildCoverageMatrix(input);
    expect(m.rows[0]!.cells["2xx"].reasons).toContain("tag-filtered");
  });

  it("falls back to not-generated when no other reason fires", () => {
    const input = emptyInput();
    input.endpoints = [ep({
      method: "get", path: "/health",
      responses: [{ statusCode: 200, description: "" }, { statusCode: 503, description: "" }],
    })];
    const m = buildCoverageMatrix(input);
    // 2xx and 5xx are declared, no security, no path params → not-generated only.
    expect(m.rows[0]!.cells["2xx"].reasons).toEqual(["not-generated"]);
    expect(m.rows[0]!.cells["5xx"].reasons).toEqual(["not-generated"]);
  });

  it("always tags deprecated, even on covered cells", () => {
    const input = emptyInput();
    input.endpoints = [ep({ method: "get", path: "/old", deprecated: true })];
    input.results = [step({
      provenance: { endpoint: "GET /old" }, request_method: "GET",
      response_status: 200, status: "pass",
    })];
    const m = buildCoverageMatrix(input);
    expect(m.rows[0]!.cells["2xx"].reasons).toContain("covered");
    expect(m.rows[0]!.cells["2xx"].reasons).toContain("deprecated");
  });

  it("totals byReason add up across cells", () => {
    const input = emptyInput();
    input.endpoints = [
      ep({ method: "get", path: "/a", responses: [{ statusCode: 200, description: "" }] }),
      ep({ method: "post", path: "/b", responses: [{ statusCode: 201, description: "" }] }),
    ];
    const m = buildCoverageMatrix(input);
    expect(m.totals.endpoints).toBe(2);
    expect(m.totals.cells).toBe(6);
    expect(m.totals.uncovered).toBe(6);
    expect(m.totals.byReason["no-spec"]).toBeGreaterThan(0);
    expect(m.totals.byReason["not-generated"]).toBeGreaterThan(0);
  });
});
